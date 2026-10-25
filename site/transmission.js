const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=value=>/^https?:\/\//.test(value||'')?value:'#';
const scopeLabel=value=>({'selected-reading':'Citation in the selected reading.','supporting-source-record':'Citation in a linked historical source record.'})[value]||'';
const reference=value=>/^\d+\s/.test(value||'')?'DK '+value:value;
const norm=value=>String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function ancientSourceLink(id,base=import.meta.url){const url=new URL('./sources/',base);url.searchParams.set('source',id);return url.href;}
const correspondenceMarkup=w=>{
 const evidence=Array.isArray(w.concordanceEvidence)?w.concordanceEvidence:w.concordanceEvidence?[w.concordanceEvidence]:[];
 return (w.concordanceNote?'<p>'+esc(w.concordanceNote)+'</p>':'')+(evidence.length?'<details class="transmission-correspondence"><summary>Passage correspondence</summary>'+evidence.map(item=>'<p>'+esc(item.excerpt)+'</p>').join('')+'</details>':'');
};
export function transmissionMarkup(entry,optionId){
 const option=entry?.options?.[optionId]||(!optionId?entry?.options?.[entry.defaultTranslationId]:null);
 if(!option)return '<p class="transmission-note">A source citation has not yet been identified for this reading. Consult the passage’s source notes below.</p>';
 const witnesses=option.witnesses||[];
 const body=witnesses.length?'<ul class="transmission-witnesses">'+witnesses.map(w=>`<li><strong>${w.authorId?`<a href="${esc(ancientSourceLink(w.authorId))}">${esc(w.author)}</a>`:esc(w.author)}</strong>${w.work||w.locator?`<p>${w.work?'<cite>'+esc(w.work)+'</cite>':''}${w.work&&w.locator?' · ':''}${esc(w.locator)}</p>`:''}<details class="transmission-evidence"><summary>Citation in the source record</summary><p>${esc(w.citation)}</p>${w.contextEvidence?.length?'<p>Preceding citation(s)</p><ul>'+w.contextEvidence.map(context=>'<li>'+esc(context.excerpt)+'</li>').join('')+'</ul>':''}${correspondenceMarkup(w)}${w.sourceUrl?`<a href="${esc(safeUrl(w.sourceUrl))}" target="_blank" rel="noopener noreferrer">Check the source record ↗</a>`:''}</details>${w.note?`<p class="transmission-note">${esc(w.note)}</p>`:''}${w.scope?`<p class="transmission-note">${esc(scopeLabel(w.scope))}</p>`:''}</li>`).join('')+'</ul>':'<p class="transmission-note">A source citation has not yet been identified for this reading.</p>';
 return body+(option.note?`<p class="transmission-note">${esc(option.note)}</p>`:'')+(option.edition?`<p class="transmission-edition"><strong>Original-text edition</strong><br>${esc(option.edition.description)}${option.edition.url?`<br><a href="${esc(safeUrl(option.edition.url))}" target="_blank" rel="noopener noreferrer">Open the historical edition ↗</a>`:''}</p>`:'');
}
export function sourcePassageLink(p,entry,authors,base=import.meta.url){
 const author=authors.get(Number(p.chapter||entry?.chapter));if(!author)return null;
 const url=new URL('./read/'+encodeURIComponent(author.slug)+'/',base);if(p.translationId)url.searchParams.set('translation',p.translationId);url.hash=p.id;return url.href;
}
export function sourceGroups(data,authors,{query='',chapter='',source=''}={}){
 const q=norm(query.trim());
 return (data.sources||[]).filter(s=>(!source||s.id===source)&&(!q||norm(s.name).includes(q))).map(s=>{
  const passages=(s.passages||[]).filter(p=>(!chapter||Number(p.chapter)===Number(chapter))&&data.entries[p.id]&&sourcePassageLink(p,data.entries[p.id],authors));
  const preferred=new Map();
  const rank=p=>(p.translationId&&p.translationId===data.entries[p.id].defaultTranslationId?2:0)+(p.scope==='selected-reading'?1:0);
  for(const passage of passages){const previous=preferred.get(passage.id);if(!previous||rank(passage)>rank(previous))preferred.set(passage.id,passage);}
  const unique=[...preferred.values()].sort((a,b)=>Number(a.chapter)-Number(b.chapter)||a.id.localeCompare(b.id,'en',{numeric:true,sensitivity:'base'}));
  return {...s,passages:unique};
 }).filter(s=>s.passages.length).sort((a,b)=>a.name.localeCompare(b.name,'en'));
}
export function sourceDirectoryMarkup(groups,data,authors,expand=false){
 return groups.map(group=>`<details class="source-group" id="source-${esc(group.id)}" ${expand?'open':''}><summary><strong>${esc(group.name)}</strong><span>${group.passages.length} passage${group.passages.length===1?'':'s'}</span></summary><ul class="source-passages">${group.passages.map(p=>`<li><a href="${esc(sourcePassageLink(p,data.entries[p.id],authors))}">${esc(authors.get(Number(p.chapter))?.name)} · ${esc(reference(p.reference||data.entries[p.id]?.reference||p.id))}</a>${p.scope?`<small>${esc(scopeLabel(p.scope))}</small>`:''}</li>`).join('')}</ul></details>`).join('');
}

