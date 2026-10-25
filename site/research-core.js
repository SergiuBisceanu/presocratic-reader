// Search the default originals in the included reading collection.
// Morpheus/LSJ mappings supply candidates, never contextual disambiguation.
// This module has no DOM, network, storage or corpus mutation side effects.

const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const unique = values => [...new Set(values)];
export const foldGreek = text => String(text ?? '').replace(/[’᾽᾿ʼ]/g, "'").normalize('NFD').toLowerCase().replace(/\p{M}/gu, '').replace(/ς/g, 'σ').normalize('NFC').trim();
const exactGreek = text => String(text ?? '').replace(/[’᾽᾿ʼ]/g, "'").normalize('NFC').toLowerCase().replace(/ς/g, 'σ').trim();
const tokenPattern = /(?=\p{L})\p{Script=Greek}(?:(?=\p{L})\p{Script=Greek}|\p{M})*(?:[’'᾽᾿ʼ])?/gu;
export function tokenizeGreek(text) {
  return [...String(text ?? '').matchAll(tokenPattern)].map(match => ({form:match[0], start:match.index, end:match.index + match[0].length, folded:foldGreek(match[0])}));
}

export const grammarOptions = Object.freeze({
  case: ['nom','gen','dat','acc','voc'],
  number: ['sg','dual','pl'],
  tense: ['pres','imperf','fut','aor','perf','plup','futperf'],
  mood: ['ind','subj','opt','imperat','inf','part'],
  voice: ['act','mid','pass','mp'],
  gender: ['masc','fem','neut']
});

function validGrammar(filters = {}) {
  return Object.entries(grammarOptions).flatMap(([key, allowed]) => allowed.includes(filters?.[key]) ? [[key, filters[key]]] : []);
}
function analysisMatches(analysis, filters) {
  const tags = new Set(String(analysis).split(/\s+/).flatMap(token => token.split('/')));
  return filters.every(([,value]) => tags.has(value));
}
function dictionaryCandidates(dictionary, form) {
  const exact = String(form).normalize('NFC');
  let records = own(dictionary.forms, exact), match = 'exact';
  if (!records?.length) { records = own(dictionary.fallbackForms, exact); match = 'folded'; }
  if (!records?.length) {
    const forms = own(dictionary.foldedForms, foldGreek(exact)) || [];
    records = forms.flatMap(key => own(dictionary.forms, key) || []); match = 'folded';
  }
  const candidates = new Map();
  for (const record of records || []) {
    const entry = own(dictionary.entries, record.entryId);
    if (!entry || !entry.headword) continue;
    const found = candidates.get(record.entryId) || {entryId:record.entryId, lemma:entry.headword, analyses:[]};
    found.analyses = unique([...found.analyses, ...(record.analyses || [])]);
    candidates.set(record.entryId, found);
  }
  return {match, candidates:[...candidates.values()]};
}
function defaultOriginal(fragment) {
  const options = (fragment.translations || []).filter(option => option?.reading && typeof option.id === 'string' && (option.reading.english || option.reading.fallbackTranslation?.text || fragment.english || fragment.fallbackTranslation?.text));
  const option = options.find(item => item.id === fragment.defaultTranslationId) || options[0];
  return {reading:option ? {...fragment, ...option.reading} : fragment, translationId:option?.id || ''};
}
function passageCompare(a, b) {
  return a.chapter - b.chapter || String(a.number).localeCompare(String(b.number), 'en', {numeric:true}) || a.id.localeCompare(b.id, 'en', {numeric:true});
}
function contiguous(text, left, right) {
  // Do not invent a phrase across Latin editorial matter or a sentence boundary.
  return !/[\p{L}\p{N}.;!?··…\[\]]/u.test(text.slice(left.end, right.start));
}

export function createResearchIndex(fragments, dictionary, authors = []) {
  if (!Array.isArray(fragments) || !dictionary?.forms || !dictionary.entries) throw new TypeError('Research data is incomplete.');
  const authorMap = new Map(authors.map(author => [Number(author.dk), author]));
  const formCache = new Map(), lemmas = new Map(), passages = [];
  let tokenCount = 0, matchedTokenCount = 0, ambiguousTokenCount = 0, fallbackTokenCount = 0;
  const seen = new Set();
  for (const fragment of fragments) {
    if (!fragment || fragment.aliasOf || fragment.originalEdition || typeof fragment.id !== 'string' || seen.has(fragment.id)) continue;
    seen.add(fragment.id);
    const {reading,translationId} = defaultOriginal(fragment), text = String(reading.greek || ''), tokens = tokenizeGreek(text);
    const author = authorMap.get(Number(fragment.chapter));
    const passage = {id:fragment.id, chapter:Number(fragment.chapter), author:author?.name || fragment.author || '', slug:author?.slug || '', reference:fragment.displayReference || 'DK ' + (fragment.dk || fragment.id.replaceAll('-', ' ')), number:fragment.number ?? fragment.id, translationId, text, tokens};
    for (const token of tokens) {
      if (!formCache.has(token.form)) formCache.set(token.form, dictionaryCandidates(dictionary, token.form));
      const lookup = formCache.get(token.form);
      token.candidates = lookup.candidates; token.match = lookup.match; token.ambiguous = lookup.candidates.length > 1;
      tokenCount++;
      if (lookup.candidates.length) matchedTokenCount++;
      if (token.ambiguous) ambiguousTokenCount++;
      if (lookup.candidates.length && lookup.match === 'folded') fallbackTokenCount++;
      for (const candidate of lookup.candidates) {
        if (!lemmas.has(candidate.entryId)) lemmas.set(candidate.entryId, {entryId:candidate.entryId, lemma:candidate.lemma, occurrences:0, passageIds:new Set()});
        const lemma = lemmas.get(candidate.entryId); lemma.occurrences++; lemma.passageIds.add(fragment.id);
      }
    }
    passages.push(passage);
  }
  passages.sort(passageCompare);
  return {passages, lemmas, dictionary, formCache, stats:{passages:passages.length, greekPassages:passages.filter(passage => passage.tokens.length).length, tokenCount, matchedTokenCount, ambiguousTokenCount, fallbackTokenCount}, phraseCache:new Map()};
}

export function suggestLemmas(index, query, limit = 12) {
  const folded = foldGreek(query);
  if (!folded || !tokenizeGreek(query).length) return [];
  return [...index.lemmas.values()].filter(lemma => foldGreek(lemma.lemma).startsWith(folded))
    .sort((a,b) => Number(foldGreek(b.lemma) === folded) - Number(foldGreek(a.lemma) === folded) || b.passageIds.size - a.passageIds.size || a.lemma.localeCompare(b.lemma, 'el'))
    .slice(0, Math.max(0, Math.min(50, Number(limit) || 12)))
    .map(lemma => ({entryId:lemma.entryId, lemma:lemma.lemma, passages:lemma.passageIds.size, occurrences:lemma.occurrences}));
}

export function resolveLemmas(index, query, lemmaId = '') {
  const exact = exactGreek(query), folded = foldGreek(query);
  if (!tokenizeGreek(query).length) return [];
  let found = [...index.lemmas.values()].filter(lemma => exactGreek(lemma.lemma) === exact);
  if (!found.length) found = [...index.lemmas.values()].filter(lemma => foldGreek(lemma.lemma) === folded);
  if (!found.length) found = dictionaryCandidates(index.dictionary, query).candidates.map(candidate => index.lemmas.get(candidate.entryId)).filter(Boolean);
  // A chosen candidate may narrow the entered word, never replace it with an
  // unrelated headword supplied through a stale form or a shared URL.
  if (lemmaId && found.some(lemma => lemma.entryId === lemmaId)) return found.filter(lemma => lemma.entryId === lemmaId);
  return found;
}

function summarizeAuthors(results) {
  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.chapter)) groups.set(result.chapter, {chapter:result.chapter, author:result.author, passages:0, occurrences:0});
    const group = groups.get(result.chapter); group.passages++; group.occurrences += result.matches.length;
  }
  return [...groups.values()].sort((a,b) => a.chapter - b.chapter);
}
function tokenMatch(token, candidates = token.candidates) {
  return {start:token.start, end:token.end, form:token.form, lemmas:candidates.map(candidate => candidate.lemma), entryIds:candidates.map(candidate => candidate.entryId), analyses:unique(candidates.flatMap(candidate => candidate.analyses)), match:token.match, ambiguous:token.ambiguous};
}

