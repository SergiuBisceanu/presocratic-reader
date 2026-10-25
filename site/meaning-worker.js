import {pipeline, env} from './vendor/semantic/transformers.min.js';
import {rankMeaning,MEANING_DIMENSIONS} from './meaning-core.js';

env.allowLocalModels=true;
env.allowRemoteModels=false;
env.localModelPath=new URL('./models/',import.meta.url).href;
env.backends.onnx.wasm.wasmPaths=new URL('./vendor/semantic/',import.meta.url).href;
env.backends.onnx.wasm.numThreads=1;
env.backends.onnx.wasm.proxy=false;
let encoder,index,pending,latest=0,queue=Promise.resolve();
const read=async(path,binary=false)=>{
  const response=await fetch(new URL(path,import.meta.url));
  if(!response.ok)throw new Error('Search files could not load.');
  return binary?response.arrayBuffer():response.json();
};
async function load(requestId){
  if(encoder&&index)return;
  if(!pending)pending=(async()=>{
    postMessage({type:'progress',requestId,stage:'loading'});
    const [model,metadata,buffer]=await Promise.all([
      pipeline('feature-extraction','all-MiniLM-L6-v2',{dtype:'q8',device:'wasm',local_files_only:true}),
      read('./data/meaning-index.json'),read('./data/meaning-vectors.bin',true)
    ]);
    if(metadata.version!==1||metadata.dimensions!==MEANING_DIMENSIONS||!Array.isArray(metadata.chunks)||!metadata.chunks.length||buffer.byteLength!==metadata.chunks.length*MEANING_DIMENSIONS*4)throw new Error('Search index version mismatch.');
    encoder=model;index={...metadata,vectors:new Float32Array(buffer)};
  })().catch(error=>{pending=null;throw error;});
  return pending;
}
self.addEventListener('message',event=>{
  const {type,requestId,query}=event.data||{};
  if(type!=='search')return;
  const current=++latest;
  queue=queue.then(async()=>{
  if(current!==latest)return;
  try{
    if(typeof query!=='string'||!query.trim()||query.length>600){postMessage({type:'result',requestId,status:'zero',matches:[],reason:'insufficient-query'});return;}
    await load(requestId);if(current!==latest)return;
    postMessage({type:'progress',requestId,stage:'searching'});
    const output=await encoder(query,{pooling:'mean',normalize:true,truncation:true,max_length:256});
    if(current!==latest)return;
    postMessage({type:'result',requestId,...rankMeaning(index,output.data,query)});
  }catch(error){
    if(current===latest)postMessage({type:'error',requestId,message:'The remembered-saying search could not load. Please try again.'});
  }
  });
});
