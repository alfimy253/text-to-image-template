import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { PROGRESSIVE_IMAGE_PIPELINE_JS } from '../src/client/progressive-image-pipeline.ts';
import { countScriptWords, sceneCountForScript } from '../src/modules/image-prompts.ts';
import { harness } from './studio-render-harness.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const setA = { title:'Garden Guide', headings:['Garden basics'], longTail:'garden flowers', short:['garden','flowers','plants','soil'] };

test('browser and worker count punctuation, emoji, Unicode and subtitle text identically at scene boundaries', () => {
 const context = vm.createContext({}); vm.runInContext(PROGRESSIVE_IMAGE_PIPELINE_JS, context);
 const inputs = [
  'hello,world '.repeat(65) + '✨ café',
  'forest🌲lake '.repeat(65),
  '🌲 '.repeat(131) + 'one',
  'word/word '.repeat(120) + '!!!',
  '\ufeffWEBVTT\n\n1\r\n00:00:01 --> 00:00:02\r\nHi,there 🌺 café\n2\n你好.世界\n',
  "one-two l'amour foo_bar 1.5 € Ж😄中"
 ];
 for (const text of inputs) {
  assert.equal(context.imageScriptWordCount(text), countScriptWords(text), text.slice(0,60));
  assert.equal(context.imageSceneTarget(text, 1), sceneCountForScript(text));
 }
});

test('parallel rendering drains already-started media before a render failure surfaces', async () => {
 const context = vm.createContext({setTimeout}); vm.runInContext(PROGRESSIVE_IMAGE_PIPELINE_JS, context);
 const first = deferred(), second = deferred(); const offsets = [];
 const run = context.runProgressiveImagePipeline({
  total: 9, parallelRenders: 2, isCancelled: () => false,
  request: async batch => Array.from({length: batch.count}, (_,i) => 'scene ' + (batch.offset+i)),
  render: async (_batch, offset) => {offsets.push(offset); if (offset === 0) await first.promise; else if (offset === 3) await second.promise;}
 });
 let finished = false; const rejection = assert.rejects(run, /first render failed/).then(() => {finished = true});
 await tick(); assert.deepEqual(offsets,[0,3]);
 first.reject(new Error('first render failed')); await tick();
 assert.equal(finished,false, 'the other paid render is still active');
 second.resolve(); await rejection;
});

test('reopening an editor walkthrough retains a single partial SEO plan instead of replanning', async t => {
 const {w} = harness(); t.after(() => w.close()); let calls=0;
 const original=w.fetch; w.fetch = async (input, init) => {
  if (String(input) === '/api/seo-plan') {calls++; return json({success:true,partial:true,sets:[setA],warning:'Only one set'});}
  return original(input,init);
 };
 w.addVideoAccordion(); await w.generateScript(1);
 assert.equal(calls,1); assert.equal(w.__VIDEO_PROJECTS[0].seoSets.length,1);
 w.closeSeoWalkthrough(1); await w.generateScript(1);
 assert.equal(calls,1); assert.equal(w.__VIDEO_PROJECTS[0].seoSets.length,1);
 assert.equal(w.document.getElementById('seo-wt-sets-1').style.display, '');
});

test('SEO plan completion follows the surviving editor project after renumbering', async t => {
 const {w} = harness(); t.after(() => w.close()); const gate=deferred(), started=deferred();
 const original=w.fetch; w.fetch = async (input, init) => {
  if (String(input) === '/api/seo-plan') { started.resolve(); await gate.promise; return json({success:true,sets:[setA]}); }
  return original(input,init);
 };
 w.addVideoAccordion(); w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[1];
 const run=w.generateScript(2); await started.promise;
 w.deleteVideoAccordion(1);
 assert.equal(w.document.getElementById('va-script-btn-1').disabled,true);
 assert.equal(w.document.getElementById('va-upload-btn-1').disabled,true);
 gate.resolve(); await run;
 assert.equal(w.__VIDEO_PROJECTS[0], project); assert.equal(project.seoSets.length,1);
 assert.ok(w.document.getElementById('seo-wt-sets-list-1').textContent.includes('Garden Guide'));
 assert.equal(w.document.getElementById('va-script-btn-1').disabled,false);
});

