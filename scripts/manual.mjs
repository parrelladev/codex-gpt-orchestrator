import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const count=process.argv.includes('--two')?2:1;
const client=new Client({name:'manual-smoke',version:'1.0.0'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/mcp/main.js',import.meta.url))]}));
  async function call(name,args={}) {const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r.content));return r.structuredContent.data;}
  const list=await call('list_agents');const agents=list.agents.filter(a=>a.state==='idle'&&!a.paused);
  if(agents.length<count)throw new Error(`Necessários ${count} agentes ociosos registrados. Abra abas via spawn_agent ou manualmente.`);
  const tasks=await Promise.all(agents.slice(0,count).map((a,i)=>call('delegate_task',{agentId:a.id,role:'teste',prompt:`Retorne apenas JSON: {"agent":${i+1},"message":"ponte funcionando"}`})));
  const ids=tasks.map(t=>t.id);console.log('Tarefas criadas:',ids);
  let done=false;for(let i=0;i<24&&!done;i++){const r=await call('wait_for_tasks',{taskIds:ids,timeoutMs:25000});done=r.done;console.log(r.tasks.map(t=>({id:t.id,status:t.status})));}
  const results=await Promise.all(ids.map(taskId=>call('get_task_result',{taskId})));
  console.log(JSON.stringify(results,null,2));if(results.some(t=>t.status!=='completed'||!t.rawText))process.exitCode=1;
}finally{await client.close();}
