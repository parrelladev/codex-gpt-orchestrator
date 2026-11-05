// ==UserScript==
// @name         Ponte GPT - Codex Orchestrator
// @namespace    local.ponte-gpt
// @version      0.1.5
// @description  Ponte local por aba: fila, heartbeat, cancelamento e resultados. Sem acesso ao terminal.
// @match        https://chatgpt.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  const key='ponte-gpt-v1';
  const version='0.1.5';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const uuid=()=>crypto.randomUUID();
  let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch{saved=null;}
  const identity={tabId:saved?.tabId||uuid(),instanceId:uuid(),agentId:null,role:saved?.role||'geral'};
  sessionStorage.setItem('ponte-gpt-document-instance',identity.instanceId);
  let paused=sessionStorage.getItem(`${key}-paused`)==='true',active=null,registered=false,halted=false;
  let lastFailure='';
  const domTimeoutMs=60000;
  let token=GM_getValue('bridgeToken',''), base=GM_getValue('server','http://127.0.0.1:3333');
  const ticket=new URLSearchParams(location.hash.slice(1));
  if(ticket.get('ponte-agent'))sessionStorage.setItem(`${key}-reservation`,JSON.stringify({agentId:ticket.get('ponte-agent'),ticket:ticket.get('ticket')}));
  let reservation;try{reservation=JSON.parse(sessionStorage.getItem(`${key}-reservation`)||'null');}catch{reservation=null;}
  const reservedId=reservation?.agentId||saved?.agentId,registrationTicket=reservation?.ticket;
  if(reservedId) history.replaceState(history.state,'',location.pathname+location.search);
  const panel=document.createElement('button');
  panel.dataset.ponteGpt='status';
  panel.style.cssText='position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#173b35;color:white;border:1px solid #79b9ab;border-radius:8px;padding:9px;max-width:340px;font:12px sans-serif';
  panel.title='Clique para pausar/retomar. Configure o token no menu Tampermonkey.';
  const status=text=>{panel.textContent=`Ponte GPT ${version} ${paused?'[pausada]':''}: ${text}`;};
  function pause() {paused=!paused;sessionStorage.setItem(`${key}-paused`,String(paused));status(paused?'pausada; tarefa atual continua':'pronta');}
  panel.onclick=pause;document.body.append(panel);
  GM_registerMenuCommand('Ponte: pausar/retomar',pause);
  GM_registerMenuCommand('Ponte: diagnosticar página',()=>alert(JSON.stringify({...domState(),lastFailure},null,2)));
  GM_registerMenuCommand('Ponte: configurar token e servidor',()=>{
    const value=prompt('bridgeToken de .local/config.json (não use adminToken):',token);if(value===null)return;
    if(!/^[a-f0-9]{64}$/.test(value)){status('token inválido');return;}
    const url=prompt('Servidor local:',base);if(!url)return;
    if(!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(url)){status('endereço inválido');return;}
    GM_setValue('bridgeToken',value);GM_setValue('server',url);location.reload();
  });
  function request(method,route,data) {
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({method,url:base+route,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        data:data===undefined?undefined:JSON.stringify(data),timeout:12000,
        onload:r=>{let body;try{body=JSON.parse(r.responseText);}catch{reject(new Error('Resposta local inválida'));return;}
          if(r.status>=200&&r.status<300)resolve(body);else {const e=new Error(body.error?.code||`HTTP ${r.status}`);e.status=r.status;reject(e);}},
        onerror:()=>reject(new Error('Servidor local indisponível')),ontimeout:()=>reject(new Error('Timeout da ponte'))});
    });
  }
  const ident=()=>({agentId:identity.agentId,instanceId:identity.instanceId});
  const execution=()=>({...ident(),taskId:active.id,executionId:active.executionId});
  const query=obj=>new URLSearchParams(obj).toString();
  const editorSelector='#prompt-textarea,#prompt-textarea [contenteditable],#prompt-textarea textarea,.ProseMirror[contenteditable],[role="textbox"][contenteditable],form textarea[placeholder]';
  const sendSelector='[data-testid="send-button"],button#composer-submit-button,button[aria-label="Send prompt"],button[aria-label="Enviar prompt"],button[aria-label="Send message"],button[aria-label="Enviar mensagem"]';
  const visible=node=>Boolean(node?.isConnected && node.getClientRects().length && getComputedStyle(node).visibility!=='hidden' && getComputedStyle(node).display!=='none');
  const editable=node=>visible(node) && !node.matches(':disabled,[readonly],[aria-disabled="true"]') && (node.isContentEditable || node instanceof HTMLTextAreaElement);
  const editor=()=>Array.from(document.querySelectorAll(editorSelector)).find(editable)||null;
  const stopButton=()=>Array.from(document.querySelectorAll('[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Parar de gerar"]')).find(visible)||null;
  const sendButton=()=>{
    const box=editor(),form=box?.closest('form');
    return Array.from(document.querySelectorAll(sendSelector)).find(visible) || (form?Array.from(form.querySelectorAll('button[type="submit"]')).find(visible):null) || null;
  };
  const turnSelector='[data-message-author-role="user"],[data-message-author-role="assistant"],[data-testid="user-message"],[data-testid="assistant-message"],article[data-turn],article[data-testid^="conversation-turn-"],[role="article"][data-turn]';
  // MarkdownRoot is the renderer observed in the user's actual ChatGPT DOM.
  // Match the stable component prefix rather than the generated CSS suffix.
  const richContentSelector='.markdown,.prose,[data-message-content],[class*="MarkdownRoot-"]';
  const richContents=()=>{
    const nodes=Array.from(document.querySelectorAll(richContentSelector)).filter(visible);
    return nodes.filter(n=>!nodes.some(parent=>parent!==n&&parent.contains(n)));
  };
  function turns() {
    const candidates=Array.from(document.querySelectorAll(turnSelector)).filter(visible);
    // Prefer the containing turn, avoiding duplicate parent/child messages.
    return candidates.filter(n=>!candidates.some(parent=>parent!==n&&parent.contains(n)));
  }
  function turnRole(node) {
    const own=node.getAttribute('data-message-author-role')||node.getAttribute('data-turn');
    if(own==='user'||own==='assistant')return own;
    const testid=node.getAttribute('data-testid');
    if(testid==='user-message')return 'user';if(testid==='assistant-message')return 'assistant';
    return node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role')||null;
  }
  const normalized=text=>text.normalize('NFKC').replace(/[\u200b-\u200d\uFEFF\u00ad]/g,'').replace(/\s+/g,' ').trim();
  function promptNodes(text) {
    const expected=normalized(text);
    // Match only visible message text, never the editor, hidden app state, or arbitrary page text as an answer.
    const matches=Array.from(document.querySelectorAll('p,div,section,article,[data-testid="user-message"]')).filter(n=>
      visible(n)&&!n.closest('[contenteditable],textarea,script,style,nav,aside')&&
      !(n.closest(turnSelector)&&turnRole(n.closest(turnSelector))==='assistant')&&normalized(n.innerText||'')===expected);
    return matches.filter(n=>!matches.some(child=>child!==n&&n.contains(child)));
  }
  function userAnchor(task) {
    const matches=promptNodes(task.sentPrompt);
    return matches[task.previousPromptCount]||null;
  }
  const contentExcluded='button,[role="button"],nav,aside,header,footer,form,[contenteditable],textarea,[data-ponte-gpt]';
  function responseToolbars() {
    const found=new Set();
    for(const button of document.querySelectorAll('button,[role="button"]')) {
      if(!visible(button)||button===panel||button.closest('nav,aside,header,footer,form,[contenteditable]'))continue;
      for(let node=button.parentElement,depth=0;node&&depth<5;node=node.parentElement,depth++) {
        if(node===document.body||node.contains(panel)||node.querySelector(editorSelector))break;
        const buttons=Array.from(node.querySelectorAll('button,[role="button"]')).filter(visible);
        if(buttons.length<2)continue;
        if(buttons.length>10)break;
        const copy=node.cloneNode(true);
        copy.querySelectorAll('button,[role="button"],svg,[aria-hidden="true"],.sr-only').forEach(n=>n.remove());
        if(!copy.textContent.trim()) {found.add(node);break;}
      }
    }
    return Array.from(found);
  }
  function following(anchor,node) {
    return visible(node)&&!node.contains(anchor)&&!anchor.contains(node)&&!node.closest(contentExcluded)&&
      Boolean(anchor.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING);
  }
  function sameConversation(anchor,node) {
    let common=anchor.parentElement;
    while(common&&!common.contains(node))common=common.parentElement;
    return Boolean(common&&common!==document.body&&common!==document.documentElement&&!common.querySelector(editorSelector)&&!common.contains(panel));
  }
  function observed(node,method,parts=[node]) {
    return {node,method,text:parts.map(n=>n.innerText||'').join('\n\n')};
  }
  function unmarkedAnswer(anchor,task) {
    const rich=richContents().filter(n=>following(anchor,n)&&sameConversation(anchor,n));
    if(rich.length)return observed(rich[rich.length-1],'rich-content');
    // Some UI variants omit author roles entirely. Infer a response only from content paired
    // with a message action toolbar, strictly after this task's confirmed question.
    for(const toolbar of responseToolbars().reverse()) {
      if(!following(anchor,toolbar)||!sameConversation(anchor,toolbar))continue;
      for(let branch=toolbar,depth=0;branch.parentElement&&depth<6;branch=branch.parentElement,depth++) {
        const parent=branch.parentElement;
        if(parent===document.body||parent.contains(anchor)||parent.querySelector(editorSelector)||parent.contains(panel))break;
        const parts=[];
        for(const sibling of parent.children) {
          if(sibling===branch)break;
          if(following(anchor,sibling)&&!sibling.matches(contentExcluded)&&!sibling.querySelector('button,[role="button"],input,textarea,[contenteditable]')&&
            sibling.innerText?.trim()&&normalized(sibling.innerText)!==normalized(task.sentPrompt))parts.push(sibling);
        }
        if(parts.length)return observed(parent,'message-toolbar',parts);
      }
    }
    return null;
  }
  function domState() {
    // Counts and flags only: no prompts, conversation text, tokens or user credentials.
    const candidates=Array.from(document.querySelectorAll(editorSelector)),box=editor(),send=sendButton();
    return {version,readyState:document.readyState,editorCandidates:candidates.length,
      visibleEditors:candidates.filter(editable).length,editorKind:box?.tagName||null,
      editorEmpty:box?!(box.value??box.textContent??'').trim():null,
      editableHints:Array.from(document.querySelectorAll('textarea,[contenteditable],[role="textbox"]')).slice(0,6).map(n=>({
        tag:n.tagName,id:n.id.slice(0,80),role:n.getAttribute('role')?.slice(0,40)||null,
        contenteditable:n.getAttribute('contenteditable'),visible:visible(n),disabled:n.matches(':disabled,[readonly],[aria-disabled="true"]')
      })),
      messageCounts:{user:turns().filter(n=>turnRole(n)==='user').length,assistant:turns().filter(n=>turnRole(n)==='assistant').length},
      captureMethod:active?.captureMethod||null,richContentCount:richContents().length,toolbarCount:responseToolbars().length,
      messageHints:Array.from(document.querySelectorAll('[data-message-author-role],[data-turn],[data-testid*="message"],article,[role="article"]')).slice(0,8).map(n=>({tag:n.tagName,role:n.getAttribute('data-message-author-role')||n.getAttribute('data-turn'),testid:n.getAttribute('data-testid')?.slice(0,80)||null})),
      sendVisible:Boolean(send),sendEnabled:Boolean(send&&!send.disabled&&send.getAttribute('aria-disabled')!=='true'),generating:Boolean(stopButton())};
  }
  function stop() {stopButton()?.click();}
  async function until(stage,fn,ms=domTimeoutMs) {
    status(`aguardando ${stage.toLowerCase()}`);
    const end=Date.now()+ms;while(Date.now()<end){if(active?.cancelled)throw new Error('Execução cancelada');const value=fn();if(value)return value;await sleep(250);}
    throw new Error(`DOM_${stage}_TIMEOUT: ${JSON.stringify(domState())}`);
  }
  async function freshConversation() {
    // Generic rich-content widgets elsewhere on the page are not conversation history.
    const modernHistory=()=>richContents().some(n=>n.matches('[class*="MarkdownRoot-"]'));
    if(!turns().length&&!modernHistory())return;
    const button=document.querySelector('[data-testid="create-new-chat-button"],a[data-testid="new-chat-button"],a[href="/"][data-discover],nav a[href="/"],button[aria-label="New chat"],button[aria-label="Nova conversa"],a[aria-label="New chat"],a[aria-label="Nova conversa"]');
    if(!button)throw new Error('NEW_CHAT_UNAVAILABLE: abra nova conversa manualmente');
    button.click();await until('NEW_CONVERSATION',()=>!turns().length&&!modernHistory()&&editor());
  }
  async function submit(task) {
    if(stopButton())throw new Error('CHAT_ALREADY_GENERATING');
    await until('EDITOR',editor);
    if(task.newConversation)await freshConversation();
    const box=await until('EDITOR',editor);
    if(box.textContent?.trim()||box.value?.trim())throw new Error('COMPOSER_NOT_EMPTY: preserve seu rascunho');
    const promptText=task.operationalPrompt||task.prompt;
    task.sentPrompt=promptText;task.previousPromptCount=promptNodes(promptText).length;
    box.focus();
    if(box instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(box,promptText);
      box.dispatchEvent(new Event('input',{bubbles:true}));
    } else {
      // Native editing keeps ProseMirror's document and React state in sync.
      if(!document.execCommand('insertText',false,promptText))throw new Error('EDITOR_INSERT_FAILED');
      box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:promptText}));
    }
    const send=await until('SEND_BUTTON',()=>{const b=sendButton();return b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'?b:null;});send.click();
    task.sent=true;
    await until('MESSAGE_ACK',()=>userAnchor(task),30000);
  }
  function answer(task) {
    const anchor=userAnchor(task);if(!anchor)return null;
    const after=turns().filter(n=>!n.contains(anchor)&&Boolean(anchor.compareDocumentPosition(n)&Node.DOCUMENT_POSITION_FOLLOWING));
    if(after.some(n=>turnRole(n)==='user'))throw new Error('CONVERSATION_MODIFIED');
    const node=after.findLast(n=>turnRole(n)==='assistant');
    if(node)return observed(node.matches(richContentSelector)?node:node.querySelector(richContentSelector)||node,'author-role');
    return unmarkedAnswer(anchor,task);
  }
  async function attachments(node) {
    // Only explicit blob downloads in this response; never fetch arbitrary URLs returned by a model.
    for(const a of Array.from(node.querySelectorAll('a[download][href^="blob:"]')).slice(0,10)) {
      try {
        const res=await fetch(a.href);const blob=await res.blob();if(blob.size>2*1024*1024)continue;
        const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});
        await request('POST','/attachments',{...execution(),name:a.download||'attachment.bin',mime:blob.type||'application/octet-stream',base64:data});
      }catch{status('anexo indisponível; texto preservado');}
    }
  }
  async function result(task) {
    let text='',changedAt=Date.now(),sentAt=0;const started=Date.now();
    while(Date.now()<task.deadline) {
      if(task.cancelled){stop();return null;}
      const observation=answer(task),node=observation?.node,next=observation?.text||'';
      task.captureMethod=observation?.method||null;
      if(next.length>1000000)throw new Error('RESPONSE_TOO_LARGE');
      if(next!==text){text=next;changedAt=Date.now();}
      if(text&&Date.now()-sentAt>3000){
        try{await request('POST','/partial',{...execution(),rawText:text});}
        catch(e){if(e.status===409||e.status===401||e.status===403)throw e;status('parcial aguardando conexão');}
        sentAt=Date.now();
      }
      if(text && !stopButton() && Date.now()-changedAt>8000 && Date.now()-started>10000) {
        await attachments(node);return text;
      }
      if(!text&&!stopButton()&&Date.now()-started>90000)throw new Error(`DOM_RESPONSE_TIMEOUT: ${JSON.stringify(domState())}`);
      await sleep(1000);
    }
    stop();throw new Error('TASK_DEADLINE');
  }
  async function deliver(payload,task) {
    while(Date.now()<task.deadline&&!task.cancelled) {
      try{return await request('POST','/complete',payload);}catch(e){if(e.status===409||e.status===404)return;status('resultado aguardando conexão');await sleep(3000);}
    }
  }
  let heartbeating=false;
  setInterval(async()=>{
    if(!registered||heartbeating)return;heartbeating=true;
    try {
      const h=await request('POST','/heartbeat',{...ident(),paused});
      if(active) {const state=await request('GET','/execution?'+query(execution()));if(!state.active||h.taskId!==active.id){active.cancelled=true;stop();}}
    }catch(e){status(e.message);if(e.status===409||e.status===404){if(active)active.cancelled=true;stop();registered=false;halted=true;status('sessão encerrada; recarregue a aba para registrar novamente');}}
    finally{heartbeating=false;}
  },10000);
  async function loop() {
    if(!token){status('configure bridgeToken no menu Tampermonkey');return;}
    while(!halted) {
      try {
        if(!registered) {
          const r=await request('POST','/register',{tabId:identity.tabId,instanceId:identity.instanceId,role:identity.role,
            ...(reservedId?{agentId:reservedId,...(registrationTicket?{ticket:registrationTicket}:{})}:{})});
          identity.agentId=r.agent.id;identity.tabId=r.agent.tabId;registered=true;
          sessionStorage.removeItem(`${key}-reservation`);
          sessionStorage.setItem(key,JSON.stringify({tabId:identity.tabId,role:identity.role,agentId:identity.agentId}));status(r.duplicate?'identidade duplicada resolvida':'registrada');
        }
        if(paused){await sleep(2000);continue;}
        const {task}=await request('GET','/next?'+query(ident()));
        if(!task){status('aguardando tarefa');await sleep(2000);continue;}
        active=task;identity.role=task.role;
        sessionStorage.setItem(key,JSON.stringify({tabId:identity.tabId,role:identity.role,agentId:identity.agentId}));status(`executando ${task.role}`);
        try {await submit(task);status('aguardando resposta');const rawText=await result(task);if(rawText!==null&&!task.cancelled)await deliver({...execution(),rawText},task);}
        catch(e) {
          lastFailure=String(e.message).slice(0,2000);
          // Failure to locate an acknowledgement must not interrupt a response already generating.
          if(!lastFailure.startsWith('DOM_MESSAGE_ACK_'))stop();
          if(!task.cancelled)await deliver({...execution(),rawText:'',error:lastFailure},task);
          if(lastFailure.startsWith('DOM_')||lastFailure.startsWith('NEW_CHAT_')) {paused=true;sessionStorage.setItem(`${key}-paused`,'true');}
          status(lastFailure);
        }
        finally{active=null;}
      }catch(e){status(e.message);if(e.status===401||e.status===403||e.status===409){halted=true;status(`${e.message}; confira configuração e recarregue`);}else await sleep(5000);}
    }
  }
  void loop();
})();
