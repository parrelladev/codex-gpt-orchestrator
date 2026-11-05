import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configSchema } from '../src/config/index.js';
import { Store } from '../src/database/store.js';
import { Service } from '../src/agents/service.js';
import { BrowserManager, type TabDriver } from '../src/browser/manager.js';
import { delegateSchema, type Agent } from '../src/tasks/types.js';
import { buildApp } from '../src/server/app.js';

export function fixture(persist=false) {
  const dir=mkdtempSync(path.join(os.tmpdir(),'ponte-test-'));
  const config=configSchema.parse({adminToken:'a'.repeat(64),bridgeToken:'b'.repeat(64),dataDir:dir,limits:{autoSpawn:false}});
  const store=new Store(persist?path.join(dir,'test.sqlite'):':memory:');let time=1000000;
  const service=new Service(store,config,()=>time);
  const opened:string[]=[],closed:string[]=[];
  const driver:TabDriver={open:async a=>{opened.push(a.id);},close:async id=>{if(opened.includes(id))closed.push(id);},connected:()=>true,detach:async()=>{}};
  const manager=new BrowserManager(service,driver),app=buildApp(service,manager);
  function register(extra={}) {return service.register({tabId:randomUUID(),instanceId:randomUUID(),role:'geral',...extra}).agent;}
  const enqueue=(extra={})=>service.delegate(delegateSchema.parse({prompt:'Teste',...extra}));
  const reserve=(a:Agent)=>service.reserve(a.id,a.instanceId)!;
  const execution=(a:Agent,t:ReturnType<typeof reserve>)=>({agentId:a.id,instanceId:a.instanceId,taskId:t.id,executionId:t.executionId!});
  const admin={authorization:`Bearer ${config.adminToken}`},bridge={authorization:`Bearer ${config.bridgeToken}`};
  return {dir,config,store,service,manager,app,opened,closed,driver,register,enqueue,reserve,execution,admin,bridge,
    advance:(ms:number)=>{time+=ms;},cleanup:async()=>{await app.close();store.close();rmSync(dir,{recursive:true,force:true});}};
}
