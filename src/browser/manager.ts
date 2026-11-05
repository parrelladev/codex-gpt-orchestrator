import { chromium, type Browser, type Page } from 'playwright-core';
import { Service } from '../agents/service.js';
import { DomainError, type Agent } from '../tasks/types.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface TabDriver { open(agent:Agent):Promise<void>; close(id:string):Promise<void>; connected():boolean; detach():Promise<void>; ownsSession?(id:string,instanceId:string):Promise<boolean> }
export class ChromeDriver implements TabDriver {
  browser?:Browser;
  pages=new Map<string,Page>();
  constructor(public service:Service) {}
  connected() { return this.browser?.isConnected()??false; }
  async connect() {
    if(!this.connected()) {
      // Keep Playwright artifacts within the configured workspace, including sandboxed servers.
      const artifactsDir=path.join(this.service.config.dataDir,'browser-artifacts');
      mkdirSync(artifactsDir,{recursive:true});
      this.browser=await chromium.connectOverCDP(this.service.config.cdpUrl,{timeout:5000,artifactsDir});
    }
    return this.browser!;
  }
  async open(a:Agent) {
    const b=await this.connect(); const context=b.contexts()[0];
    if(!context) throw new Error('Dedicated Chrome profile unavailable');
    const page=await context.newPage(); this.pages.set(a.id,page);
    page.on('close',()=>{this.pages.delete(a.id); if(this.service.agent(a.id).state!=='stopping') this.service.disconnect(a.id,'Managed tab closed');});
    try { await page.goto(`https://chatgpt.com/#ponte-agent=${a.id}&ticket=${a.ticket}`,{waitUntil:'domcontentloaded',timeout:30000}); }
    catch(e) { await page.close().catch(()=>{}); throw e; }
  }
  async close(id:string) { const p=this.pages.get(id); if(p) {await p.close(); this.pages.delete(id);} }
  async ownsSession(id:string,instanceId:string) {
    const page=this.pages.get(id);if(!page||page.isClosed())return false;
    try {return await Promise.race([
      page.evaluate(nonce=>sessionStorage.getItem('ponte-gpt-document-instance')===nonce,instanceId),
      new Promise<boolean>(r=>setTimeout(()=>r(false),1000))
    ]);}catch{return false;}
  }
  async detach() {
    // For a connectOverCDP connection close disconnects Playwright; the external Chrome process remains.
    await this.browser?.close(); this.browser=undefined; this.pages.clear();
  }
}
export class BrowserManager {
  private lock:Promise<unknown>=Promise.resolve();
  private opened:number[]=[];
  private cooldownUntil=0;
  private failures=0;
  private lastClosed=0;
  constructor(public service:Service,public driver:TabDriver) {}
  private serial<T>(fn:()=>Promise<T>):Promise<T> {
    const next=this.lock.then(fn,fn); this.lock=next.catch(()=>{}); return next;
  }
  spawn(role='geral',force=false) { return this.serial(async()=>{
    const s=this.service, now=s.now();
    const idle=s.live().find(a=>a.state==='idle' && !a.paused);
    if(!force && s.config.limits.reuseIdleAgents && idle) { idle.role=role; s.store.saveAgent(idle); return {agent:idle,reused:true}; }
    if(now<this.cooldownUntil || now-this.lastClosed<15000) throw new DomainError('COOLDOWN','Browser creation cooling down',429);
    this.opened=this.opened.filter(t=>now-t<60000);
    if(this.opened.length>=s.config.limits.newTabsPerMinute) throw new DomainError('TAB_RATE_LIMIT','New tabs per minute exceeded',429);
    const a=s.create(role,true); this.opened.push(now);
    try { await this.driver.open(a); this.failures=0; return {agent:s.agent(a.id),reused:false}; }
    catch { s.disconnect(a.id,'Chrome connection or navigation failed'); this.failures++;
      this.cooldownUntil=now+Math.min(300000,30000*2**(this.failures-1));
      throw new DomainError('CHROME_UNAVAILABLE','Start dedicated Chrome, then check CDP and manual login',503); }
  }); }
  terminate(id:string) { return this.serial(async()=>{this.service.stop(id); await this.driver.close(id); this.lastClosed=this.service.now(); return {agentId:id,state:'stopping'};}); }
  async scale(target:number) {
    if(target>this.service.config.limits.maxAgents || target<this.service.config.limits.minAgents) throw new DomainError('CAPACITY','Target outside configured limits');
    const live=this.service.live(); const busy=live.filter(a=>a.state==='busy').length;
    if(target<busy) throw new DomainError('BUSY','Target would terminate active agents');
    while(this.service.live().length<target) await this.spawn('geral',true);
    const candidates=this.service.live().filter(a=>a.state!=='busy').sort((a,b)=>a.idleSince-b.idleSince);
    while(this.service.live().length>target) { const a=candidates.shift(); if(!a) break; await this.terminate(a.id); }
    return this.service.status();
  }
  private ticking=false;
  async tick() {
    if(this.ticking || this.service.closing) return; this.ticking=true;
    try {
      const s=this.service; s.sweep();
      // Close only pages created in this process, including abandoned starts; never enumerate or adopt unknown pages.
      for(const a of s.agents()) if(a.managed && ['disconnected','error','stopping'].includes(a.state)) await this.driver.close(a.id);
      const ready=s.tasks().filter(t=>t.status==='queued' && t.dependencies.every(d=>s.task(d).status==='completed'));
      if(s.config.limits.autoSpawn) {
        const busy=s.live().filter(a=>a.state==='busy').length;
        // A task pinned to a busy/paused agent cannot benefit from opening another tab.
        const targeted=new Set(ready.filter(t=>t.agentId && s.agent(t.agentId).state!=='busy').map(t=>t.agentId));
        const demand=busy+targeted.size+ready.filter(t=>!t.agentId).length;
        const target=Math.min(s.config.limits.maxAgents,Math.max(s.config.limits.minAgents,demand));
        if(s.live().length<target) { try {await this.spawn(ready[0]?.role??'geral',true);} catch(e) { s.event({event:'auto_spawn_deferred',code:e instanceof DomainError?e.code:'BROWSER_ERROR'}); } }
      }
      if(s.config.limits.autoCloseIdleAgents) for(const a of s.live())
        if(a.managed && a.state==='idle' && s.live().length>s.config.limits.minAgents && !ready.length && s.now()-a.idleSince>s.config.limits.idleTimeoutMinutes*60000) await this.terminate(a.id);
    } finally { this.ticking=false; }
  }
  async shutdown() { await this.lock; for(const a of this.service.agents()) if(a.managed) await this.driver.close(a.id); await this.driver.detach(); }
}
