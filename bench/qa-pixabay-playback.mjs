// Decode every actual exported frame, then reopen each MP4 in a real browser.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {launchQABrowser} from './qa-browser.mjs';
const base=process.env.QA_URL||'http://127.0.0.1:8765';
const browser=await launchQABrowser();const page=await browser.newPage();
const results=JSON.parse(await readFile('qa-preview/results.json','utf8'));
results.playback={};let logs='Real MP4 verification; files are unmodified browser exports.\n';
try{
 await page.goto(base+'/');
 for(const name of ['sample-quick-batch.mp4','sample-editor.mp4']){
  const decoded=spawnSync(resolve('node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),['-hide_banner','-i','qa-preview/'+name,'-f','null','-'],{encoding:'utf8',timeout:30000});
  assert.equal(decoded.status,0,decoded.stderr);assert.match(decoded.stderr,/frame=\s*450/);assert.doesNotMatch(decoded.stderr,/Error while decoding|Invalid data|corrupt decoded/);
  logs+='\n=== '+name+' ===\n'+decoded.stderr;
  const check=await page.evaluate(async(url)=>{
   const video=document.createElement('video');video.muted=true;video.controls=true;document.body.appendChild(video);
   function event(name){return new Promise((resolve,reject)=>{const done=()=>{clearTimeout(timer);resolve()};const timer=setTimeout(()=>reject(new Error(name+' timed out')),10000);video.addEventListener(name,done,{once:true})})}
   const loaded=event('loadeddata');video.src=url;await loaded;
   await video.play();await new Promise(r=>setTimeout(r,150));video.pause();
   const played=video.currentTime>0;
   const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;const ctx=canvas.getContext('2d');
   const frames=[];
   for(const time of [1.8,2.7,12.1,13.2]){
    const ready=event('seeked');video.currentTime=time;await ready;await new Promise(r=>setTimeout(r,120));ctx.drawImage(video,0,0,64,36);
    const pixels=ctx.getImageData(0,0,64,36).data;let hash=2166136261,sum=0;
    for(let i=0;i<pixels.length;i++){hash=Math.imul(hash^pixels[i],16777619)>>>0;if(i%4!==3)sum+=pixels[i]}
    frames.push({time,hash,mean:sum/(64*36*3)});
   }
   const result={played,duration:video.duration,width:video.videoWidth,height:video.videoHeight,frames};
   video.removeAttribute('src');video.load();video.remove();return result;
  },base+'/qa-preview/'+name);
  console.log('PLAYBACK',name,JSON.stringify(check));
  assert.equal(check.played,true);assert.ok(Math.abs(check.duration-15)<0.04);
  assert.ok(check.frames.every(f=>f.mean>5));assert.notEqual(check.frames[0].hash,check.frames[1].hash);assert.notEqual(check.frames[2].hash,check.frames[3].hash);
  results.playback[name]={...check,decodedFrames:450,ffmpegDecodeErrors:0};
  console.log(name,JSON.stringify(results.playback[name]));
 }
}finally{await browser.close()}
await writeFile('qa-preview/results.json',JSON.stringify(results,null,2));
await writeFile('qa-preview/verification.txt',logs);
console.log('Both MP4s decode 450/450 frames, play, seek, and contain moving pixels in BOTH clip windows.');
