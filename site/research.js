import {createResearchIndex, searchResearch, suggestLemmas, repeatedPhrases} from './research-core.js';
import {formatAnalysis} from './lsj.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const grammarKeys = ['case','number','tense','mood','voice','gender'];
const modes = ['lemma','surface','phrase','repeated'];
const pageSize = 30;

export function researchExcerpt(text, matches, radius = 100) {
  const first = matches[0], start = Math.max(0, (first?.start || 0) - radius);
  const end = Math.min(text.length, Math.max(start + 280, first?.end || 0));
  const ranges = matches.filter(m => m.start < end && m.end > start).sort((a,b) => a.start-b.start);
  let cursor = start, html = start ? '…' : '';
  for (const range of ranges) {
    const left = Math.max(cursor, range.start), right = Math.min(end, range.end);
    if (left >= right) continue;
    html += esc(text.slice(cursor,left)) + '<mark>' + esc(text.slice(left,right)) + '</mark>';
    cursor = right;
  }
  return html + esc(text.slice(cursor,end)) + (end < text.length ? '…' : '');
}

if (typeof document !== 'undefined' && document.querySelector('[data-research-page]')) {
  const $ = selector => document.querySelector(selector);
  const form = $('#research-form'), results = $('#research-results'), status = $('#research-status');
  let index, pending, request = 0, lemmaId = '', offset = 0;
  const readJson = async path => {
    const response = await fetch(new URL(path,import.meta.url));
    if (!response.ok) throw new Error('Concordance data could not load.');
    return response.json();
  };
  const load = () => index ? Promise.resolve(index) : (pending ??= Promise.all([
    readJson('./data/corpus.json'),readJson('./data/lsj.json'),readJson('./data/catalogue.json')
  ]).then(([corpus,dictionary,catalogue]) => {
    index = createResearchIndex(corpus.fragments,dictionary,catalogue.entries);
    const chapters = new Map(index.passages.filter(p=>p.tokens.length).map(p=>[p.chapter,p.author]));
    const current = $('#research-chapter').value || new URLSearchParams(location.search).get('chapter');
    $('#research-chapter').innerHTML = '<option value="">All thinkers</option>' + [...chapters].sort((a,b)=>a[0]-b[0]).map(([chapter,author])=>`<option value="${chapter}">DK ${chapter} · ${esc(author)}</option>`).join('');
    if (chapters.has(Number(current))) $('#research-chapter').value = current;
    return index;
  }).catch(error=>{pending=null;throw error;}));

  function readControls() {
    return {mode:$('#research-mode').value, query:$('#research-query').value.trim(), chapter:$('#research-chapter').value,
      grammar:Object.fromEntries(grammarKeys.map(key=>[key,$('#research-'+key)?.value || ''])),
      includeAmbiguous:$('#research-ambiguous').checked,crossAuthors:$('#research-cross').checked,lemmaId,offset,limit:pageSize};
  }
  function modeControls() {
    const mode = $('#research-mode').value, grammatical = mode==='lemma'||mode==='surface';
    $('#research-grammar').hidden = !grammatical;
    $('#research-ambiguity-label').hidden = mode!=='lemma';
    $('#research-cross-label').hidden = mode!=='repeated';
    form.querySelector('button[type=submit]').textContent = mode==='repeated'?'Browse phrases':'Find passages';
    $('#research-query-note').textContent = mode==='repeated' ? 'Browse repeated sequences of three or four words. Enter Greek to narrow the list.' : mode==='phrase' ? 'Matches whole words in order, without crossing sentence breaks. Accents are optional.' : mode==='surface' ? 'Matches this whole written form. Accents are optional.' : 'Includes inflected forms. Leave the word empty to search by grammatical filters alone.';
  }
  function restoreUrl() {
    const params = new URLSearchParams(location.search);
    $('#research-mode').value = modes.includes(params.get('mode'))?params.get('mode'):'lemma';
    $('#research-query').value = (params.get('q')||'').slice(0,120);
    $('#research-chapter').value = params.get('chapter')||'';
    for(const key of grammarKeys) if($('#research-'+key)) $('#research-'+key).value=params.get(key)||'';
    $('#research-ambiguous').checked = params.get('ambiguous')!=='0';
    $('#research-cross').checked = params.get('cross')!=='0';
    lemmaId=params.get('lemma')||'';
    const page=Number(params.get('page'));offset=(Number.isFinite(page)&&page>=1?Math.floor(page)-1:0)*pageSize;
    modeControls();
  }
  function writeUrl() {
    const options=readControls(),url=new URL(location.href);url.search='';
    if(options.query)url.searchParams.set('q',options.query);
    if(options.mode!=='lemma')url.searchParams.set('mode',options.mode);
    if(options.chapter)url.searchParams.set('chapter',options.chapter);
    if(options.mode==='lemma'||options.mode==='surface')for(const [key,value]of Object.entries(options.grammar))if(value)url.searchParams.set(key,value);
    if(options.mode==='lemma'&&!options.includeAmbiguous)url.searchParams.set('ambiguous','0');
    if(options.mode==='repeated'&&!options.crossAuthors)url.searchParams.set('cross','0');
    if(options.mode==='lemma'&&lemmaId)url.searchParams.set('lemma',lemmaId);
    if(offset)url.searchParams.set('page',String(Math.floor(offset/pageSize)+1));
    if(url.href!==location.href)history.pushState(null,'',url.href);
  }
  function passageUrl(hit) {
    const url=new URL('./read/'+encodeURIComponent(hit.slug)+'/',import.meta.url);
    if(hit.translationId)url.searchParams.set('translation',hit.translationId);
    url.hash=hit.id;
    return url.href;
  }
  function pagination(total) {
    const nav=$('#research-pagination');nav.hidden=total<=pageSize;
    nav.innerHTML=total>pageSize?`<button type="button" data-research-page="${Math.max(0,offset-pageSize)}" ${offset===0?'disabled':''}>← Previous</button><span>${offset+1}–${Math.min(offset+pageSize,total)} of ${total}</span><button type="button" data-research-page="${offset+pageSize}" ${offset+pageSize>=total?'disabled':''}>Next →</button>`:'';
  }
  function renderHits(found) {
    status.textContent=found.error||`${found.totalOccurrences.toLocaleString('en-GB')} occurrence${found.totalOccurrences===1?'':'s'} in ${found.totalPassages.toLocaleString('en-GB')} passage${found.totalPassages===1?'':'s'}.`;
    $('#research-author-counts').innerHTML=found.authors.length>1?'<details class="research-distribution"><summary>Occurrences by thinker ('+found.authors.length+')</summary><div>'+found.authors.map(a=>`<button type="button" data-research-chapter="${a.chapter}">${esc(a.author)} <span>${a.occurrences}</span></button>`).join('')+'</div></details>':'';
    const suggestions=found.queryCandidates.length>1?found.queryCandidates:!found.results.length&&found.mode==='lemma'?suggestLemmas(index,found.query):[];
    $('#research-suggestions').innerHTML=suggestions.length?'<p>'+ (found.queryCandidates.length>1?'Possible headwords — choose one to narrow the results.':'Headwords in this collection')+'</p>'+suggestions.map(l=>`<button type="button" data-research-lemma="${esc(l.entryId)}" data-headword="${esc(l.lemma)}"><span lang="grc">${esc(l.lemma)}</span> · ${l.passages} passages</button>`).join(''):'';
    results.innerHTML=found.results.map(hit=>{
      const forms=[...new Map(hit.matches.map(m=>[m.form+'|'+m.lemmas.join(','),m])).values()];
      return `<article class="research-hit"><header><a class="research-ref" href="${esc(passageUrl(hit))}">${esc(hit.author)} · ${esc(hit.reference)} →</a><span>${hit.occurrences} match${hit.occurrences===1?'':'es'}</span></header><p class="research-excerpt" lang="grc">${researchExcerpt(hit.text,hit.matches)}</p>${forms.some(m=>m.lemmas.length)?`<details><summary>Matched forms &amp; possible analyses</summary><ul>${forms.map(m=>`<li><span lang="grc">${esc(m.form)}</span>${m.lemmas.length?' → <span lang="grc">'+esc(m.lemmas.join(' / '))+'</span>':''}${m.ambiguous?' <span class="research-match-note">(other headwords are possible)</span>':''}${m.match==='folded'?' <span class="research-match-note">(accent fallback)</span>':''}${m.analyses.length?'<p>'+esc([...new Set(m.analyses.map(formatAnalysis).filter(Boolean))].join('; '))+'</p>':''}</li>`).join('')}</ul></details>`:''}</article>`;
    }).join('') || (found.error?'':'<p class="research-empty">No matching passages. Try another form, remove a grammatical filter, or search the word as written.</p>');
    pagination(found.totalPassages);
  }
  function renderPhrases(found) {
    status.textContent=found.error||`${found.totalPhrases.toLocaleString('en-GB')} recurring word sequences.`;
    $('#research-suggestions').innerHTML='';$('#research-author-counts').innerHTML='';
    results.innerHTML=found.results.map(p=>`<button type="button" class="research-phrase" data-research-phrase="${esc(p.phrase)}"><strong lang="grc">${esc(p.phrase)}</strong><span>${p.occurrences} occurrences · ${p.passages} passages · ${p.authors.length} thinkers</span></button>`).join('')||'<p class="research-empty">No recurring phrases match these filters.</p>';
    pagination(found.totalPhrases);
  }
  async function run({save=true,focus=false}={}) {
    const current=++request;
    modeControls();status.textContent=index?'Searching…':'Opening the concordance…';results.setAttribute('aria-busy','true');
    try {
      await load();
      if(current!==request)return;
      // Let the loading message paint before indexing recurring sequences.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if(current!==request)return;
      const options=readControls();
      const grammatical=Object.values(options.grammar).some(Boolean)&&(options.mode==='lemma'||options.mode==='surface');
      if(!options.query&&options.mode!=='repeated'&&!grammatical){
        status.textContent=`${index.stats.greekPassages.toLocaleString('en-GB')} passages with Greek text. Choose a word or a search above.`;
        results.innerHTML='';$('#research-pagination').hidden=true;$('#research-suggestions').innerHTML='';$('#research-author-counts').innerHTML='';
      }else if(options.mode==='repeated'){
        let found=repeatedPhrases(index,{...options,minWords:3,maxWords:4});
        if(offset>=found.totalPhrases&&offset){offset=0;found=repeatedPhrases(index,{...options,offset:0,minWords:3,maxWords:4});}
        renderPhrases(found);
      }else{
        let found=searchResearch(index,options);
        if(offset>=found.totalPassages&&offset){offset=0;found=searchResearch(index,{...options,offset:0});}
        renderHits(found);
      }
      if(save)writeUrl();
      if(focus)results.focus({preventScroll:true});
    }catch(error){
      if(current!==request)return;
      status.textContent='The concordance could not load. The reading pages remain available.';
      results.innerHTML='<button type="button" data-research-retry>Try again</button>';
    }finally{if(current===request)results.setAttribute('aria-busy','false');}
  }
  form.addEventListener('submit',event=>{event.preventDefault();offset=0;lemmaId='';run();});
  form.addEventListener('change',event=>{if(event.target.id==='research-query')return;offset=0;lemmaId='';run();});
  document.querySelector('[data-research-page]').addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.hasAttribute('data-research-page')){offset=Number(target.dataset.researchPage);run({focus:true});results.scrollIntoView({behavior:'instant',block:'start'});return;}
    if(target.hasAttribute('data-research-chapter')){$('#research-chapter').value=target.dataset.researchChapter;offset=0;run();return;}
    if(target.hasAttribute('data-research-lemma')){lemmaId=target.dataset.researchLemma;$('#research-query').value=target.dataset.headword;offset=0;run();return;}
    if(target.hasAttribute('data-research-example')){$('#research-query').value=target.dataset.researchExample;$('#research-mode').value='lemma';}
    else if(target.hasAttribute('data-research-phrase')){$('#research-query').value=target.dataset.researchPhrase;$('#research-mode').value='phrase';$('#research-chapter').value='';}
    else if(target.hasAttribute('data-research-repeated')){$('#research-query').value='';$('#research-mode').value='repeated';}
    else if(!target.hasAttribute('data-research-retry'))return;
    offset=0;lemmaId='';run();
  });
  window.addEventListener('popstate',()=>{restoreUrl();run({save:false});});
  restoreUrl();run({save:false});
}
