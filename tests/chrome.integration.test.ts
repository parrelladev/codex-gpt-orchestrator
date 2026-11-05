import { expect,it } from 'vitest';
import { chromium } from 'playwright-core';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ChromeDriver } from '../src/browser/manager.js';
import { fixture } from './helpers.js';
// Deliberately opt-in: actual local Chrome, but a controlled HTML fixture, no ChatGPT session.
import { detectChrome } from '../scripts/chrome.mjs';

it.skipIf(process.env.RUN_CHROME_TESTS!=='1')('runs two userscripts via real Chrome/CDP and preserves an unknown tab',async()=>{
  const f=fixture();f.service.now=()=>Date.now();
  const profile=mkdtempSync(path.join(os.tmpdir(),'ponte-chrome-test-'));
  const context=await chromium.launchPersistentContext(profile,{executablePath:detectChrome(),headless:true,
    args:['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--disable-extensions']});
  let driver:ChromeDriver|undefined;
  let documentCount=0;
  try {
    const port=readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
    f.config.cdpUrl=`http://127.0.0.1:${port}`;
    await context.route('https://chatgpt.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body>
      <button data-testid="create-new-chat-button" onclick="document.getElementById('messages').replaceChildren()">New</button>
      <form><textarea placeholder="hidden legacy editor" style="display:none"></textarea></form>
      <div id="messages"></div>${++documentCount===1?'<div id="prompt-textarea" class="ProseMirror" contenteditable="" style="min-height:24px"></div>':documentCount===2?'<textarea id="prompt-textarea"></textarea>':'<div id="prompt-textarea"><div class="ProseMirror" contenteditable="true" style="min-height:24px"></div></div>'}<button ${documentCount>2?'id="composer-submit-button"':'data-testid="send-button"'}>Send</button>
      <script>window.sentPrompts=[];const send=document.querySelector('[data-testid="send-button"],#composer-submit-button');
      document.addEventListener('input',()=>{send.style.display='';});send.onclick=()=>{
        const root=document.getElementById('prompt-textarea'),e=root.querySelector('[contenteditable]')||root;
        const u=document.createElement(${documentCount>2?"'article'":"'div'"});${documentCount===1?"u.dataset.messageAuthorRole='user';":documentCount>2?"u.dataset.turn='user';u.dataset.testid='conversation-turn-0';":"u.className='bubble-without-role';"}
        u.textContent=e.value??e.innerText;window.sentPrompts.push(u.textContent);if('value' in e)e.value='';else e.replaceChildren();document.getElementById('messages').append(u);send.style.display='none';
        if(window.suppressResponse)return;
        const stop=document.createElement('button');stop.dataset.testid='stop-button';document.body.append(stop);
        const a=document.createElement(${documentCount===2?"'div'":"'article'"});${documentCount===1?"a.dataset.messageAuthorRole='assistant';":documentCount===2?'':"a.dataset.testid='assistant-message';"}
        const content=document.createElement('div');${documentCount===2?"content.className=window.richFallback?'MarkdownRoot-ChangedHash':'MarkdownRoot-RealLayout';":"content.className='markdown';"}
        const renderer=document.createElement('div');renderer.className='DilRenderer-Test DilResponseRoot-Test';const p=document.createElement('p'),output=document.createElement('span');output.textContent='working';p.append(output);renderer.append(p);content.append(renderer);
        let wrapped=content;for(let i=0;i<8;i++){const outer=document.createElement('div');outer.append(wrapped);wrapped=outer;}a.append(wrapped);
        const actions=document.createElement('div');for(let i=0;i<3;i++){const b=document.createElement('button');b.style.cssText='width:20px;height:20px';actions.append(b);}a.append(actions);document.getElementById('messages').append(a);
        setTimeout(()=>{output.textContent=JSON.stringify({summary:'fixture completed',ordinal:window.sentPrompts.length,tests:['simulated UI']});stop.remove();},500);
      };</script></body></html>`}));
    await context.exposeBinding('ponteRequest',async(_source,options:{method:string;url:string;headers:Record<string,string>;data?:string})=>{
      const url=new URL(options.url);expect(url.hostname).toBe('127.0.0.1');
      const response=await f.app.inject({method:options.method as 'GET'|'POST',url:url.pathname+url.search,headers:options.headers,payload:options.data});
      return {status:response.statusCode,responseText:response.body};
    });
    const source=readFileSync(fileURLToPath(new URL('../userscript/ponte-gpt.user.js',import.meta.url)),'utf8');
    await context.addInitScript({content:`
      window.GM_getValue=(key,fallback)=>key==='bridgeToken'?'${f.config.bridgeToken}':fallback;
      window.GM_setValue=()=>{};window.ponteMenus={};window.GM_registerMenuCommand=(name,callback)=>{window.ponteMenus[name]=callback;};
      window.alert=text=>{window.ponteDiagnostic=text;};
      window.GM_xmlhttpRequest=options=>window.ponteRequest({method:options.method,url:options.url,headers:options.headers,data:options.data}).then(options.onload,options.onerror);
      window.addEventListener('DOMContentLoaded',()=>{${source}\n});`});
    const unknown=await context.newPage();await unknown.goto('about:blank');
    driver=new ChromeDriver(f.service);f.manager.driver=driver;const manager=f.manager;
    await manager.scale(2);
    expect(existsSync(path.join(f.config.dataDir,'browser-artifacts'))).toBe(true);
    await expect.poll(()=>f.service.live().filter(a=>a.state==='idle').length,{timeout:10000}).toBe(2);
    // Empty contenteditable attributes are valid HTML and must not be treated as a missing editor.
    const first=f.enqueue({agentId:f.service.live()[0].id});
    await expect.poll(()=>f.service.task(first.id).status,{timeout:30000}).toBe('completed');
    const reloadedId=f.service.live()[0].id;await driver.pages.get(reloadedId)!.reload();
    await expect.poll(()=>f.service.live().length).toBe(2);
    await expect.poll(()=>f.service.agent(reloadedId).instanceId).toBe(await driver.pages.get(reloadedId)!.evaluate(()=>sessionStorage.getItem('ponte-gpt-document-instance')));
    const tasks=f.service.live().map(a=>f.enqueue({agentId:a.id}));
    await expect.poll(()=>f.service.tasks().filter(t=>t.status==='completed').length,{timeout:30000}).toBe(3);
    for(const t of tasks)expect(f.service.task(t.id)).toMatchObject({structured:{summary:'fixture completed'},status:'completed'});
    const page=driver.pages.get(reloadedId)!;
    // Repeated prompts in the same conversation must bind to the new turn, not a previous answer.
    const repeated=f.enqueue({agentId:reloadedId,newConversation:false});
    const otherId=f.service.live().find(a=>a.id!==reloadedId)!.id;
    await driver.pages.get(otherId)!.evaluate(()=>{(window as unknown as {richFallback:boolean}).richFallback=true;});
    const rich=f.enqueue({agentId:otherId,newConversation:false});
    await expect.poll(()=>[f.service.task(repeated.id).status,f.service.task(rich.id).status],{timeout:30000}).toEqual(['completed','completed']);
    expect(f.service.task(rich.id).structured).toMatchObject({ordinal:2});
    expect(f.service.task(repeated.id).structured).toMatchObject({ordinal:2});
    const prompts=await page.evaluate(()=>(window as unknown as {sentPrompts:string[]}).sentPrompts);
    expect(prompts).toHaveLength(2);expect(prompts.every(p=>!p.includes('PONTE TASK')&&!p.includes('summary, files'))).toBe(true);
    await page.clock.install();
    await page.evaluate(()=>{
      (window as unknown as {suppressResponse:boolean}).suppressResponse=true;
      const unrelated=document.createElement('div');unrelated.innerHTML='<div class="markdown">{"resultado":391}</div><button>Copy</button><button>Share</button>';document.body.append(unrelated);
    });
    const noResponse=f.enqueue({agentId:reloadedId});
    await expect.poll(()=>page.locator('[data-ponte-gpt="status"]').textContent(),{timeout:5000}).toContain('aguardando resposta');
    await page.clock.fastForward(91000);
    await expect.poll(()=>f.service.task(noResponse.id).status,{timeout:5000}).toBe('failed');
    expect(f.service.task(noResponse.id).rawText).toBe('');
    expect(f.service.task(noResponse.id).error).toContain('DOM_RESPONSE_TIMEOUT');
    await page.locator('[data-ponte-gpt="status"]').click();
    await page.evaluate(()=>document.getElementById('prompt-textarea')!.remove());
    const missing=f.enqueue({agentId:reloadedId});
    await expect.poll(()=>f.service.task(missing.id).status,{timeout:5000}).toBe('assigned');
    await page.clock.fastForward(61000);
    await expect.poll(()=>f.service.task(missing.id).status,{timeout:5000}).toBe('failed');
    expect(f.service.task(missing.id).error).toContain('DOM_EDITOR_TIMEOUT');
    expect(f.service.task(missing.id).error).toContain('"visibleEditors":0');
    const diagnostic=await page.evaluate(()=>{
      const w=window as unknown as {ponteMenus:Record<string,()=>void>;ponteDiagnostic:string};
      w.ponteMenus['Ponte: diagnosticar página']();return JSON.parse(w.ponteDiagnostic);
    });
    expect(diagnostic).toMatchObject({version:'0.1.5',visibleEditors:0,editorEmpty:null});
    expect(JSON.stringify(diagnostic)).not.toContain(f.config.bridgeToken);
    await manager.scale(0);expect(unknown.isClosed()).toBe(false);expect(driver.pages.size).toBe(0);
  }finally {
    await driver?.detach();await context.close();await f.cleanup();rmSync(profile,{recursive:true,force:true});
  }
},90000);
