// Requires the optional tools documented in qa-preview/README.md and the QA server.
import assert from 'node:assert/strict';
import {QA_SCRIPT} from './qa-pixabay-data.mjs';
import {writeFile, mkdir} from 'node:fs/promises';
import {launchQABrowser} from './qa-browser.mjs';
const base=process.env.QA_URL||'http://127.0.0.1:8765';
const browser=await launchQABrowser();
const errors=[],warnings=[],dialogs=[];
const page=await browser.newPage({viewport:{width:1400,height:1000},acceptDownloads:true});
page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR:',e.message)});
page.on('console',m=>{if(m.type()==='warning'||m.type()==='error'){warnings.push(m.text());console.log('BROWSER:',m.text())}});
page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss()});
await page.route('**/*',r=>r.request().url().startsWith(base)||r.request().url().startsWith('blob:')||r.request().url().startsWith('data:')?r.continue():r.abort());
await mkdir('qa-preview',{recursive:true});
const script=QA_SCRIPT;
const watchdog=setTimeout(async()=>{console.error('QA deadline exceeded');await page.screenshot({path:'qa-preview/timeout.png'}).catch(()=>{});await browser.close();},180000);
const results={fixtureMode:true,script,errors,warnings,dialogs,layouts:{}};
async function saveBlob(name){
 const base64=await page.evaluate(async()=>{const bytes=new Uint8Array(await window.__lastRenderBlob.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)});
 await writeFile('qa-preview/'+name,Buffer.from(base64,'base64'));
}
try{
 await page.goto(base+'/free');
 results.codecs=await page.evaluate(async()=>({avc:(await VideoEncoder.isConfigSupported({codec:'avc1.42001f',width:640,height:360,bitrate:1000000,framerate:30})).supported,aac:(await AudioEncoder.isConfigSupported({codec:'mp4a.40.2',sampleRate:44100,numberOfChannels:1,bitrate:128000})).supported}));
 console.log('CODECS',results.codecs);
 const start=Date.now();
 const batch=await page.evaluate(async(script)=>{
  while(window.__BATCH_ROWS.length)removeBatchRow(window.__BATCH_ROWS[0].id);
  const row=addBatchRow({script,minutes:1,orientation:'landscape',resolution:720,style:'Cinematic Film'});
  await runBatchRow(row);
  window.__QA_ROW=row;
  return {id:row.id,stage:row.stage,error:row.error,images:row.images.length,clips:row.slides.filter(s=>s.type==='mp4').length,frames:row.slides.reduce((n,s)=>n+Math.round(s._partialSec*30),0),timeline:row.slides.map(s=>({type:s.type||'image',seconds:s._partialSec})),duration:row.audio?.duration};
 },script);
 console.log('BATCH',batch);assert.equal(batch.stage,'done');assert.equal(batch.images,10);assert.equal(batch.clips,2);
 await page.evaluate(()=>exportBatchRow(window.__QA_ROW.id));
 assert.ok(await page.evaluate(()=>window.__lastRenderBlob?.size>1000));
 await saveBlob('sample-quick-batch.mp4');
 batch.elapsedMs=Date.now()-start;results.layouts.quickBatch=batch;
 await page.screenshot({path:'qa-preview/quick-batch.png',fullPage:false});
 await page.goto(base+'/free');
 const editorStart=Date.now();
 const editor=await page.evaluate(async(script)=>{
  addVideoAccordion();const project=window.__VIDEO_PROJECTS[0];
  project.script=script;project._seoTopic='fresh community fruit';project._seoMinutes=1;project._imageFlowActive=true;
  project.orientation='landscape';project.resolution=720;
  document.getElementById('va-quality-'+project.n).value='low';
  project.audioFile=new File([await(await fetch('/api/voiceover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:script})})).blob()],'qa-fixture.mp3',{type:'audio/mpeg'});
  project.subtitles=buildScriptCues(script,15000);
  project.selectedSeoSet={longTail:'fresh community fruit',short:['fruit','health','community','markets']};
  await startImagePromptFlow(project.n);
  const data={id:project.n,assets:project.assets.length,clips:project.assets.filter(a=>a.kind==='mp4').length,sceneOrder:project.assets.map(a=>a.sceneIndex)};
  await runGenerationQueue();data.status=project.status;data.error=project.error;data.duration=project.audio?.duration;
  return data;
 },script);
 console.log('EDITOR',editor);assert.equal(editor.assets,10);assert.equal(editor.clips,2);assert.equal(editor.status,'done');
 assert.ok(await page.evaluate(()=>window.__lastRenderBlob?.size>1000));
 await saveBlob('sample-editor.mp4');editor.elapsedMs=Date.now()-editorStart;results.layouts.editor=editor;
 await page.screenshot({path:'qa-preview/editor.png',fullPage:false});
 results.providerStats=await(await page.request.get(base+'/qa-stats')).json();
 assert.equal(results.providerStats.plannerCalls.length,8);assert.ok(results.providerStats.plannerCalls.every(c=>c.containsWholeScript));
 assert.ok(results.providerStats.searches.every(s=>s.per_page==='3'));
 assert.equal(errors.length,0,'no uncaught browser errors');
 console.log('QA PASSED: both real browser MP4 exports saved.');
}finally{
 await writeFile('qa-preview/results.json',JSON.stringify(results,null,2));
 clearTimeout(watchdog);await browser.close();
}
