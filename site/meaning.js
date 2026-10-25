const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function supportsMeaningSearch(runtime=globalThis){
 // The local ONNX backend needs SIMD. Probe the instruction, not the browser name.
 // This module returns i8x16.splat(i32.const 0) without loading any search assets.
 try{return typeof runtime.Worker==='function'&&typeof runtime.WebAssembly?.validate==='function'&&runtime.WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,8,1,6,0,65,0,253,15,11]));}catch{return false;}
}

export function meaningLink(hit,base=import.meta.url){
 const url=new URL('./read/'+encodeURIComponent(hit.slug)+'/',base);if(hit.translationId)url.searchParams.set('translation',hit.translationId);url.hash=hit.id;return url.href;
}
export function meaningResults(result){
 if(result.status==='zero'||!result.matches?.length)return '<p class="meaning-empty">No sufficiently close passage was found among the included English translations. Try a shorter description, or use <button type="button" class="text-link" data-action="search">ordinary text search</button>.</p>';
 return result.matches.map(hit=>`<article class="meaning-hit"><header><a class="meaning-ref" href="${esc(meaningLink(hit))}">${esc(hit.author)} · ${esc(hit.reference||'DK '+hit.id.replaceAll('-',' '))} →</a><span>Possible match</span></header><blockquote class="meaning-excerpt" lang="en">${hit.start>0?'…':''}${esc(hit.text)}${hit.end<hit.sourceTextLength?'…':''}</blockquote><p class="meaning-credit">${esc(hit.credit)}</p><a class="text-link" href="${esc(meaningLink(hit))}">Read the passage &amp; its sources →</a></article>`).join('');
}

if(typeof document!=='undefined'&&document.querySelector('[data-meaning-page]')){
 const $=selector=>document.querySelector(selector),form=$('#meaning-form'),input=$('#meaning-query'),status=$('#meaning-status'),results=$('#meaning-results'),progress=$('#meaning-progress');
 const supported=supportsMeaningSearch();
 let worker,requestId=0,currentQuery='';
 function showUnsupported(){status.textContent='Remembered-saying search is unavailable in this browser.';results.innerHTML='<p>Try another browser, or use <button type="button" class="text-link" data-action="search">word and DK-reference search</button>, which covers every available language.</p>';progress.hidden=true;results.setAttribute('aria-busy','false');form.querySelector('button[type=submit]').disabled=true;}
 function showError(){status.textContent='Search could not finish in this browser.';results.innerHTML='<p>Please try again. Ordinary text search remains available.</p><button type="button" data-meaning-retry>Try again</button>';progress.hidden=true;results.setAttribute('aria-busy','false');form.querySelector('button[type=submit]').textContent='Find possible matches';}
 function getWorker(){
  if(worker)return worker;
  worker=new Worker(new URL('./meaning-worker.js',import.meta.url),{type:'module'});
  const activeWorker=worker;
  worker.addEventListener('message',event=>{
   const message=event.data;if(worker!==activeWorker||message.requestId!==requestId)return;
   if(message.type==='progress'){status.textContent=message.stage==='searching'?'Comparing passages…':'Preparing the local search…';return;}
   if(message.type==='error'){activeWorker.terminate();worker=null;showError();return;}
   if(message.type!=='result')return;
   progress.hidden=true;results.setAttribute('aria-busy','false');form.querySelector('button[type=submit]').textContent='Find possible matches';
   status.textContent=message.status==='zero'||!message.matches?.length?'Zero matches found':`${message.matches.length} possible match${message.matches.length===1?'':'es'}`;
   results.innerHTML=meaningResults(message);
  });
  worker.addEventListener('error',()=>{if(worker!==activeWorker)return;activeWorker.terminate();worker=null;showError();});
  return worker;
 }
 function search(){
  if(!supported){showUnsupported();return;}
  const query=input.value.trim();requestId++;if(!query){status.textContent='Enter a few words or a sentence.';results.innerHTML='';progress.hidden=true;results.setAttribute('aria-busy','false');form.querySelector('button[type=submit]').textContent='Find possible matches';input.focus();return;}
  currentQuery=query;results.innerHTML='';results.setAttribute('aria-busy','true');progress.hidden=false;status.textContent='Preparing the local search…';form.querySelector('button[type=submit]').textContent='Searching…';
  try{getWorker().postMessage({type:'search',requestId,query});}catch{worker?.terminate();worker=null;showError();}
 }
 form.addEventListener('submit',event=>{event.preventDefault();search();});
 document.querySelector('[data-meaning-page]').addEventListener('click',event=>{
  const example=event.target.closest('[data-meaning-example]');if(example){input.value=example.dataset.meaningExample;search();}
  if(event.target.closest('[data-meaning-retry]')){if(!input.value.trim())input.value=currentQuery;search();}
 });
 window.addEventListener('pagehide',()=>{worker?.terminate();worker=null;if(!progress.hidden){requestId++;progress.hidden=true;results.setAttribute('aria-busy','false');status.textContent='Search paused. Submit the phrase again to continue.';form.querySelector('button[type=submit]').textContent='Find possible matches';}});
 if(!supported)showUnsupported();
}
