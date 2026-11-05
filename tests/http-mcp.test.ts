import { afterEach,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcp } from '../src/mcp/server.js';
import { fixture } from './helpers.js';
let f:ReturnType<typeof fixture>;afterEach(async()=>{await f?.cleanup();});

it('authenticates bridge and admin separately and validates origins and payloads',async()=>{
  f=fixture();expect((await f.app.inject('/health')).statusCode).toBe(200);
  for(const headers of [{},f.bridge,{...f.admin,origin:'https://evil.example'},{...f.admin,origin:'https://chatgpt.com'}])
    expect((await f.app.inject({url:'/status',headers})).statusCode).toBeGreaterThanOrEqual(401);
  expect((await f.app.inject({url:'/status',headers:f.admin})).statusCode).toBe(200);
  expect((await f.app.inject({method:'POST',url:'/register',headers:f.admin,payload:{}})).statusCode).toBe(401);
  expect((await f.app.inject({method:'POST',url:'/register',headers:f.bridge,payload:{tabId:'bad'}})).statusCode).toBe(400);
  expect((await f.app.inject({method:'POST',url:'/tasks',headers:f.admin,payload:{prompt:'hi',command:'rm'}})).statusCode).toBe(400);
});
it('atomically claims tasks across simultaneous HTTP requests',async()=>{
  f=fixture();const agents=Array.from({length:4},()=>f.register());const t=f.enqueue();
  const outcomes=await Promise.all(agents.map(a=>f.app.inject({url:`/next?agentId=${a.id}&instanceId=${a.instanceId}`,headers:f.bridge})));
  const assigned=outcomes.map(r=>r.json().task).filter(Boolean);expect(assigned).toHaveLength(1);expect(assigned[0].id).toBe(t.id);
});
it('enforces input size, attachment isolation and path traversal checks',async()=>{
  f=fixture();const a=f.register();f.enqueue();const t=f.reserve(a),x=f.execution(a,t);
  expect((await f.app.inject({method:'POST',url:'/complete',headers:f.bridge,payload:{...x,rawText:'x'.repeat(1000001)}})).statusCode).toBe(400);
  expect((await f.app.inject({method:'POST',url:'/complete',headers:f.bridge,payload:{...x,rawText:'x'.repeat(4*1024*1024)}})).statusCode).toBe(413);
  for(const name of ['../config.json','..\\secrets','NUL.txt','/tmp/a','a:b']) {
    const r=await f.app.inject({method:'POST',url:'/attachments',headers:f.bridge,payload:{...x,name,mime:'text/plain',base64:'aGk='}});expect(r.statusCode).toBe(400);
  }
  const r=await f.app.inject({method:'POST',url:'/attachments',headers:f.bridge,payload:{...x,name:'answer.txt',mime:'text/plain',base64:'aGk='}});
  expect(r.statusCode).toBe(200);expect(r.json().bytes).toBe(2);expect(f.service.task(t.id).attachments).toHaveLength(1);
  f.service.cancel(t.id);expect((await f.app.inject({method:'POST',url:'/complete',headers:f.bridge,payload:{...x,rawText:'late'}})).statusCode).toBe(409);
});
it('validates runtime configuration and queue limits',async()=>{
  f=fixture();f.register();f.register();
  expect((await f.app.inject({method:'PATCH',url:'/config',headers:f.admin,payload:{maxAgents:1}})).statusCode).toBe(409);
  expect((await f.app.inject({method:'PATCH',url:'/config',headers:f.admin,payload:{maxQueuedTasks:1}})).statusCode).toBe(200);
  f.enqueue();expect(()=>f.enqueue()).toThrow('full');
});
it('exercises all ten MCP tools and two simulated agents end to end',async()=>{
  f=fixture();const server=createMcp(async(method,route,body)=>{
    const r=await f.app.inject({method:method as 'GET'|'POST',url:route,headers:f.admin,payload:body as Record<string,unknown>});
    if(r.statusCode>=400)throw new Error(r.json().error.message);return r.json();
  });
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'test-orchestrator',version:'1.0.0'});
  await server.connect(serverTransport);await client.connect(clientTransport);
  async function call(name:string,args:Record<string,unknown>={}) {
    const r=await client.callTool({name,arguments:args});expect(r.isError,JSON.stringify(r.content)).not.toBe(true);
    return (r.structuredContent as {data:any}).data;
  }
  try {
    const tools=await client.listTools();expect(tools.tools).toHaveLength(10);expect(tools.tools.every(t=>t.outputSchema)).toBe(true);
    await call('scale_agents',{count:2});
    const managed=f.service.agents();const agents=managed.map(a=>f.register({agentId:a.id,ticket:a.ticket}));
    expect((await call('list_agents')).agents).toHaveLength(2);
    expect((await call('spawn_agent',{role:'testes'})).reused).toBe(true);
    const t1=await call('delegate_task',{prompt:'A'}),t2=await call('delegate_task',{prompt:'B'});
    const tasks=await Promise.all(agents.map(async a=>{
      const r=await f.app.inject({url:`/next?agentId=${a.id}&instanceId=${a.instanceId}`,headers:f.bridge});return r.json().task;
    }));
    expect(new Set(tasks.map(t=>t.id)).size).toBe(2);expect(f.service.live().filter(a=>a.state==='busy')).toHaveLength(2);
    expect((await call('get_task_status',{taskId:t1.id})).status).toBe('assigned');
    expect((await call('wait_for_tasks',{taskIds:[t1.id,t2.id],timeoutMs:0})).done).toBe(false);
    // A pending wait must finish normally at its deadline, rather than abort a 1ms final HTTP poll.
    const waiting=await call('wait_for_tasks',{taskIds:[t1.id,t2.id],timeoutMs:600});
    expect(waiting.done).toBe(false);expect(waiting.tasks).toHaveLength(2);
    await Promise.all(tasks.map((t,i)=>f.app.inject({method:'POST',url:'/complete',headers:f.bridge,payload:{...f.execution(agents[i],t),rawText:JSON.stringify({summary:`worker ${i}`})}})));
    expect((await call('wait_for_tasks',{taskIds:[t1.id,t2.id]})).done).toBe(true);
    expect((await call('get_task_result',{taskId:t1.id})).structured.summary).toMatch(/worker/);
    const pending=await call('delegate_task',{prompt:'cancel'});expect((await call('cancel_task',{taskId:pending.id})).status).toBe('cancelled');
    expect((await call('get_system_status')).agents).toHaveLength(2);
    await call('terminate_agent',{agentId:agents[0].id});expect(f.closed).toContain(agents[0].id);
    const invalid=await client.callTool({name:'get_task_result',arguments:{taskId:randomUUID()}});expect(invalid.isError).toBe(true);
  }finally {await client.close();await server.close();}
});
