import { z } from 'zod';
export const id = z.string().uuid();
export const role = z.string().trim().min(1).max(80);
export const agentStates = ['starting','idle','busy','error','disconnected','stopping'] as const;
export const taskStates = ['queued','assigned','running','streaming','completed','failed','cancelled','timed_out'] as const;
export const agentSchema = z.object({
  id, tabId:id, instanceId: z.string(), role, state:z.enum(agentStates), taskId:id.nullable(),
  createdAt:z.number(), heartbeatAt:z.number(), idleSince:z.number(), completed:z.number(), failures:z.number(),
  managed:z.boolean(), paused:z.boolean(), ticket:z.string().optional()
});
export type Agent = z.infer<typeof agentSchema>;
export const delegateSchema = z.object({
  prompt:z.string().min(1).max(100000), role:role.default('geral'),
  agentId:id.optional(), priority:z.number().int().min(0).max(100).default(1),
  dependencies:z.array(id).max(100).default([]), newConversation:z.boolean().default(true)
}).strict();
export const taskSchema = z.object({
  id, agentId:id.nullable(), role, prompt:z.string(), status:z.enum(taskStates), priority:z.number(),
  dependencies:z.array(id), newConversation:z.boolean(), createdAt:z.number(), updatedAt:z.number(),
  executionId:id.nullable(), leaseUntil:z.number().nullable(), deadline:z.number().nullable(),
  attempts:z.number(), rawText:z.string(), structured:z.unknown().nullable(), error:z.string().nullable(),
  attachments:z.array(z.object({id, name:z.string(), mime:z.string(), bytes:z.number()}))
});
export type Task = z.infer<typeof taskSchema>;
export const active = (t:Task) => ['assigned','running','streaming'].includes(t.status);
export const terminal = (t:Task) => ['completed','failed','cancelled','timed_out'].includes(t.status);
export const identitySchema = z.object({agentId:id, instanceId:id}).strict();
export const executionSchema = identitySchema.extend({taskId:id, executionId:id}).strict();
export const replySchema = executionSchema.extend({
  rawText:z.string().max(1000000), error:z.string().max(2000).optional()
}).strict();
export class DomainError extends Error {
  constructor(public code:string, message:string, public status=409) { super(message); }
}
