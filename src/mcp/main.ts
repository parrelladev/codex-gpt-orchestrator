import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config/index.js';
import { createMcp } from './server.js';

const c=loadConfig();
const server=createMcp(async(method,route,body,timeoutMs)=>{
  const res=await fetch(`http://127.0.0.1:${c.port}${route}`,{
    method,headers:{authorization:`Bearer ${c.adminToken}`,'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs??(method==='GET'?3000:35000))
  });
  const data=await res.json() as {error?:{code:string;message:string}};
  if(!res.ok) throw new Error(`${data.error?.code??res.status}: ${data.error?.message??'HTTP error'}`);
  return data;
});
await server.connect(new StdioServerTransport());
