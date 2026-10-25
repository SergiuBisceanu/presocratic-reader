// Semantic retrieval only: every returned word comes from a published translation.
export const MEANING_DIMENSIONS = 384;
// Conservative development-set gate; cosine similarity is not a probability.
export const MEANING_THRESHOLD = 0.53;
const clean = text => String(text ?? '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const stop = new Set('a an and are as at be been being but by can could did do does for from had has have he her him his how i if in into is it its me my no not of on one or our she so than that the their them then there these they this those through to too was we were what when where which who why will with would you your'.split(' '));
const words = text => clean(text).split(' ').filter(word=>word.length>2&&!stop.has(word));

export function chunkTranslations(fragments, authors=[], {maxWords=90, overlap=25}={}) {
  const byChapter=new Map(authors.map(author=>[Number(author.dk),author])),chunks=[],seen=new Set();
  for(const fragment of fragments){
    if(!fragment || fragment.aliasOf || fragment.originalEdition)continue;
    const options=(fragment.translations||[]).filter(option=>option?.language==='en' && typeof option.reading?.english==='string' && option.reading.english.trim());
    for(const option of options){
      const text=option.reading.english;
      const sourceWords=[...text.matchAll(/\S+/gu)];if(!sourceWords.length)continue;
      const author=byChapter.get(Number(fragment.chapter));
      const add=(start,end)=>{
        const key=fragment.id+'|'+option.id+'|'+start+'|'+end;
        if(seen.has(key))return;
        seen.add(key);
        const chunk={id:fragment.id,chapter:Number(fragment.chapter),author:author?.name||fragment.author||'',slug:author?.slug||'',reference:fragment.displayReference||'DK '+fragment.dk,translationId:option.id,text:text.slice(start,end),start,end,sourceTextLength:text.length,credit:[option.reading.translator||option.reading.englishCredit,option.reading.translationEdition].filter(Boolean).join(' · ')};
        // A short sentence may begin in the middle of a verse quotation. Keep
        // its exact embedding but return enough original surrounding words.
        if(chunk.text.split(/\s+/u).length<30&&chunk.text.length<text.trim().length){
          let first=Math.max(0,sourceWords.findIndex(word=>word.index>=start)-15);
          const after=Math.min(sourceWords.length,first+60);first=Math.max(0,after-60);
          const contextStart=sourceWords[first].index,contextEnd=sourceWords[after-1].index+sourceWords[after-1][0].length;
          chunk.context={text:text.slice(contextStart,contextEnd),start:contextStart,end:contextEnd};
        }
        chunks.push(chunk);
      };
      for(let first=0;first<sourceWords.length;){
        let after=Math.min(sourceWords.length,first+maxWords);
        // Prefer a sentence ending without dropping the overlapping next window.
        if(after<sourceWords.length){
          for(let at=after-1;at>=first+Math.floor(maxWords*.65);at--){
            if(/[.!?][”’"')\]]?$/.test(sourceWords[at][0])){after=at+1;break;}
          }
        }
        const start=sourceWords[first].index,end=sourceWords[after-1].index+sourceWords[after-1][0].length;
        add(start,end);
        if(after===sourceWords.length)break;
        first=Math.max(first+1,after-overlap);
      }
      // Short sentences in longer quotations deserve their own embedding: a
      // remembered saying can otherwise disappear inside unrelated context.
      const sentences=new Intl.Segmenter('en',{granularity:'sentence'}).segment(text);
      for(const sentence of sentences){
        const content=sentence.segment.trim(),count=content.split(/\s+/u).length;
        if(count<5||count>maxWords)continue;
        const start=sentence.index+sentence.segment.indexOf(content);
        add(start,start+content.length);
      }
    }
  }
  return chunks;
}

export function rankMeaning(index, queryVector, query, {limit=6,threshold=MEANING_THRESHOLD}={}) {
  const normalized=clean(query),tokens=words(query);
  if(normalized.length<4 || normalized.length>600 || !tokens.length)return {status:'zero',matches:[],reason:'insufficient-query'};
  if(!queryVector || queryVector.length!==MEANING_DIMENSIONS || [...queryVector].some(value=>!Number.isFinite(value)))throw new TypeError('Invalid query embedding.');
  if(!Array.isArray(index?.chunks) || !index.chunks.length || index.vectors?.length!==index.chunks.length*MEANING_DIMENSIONS)throw new TypeError('Incomplete search index.');
  const queryNorm=Math.sqrt(queryVector.reduce((sum,value)=>sum+value*value,0));
  if(queryNorm===0)throw new TypeError('Empty query embedding.');
  const candidates=[];
  for(let row=0;row<index.chunks.length;row++){
    const offset=row*MEANING_DIMENSIONS,chunk=index.chunks[row];let score=0,norm=0;
    for(let col=0;col<MEANING_DIMENSIONS;col++){const value=index.vectors[offset+col];score+=queryVector[col]*value;norm+=value*value;}
    if(!Number.isFinite(score)||!Number.isFinite(norm)||!norm)throw new TypeError('Invalid search index vector.');
    score/=queryNorm*Math.sqrt(norm);
    const text=clean(chunk.text),exact=normalized.length>=12&&tokens.length>=2&&(' '+text+' ').includes(' '+normalized+' ');
    if(score<threshold&&!exact)continue;
    const sourceTerms=new Set(words(chunk.text));
    const shared=tokens.filter(word=>sourceTerms.has(word)).length/Math.max(1,tokens.length);
    candidates.push({...chunk,score:Math.max(-1,Math.min(1,score)),exact,rank:score+Math.min(.025,shared*.025)+(exact ? .1 : 0)});
  }
  candidates.sort((a,b)=>b.rank-a.rank || b.score-a.score || a.id.localeCompare(b.id));
  const matches=[],seen=new Set();
  for(const candidate of candidates){
    if(seen.has(candidate.id))continue;seen.add(candidate.id);
    const {rank,context,...match}=candidate;
    if(context){match.matchedText=match.text;match.matchedStart=match.start;match.matchedEnd=match.end;Object.assign(match,context);}
    matches.push(match);
    if(matches.length>=Math.max(1,Math.min(12,limit)))break;
  }
  return {status:matches.length?'matches':'zero',matches,reason:matches.length?'':'below-threshold'};
}
