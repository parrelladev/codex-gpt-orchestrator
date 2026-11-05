import { loadConfig } from '../config/index.js';
import { Store } from '../database/store.js';
import { Service } from '../agents/service.js';
import { ChromeDriver, BrowserManager } from '../browser/manager.js';
import { buildApp } from './app.js';
import path from 'node:path';

const config=loadConfig(),store=new Store(path.join(config.dataDir,'ponte.sqlite'));
const service=new Service(store,config,undefined,true,event=>process.stderr.write(JSON.stringify({at:new Date().toISOString(),...event})+'\n'));
const manager=new BrowserManager(service,new ChromeDriver(service));
const app=buildApp(service,manager,true);
let stopping=false;
const interval=setInterval(()=>{manager.tick().catch(()=>service.event({event:'maintenance_error'}));},5000);
async function shutdown() {
  if(stopping)return;stopping=true;clearInterval(interval);service.closing=true;
  await app.close(); service.shutdown(); await manager.shutdown(); store.close();
}
process.on('SIGINT',()=>{void shutdown();});process.on('SIGTERM',()=>{void shutdown();});
try { await app.listen({host:'127.0.0.1',port:config.port}); }
catch(e) { clearInterval(interval);store.close();throw e; }