export function searchResearch(index, options = {}) {
  const mode = ['lemma','surface','phrase'].includes(options.mode) ? options.mode : 'lemma';
  const query = String(options.query || '').trim().slice(0, 200), queryTokens = tokenizeGreek(query), filters = validGrammar(options.grammar);
  const grammarOnly = !query && mode !== 'phrase' && filters.length > 0;
  const chapter = Number(options.chapter) || null, includeAmbiguous = options.includeAmbiguous !== false;
  const lemmas = mode === 'lemma' ? resolveLemmas(index, query, options.lemmaId) : [], lemmaIds = new Set(lemmas.map(lemma => lemma.entryId));
  const queryCandidates = lemmas.map(lemma => ({entryId:lemma.entryId, lemma:lemma.lemma, passages:lemma.passageIds.size, occurrences:lemma.occurrences}));
  const results = [];
  let error = '';
  if (!queryTokens.length) error = query ? 'Enter a Greek word or phrase.' : '';
  else if (mode !== 'phrase' && (queryTokens.length !== 1 || query.replace(queryTokens[0].form, '').trim())) error = 'Use phrase search for more than one Greek word.';
  else if (mode === 'phrase' && queryTokens.length > 12) error = 'Search up to twelve Greek words at a time.';
  else if (mode === 'phrase' && /[\p{L}\p{N}]/u.test(queryTokens.reduce((remaining, token) => remaining.replace(token.form, ''), query))) error = 'Enter Greek words only.';
  if (!error && (queryTokens.length || grammarOnly)) for (const passage of index.passages) {
    if (chapter && passage.chapter !== chapter) continue;
    const matches = [], tokens = passage.tokens;
    if (mode === 'phrase') {
      for (let at = 0; at <= tokens.length - queryTokens.length; at++) {
        const sequence = tokens.slice(at, at + queryTokens.length);
        if (!sequence.every((token,i) => token.folded === queryTokens[i].folded && (!i || contiguous(passage.text, sequence[i-1], token)))) continue;
        matches.push({start:sequence[0].start, end:sequence.at(-1).end, form:passage.text.slice(sequence[0].start, sequence.at(-1).end), lemmas:[], entryIds:[], analyses:[], match:'surface', ambiguous:false});
      }
    } else for (const token of tokens) {
      if (!grammarOnly && mode === 'surface' && token.folded !== queryTokens[0].folded) continue;
      if (!grammarOnly && mode === 'lemma' && !token.candidates.some(candidate => lemmaIds.has(candidate.entryId))) continue;
      if (mode === 'lemma' && !includeAmbiguous && token.ambiguous) continue;
      let candidates = mode === 'lemma' && !grammarOnly ? token.candidates.filter(candidate => lemmaIds.has(candidate.entryId)) : token.candidates;
      if (filters.length) candidates = candidates.map(candidate => ({...candidate, analyses:candidate.analyses.filter(analysis => analysisMatches(analysis, filters))})).filter(candidate => candidate.analyses.length);
      if (filters.length && !candidates.length) continue;
      matches.push(tokenMatch(token, candidates));
    }
    if (matches.length) {
      const {tokens:ignored, ...metadata} = passage;
      results.push({...metadata, matches, occurrences:matches.length});
    }
  }
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0)), limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 30)));
  return {mode, query, grammarOnly, error, queryCandidates, totalPassages:results.length, totalOccurrences:results.reduce((sum,result) => sum + result.matches.length, 0), authors:summarizeAuthors(results), results:results.slice(offset, offset + limit), offset, limit};
}

