// Local-only QA boundary: real app/planner/import/render code, fixture providers.
// Never reads .dev.vars, never contacts a live LLM, Pixabay or speech account.
import http from 'node:http';
import {QA_SCRIPT} from './qa-pixabay-data.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHTML} from '../src/page.ts';
import {handleGenerateImagePrompts} from '../src/modules/image-prompts.ts';
import {handleImageBinary, handleImageBatch} from '../src/modules/image-batch.ts';
const port=Number(process.env.QA_PORT || 8765);
const fixture=resolve('.cache/pixabay-qa');
const stats={plannerCalls:[],searches:[],downloads:[],voiceovers:0};
const env={PIXABAY_API_KEY:'local-qa-fixture-not-a-secret', AI:{run:async(model,input)=>{
 const slots=JSON.parse(input.prompt.match(/Requested slots of \d+ total: ([^\n]+)/)[1]);
 stats.plannerCalls.push({slots,containsWholeScript:input.prompt.includes(QA_SCRIPT)});
 return {response:{scenes:slots.map(s=>({type:s.type,keywords:'fresh community fruit '+s.scene}))}};
}}};
const credits={consume:async n=>({allowed:true,granted:n}),refund:async()=>null};
const photo=id=>({id,pageURL:`https://pixabay.com/photos/qa-${id}/`,user:'LOCAL QA FIXTURE',tags:'fruit',largeImageURL:`https://cdn.pixabay.com/photo/${id}.jpg`,previewURL:`https://cdn.pixabay.com/photo/${id}.jpg`,imageWidth:640,imageHeight:480});
globalThis.fetch=async(input,init)=>{
 const u=new URL(String(input));
 if(u.hostname==='pixabay.com'){
  stats.searches.push({path:u.pathname,q:u.searchParams.get('q'),per_page:u.searchParams.get('per_page')});
  if(u.pathname.includes('videos')) return Response.json({totalHits:3,hits:[701,702,703].map((id,i)=>({id,pageURL:`https://pixabay.com/videos/qa-${id}/`,user:'LOCAL QA FIXTURE',duration:5,videos:{small:{url:`https://cdn.pixabay.com/video/${i===1?2:1}.mp4`,width:640,height:360,size:250000}}}))});
  return Response.json({totalHits:3,hits:[101,102,103].map(photo)});
 }
 if(u.hostname==='cdn.pixabay.com'){
  stats.downloads.push(u.pathname);
  const video=u.pathname.endsWith('.mp4');
  return new Response(await readFile(resolve(fixture,video?(u.pathname.includes('/2.mp4')?'clip2.mp4':'clip1.mp4'):'fruits.jpg')),{headers:{'Content-Type':video?'video/mp4':'image/jpeg'}});
 }
 throw new Error('QA blocks all non-fixture provider fetches');
};
const types={'.mp4':'video/mp4','.jpg':'image/jpeg','.png':'image/png','.json':'application/json','.html':'text/html; charset=utf-8'};
http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,`http://localhost:${port}`);
  let response;
  if(u.pathname==='/api/pipeline-capabilities') response=Response.json({version:261,binaryImages:true,compactPrompts:true,imageChunks:2,imageSlots:6,imageBatchSize:3,chunkVoiceover:false,singleAttemptScript:true});
  else if(u.pathname==='/api/voiceover') {stats.voiceovers++;response=new Response(await readFile(resolve(fixture,'narration.mp3')),{headers:{'Content-Type':'audio/mpeg'}});}
  else if(u.pathname==='/api/session') response=Response.json({authenticated:true,session:{email:'qa@example.test',name:'Local QA',status:'approved'},identity:{email:'qa@example.test'},user:{email:'qa@example.test'},entitlements:{active:true,unlimited:true},plan:{key:'administrator',unlimited:true},usage:{remaining:999,used:0},cloudflareAccessEnabled:false});
  else if(u.pathname==='/qa-stats') response=Response.json(stats);
  else if(u.pathname==='/api/image-prompts'||u.pathname==='/api/image'||u.pathname==='/api/image-batch'){
   const parts=[];for await(const p of req)parts.push(p);
   const r=new Request(u,{method:req.method,headers:req.headers,body:Buffer.concat(parts)});
   response=u.pathname==='/api/image-prompts'?await handleGenerateImagePrompts(r,env,'qa-text-planner'):
    u.pathname==='/api/image'?await handleImageBinary(r,env,credits):await handleImageBatch(r,env,credits,{waveIntervalMs:0});
  }
  else if(u.pathname==='/muxer.js') response=new Response(await readFile('node_modules/mp4-muxer/build/mp4-muxer.js'),{headers:{'Content-Type':'text/javascript'}});
  else if(u.pathname==='/free'||u.pathname==='/studio'){
   const html=createHTML().replace('https://unpkg.com/mp4-muxer@5.1.3/build/mp4-muxer.js','/muxer.js').replace('</head>',`<script>window.__FREEMIUM_MODE=true;window.__workerMode=true;</script></head>`).replace('</body>','<aside style="position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#183b32;color:#d5ffe9;padding:10px 14px;border:1px solid #4fbd95;border-radius:8px;font:13px system-ui;pointer-events:none">LOCAL FIXTURE QA — no live providers</aside></body>');
   response=new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Set-Cookie':'studio_freemium=1; Path=/; SameSite=Lax'}});
  }
  else if(u.pathname.startsWith('/qa-preview/')||u.pathname==='/'){
   const name=u.pathname==='/'?'index.html':u.pathname.slice('/qa-preview/'.length);
   if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Error('Invalid file');
   const ext=name.slice(name.lastIndexOf('.'));
   const bytes=await readFile(resolve('qa-preview',name));
   const headers={'Content-Type':types[ext]||'application/octet-stream','Accept-Ranges':'bytes'};
   const range=req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
   if(range){
    const start=range[1]?Number(range[1]):Math.max(0,bytes.length-Number(range[2]));
    const end=range[1]&&range[2]?Math.min(bytes.length-1,Number(range[2])):bytes.length-1;
    if(start>end||start>=bytes.length)response=new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
    else response=new Response(bytes.subarray(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
   }else response=new Response(bytes,{headers:{...headers,'Content-Length':String(bytes.length)}});
  }
  else response=Response.json({ok:true});
  res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body){for await(const c of response.body)res.write(c);}res.end();
 }catch(e){console.error(e);res.writeHead(500,{'Content-Type':'text/plain'});res.end('Local QA error: '+e.message);}
}).listen(port,'0.0.0.0',()=>console.log(`QA fixture studio listening on 0.0.0.0:${port}; no live provider credentials loaded`));
