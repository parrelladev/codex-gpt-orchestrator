import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Service } from '../src/agents/service.js';
import { fixture } from './helpers.js';
let f:ReturnType<typeof fixture>;afterEach(async()=>{await f?.cleanup();});
describe('agents, leases and durable task queue',()=>{
  it('registers independent tabs and makes registration idempotent',()=>{
    f=fixture();const a=f.register(),b=f.register();expect(a.id).not.toBe(b.id);
    expect(f.register({tabId:a.tabId,instanceId:a.instanceId}).id).toBe(a.id);expect(f.service.live()).toHaveLength(2);
  });
  it('resolves a duplicated sessionStorage tab ID to a new identity',()=>{
    f=fixture();const a=f.register(),b=f.register({tabId:a.tabId});expect(b.tabId).not.toBe(a.tabId);expect(b.id).not.toBe(a.id);
    // Retry the original request after a lost registration response.
    expect(f.register({tabId:a.tabId,instanceId:b.instanceId}).id).toBe(b.id);
  });
  it('consumes a managed registration ticket only once',async()=>{
    f=fixture();const {agent:a}=await f.manager.spawn('backend');
    const r=f.register({agentId:a.id,ticket:a.ticket,tabId:a.tabId});expect(r.id).toBe(a.id);expect(r.ticket).toBeUndefined();
    expect(f.register({agentId:a.id,ticket:a.ticket,tabId:a.tabId}).id).not.toBe(a.id);
  });
  it('renews a browser-verified managed document without closing or duplicating the agent',async()=>{
    f=fixture();const {agent:a}=await f.manager.spawn('backend');const first=f.register({agentId:a.id,ticket:a.ticket,tabId:a.tabId});
    f.enqueue({agentId:a.id});const t=f.reserve(first);
    const reloaded=f.service.register({agentId:a.id,tabId:a.tabId,instanceId:randomUUID(),role:'backend'},true).agent;
    expect(reloaded.id).toBe(a.id);expect(reloaded.state).toBe('idle');expect(f.service.task(t.id)).toMatchObject({status:'queued',executionId:null});
    expect(f.service.live()).toHaveLength(1);
  });
  it('assigns at most one task per agent and one execution per task',()=>{
    f=fixture();const a=f.register(),b=f.register();f.enqueue();const t=f.reserve(a);
    expect(f.reserve(a)).toBeNull();expect(f.reserve(b)).toBeNull();expect(f.service.task(t.id).attempts).toBe(1);
  });
  it('honors priorities, dependencies and target agent',()=>{
    f=fixture();const a=f.register(),b=f.register();const first=f.enqueue({agentId:a.id});
    const second=f.enqueue({dependencies:[first.id],priority:99});expect(f.reserve(b)).toBeNull();
    const t=f.reserve(a);expect(t.id).toBe(first.id);f.service.reply({...f.execution(a,t),rawText:'done'});
    expect(f.reserve(b).id).toBe(second.id);
  });
  it('preserves raw text and recognizes structured JSON',()=>{
    f=fixture();const a=f.register();f.enqueue();const t=f.reserve(a),raw='```json\n{"summary":"ok"}\n```';
    f.service.reply({...f.execution(a,t),rawText:'partial'},true);expect(f.service.task(t.id).status).toBe('streaming');
    f.service.reply({...f.execution(a,t),rawText:raw});expect(f.service.task(t.id)).toMatchObject({rawText:raw,structured:{summary:'ok'},status:'completed'});
    expect(f.service.agent(a.id).completed).toBe(1);
    expect(()=>f.service.reply({...f.execution(a,t),rawText:'overwrite'})).toThrow('Execution');
  });
  it('invalidates cancelled executions and dependent tasks',()=>{
    f=fixture();const a=f.register();const first=f.enqueue(),dep=f.enqueue({dependencies:[first.id]});const t=f.reserve(a);
    f.service.cancel(t.id);expect(()=>f.service.reply({...f.execution(a,t),rawText:'late'})).toThrow();
    f.service.sweep();expect(f.service.task(dep.id).status).toBe('failed');expect(f.service.task(t.id).status).toBe('cancelled');
  });
  it('rejects leases before sweep, requeues disconnects and rejects superseded results',()=>{
    f=fixture();const a=f.register(),b=f.register();f.enqueue();const old=f.reserve(a);
    f.advance(60001);expect(()=>f.service.reply({...f.execution(a,old),rawText:'late'})).toThrow();
    f.service.heartbeat(b.id,b.instanceId);f.service.sweep();const next=f.reserve(b);
    expect(next.id).toBe(old.id);expect(next.executionId).not.toBe(old.executionId);expect(next.attempts).toBe(2);
    expect(()=>f.service.reply({...f.execution(a,old),rawText:'stale'})).toThrow();
  });
  it('heartbeats renew a lease without extending its hard deadline',()=>{
    f=fixture();const a=f.register();f.enqueue();const t=f.reserve(a);
    for(let i=0;i<15;i++){f.advance(40000);f.service.heartbeat(a.id,a.instanceId);f.service.sweep();}
    expect(f.service.task(t.id).status).toBe('timed_out');expect(f.service.task(t.id).deadline).toBe(t.deadline);
  });
  it('reconnects the same document after network loss',()=>{
    f=fixture();const a=f.register();f.advance(45001);f.service.sweep();expect(f.service.agent(a.id).state).toBe('disconnected');
    const b=f.register({tabId:a.tabId,instanceId:a.instanceId});expect(b.id).toBe(a.id);expect(b.state).toBe('idle');
  });
  it('pauses reservations without consuming queued tasks',()=>{
    f=fixture();const a=f.register();f.enqueue();f.service.heartbeat(a.id,a.instanceId,true);expect(f.reserve(a)).toBeNull();
    f.service.heartbeat(a.id,a.instanceId,false);expect(f.reserve(a)).not.toBeNull();
  });
  it('recovers interrupted executions from SQLite with bounded retries',()=>{
    f=fixture(true);const a=f.register();f.enqueue();const t=f.reserve(a);
    const recovered=new Service(f.store,f.config);expect(recovered.task(t.id)).toMatchObject({status:'queued',executionId:null,agentId:null});
    const b=f.register();const retry=f.reserve(b);f.service.disconnect(b.id,'lost');expect(f.service.task(retry.id).status).toBe('failed');
  });
  it('shuts down safely and prevents further registrations or claims',()=>{
    f=fixture();const a=f.register();f.enqueue();f.reserve(a);f.service.shutdown();
    expect(f.service.live()).toHaveLength(0);expect(f.service.tasks()[0].status).toBe('queued');expect(()=>f.register()).toThrow('stopping');
  });
  it('rejects unknown dependencies and wrong identity',()=>{
    f=fixture();const a=f.register();expect(()=>f.enqueue({dependencies:[randomUUID()]})).toThrow('not found');
    expect(()=>f.service.reserve(a.id,randomUUID())).toThrow('session');
  });
});