function phraseGroups(index, minWords, maxWords) {
  const cacheKey = minWords + ':' + maxWords;
  if (index.phraseCache.has(cacheKey)) return index.phraseCache.get(cacheKey);
  const groups = new Map();
  for (const passage of index.passages) for (let at = 0; at < passage.tokens.length; at++) {
    const sequence = [];
    for (let length = 1; length <= maxWords && at + length <= passage.tokens.length; length++) {
      const token = passage.tokens[at + length - 1];
      if (sequence.length && !contiguous(passage.text, sequence.at(-1), token)) break;
      sequence.push(token);
      if (length < minWords) continue;
      const key = sequence.map(item => item.folded).join(' ');
      if (!groups.has(key)) groups.set(key, {key, phrase:sequence.map(item => item.form).join(' '), words:length, occurrences:0, passageIds:new Set(), authors:new Map()});
      const group = groups.get(key); group.occurrences++; group.passageIds.add(passage.id);
      group.authors.set(passage.chapter, passage.author);
    }
  }
  const repeated = [...groups.values()].filter(group => group.passageIds.size > 1);
  index.phraseCache.set(cacheKey, repeated);
  return repeated;
}

export function repeatedPhrases(index, options = {}) {
  const minWords = Math.max(2, Math.min(5, Math.floor(Number(options.minWords) || 3)));
  const maxWords = Math.max(minWords, Math.min(5, Math.floor(Number(options.maxWords) || 4)));
  const minPassages = Math.max(2, Math.floor(Number(options.minPassages) || 2));
  const enteredQuery = String(options.query || '').trim().slice(0, 200), queryTokens = tokenizeGreek(enteredQuery);
  const query = queryTokens.map(token => token.folded).join(' ');
  const error = enteredQuery && (!queryTokens.length || /[\p{L}\p{N}]/u.test(queryTokens.reduce((remaining, token) => remaining.replace(token.form, ''), enteredQuery))) ? 'Enter Greek words only.' : '';
  const chapter = Number(options.chapter) || null;
  const filtered = (error ? [] : phraseGroups(index,minWords,maxWords)).filter(group => group.passageIds.size >= minPassages && (options.crossAuthors === false || group.authors.size > 1) && (!chapter || group.authors.has(chapter)) && (!query || (' ' + group.key + ' ').includes(' ' + query + ' ')))
    .sort((a,b) => b.authors.size - a.authors.size || b.passageIds.size - a.passageIds.size || b.words - a.words || a.key.localeCompare(b.key, 'el'));
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0)), limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 30)));
  return {totalPhrases:filtered.length, error, offset, limit, results:filtered.slice(offset, offset + limit).map(group => ({phrase:group.phrase, words:group.words, passages:group.passageIds.size, occurrences:group.occurrences, authors:[...group.authors].sort((a,b) => a[0]-b[0]).map(([chapter,author]) => ({chapter,author})), examples:[...group.passageIds]}))};
}
