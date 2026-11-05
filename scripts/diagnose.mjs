import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { detectChrome } from './chrome.mjs';
import { loadConfig, root } from '../dist/config/index.js';
const c=loadConfig();let failures=0;
async function check(name,fn) {try{console.log(`OK ${name}: ${await fn()}`);}catch(e){failures++;console.log(`FALHA ${name}: ${e.message}`);}}
await check('Node',()=>{if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node >=22.13');return process.version;});
await check('Chrome',()=>{const chrome=detectChrome();if(!chrome)throw new Error('Não encontrado');return chrome;});
await check('HTTP',async()=>{const r=await fetch(`http://127.0.0.1:${c.port}/health`,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw new Error(String(r.status));return JSON.stringify(await r.json());});
await check('CDP',async()=>{const r=await fetch(`${c.cdpUrl}/json/version`,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw new Error(String(r.status));const v=await r.json();return v.Browser;});
await check('Ponte / agentes',async()=>{const r=await fetch(`http://127.0.0.1:${c.port}/agents`,{headers:{authorization:`Bearer ${c.adminToken}`},signal:AbortSignal.timeout(3000)});if(!r.ok)throw new Error(String(r.status));const a=(await r.json()).agents.filter(a=>a.instanceId && ['idle','busy'].includes(a.state));if(!a.length)throw new Error('Nenhuma ponte registrada e conectada');return `${a.length} agente(s)`;});
await check('SQLite',()=>{const db=new DatabaseSync(path.join(c.dataDir,'ponte.sqlite'),{readOnly:true});try {return db.prepare('PRAGMA integrity_check').get().integrity_check;}finally{db.close();}});
await check('MCP stdio',async()=>{const client=new Client({name:'diagnose',version:'1.0.0'});try{await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/mcp/main.js',import.meta.url))],cwd:root}));const tools=await client.listTools();const status=await client.callTool({name:'get_system_status',arguments:{}});if(status.isError)throw new Error('MCP respondeu, mas HTTP indisponível');return `${tools.tools.length} ferramentas; get_system_status OK`;}finally{await client.close();}});
process.exitCode=failures?1:0;
