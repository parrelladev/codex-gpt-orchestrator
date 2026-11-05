// Read-only DOM diagnostics for the dedicated CDP instance. Never reads cookies or session stores.
import { chromium } from 'playwright-core';
import { loadConfig } from '../dist/config/index.js';
const config=loadConfig();
const browser=await chromium.connectOverCDP(config.cdpUrl,{timeout:5000});
try {
  for(const page of browser.contexts().flatMap(c=>c.pages())) {
    if(new URL(page.url()).origin!=='https://chatgpt.com')continue;
    const result=await page.evaluate(()=>{
      const visible=n=>Boolean(n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');
      const shape=n=>({tag:n.tagName,id:n.id,className:typeof n.className==='string'?n.className.slice(0,180):'',role:n.getAttribute('role'),testid:n.getAttribute('data-testid')});
      // This diagnostic targets the arithmetic smoke-test response already supplied by the user.
      const matches=Array.from(document.querySelectorAll('div,p,span,pre,code')).filter(n=>visible(n)&&/^\{\s*"resultado"\s*:\s*391\s*\}$/.test(n.innerText?.trim()||''));
      const leaves=matches.filter(n=>!matches.some(child=>child!==n&&n.contains(child)));
      return {ponteStatus:document.querySelector('[data-ponte-gpt="status"]')?.textContent||null,
      renderers:Array.from(document.querySelectorAll('[class*="MarkdownRoot-"]')).filter(visible).map(n=>({...shape(n),textLength:n.innerText?.length||0,ariaBusy:n.getAttribute('aria-busy')})),
      editors:Array.from(document.querySelectorAll('[role="textbox"][contenteditable],#prompt-textarea')).filter(visible).map(n=>({...shape(n),textLength:n.textContent?.length||0,visibleTextLength:n.innerText?.length||0,
        placeholder:n.getAttribute('data-placeholder')||n.getAttribute('aria-placeholder'),children:Array.from(n.children).slice(0,8).map(c=>({...shape(c),textLength:c.textContent?.length||0,visibleTextLength:c.innerText?.length||0,contenteditable:c.getAttribute('contenteditable'),ariaHidden:c.getAttribute('aria-hidden')}))})),
      responseMatches:leaves.length,structures:leaves.slice(-2).map(n=>{
        const ancestors=[];for(let p=n;p&&ancestors.length<11;p=p.parentElement)ancestors.push({...shape(p),containsEditor:Boolean(p.querySelector('[role="textbox"][contenteditable],#prompt-textarea')),children:Array.from(p.children).slice(0,10).map(shape)});
        return ancestors;
      }),markdownCount:document.querySelectorAll('.markdown,.prose').length,
      actionControls:Array.from(document.querySelectorAll('button,[role="button"]')).filter(n=>visible(n)&&/copy|copiar|good response|bad response|boa resposta|resposta ruim|share|compartilhar/i.test(n.getAttribute('aria-label')||n.getAttribute('title')||'')).map(n=>({...shape(n),label:n.getAttribute('aria-label')||n.getAttribute('title')})).slice(-12)};
    });
    console.log(JSON.stringify(result,null,2));
  }
}finally{await browser.close();}