if(typeof document!=='undefined'){
 let data,pending;
 const load=()=>data?Promise.resolve(data):(pending??=fetch(new URL('./data/transmission.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Source records unavailable');return r.json();}).then(value=>{if(!value.entries||!Array.isArray(value.sources))throw Error('Source records incomplete');data=value;return value;}).catch(error=>{pending=null;throw error;}));
 async function fill(details){
  const id=details.dataset.transmissionId,option=details.dataset.transmissionOption||'',target=details.querySelector('.transmission-content');if(!target)return;
  target.setAttribute('aria-busy','true');
  try{const records=await load();if(details.isConnected&&details.dataset.transmissionId===id&&(details.dataset.transmissionOption||'')===option)target.innerHTML=transmissionMarkup(records.entries[id],option);}
  catch{target.innerHTML='<p>The source record could not load.</p><button type="button" data-transmission-retry>Try again</button>';}
  finally{target.setAttribute('aria-busy','false');}
 }
 document.addEventListener('toggle',event=>{const target=event.target;if(target.matches?.('details.transmission')&&target.open)fill(target);},true);
 document.addEventListener('click',event=>{const retry=event.target.closest('[data-transmission-retry]');if(retry)fill(retry.closest('.transmission'));});
 if(document.querySelector('[data-sources-page]')){
  const input=document.getElementById('source-filter'),select=document.getElementById('source-thinker'),status=document.getElementById('source-status'),directory=document.getElementById('source-directory');
  const params=new URLSearchParams(location.search);let source=params.get('source')||'',chapter=params.get('chapter')||'',filtersEdited=false,authors,timer;
  input.value=(params.get('q')||'').slice(0,100);
  function render(save=true){
   const groups=sourceGroups(data,authors,{query:input.value,chapter:select.value,source}),count=new Set(groups.flatMap(s=>s.passages.map(p=>p.id))).size;
   status.textContent=`${groups.length} source${groups.length===1?'':'s'} · ${count} linked passage${count===1?'':'s'}`;
   directory.innerHTML=sourceDirectoryMarkup(groups,data,authors,!!source||groups.length===1)||'<p class="source-empty">No source records match these filters.</p>';
   if(source)status.innerHTML+=` · <a href="${esc(new URL('./sources/',import.meta.url).href)}">All sources</a>`;
   if(save){const url=new URL(location.href);url.search='';if(input.value.trim())url.searchParams.set('q',input.value.trim());if(select.value)url.searchParams.set('chapter',select.value);if(source)url.searchParams.set('source',source);history.replaceState(null,'',url.href);}
  }
  async function initialize(){
   status.textContent='Opening the source records…';
   try{
    const [records,catalogue]=await Promise.all([load(),fetch(new URL('./data/catalogue.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Catalogue unavailable');return r.json();})]);
    authors=new Map(catalogue.entries.map(a=>[a.dk,a]));
    const chapters=[...new Set(records.sources.flatMap(s=>s.passages.map(p=>p.chapter)))].sort((a,b)=>a-b);
    select.innerHTML='<option value="">All thinkers</option>'+chapters.filter(ch=>authors.has(ch)).map(ch=>`<option value="${ch}">DK ${ch} · ${esc(authors.get(ch).name)}</option>`).join('');
    select.value=chapter;render(filtersEdited);
   }catch{status.textContent='The source records could not load.';directory.innerHTML='<button type="button" id="source-retry">Try again</button>';document.getElementById('source-retry').addEventListener('click',initialize);}
  }
  input.addEventListener('input',()=>{source='';filtersEdited=true;clearTimeout(timer);timer=setTimeout(()=>{if(authors)render();},100);});
  select.addEventListener('change',()=>{chapter=select.value;filtersEdited=true;if(authors)render();});initialize();
 }
}
