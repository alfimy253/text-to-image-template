// Optional Linux browser QA tooling. The extracted binaries remain in ignored .cache.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import chromium from '@sparticuz/chromium';
import {chromium as playwright} from 'playwright-core';
export async function launchQABrowser(){
 if(process.platform==='linux'){
  const libs=resolve('.cache/pixabay-qa/chromium-libs');await mkdir(libs,{recursive:true});
  const archive=resolve(libs,'al2023.tar');
  await writeFile(archive,brotliDecompressSync(await readFile(new URL('../bin/al2023.tar.br',import.meta.resolve('@sparticuz/chromium')))));
  execFileSync('tar',['xf',archive,'-C',libs]);
  process.env.LD_LIBRARY_PATH=resolve(libs,'lib')+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:'');
 }
 return playwright.launch({executablePath:await chromium.executablePath(),args:[...chromium.args,'--autoplay-policy=no-user-gesture-required'],headless:true});
}
