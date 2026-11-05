import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export function detectChrome() {
  return [process.env.CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'],'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'
  ].find(p=>p && existsSync(p));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const chrome=detectChrome();if(!chrome) throw new Error('Chrome não encontrado; defina CHROME_PATH.');
  const {loadConfig}=await import('../dist/config/index.js');const c=loadConfig();
  const profile=path.join(c.dataDir,'chrome-profile');mkdirSync(profile,{recursive:true});
  const child=spawn(chrome,[`--remote-debugging-port=${new URL(c.cdpUrl).port||80}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','https://chatgpt.com/'],{detached:true,stdio:'ignore',windowsHide:false});
  child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.unref();
  console.log('Chrome dedicado iniciado. Instale Tampermonkey e faça login manualmente. Perfil:',profile);
}
