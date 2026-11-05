import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { agentSchema, taskSchema, delegateSchema, id, role } from '../tasks/types.js';
import { limitsSchema } from '../config/index.js';

export type Request = (method:string, route:string, body?:unknown,timeoutMs?:number)=>Promise<unknown>;
const publicAgent=agentSchema.omit({ticket:true});
const summaryTask=taskSchema.omit({prompt:true,rawText:true,structured:true});
const statusSchema=z.object({closing:z.boolean(),agents:z.array(publicAgent),tasks:z.array(summaryTask),limits:limitsSchema,browser:z.object({connected:z.boolean()}).optional()});
export function createMcp(request:Request) {
  const server=new McpServer({name:'codex-gpt-orchestrator',version:'0.1.0'});
  function tool<S extends z.ZodObject>(name:string,description:string,input:S,output:z.ZodType,run:(args:z.infer<S>)=>Promise<unknown>) {
    const envelope=z.object({ok:z.boolean(),data:output.optional(),error:z.object({code:z.string(),message:z.string()}).optional()});
    const shape:Record<string,z.ZodType>=input.shape;
    server.registerTool(name,{description,inputSchema:shape,outputSchema:envelope},async args=>{
      try {
        const data=output.parse(await run(input.parse(args)));
        const result=envelope.parse({ok:true,data});
        return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
      } catch(e) {
        const message=e instanceof Error?e.message:'Operation failed';
        const result={ok:false,error:{code:'OPERATION_FAILED',message:message.slice(0,500)}};
        return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result,isError:true};
      }
    });
  }
  tool('list_agents','Lista identidades, especialidades, estados e heartbeats dos agentes.',z.object({}),z.object({agents:z.array(publicAgent)}),()=>request('GET','/agents'));
  tool('spawn_agent','Reutiliza agente ocioso ou abre aba gerenciada. Requer Chrome dedicado e ponte instalada. force cria nova aba dentro dos limites.',z.object({role:role.default('geral'),force:z.boolean().default(false)}),z.object({agent:publicAgent,reused:z.boolean()}),x=>request('POST','/agents/spawn',x));
  tool('delegate_task','Enfileira trabalho independente; não executa código recebido. dependencies contém IDs de tarefas já existentes. Contexto isolado por padrão.',delegateSchema,taskSchema,x=>request('POST','/tasks',x));
  tool('get_task_status','Consulta estado e tentativa atual de uma tarefa sem retornar conteúdo.',z.object({taskId:id}),summaryTask,async x=>{const t=taskSchema.parse(await request('GET',`/tasks/${x.taskId}`));const {prompt,rawText,structured,...summary}=t;return summary;});
  tool('get_task_result','Retorna texto original não confiável, JSON quando reconhecido e metadados de anexos. Revise antes de aplicar arquivos ou comandos.',z.object({taskId:id}),taskSchema,x=>request('GET',`/tasks/${x.taskId}`));
  tool('wait_for_tasks','Espera no máximo 25 segundos por estados terminais. Retorna pendências para nova consulta; não bloqueia indefinidamente.',z.object({taskIds:z.array(id).min(1).max(32),timeoutMs:z.number().int().min(0).max(25000).default(10000)}),z.object({done:z.boolean(),tasks:z.array(summaryTask)}),async x=>{
    const end=Date.now()+x.timeoutMs;
    let previous:z.infer<typeof summaryTask>[]|undefined;
    while(true) {
      // Do not begin a poll with a near-zero HTTP timeout at the wait deadline.
      if(previous&&end-Date.now()<100)return {done:false,tasks:previous};
      let tasks:z.infer<typeof summaryTask>[];
      try {
        tasks=await Promise.all(x.taskIds.map(async taskId=>{const {prompt,rawText,structured,...t}=taskSchema.parse(await request('GET',`/tasks/${taskId}`,undefined,Math.max(100,Math.min(3000,x.timeoutMs===0?3000:end-Date.now()))));return t;}));
      }catch(e){
        if(previous&&Date.now()>=end&&e instanceof Error&&['AbortError','TimeoutError'].includes(e.name))return {done:false,tasks:previous};
        throw e;
      }
      const done=tasks.every(t=>['completed','failed','cancelled','timed_out'].includes(t.status));
      if(done || Date.now()>=end) return {done,tasks};
      previous=tasks;
      await new Promise(r=>setTimeout(r,Math.min(500,end-Date.now())));
    }
  });
  tool('cancel_task','Cancela uma tarefa e invalida sua execução; resultados atrasados são rejeitados.',z.object({taskId:id}),taskSchema,x=>request('POST',`/tasks/${x.taskId}/cancel`,{}));
  tool('terminate_agent','Encerra agente sem tarefa ativa. Fecha somente a aba que este processo criou; abas desconhecidas são preservadas.',z.object({agentId:id}),z.object({agentId:id,state:z.string()}),x=>request('POST','/agents/terminate',x));
  tool('scale_agents','Ajusta quantidade de agentes, respeitando capacidade, limites de criação e tarefas ativas. Pode retornar erro após progresso parcial; consulte status.',z.object({count:z.number().int().min(0).max(32)}),statusSchema,x=>request('POST','/agents/scale',x));
  tool('get_system_status','Consulta limites, filas, agentes e conexão do controlador CDP.',z.object({}),statusSchema,()=>request('GET','/status'));
  return server;
}
