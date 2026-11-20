import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHTML } from '../src/page.ts';
import { APP_JS } from '../src/client/app-js.ts';
import { TIMELINE_EDITOR_JS } from '../src/client/timeline-editor.ts';

function spyCanvas() {
  const ops = [];
  const ctx = { ops, filter: 'none',
    save() {}, restore() {}, clearRect(...a) { ops.push(['clear', ...a]); },
    fillRect(...a) { ops.push(['rect', this.fillStyle, ...a]); },
    drawImage(_image, ...a) { ops.push(['image', ...a]); },
    fillText(...a) { ops.push(['text', ...a]); }, measureText(s) { return {width: s.length * 10}; },
    translate(...a) { ops.push(['translate', ...a]); }, rotate(...a) { ops.push(['rotate', ...a]); },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() { ops.push(['fill', this.fillStyle]); }, arc() {},
    createLinearGradient() { return {addColorStop() {}}; }, createRadialGradient() { return {addColorStop() {}}; }
  };
  return ctx;
}

test('edited table preview paints the saved timeline with the editor painter, including gaps and subtitles', t => {
  const dom = new JSDOM(createHTML(), {url:'https://studio.test/free?layout=table&pipelinePage=parity', runScripts:'outside-only', pretendToBeVisual:true});
  const w = dom.window; t.after(() => w.close());
  w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
  w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {};
  w.Audio = class { constructor(src='') { this.src=src; this.currentTime=0; this.paused=true; } addEventListener() {} play() { this.paused=false; return Promise.resolve(); } pause() { this.paused=true; } };
  const ctx = spyCanvas(); w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.eval(APP_JS.replace('__PROMPTS_JSON__', '[]')); w.eval(TIMELINE_EDITOR_JS);
	w.__PIPELINE_RETRY_SPEED = 20000;
  w.setStudioLayout('table');
  const row = w.__BATCH_ROWS[0];
  row.script = 'This script has more than ten words and makes a completed test row.';
  row.images = [{index:0}]; row.mp3 = new w.Blob(['audio'], {type:'audio/mpeg'}); row.mp3Url='blob:voice'; row.animated=true; row.stage='done';
  const image = {naturalWidth: 200, naturalHeight: 100, complete:true};
  row.slides = [{id:'clip', sceneId:'scene-1', assetId:'scene-1', type:'image', img:image, _partialSec:3}];
  row.subtitles = [{startMs:0,endMs:9000,text:'stale row subtitle'}];
  row.timelineKey = 'ytvs.timeline-editor.v1.parity-row';
  const text = 'untruncated '.repeat(20);
  const media = {id:'clip',kind:'media',sceneId:'scene-1',assetId:'scene-1',startSec:1,durationSec:3,fit:'cover',visible:true};
  const visual = {id:'text',kind:'text',startSec:0,durationSec:6,text,visible:true,x:50,y:78,fontSize:28,font:'sans',align:'center'};
  const state = {projectId:'parity-row',updatedAt:100,videoStyle:'Documentary',frame:{width:400,height:200},durationSec:6,subtitles:[{startMs:0,endMs:6000,text:'timeline subtitle'}],scenes:[{id:'scene-1',name:'Scene 1',mediaAssetId:'scene-1',videoStyle:'Documentary',effects:[]}],tracks:[{id:'background-media',kind:'media',items:[media]},{kind:'visual',items:[visual]}]};
  w.localStorage.setItem(row.timelineKey, JSON.stringify(state));
  row.timeline={updatedAt:100,sceneItems:[{id:'scene-1',slideId:'clip',a:'scene-1',i:0,t:0,s:1,d:3,v:1}],durationSec:6,frame:state.frame}; row.timelineEdited=true;
  w.renderBatchTable();
  w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="preview"]`).click();
  function tableAt(sec) { ctx.ops.length=0; w.batchPreviewSeek(sec); w.batchPreviewTick(); return ctx.ops.map(x=>[...x]); }
  const tableOps = tableAt(2);
  const expected = spyCanvas();
  w.__TIMELINE_EDITOR__.paintFrame(expected,400,200,2,{state,active:media,scene:state.scenes[0],asset:{image},visuals:[visual]});
  assert.deepEqual(tableOps, expected.ops);
  assert.ok(tableOps.some(o=>o[0]==='text' && o[1]===text));
  assert.ok(tableOps.some(o=>o[0]==='text' && o[1]==='timeline subtitle'));
  assert.ok(!tableOps.some(o=>o[1]==='stale row subtitle'));
  assert.deepEqual(tableOps.find(o=>o[0]==='image').slice(1), [0,0,400,200], 'no table-only zoom');
  const gap = tableAt(0.25);
  assert.ok(!gap.some(o=>o[0]==='image'));
  assert.ok(gap.some(o=>o[1]===text), 'visuals still paint in gaps');
  assert.equal(row.projectDetail.scenes[0].id, 'scene-1');
  assert.equal(row.projectDetail.scenes[0].mediaAssetId, 'scene-1');
  w.closeBatchPreview();

  // A later saved edit can remove all media and subtitles. Old slides/cues
  // must not reappear, while visual-only content is still rendered.
  state.updatedAt = 200; state.scenes = []; state.tracks[0].items = []; state.subtitles = [];
  w.localStorage.setItem(row.timelineKey, JSON.stringify(state));
  w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="preview"]`).click();
  const emptyOps = tableAt(2);
  assert.equal(row.slides.length, 0);
  assert.equal(row.slideItems.length, 0);
  assert.ok(!emptyOps.some(o => o[0] === 'image'));
  assert.ok(emptyOps.some(o => o[1] === text));
  assert.ok(!emptyOps.some(o => o[1] === 'timeline subtitle' || o[1] === 'stale row subtitle'));
  w.closeBatchPreview();
});

test('shared painter skips only the baked children of the active rendered template', t => {
  const dom = new JSDOM('', {url:'https://studio.test/?layout=table',runScripts:'outside-only'}); t.after(()=>dom.window.close());
  const w=dom.window; w.eval(TIMELINE_EDITOR_JS);
  const ctx=spyCanvas();
  const active={id:'clip',visible:true,fit:'contain',isTemplateScene:true};
  const video={videoWidth:100,videoHeight:100,readyState:4};
  const text=(id,parent,baked)=>({kind:'text',id,parentId:parent,bakedInTemplateClip:baked,text:id,visible:true,startSec:0,durationSec:4});
  w.__TIMELINE_EDITOR__.paintFrame(ctx,400,200,1,{state:{videoStyle:'Documentary',subtitles:[]},active,scene:{isTemplateScene:true},asset:{video},visuals:[text('baked','clip',true),text('other','another',true),text('new','clip',false)]});
  assert.ok(!ctx.ops.some(o=>o[1]==='baked'));
  assert.ok(ctx.ops.some(o=>o[1]==='other'));
  assert.ok(ctx.ops.some(o=>o[1]==='new'));
  assert.deepEqual(ctx.ops.find(o=>o[0]==='image').slice(1),[100,0,200,200]);
});
