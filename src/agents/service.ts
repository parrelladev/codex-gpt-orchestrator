import { randomUUID } from 'node:crypto';
import type { Config } from '../config/index.js';
import { Store } from '../database/store.js';
import { active, terminal, DomainError, delegateSchema, type Agent, type Task } from '../tasks/types.js';
import { z } from 'zod';
import { operationalPrompt } from '../tasks/prompt.js';

export const registerSchema = z.object({
  tabId:z.string().uuid(), instanceId:z.string().uuid(), role:z.string().min(1).max(80).default('geral'),
  agentId:z.string().uuid().optional(), ticket:z.string().uuid().optional()
}).strict();
export class Service {
  closing=false;
  constructor(public store:Store, public config:Config, public now=()=>Date.now(), recover=true,
    public log:(event:Record<string,unknown>)=>void=()=>{}) {
    if (recover) this.recover();
  }
  event(event:Record<string,unknown>) { this.store.event(event); this.log(event); }
  agents() { return this.store.agents(); }
  tasks() { return this.store.tasks(); }
  agent(id:string) { const a=this.agents().find(a=>a.id===id); if(!a) throw new DomainError('NOT_FOUND','Agent not found',404); return a; }
  task(id:string) { const t=this.tasks().find(t=>t.id===id); if(!t) throw new DomainError('NOT_FOUND','Task not found',404); return t; }
  live() { return this.agents().filter(a=>!['disconnected','error','stopping'].includes(a.state)); }
  capacity() { if(this.closing) throw new DomainError('SHUTTING_DOWN','Server stopping',503); if(this.live().length>=this.config.limits.maxAgents) throw new DomainError('CAPACITY','Agent capacity reached'); }
  create(role='geral', managed=false):Agent {
    this.capacity(); const at=this.now();
    const a:Agent={id:randomUUID(),tabId:randomUUID(),instanceId:'',role,state:'starting',taskId:null,
      createdAt:at,heartbeatAt:at,idleSince:at,completed:0,failures:0,managed,paused:false,
      ...(managed?{ticket:randomUUID()}:{})};
    this.store.saveAgent(a); this.event({event:'agent_created',agentId:a.id,state:a.state}); return a;
  }
  register(input:z.infer<typeof registerSchema>,ownedSession=false) {
    return this.store.transaction(()=>{
      if(this.closing) throw new DomainError('SHUTTING_DOWN','Server stopping',503);
      const previous=this.agents().find(a=>a.instanceId===input.instanceId);
      if(previous && !['stopping','error'].includes(previous.state)) {
        if(previous.state==='disconnected') { this.capacity(); previous.state='idle'; }
        previous.heartbeatAt=this.now(); this.store.saveAgent(previous); return {agent:previous,duplicate:false};
      }
      let reserved=input.agentId?this.agent(input.agentId):undefined;
      const validTicket=reserved?.state==='starting' && reserved.ticket && reserved.ticket===input.ticket;
      const managedReload=ownedSession && reserved?.managed && reserved.state!=='stopping';
      if(managedReload && reserved) {
        if(['disconnected','error'].includes(reserved.state))this.capacity();
        if(reserved.taskId) {this.disconnect(reserved.id,'Managed document reloaded');reserved=this.agent(reserved.id);}
      }
      const duplicate=!managedReload && this.agents().some(a=>a.tabId===input.tabId && a.instanceId!==input.instanceId);
      const a=validTicket||managedReload?reserved!:this.create(input.role);
      if(validTicket && this.now()-a.createdAt>this.config.limits.heartbeatTimeoutMs) throw new DomainError('EXPIRED','Registration ticket expired');
      a.tabId=duplicate&&!managedReload?randomUUID():input.tabId; a.instanceId=input.instanceId;
      a.state='idle'; a.heartbeatAt=this.now(); a.idleSince=this.now(); delete a.ticket;
      this.store.saveAgent(a); this.event({event:'agent_registered',agentId:a.id,duplicate});
      return {agent:a,duplicate};
    });
  }
  identity(agentId:string,instanceId:string) {
    const a=this.agent(agentId);
    if(a.instanceId!==instanceId || ['stopping','disconnected','error','starting'].includes(a.state)) throw new DomainError('IDENTITY','Agent session inactive');
    return a;
  }
  heartbeat(agentId:string,instanceId:string,paused=false) {
    const a=this.identity(agentId,instanceId); a.heartbeatAt=this.now(); a.paused=paused;
    if(a.taskId) { const t=this.task(a.taskId); if(active(t) && (t.deadline??0)>this.now() && (t.leaseUntil??0)>this.now()) {
      t.leaseUntil=Math.min(this.now()+this.config.limits.leaseMs,t.deadline!);
      if(t.status==='assigned') t.status='running'; this.store.saveTask(t);
    }}
    this.store.saveAgent(a); return {state:a.state,taskId:a.taskId,paused:a.paused};
  }
  delegate(input:z.infer<typeof delegateSchema>):Task {
    if(this.closing) throw new DomainError('SHUTTING_DOWN','Server stopping',503);
    if(this.tasks().filter(t=>!terminal(t)).length>=this.config.limits.maxQueuedTasks) throw new DomainError('QUEUE_FULL','Queue full');
    input.dependencies.forEach(d=>this.task(d));
    if(input.agentId) { const a=this.agent(input.agentId); if(['error','disconnected','stopping'].includes(a.state)) throw new DomainError('AGENT_UNAVAILABLE','Target agent inactive'); }
    const at=this.now(); const t:Task={id:randomUUID(),agentId:input.agentId??null,role:input.role,prompt:input.prompt,
      status:'queued',priority:input.priority,dependencies:input.dependencies,newConversation:input.newConversation,
      createdAt:at,updatedAt:at,executionId:null,leaseUntil:null,deadline:null,attempts:0,rawText:'',structured:null,error:null,attachments:[]};
    this.store.saveTask(t); this.event({event:'task_queued',taskId:t.id,state:t.status}); return t;
  }
  reserve(agentId:string,instanceId:string) {
    return this.store.transaction(()=>{
      const a=this.identity(agentId,instanceId); if(this.closing || a.paused || a.state!=='idle') return null;
      const t=this.tasks().filter(t=>t.status==='queued' && (!t.agentId || t.agentId===a.id) &&
        t.dependencies.every(d=>this.task(d).status==='completed')).sort((x,y)=>y.priority-x.priority || x.createdAt-y.createdAt)[0];
      if(!t) return null;
      t.agentId=a.id; t.executionId=randomUUID(); t.attempts++; t.status='assigned'; t.updatedAt=this.now();
      t.deadline=this.now()+this.config.limits.maxTaskDurationMinutes*60000;
      t.leaseUntil=Math.min(this.now()+this.config.limits.leaseMs,t.deadline);
      a.state='busy'; a.taskId=t.id; a.role=t.role; a.heartbeatAt=this.now();
      this.store.saveTask(t); this.store.saveAgent(a);
      this.event({event:'task_reserved',taskId:t.id,agentId:a.id,executionId:t.executionId,state:t.status,attempts:t.attempts});
      return {...t, operationalPrompt:operationalPrompt(t)};
    });
  }
  execution(input:{agentId:string;instanceId:string;taskId:string;executionId:string}) {
    const a=this.identity(input.agentId,input.instanceId), t=this.task(input.taskId);
    if(a.taskId!==t.id || t.agentId!==a.id || t.executionId!==input.executionId || !active(t) ||
      (t.leaseUntil??0)<=this.now() || (t.deadline??0)<=this.now()) throw new DomainError('STALE_EXECUTION','Execution cancelled, expired or replaced');
    return {a,t};
  }
  reply(input:{agentId:string;instanceId:string;taskId:string;executionId:string;rawText:string;error?:string},partial=false) {
    return this.store.transaction(()=>{
      const {a,t}=this.execution(input); if(!input.error || input.rawText) t.rawText=input.rawText; t.updatedAt=this.now();
      if(partial) t.status='streaming';
      else {
        t.status=input.error?'failed':'completed'; t.error=input.error??null;
        try { t.structured=JSON.parse(t.rawText.replace(/^```(?:json)?\s*|\s*```$/g,'')); } catch { t.structured=null; }
        a.state='idle'; a.taskId=null; a.idleSince=this.now();
        if(input.error) a.failures++; else a.completed++;
        this.store.saveAgent(a);
      }
      this.store.saveTask(t); this.event({event:partial?'task_streaming':'task_finished',agentId:a.id,taskId:t.id,state:t.status,durationMs:this.now()-t.createdAt,attempts:t.attempts});
      return {taskId:t.id,status:t.status};
    });
  }
  finish(t:Task,status:Task['status'],reason:string) {
    t.status=status; t.error=reason; t.updatedAt=this.now(); t.leaseUntil=null;
    if(t.agentId) { const a=this.agent(t.agentId); if(a.taskId===t.id) { a.taskId=null; a.state='idle'; a.idleSince=this.now(); a.failures++; this.store.saveAgent(a); } }
    this.store.saveTask(t); this.event({event:'task_stopped',taskId:t.id,agentId:t.agentId,state:status,reason,attempts:t.attempts});
  }
  cancel(id:string) { return this.store.transaction(()=>{const t=this.task(id); if(!terminal(t)) this.finish(t,'cancelled','Cancelled by orchestrator'); return this.task(id);}); }
  disconnect(id:string,reason:string) {
    const a=this.agent(id);
    if(a.taskId) {const t=this.task(a.taskId); if(active(t)) {
      this.finish(t,t.attempts<this.config.limits.maxAttempts?'queued':'failed',reason);
      t.agentId=null; t.executionId=null; t.rawText=''; t.structured=null; t.attachments=[]; this.store.saveTask(t);
    }}
    a.taskId=null; a.state='disconnected'; a.failures++; delete a.ticket; this.store.saveAgent(a);
    for(const t of this.tasks()) if(t.status==='queued' && t.agentId===id) {t.agentId=null;this.store.saveTask(t);}
    this.event({event:'agent_disconnected',agentId:a.id,state:a.state,reason});
  }
  stop(id:string) {
    const a=this.agent(id); if(a.taskId) throw new DomainError('BUSY','Cannot terminate an active agent');
    a.state='stopping'; delete a.ticket; this.store.saveAgent(a);
    for(const t of this.tasks()) if(t.status==='queued' && t.agentId===id) {t.agentId=null;this.store.saveTask(t);}
    this.event({event:'agent_stopping',agentId:a.id,state:a.state}); return a;
  }
  sweep() {
    const now=this.now();
    for(const t of this.tasks()) {
      if(active(t) && (t.deadline??0)<=now) this.finish(t,'timed_out','Task duration exceeded');
      else if(active(t) && (t.leaseUntil??0)<=now && t.agentId) this.disconnect(t.agentId,'Lease expired');
      else if(t.status==='queued' && t.dependencies.some(d=>['failed','cancelled','timed_out'].includes(this.task(d).status))) this.finish(t,'failed','Dependency did not complete');
    }
    for(const a of this.live()) if(now-a.heartbeatAt>this.config.limits.heartbeatTimeoutMs) this.disconnect(a.id,'Heartbeat expired');
  }
  recover() {
    for(const t of this.tasks()) if(active(t)) {
      t.status=t.attempts<this.config.limits.maxAttempts?'queued':'failed'; t.error='Server restarted; previous execution invalidated';
      t.agentId=null; t.executionId=null; t.leaseUntil=null; t.rawText=''; t.attachments=[]; this.store.saveTask(t);
    }
    for(const a of this.live()) {a.state='disconnected'; a.taskId=null; delete a.ticket; this.store.saveAgent(a);}
    for(const t of this.tasks()) if(t.status==='queued' && t.agentId) {t.agentId=null;this.store.saveTask(t);}
  }
  shutdown() { this.closing=true; for(const a of this.live()) this.disconnect(a.id,'Server shutting down'); }
  status() { return {closing:this.closing,agents:this.agents().map(({ticket,...a})=>a),tasks:this.tasks().map(({prompt,rawText,structured,...t})=>t),limits:this.config.limits}; }
}
