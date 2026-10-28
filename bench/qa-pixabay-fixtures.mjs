// Deterministic local media; NOT stock search results or AI-generated images.
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const dir=resolve('.cache/pixabay-qa');
await mkdir(dir,{recursive:true});
const source=execFileSync('gh',['api','repos/opencv/opencv/contents/samples/data/fruits.jpg?ref=4.x','--jq','.content'],{encoding:'utf8'});
await writeFile(resolve(dir,'fruits.jpg'),Buffer.from(source,'base64'));
const ffmpeg=resolve('node_modules/@ffmpeg-installer/linux-x64/ffmpeg');
const run=args=>execFileSync(ffmpeg,['-hide_banner','-loglevel','error',...args,'-y'],{stdio:'inherit'});
run(['-f','lavfi','-i','sine=frequency=220:sample_rate=44100:duration=15','-af','volume=0.025','-c:a','libmp3lame',resolve(dir,'narration.mp3')]);
const font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
for(const n of [1,2]){
 const motion=n===1?"zoompan=z='min(zoom+0.002,1.35)':d=150:s=640x360:fps=30":"zoompan=z=1.4:x='(iw-iw/zoom)*(on/150)':y='ih/6':d=150:s=640x360:fps=30";
 const label=n===1?'QA VIDEO 1 - moving produce':'QA VIDEO 2 - fresh food';
 run(['-loop','1','-i',resolve(dir,'fruits.jpg'),'-vf',`scale=800:450,${motion},drawtext=fontfile=${font}:text='${label}':x=20:y=20:fontsize=23:fontcolor=white:box=1:boxcolor=black@0.6`,'-t','5','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',resolve(dir,`clip${n}.mp4`)]);
}
console.log('Local fixture JPEG, two distinct moving MP4s and 15-second low-volume tone prepared.');
