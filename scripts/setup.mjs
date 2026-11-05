import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'.local');mkdirSync(dir,{recursive:true});
const file=path.join(dir,'config.json');
if(existsSync(file)) console.log('Configuração existente preservada:',file);
else {writeFileSync(file,JSON.stringify({port:3333,adminToken:randomBytes(32).toString('hex'),bridgeToken:randomBytes(32).toString('hex'),cdpUrl:'http://127.0.0.1:9222',dataDir:'.local',limits:{maxAgents:4,minAgents:0,idleTimeoutMinutes:5,maxTaskDurationMinutes:10,reuseIdleAgents:true,autoCloseIdleAgents:true,autoSpawn:true,newTabsPerMinute:4}},null,2),{flag:'wx',mode:0o600});console.log('Configuração criada:',file);}
console.log('Tokens não são exibidos. Abra o arquivo local para configurar o Tampermonkey. Não compartilhe .local.');
