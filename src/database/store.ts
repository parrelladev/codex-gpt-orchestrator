import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Agent, Task } from '../tasks/types.js';

// One HTTP writer; MCP always goes through HTTP. Transactions also protect multiple SQLite connections.
export class Store {
  db:DatabaseSync;
  constructor(file:string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), {recursive:true});
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, at INTEGER, payload TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  agents():Agent[] { return this.db.prepare('SELECT payload FROM agents').all().map(r=>JSON.parse(String(r.payload))); }
  tasks():Task[] { return this.db.prepare('SELECT payload FROM tasks').all().map(r=>JSON.parse(String(r.payload))); }
  saveAgent(a:Agent) { this.db.prepare('INSERT INTO agents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(a.id,JSON.stringify(a)); }
  saveTask(t:Task) { this.db.prepare('INSERT INTO tasks VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(t.id,JSON.stringify(t)); }
  transaction<T>(fn:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const v=fn(); this.db.exec('COMMIT'); return v; }
    catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  event(data:Record<string,unknown>) { this.db.prepare('INSERT INTO events(at,payload) VALUES (?,?)').run(Date.now(),JSON.stringify(data)); }
  close() { this.db.close(); }
}
