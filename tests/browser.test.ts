import { afterEach,expect,it } from 'vitest';
import { fixture } from './helpers.js';
let f:ReturnType<typeof fixture>;afterEach(async()=>{await f?.cleanup();});
it('reuses idle agents and enforces maximum capacity under concurrent spawning',async()=>{
  f=fixture();const a=f.register();expect((await f.manager.spawn('frontend')).agent.id).toBe(a.id);
  const outcomes=await Promise.allSettled(Array.from({length:5},()=>f.manager.spawn('geral',true)));
  expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(3);expect(f.service.live()).toHaveLength(4);
});
it('scales dynamically and leaves active tasks untouched',async()=>{
  f=fixture();await f.manager.scale(2);expect(f.opened).toHaveLength(2);
  const a=f.service.agents()[0];const r=f.register({agentId:a.id,ticket:a.ticket});f.enqueue();f.reserve(r);
  await expect(f.manager.scale(0)).rejects.toThrow('active');await f.manager.scale(1);expect(f.service.agent(a.id).state).toBe('busy');
});
it('auto-spawns only ready work up to configured limits',async()=>{
  f=fixture();f.config.limits.autoSpawn=true;f.config.limits.maxAgents=2;
  f.enqueue();f.enqueue();f.enqueue();await f.manager.tick();await f.manager.tick();await f.manager.tick();expect(f.opened).toHaveLength(2);
});
it('closes idle owned tabs, preserves manual tabs and applies churn cooldown',async()=>{
  f=fixture();const manual=f.register();const a=(await f.manager.spawn('geral',true)).agent;
  f.register({agentId:a.id,ticket:a.ticket});f.advance(6*60000);
  // Simulate healthy idle agents so only idle timeout applies.
  for(const agent of f.service.live())f.service.heartbeat(agent.id,agent.instanceId);
  await f.manager.tick();expect(f.closed).toEqual([a.id]);expect(f.service.agent(manual.id).state).toBe('idle');
  await expect(f.manager.spawn('geral',true)).rejects.toThrow('cooling');
});
it('bounds creation rate and repeated connection errors',async()=>{
  f=fixture();f.config.limits.newTabsPerMinute=1;await f.manager.spawn('geral',true);
  await expect(f.manager.spawn('geral',true)).rejects.toThrow('per minute');f.advance(60001);
  f.driver.open=async()=>{throw new Error('CDP unavailable');};await expect(f.manager.spawn('geral',true)).rejects.toThrow('dedicated Chrome');
  await expect(f.manager.spawn('geral',true)).rejects.toThrow('cooling');
});
it('releases queued target tasks when an idle agent terminates',async()=>{
  f=fixture();const a=f.register();const t=f.enqueue({agentId:a.id});await f.manager.terminate(a.id);expect(f.service.task(t.id).agentId).toBeNull();
});
it('does not spawn unnecessary agents for tasks pinned to an existing agent',async()=>{
  f=fixture();f.config.limits.autoSpawn=true;const a=f.register();
  for(let i=0;i<4;i++)f.enqueue({agentId:a.id});
  await f.manager.tick();expect(f.opened).toHaveLength(0);
  f.reserve(a);await f.manager.tick();expect(f.opened).toHaveLength(0);
});
