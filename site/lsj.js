// Historical LSJ excerpts and build-time morphological analyses, served locally.
// Dataset provenance and licences are recorded in data/lsj.json and the credits.
export const greekTokens = text => [...text.matchAll(/(?=\p{L})\p{Script=Greek}(?:(?=\p{L})\p{Script=Greek}|\p{M})*(?:[’'᾽᾿ʼ])?/gu)];
export const foldGreek = text => text.replace(/[’᾽᾿ʼ]/g,"'").normalize('NFD').toLowerCase().replace(/\p{M}/gu,'').replace(/ς/g,'σ').normalize('NFC').trim();
const cleanWord = text => text.normalize('NFC').trim();
const escapeHtml = text => String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = url => /^https:\/\//.test(url||'')?url:'#';
const own=(object,key)=>Object.hasOwn(object,key)?object[key]:undefined;
export function definitionMarkup(entry){
 if(entry.entryKind==='source-fragment')return '<p>This source record is a fragment of another dictionary article, not a separate word definition. Follow the source link for context.</p>';
 const definitions=(entry.definitions||[]).filter(Boolean);
 return definitions.length?`<ul class="lsj-senses">${definitions.map(definition=>`<li>${escapeHtml(definition)}</li>`).join('')}</ul>`:'<p>This entry has no short definition. Follow the source link for the complete article.</p>';
}
export function setWordTabStop(word){
 const scope=word.closest('.original-text,.witness-text');if(!scope)return;
 for(const item of scope.querySelectorAll('.greek-word'))item.tabIndex=item===word?0:-1;
}
export function concordanceLink(headword,baseUrl=import.meta.url){
 const url=new URL('./concordance/',baseUrl);url.searchParams.set('mode','lemma');url.searchParams.set('q',headword);return url.href;
}

export function findHeadwords(index,word){
 const exact=cleanWord(word),direct=own(index.headwords,exact);
 if(direct?.length)return {match:'headword',records:direct};
 const keys=own(index.foldedHeadwords,foldGreek(exact))||[];
 return {match:'folded',records:keys.flatMap(key=>index.headwords[key]||[])};
}
export function suggestHeadwords(index,word,limit=8){
 const prefix=foldGreek(cleanWord(word));if(prefix.length<2)return [];
 const result=[];
 for(const key of Object.keys(index.foldedHeadwords)){
  if(!key.startsWith(prefix)||key===prefix)continue;
  for(const headword of index.foldedHeadwords[key]){
   if(!result.includes(headword))result.push(headword);
   if(result.length===limit)return result;
  }
 }
 return result;
}
const grammar={pres:'present',imperf:'imperfect',fut:'future',aor:'aorist',perf:'perfect',plup:'pluperfect',futperf:'future perfect',ind:'indicative',subj:'subjunctive',opt:'optative',imperat:'imperative',inf:'infinitive',part:'participle',act:'active',mid:'middle',pass:'passive',mp:'middle/passive','1st':'first person','2nd':'second person','3rd':'third person',sg:'singular',dual:'dual',pl:'plural',nom:'nominative',gen:'genitive',dat:'dative',acc:'accusative',voc:'vocative',masc:'masculine',fem:'feminine',neut:'neuter',comp:'comparative',superl:'superlative',attic:'Attic',ionic:'Ionic',doric:'Doric',aeolic:'Aeolic',epic:'epic',homeric:'Homeric',poetic:'poetic',contr:'contracted',unaugmented:'unaugmented',nu_movable:'movable nu'};
export function formatAnalysis(value){
 return [...new Set(value.split(/\s+/).map(token=>token.split('/').every(part=>grammar[part])?token.split('/').map(part=>grammar[part]).join('/'):'').filter(Boolean))].join(' · ');
}

export function lookupWord(data,word){
 const exact=cleanWord(word),direct=own(data.forms,exact);
 let candidates=direct?.length?direct:[],match='exact';
 const fallback=data.fallbackForms&&own(data.fallbackForms,exact);
 if(!candidates.length&&fallback?.length){candidates=fallback;match='folded';}
 if(!candidates.length){
  const forms=own(data.foldedForms,foldGreek(exact))||[];
  candidates=forms.flatMap(form=>data.forms[form]||[]);match='folded';
 }
 // A dictionary headword can be entered even if it is not a surface form here.
 if(!candidates.length){
  candidates=Object.entries(data.entries).filter(([,entry])=>foldGreek(entry.headword)===foldGreek(exact)).map(([entryId,entry])=>({entryId,lemma:entry.headword,analyses:[]}));
  match='headword';
 }
 const unique=new Map();
 for(const candidate of candidates){
  const entry=data.entries[candidate.entryId];if(!entry)continue;
  if(!unique.has(candidate.entryId))unique.set(candidate.entryId,{...entry,entryId:candidate.entryId,analyses:[]});
  const found=unique.get(candidate.entryId);found.analyses=[...new Set([...found.analyses,...(candidate.analyses||[])])];
 }
 return {word:exact,match,entries:[...unique.values()]};
}

if(typeof document!=='undefined'){
 const main=document.getElementById('main'),dialog=document.getElementById('lsj-dialog');
 if(main&&dialog){
  const content=document.getElementById('lsj-content'),title=document.getElementById('lsj-title'),input=document.getElementById('lsj-query');
  const readingRoots=[main,document.getElementById('info-content')].filter(Boolean);
  let dataset,pending,index,indexPending,activeRequest=0,origin,lastFull=false;
  const scopes='.original-text,.witness-text';
  const wordNav=document.createElement('nav');
  wordNav.className='lsj-word-nav';wordNav.hidden=true;wordNav.setAttribute('aria-label','Words in this passage');
  wordNav.innerHTML='<button type="button" data-lsj-step="-1">← Previous word</button><span class="lsj-word-position"></span><button type="button" data-lsj-step="1">Next word →</button>';
  content.before(wordNav);
  const passageWords=()=>origin?.matches('.greek-word')&&origin.isConnected?[...origin.closest(scopes).querySelectorAll('.greek-word')]:[];
  const updateWordNav=()=>{
   const words=passageWords(),at=words.indexOf(origin);wordNav.hidden=at<0;
   if(at<0)return;
   wordNav.querySelector('.lsj-word-position').textContent=`Word ${at+1} of ${words.length}`;
   for(const button of wordNav.querySelectorAll('[data-lsj-step]')){
    const next=words[at+Number(button.dataset.lsjStep)];button.disabled=!next;
    button.setAttribute('aria-label',(Number(button.dataset.lsjStep)<0?'Previous word':'Next word')+(next?': '+next.textContent:''));
   }
  };
  const openDialog=()=>{
   const originDialog=origin?.closest('dialog');
   for(const other of document.querySelectorAll('dialog[open]'))if(other!==dialog&&other!==originDialog)other.close();
   if(!dialog.open)dialog.showModal();
   dialog.scrollTop=0;
  };
  const openDictionary=button=>{
   activeRequest++;origin=button;lastFull=false;title.textContent='Greek dictionary';title.lang='en';input.value='';
   content.innerHTML='<p>Enter a Greek word or dictionary headword. Accents are optional. You can also enter the first few letters to find headwords.</p>';
   content.setAttribute('aria-busy','false');updateWordNav();openDialog();input.focus({preventScroll:true});
  };
  const load=()=>dataset?Promise.resolve(dataset):(pending??=fetch(new URL('./data/lsj.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Dictionary unavailable');return r.json()}).then(data=>{if(!data.entries||!data.forms||!data.foldedForms)throw new Error('Dictionary incomplete');dataset=data;return data}).catch(e=>{pending=null;throw e}));
  const readJson=async url=>{const response=await fetch(url);if(!response.ok)throw new Error('Dictionary unavailable');return response.json()};
  const loadIndex=()=>index?Promise.resolve(index):(indexPending??=readJson(new URL('./data/lsj-index.json',import.meta.url)).then(data=>{if(!data.headwords||!data.foldedHeadwords||!data.shards)throw new Error('Dictionary index incomplete');index=data;return data}).catch(e=>{indexPending=null;throw e}));
  const shardCache=new Map();
  const loadShard=(dictionary,key)=>{
   const path=dictionary.shards[key];
   if(!/^lsj-entries\/[\w-]+\.json$/.test(path||''))return Promise.reject(new Error('Dictionary entry unavailable'));
   if(!shardCache.has(key))shardCache.set(key,readJson(new URL('./data/'+path,import.meta.url)).then(data=>{if(!data.entries)throw new Error('Dictionary entry incomplete');return data.entries}).catch(e=>{shardCache.delete(key);throw e}));
   return shardCache.get(key);
  };
  const readHeadwords=async(dictionary,found,word)=>{
   const keys=[...new Set(found.records.map(record=>record.shard))],shards=await Promise.all(keys.map(key=>loadShard(dictionary,key))),entries=new Map();
   for(const record of found.records){const entry=shards[keys.indexOf(record.shard)][record.entryId];if(entry)entries.set(record.entryId,{...entry,entryId:record.entryId,analyses:[]})}
   if(!entries.size)throw new Error('Dictionary entry unavailable');
   return {word,match:found.match,entries:[...entries.values()]};
  };
  const render=(result)=>{
   const count=result.entries.length;
   const note=result.match==='folded'?'Accents could not be matched exactly. Check the headword and sense against the passage.':count>1?'This form has more than one possible headword. Choose the sense that fits the passage.':'Selected LSJ senses. Their application depends on the passage.';
   if(!count){const suggestions=result.suggestions||[];content.innerHTML='<p class="lsj-status" role="status">No LSJ match for this form.</p><p>Try the dictionary headword, or enter its first few letters. Names, damaged readings and some dialectal forms may not have a match.</p>'+(suggestions.length?`<div class="lsj-suggestions"><p>Headwords beginning with these letters</p><div>${suggestions.map(word=>`<button type="button" lang="grc" data-lsj-lemma="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join('')}</div></div>`:'');return;}
   content.innerHTML=`<p class="lsj-match-note" role="status">${count>1?'Possible headwords. ':''}${note}</p>`+result.entries.map(entry=>{
    const analyses=[...new Set((entry.analyses||[]).map(formatAnalysis).filter(Boolean))];
    return `<section class="lsj-entry"><h3 lang="grc">${escapeHtml(entry.headword)}</h3>${definitionMarkup(entry)}${analyses.length?`<details class="lsj-analysis"><summary>Possible grammatical forms</summary><ul>${analyses.map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul></details>`:''}<a class="lsj-source" href="${escapeHtml(safeUrl(entry.sourceUrl))}" target="_blank" rel="noopener noreferrer">Full LSJ entry ↗</a><a class="lsj-concordance" href="${escapeHtml(concordanceLink(entry.headword))}">Find in the fragments →</a></section>`;
   }).join('');
  };
  const show=async(word,{full=false}={})=>{
   const request=++activeRequest;lastFull=full;title.textContent=word;title.lang='grc';input.value=word;
   content.innerHTML='<p class="lsj-status" role="status">Opening LSJ…</p>';content.setAttribute('aria-busy','true');
   updateWordNav();openDialog();
   try{
    const data=await load();let result=lookupWord(data,word);
    if(full||!result.entries.length){
     try{
      const dictionary=await loadIndex(),found=findHeadwords(dictionary,word);
      if(found.records.length&&(found.match==='headword'||!result.entries.length||result.match!=='exact'))result=await readHeadwords(dictionary,found,word);
      else if(!result.entries.length)result.suggestions=suggestHeadwords(dictionary,word);
     }catch(error){if(!result.entries.length)throw error;}
    }
    if(request!==activeRequest||!dialog.open)return;render(result);
   }
   catch{if(request===activeRequest)content.innerHTML='<p class="lsj-status" role="status">The dictionary could not load. Check your connection and try again.</p><button class="lsj-retry" type="button">Try again</button>';}
   finally{if(request===activeRequest)content.setAttribute('aria-busy','false');}
  };
  function enhance(){
   observer.disconnect();
   for(const scope of readingRoots.flatMap(root=>[...root.querySelectorAll(scopes)])){
    const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT),nodes=[];
    while(walker.nextNode())if(!walker.currentNode.parentElement.closest('button,a,script,style,.source-label,sup'))nodes.push(walker.currentNode);
    let hasTabStop=!!scope.querySelector('.greek-word[tabindex="0"]');
    for(const node of nodes){
     const text=node.nodeValue,matches=greekTokens(text);if(!matches.length)continue;
     const fragment=document.createDocumentFragment();let cursor=0;
     for(const match of matches){
      fragment.append(document.createTextNode(text.slice(cursor,match.index)));
      const button=document.createElement('button');button.type='button';button.className='greek-word';button.textContent=match[0];button.dataset.greekWord=match[0];button.title='Look up in LSJ';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','lsj-dialog');button.tabIndex=hasTabStop?-1:0;hasTabStop=true;
      fragment.append(button);cursor=match.index+match[0].length;
     }
     fragment.append(document.createTextNode(text.slice(cursor)));node.replaceWith(fragment);
    }
   }
   for(const root of readingRoots)observer.observe(root,{childList:true,subtree:true});
   if(readingRoots.some(root=>root.querySelector('.greek-word')))load().catch(()=>{});
  }
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhance()})}});
  enhance();
  document.addEventListener('click',event=>{
   const opener=event.target.closest('[data-action="dictionary"]');
   if(opener){openDictionary(opener);return;}
   const step=event.target.closest('[data-lsj-step]');
   if(step&&wordNav.contains(step)){
    const words=passageWords(),at=words.indexOf(origin),next=at>=0&&words[at+Number(step.dataset.lsjStep)];
    if(!next)return;
    origin=next;setWordTabStop(origin);show(origin.dataset.greekWord);
    if(step.disabled)wordNav.querySelector('[data-lsj-step]:not(:disabled)')?.focus({preventScroll:true});
    return;
   }
   const word=event.target.closest('.greek-word');
   if(word){if(window.getSelection()?.toString().trim())return;origin=word;setWordTabStop(word);show(word.dataset.greekWord);}
   const headword=event.target.closest('[data-lsj-lemma]');if(headword)show(headword.dataset.lsjLemma,{full:true});
   if(event.target.closest('.lsj-retry'))show(input.value,{full:lastFull});
  });
  document.addEventListener('keydown',event=>{
   if(event.altKey||event.ctrlKey||event.metaKey)return;
   const word=event.target.closest('.greek-word');if(!word||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   const words=[...word.closest(scopes).querySelectorAll('.greek-word')],i=words.indexOf(word);
   const next=event.key==='Home'?0:event.key==='End'?words.length-1:Math.max(0,Math.min(words.length-1,i+(event.key==='ArrowRight'?1:-1)));
   event.preventDefault();setWordTabStop(words[next]);words[next].focus();
  });
  document.getElementById('lsj-form').addEventListener('submit',event=>{event.preventDefault();const value=input.value.trim();if(value)show(value,{full:true})});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog.open){event.preventDefault();event.stopImmediatePropagation();dialog.close()}},true);
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close()});
  dialog.addEventListener('close',()=>{activeRequest++;requestAnimationFrame(()=>{if(origin?.isConnected&&(!document.querySelector('dialog[open]')||origin.closest('dialog[open]')))origin.focus({preventScroll:true})});});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()});
 }
}
