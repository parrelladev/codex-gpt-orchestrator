import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const limitsSchema = z.object({
  maxAgents: z.number().int().min(1).max(32).default(4),
  minAgents: z.number().int().min(0).max(32).default(0),
  idleTimeoutMinutes: z.number().min(0.1).max(1440).default(5),
  maxTaskDurationMinutes: z.number().min(0.1).max(120).default(10),
  reuseIdleAgents: z.boolean().default(true), autoCloseIdleAgents: z.boolean().default(true),
  autoSpawn: z.boolean().default(true), newTabsPerMinute: z.number().int().min(1).max(20).default(4),
  heartbeatTimeoutMs: z.number().int().min(1000).default(45000),
  leaseMs: z.number().int().min(1000).default(60000),
  maxAttempts: z.number().int().min(1).max(5).default(2),
  maxQueuedTasks: z.number().int().min(1).max(10000).default(200)
}).strict();
export const configSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(3333),
  adminToken: z.string().regex(/^[a-f0-9]{64}$/), bridgeToken: z.string().regex(/^[a-f0-9]{64}$/),
  cdpUrl: z.string().url().default('http://127.0.0.1:9222'),
  dataDir: z.string().default('.local'), limits: limitsSchema.default(() => limitsSchema.parse({}))
}).strict().superRefine((c, ctx) => {
  const u = new URL(c.cdpUrl);
  if (u.hostname !== '127.0.0.1' || u.protocol !== 'http:' || u.username || u.password || u.pathname !== '/')
    ctx.addIssue({ code: 'custom', message: 'CDP must use http://127.0.0.1:port' });
  if (c.limits.minAgents > c.limits.maxAgents) ctx.addIssue({code:'custom', message:'minAgents > maxAgents'});
  if (c.adminToken === c.bridgeToken) ctx.addIssue({code:'custom', message:'Tokens must differ'});
});
export type Config = z.infer<typeof configSchema>;
export const configFile = process.env.PONTE_CONFIG || path.join(root, '.local/config.json');
export function loadConfig(): Config {
  const c = configSchema.parse(JSON.parse(readFileSync(configFile, 'utf8')));
  c.dataDir = path.resolve(root, c.dataDir);
  return c;
}