test('script completion starts keyword planning on the surviving project after renumbering', async t => {
 const {w} = harness(); t.after(() => w.close()); const gate=deferred(), started=deferred(), planned=deferred();
 const original=w.fetch; w.fetch = async (input,init={}) => {
  const path=String(input);
  if (path === '/api/pipeline-capabilities') return json({singleAttemptScript:true,compactPrompts:true});
  if (path === '/api/script') {started.resolve(); await gate.promise; return json({success:true,script:'A forest has trees and flowers.',durationMs:60000});}
  if (path === '/api/image-prompts') {planned.resolve(JSON.parse(init.body)); return json({success:false,error:'test stop'},400);}
  return original(input,init);
 };
 w.addVideoAccordion(); w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[1];
 project.selectedSeoSet=setA; project._seoTopic='forest'; project._seoMinutes=1;
 const run=w.confirmSeoStyleAndGenerate(2); await started.promise;
 w.deleteVideoAccordion(1); gate.resolve(); await run;
 const body=await Promise.race([planned.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('keyword planning did not start')),2000))]);
 assert.equal(body.script,'A forest has trees and flowers.');
 assert.equal(w.__VIDEO_PROJECTS[0],project); assert.equal(project.imagePromptTarget,6);
});

test('a deleted project cannot apply a late SEO plan to a replacement accordion', async t => {
 const {w} = harness(); t.after(() => w.close()); const gate=deferred(), started=deferred();
 const original=w.fetch; w.fetch = async (input,init) => {
  if (String(input) === '/api/seo-plan') {started.resolve(); await gate.promise; return json({success:true,sets:[setA]});}
  return original(input,init);
 };
 w.addVideoAccordion(); const removed=w.__VIDEO_PROJECTS[0];
 const run=w.generateScript(1); await started.promise;
 w.deleteVideoAccordion(1); w.addVideoAccordion(); const replacement=w.__VIDEO_PROJECTS[0];
 gate.resolve(); await run;
 assert.equal(removed._deleted,true); assert.notEqual(replacement,removed);
 assert.ok(!replacement.seoSets || replacement.seoSets.length===0);
 assert.equal(w.document.getElementById('seo-walkthrough-modal-1'),null);
});

