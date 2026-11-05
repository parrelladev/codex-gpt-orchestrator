import Fastify, { LogController } from 'fastify';
import { z, ZodError } from 'zod';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Service, registerSchema } from '../agents/service.js';
import { BrowserManager } from '../browser/manager.js';
import { DomainError, id, identitySchema, executionSchema, replySchema, delegateSchema, role } from '../tasks/types.js';
import { equals, safeName } from '../security/auth.js';
import { limitsSchema } from '../config/index.js';

export function buildApp(s:Service,browser:BrowserManager,logger=false) {
  const app=Fastify({logger,bodyLimit:3*1024*1024,logController:new LogController({disableRequestLogging:true}),requestTimeout:10000});
  const bridgeRoutes=['/register','/heartbeat','/next','/complete','/partial','/execution','/attachments'];
  app.setErrorHandler((e,_req,res)=>{
    if(e instanceof ZodError) return res.code(400).send({error:{code:'VALIDATION',message:'Invalid parameters',fields:e.issues.map(i=>i.path.join('.'))}});
    if(e instanceof DomainError) return res.code(e.status).send({error:{code:e.code,message:e.message}});
    const status=(e as {statusCode?:number}).statusCode??500;
    return res.code(status).send({error:{code:status===500?'INTERNAL':'HTTP_ERROR',message:status===500?'Internal error':'Invalid request'}});
  });
  app.addHook('onRequest',async(req,res)=>{
    const origin=req.headers.origin;
    if(origin && origin!=='https://chatgpt.com') return res.code(403).send({error:{code:'ORIGIN',message:'Origin denied'}});
    const pathname=req.url.split('?')[0];
    if(pathname==='/health' && req.method==='GET') return;
    const bearer=req.headers.authorization?.replace(/^Bearer /,'')??'';
    const isBridge=bridgeRoutes.includes(pathname);
    // No CORS: GM_xmlhttpRequest is privileged; page scripts cannot access the local bridge.
    const allowed=isBridge?equals(bearer,s.config.bridgeToken):!origin && equals(bearer,s.config.adminToken);
    if(!allowed) return res.code(401).send({error:{code:'AUTH',message:'Unauthorized'}});
  });
  app.get('/health',()=>({ok:!s.closing,service:'ponte-gpt',version:'0.1.0'}));
  app.get('/status',()=>({...s.status(),browser:{connected:browser.driver.connected()}}));
  app.post('/register',async req=>{
    const x=registerSchema.parse(req.body);
    const owned=x.agentId?await browser.driver.ownsSession?.(x.agentId,x.instanceId)??false:false;
    const {agent,duplicate}=s.register(x,owned);const {ticket,...publicAgent}=agent;return {agent:publicAgent,duplicate};
  });
  app.post('/heartbeat',req=>{const x=identitySchema.extend({paused:z.boolean().default(false)}).parse(req.body); return s.heartbeat(x.agentId,x.instanceId,x.paused);});
  app.get('/next',req=>{const x=identitySchema.parse(req.query); return {task:s.reserve(x.agentId,x.instanceId)};});
  app.get('/execution',req=>{const x=executionSchema.parse(req.query); try {const {t}=s.execution(x);return {active:true,status:t.status};}catch(e){if(e instanceof DomainError)return {active:false};throw e;}});
  app.post('/partial',req=>s.reply(replySchema.parse(req.body),true));
  app.post('/complete',req=>s.reply(replySchema.parse(req.body)));
  app.post('/attachments',req=>{
    const x=executionSchema.extend({name:z.string(),mime:z.string().max(100),base64:z.string().max(2800000).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).parse(req.body);
    const {t}=s.execution(x); if(t.attachments.length>=10) throw new DomainError('ATTACHMENTS_LIMIT','Maximum 10 attachments');
    let name:string; try {name=safeName(x.name);}catch{throw new DomainError('FILE_NAME','Invalid attachment name',400);}
    const data=Buffer.from(x.base64,'base64'); if(data.length>2*1024*1024 || data.toString('base64')!==x.base64) throw new DomainError('SIZE','Invalid or oversized base64',400);
    const attachmentId=randomUUID(),dir=path.join(s.config.dataDir,'attachments'); mkdirSync(dir,{recursive:true});
    // Filename supplied by the agent is metadata only. Stored filename is always a generated UUID.
    writeFileSync(path.join(dir,attachmentId),data,{flag:'wx'});
    const a={id:attachmentId,name,mime:x.mime,bytes:data.length};t.attachments.push(a);s.store.saveTask(t);return a;
  });
  app.get('/agents',()=>({agents:s.status().agents}));
  app.post('/agents/spawn',async req=>{const x=z.object({role:role.default('geral'),force:z.boolean().default(false)}).strict().parse(req.body??{});const result=await browser.spawn(x.role,x.force);const {ticket,...agent}=result.agent;return {...result,agent};});
  app.post('/agents/terminate',req=>{const x=z.object({agentId:id}).strict().parse(req.body);return browser.terminate(x.agentId);});
  app.post('/agents/scale',req=>{const x=z.object({count:z.number().int().min(0).max(32)}).strict().parse(req.body);return browser.scale(x.count);});
  app.post('/tasks',req=>s.delegate(delegateSchema.parse(req.body)));
  app.get('/tasks/:id',req=>s.task(z.object({id}).parse(req.params).id));
  app.get('/chat/:id',req=>s.task(z.object({id}).parse(req.params).id));
  app.post('/tasks/:id/cancel',req=>s.cancel(z.object({id}).parse(req.params).id));
  app.patch('/config',req=>{
    const patch=limitsSchema.partial().parse(req.body),next={...s.config.limits,...patch};
    if(next.minAgents>next.maxAgents || s.live().length>next.maxAgents) throw new DomainError('CAPACITY','Scale down first; minAgents must not exceed maxAgents');
    s.config.limits=next; return {limits:next,persistent:false};
  });
  return app;
}
