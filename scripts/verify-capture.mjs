// Runs only the local userscript's read-only DOM adapter against an existing task's visible question.
// Does not submit messages, click controls or update task results.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../dist/config/index.js';
import { operationalPrompt } from '../dist/tasks/prompt.js';
const taskId=process.argv[2];
if(!/^[0-9a-f-]{36}$/.test(taskId||''))throw new Error('Usage: node scripts/verify-capture.mjs TASK_UUID');
const config=loadConfig();
const res=await fetch(`http://127.0.0.1:${config.port}/tasks/${taskId}`,{headers:{authorization:`Bearer ${config.adminToken}`},signal:AbortSignal.timeout(3000)});
if(!res.ok)throw new Error(`Task lookup failed: ${res.status}`);
const task=await res.json();task.sentPrompt=operationalPrompt(task);task.previousPromptCount=0;
const source=readFileSync(new URL('../userscript/ponte-gpt.user.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('  const editorSelector='),source.indexOf('  function stop()'));
const answerCode=source.slice(source.indexOf('  function answer(task)'),source.indexOf('  async function attachments'));
const version=source.match(/const version='([^']+)'/)?.[1];
const browser=await chromium.connectOverCDP(config.cdpUrl,{timeout:5000});let found=false;
try {
  for(const page of browser.contexts().flatMap(c=>c.pages())) {
    if(new URL(page.url()).origin!=='https://chatgpt.com')continue;
    const adapter=new Function('task',`
      const panel=document.querySelector('[data-ponte-gpt="status"]'),active=task,version=${JSON.stringify(version)};
      ${helpers}\n${answerCode}
      const matches=promptNodes(task.sentPrompt);
      if(matches.length!==1)return {matched:false,promptMatches:matches.length,richRootCount:richContents().length,
        hint:'Keep the original task conversation visible in the dedicated Chrome. No task result was modified.'};
      const captured=answer(task),anchor=userAnchor(task);
      return {matched:true,method:captured?.method||null,rawText:captured?.text||'',
        roots:richContents().map(n=>({following:following(anchor,n),sameConversation:sameConversation(anchor,n)}))};
    `);
    const result=await page.evaluate(adapter,task);
    console.log(JSON.stringify(result,null,2));if(result.matched&&result.rawText)found=true;
  }
}finally{await browser.close();}
if(!found)process.exitCode=1;