test('editor passes a validated SEO writer result and selected vocabulary into the real stock keyword planner', async t => {
 const {handleSeoPlanGeneration,handleSeoScriptGeneration} = await import('../src/modules/script-seo.ts');
 const {handleGenerateImagePrompts} = await import('../src/modules/image-prompts.ts');
 const {w} = harness(); t.after(() => w.close()); const planning=deferred(); const prompts=[];
 const setB={title:'Planting Herbs',headings:['Planting herbs'],longTail:'herbs for home',short:['herbs','home','planting','pots']};
 const lines=['Garden flowers help the garden.','Flowers grow in the soil.','Plants love healthy soil.','Plants thrive here.'];
 const srt=lines.map((line,i)=>`${i+1}\n00:00:${String(i*4).padStart(2,'0')},000 --> 00:00:${String((i+1)*4).padStart(2,'0')},000\n${line}`).join('\n\n');
 const env={AI:{run:async (_model,input)=>{
  prompts.push(input.prompt);
  if (input.prompt.includes('SEO strategist')) return {response:JSON.stringify(input.prompt.includes('DIFFERENT')?setB:setA)};
  if (input.prompt.includes('professional video script writer')) return {response:srt};
  if (input.prompt.includes('You plan Pixabay stock searches')) {
   const slots=JSON.parse(input.prompt.match(/Requested slots of \d+ total: ([^\n]+)/)[1]);
   return {response:{scenes:slots.map(s=>({scene:s.scene,type:s.type,keywords:'garden scene '+s.scene}))}};
  }
  throw Error('unexpected model prompt');
 }}};
 const original=w.fetch; w.fetch=async (input,init={})=>{
  const path=String(input), req=new Request('https://studio.test'+path,{method:init.method || 'GET',headers:init.headers,body:init.body});
  if (path==='/api/pipeline-capabilities') return json({singleAttemptScript:true,compactPrompts:true,binaryImages:true});
  if (path==='/api/seo-plan') return handleSeoPlanGeneration(req,env,'text');
  if (path==='/api/script') return handleSeoScriptGeneration(req,new URL(req.url),env,'text');
  if (path==='/api/image-prompts') {const copy=await req.clone().json(); const response=await handleGenerateImagePrompts(req,env,'text'); planning.resolve(copy); return response;}
  if (path==='/api/image') return json({error:'fixture stops media delivery'},422);
  return original(input,init);
 };
 w.addVideoAccordion(); w.document.getElementById('va-script-topic-1').value='garden';
 await w.generateScript(1); assert.equal(w.__VIDEO_PROJECTS[0].seoSets.length,2);
 w.selectSeoKeywordSet(1,0); await w.confirmSeoStyleAndGenerate(1);
 const body=await Promise.race([planning.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('planner did not run')),2000))]);
 assert.match(body.script,/Garden flowers help the garden/);
 assert.equal(body.keywordSet.longTail,setA.longTail);
 const stockInstruction=prompts.find(p=>p.includes('You plan Pixabay stock searches'));
 assert.ok(stockInstruction.includes(body.script));
 assert.ok(stockInstruction.includes('SEO search terms for this video (reuse their subject words'));
 assert.ok(stockInstruction.includes('garden flowers'));
 // Allow the deliberately failed media batch to settle before the DOM closes.
 for(let i=0;i<100 && w.__VIDEO_PROJECTS[0]._imageFlowActive;i++) await new Promise(r=>setTimeout(r,10));
 assert.equal(w.__VIDEO_PROJECTS[0]._imageFlowActive,false);
});

test('permanent script request errors do not retry and report the actual attempt count', async t => {
 const {w} = harness(); t.after(()=>w.close()); let calls=0;
 const original=w.fetch; w.fetch=async(input,init)=>{
  if (String(input)==='/api/pipeline-capabilities') return json({singleAttemptScript:false});
  if (String(input)==='/api/script') {calls++; return json({success:false,error:'bad keyword set'},400);}
  return original(input,init);
 };
 w.addVideoAccordion(); w.__VIDEO_PROJECTS[0].selectedSeoSet=setA;
 assert.equal(await w.runSeoScriptRequest(1,'garden',1,'medium'),false);
 assert.equal(calls,1);
 assert.match(w.document.getElementById('va-script-status-1').textContent,/after 1 attempt: bad keyword set/);
});

test('repeated confirmation cannot start duplicate script writers', async t => {
 const {w} = harness(); t.after(()=>w.close()); const gate=deferred(), started=deferred(); let calls=0;
 const original=w.fetch; w.fetch=async(input,init)=>{
  if (String(input)==='/api/pipeline-capabilities') return json({singleAttemptScript:true});
  if (String(input)==='/api/script') {calls++;started.resolve();await gate.promise;return json({success:false,error:'invalid'},400);}
  return original(input,init);
 };
 w.addVideoAccordion(); w.__VIDEO_PROJECTS[0].selectedSeoSet=setA;
 const first=w.confirmSeoStyleAndGenerate(1); await started.promise;
 await w.confirmSeoStyleAndGenerate(1); assert.equal(calls,1);
 gate.resolve(); await first; assert.equal(w.__VIDEO_PROJECTS[0]._imageFlowActive,false);
});
