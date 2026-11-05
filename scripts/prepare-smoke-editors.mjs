// Recovery for exact stale prompts from explicitly selected prior smoke-test task IDs.
// Dry run by default. Never clears an unrecognized draft; backup is written before any edit.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadConfig } from '../dist/config/index.js';
const c=loadConfig(),clear=process.argv.includes('--clear-owned');
const taskIds=process.argv.slice(2).filter(arg=>/^[0-9a-f-]{36}$/.test(arg));
if(!taskIds.length)throw new Error('Pass prior smoke-test TASK_UUID values; --clear-owned is optional');
const expected=[];
for(const taskId of taskIds){
  const r=await fetch(`http://127.0.0.1:${c.port}/tasks/${taskId}`,{headers:{authorization:`Bearer ${c.adminToken}`},signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw new Error('Smoke-test task not found; nothing will be cleared');
  const task=await r.json();
  expected.push({taskId,text:task.prompt},{taskId,text:`Especialidade: ${task.role}. Não execute comandos nem delegue tarefas.\nSiga o formato de resposta solicitado na tarefa abaixo.\n\n${task.prompt}`});
}
const artifactsDir=path.join(c.dataDir,'browser-artifacts');mkdirSync(artifactsDir,{recursive:true});
const browser=await chromium.connectOverCDP(c.cdpUrl,{timeout:5000,artifactsDir});
try {
  for(const page of browser.contexts().flatMap(ctx=>ctx.pages())) {
    if(new URL(page.url()).origin!=='https://chatgpt.com')continue;
    const draft=await page.evaluate(expected=>{
      const compact=s=>s.normalize('NFKC').replace(/\s+/g,'');
      const box=Array.from(document.querySelectorAll('[role="textbox"][contenteditable],.ProseMirror[contenteditable]')).find(n=>n.isContentEditable&&n.getClientRects().length);
      if(!box)return null;
      const text=box.innerText||box.textContent||'';
      const match=expected.find(item=>compact(text)===compact(item.text));
      return {text,owned:Boolean(match),matchingTaskId:match?.taskId,length:text.length};
    },expected);
    if(!draft?.owned){console.log(JSON.stringify({owned:false,length:draft?.length||0,changed:false}));continue;}
    if(!clear){console.log(JSON.stringify({owned:true,matchingTaskId:draft.matchingTaskId,length:draft.length,changed:false}));continue;}
    const backup=path.join(c.dataDir,`recovered-smoke-draft-${randomUUID()}.json`);
    writeFileSync(backup,JSON.stringify({at:new Date().toISOString(),text:draft.text},null,2),{flag:'wx',mode:0o600});
    const changed=await page.evaluate(expected=>{
      const compact=s=>s.normalize('NFKC').replace(/\s+/g,'');
      const box=Array.from(document.querySelectorAll('[role="textbox"][contenteditable],.ProseMirror[contenteditable]')).find(n=>n.isContentEditable&&n.getClientRects().length);
      if(!box||!expected.some(item=>compact(box.innerText||box.textContent||'')===compact(item.text)))return false;
      box.focus();if(document.activeElement!==box&&!box.contains(document.activeElement))return false;
      const range=document.createRange();range.selectNodeContents(box);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('delete',false))return false;
      box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
      return !(box.textContent||'').trim();
    },expected);
    console.log(JSON.stringify({owned:true,changed,backup}));
  }
}finally{await browser.close();}
