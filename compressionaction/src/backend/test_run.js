import { runCompressionJob } from './compressRunner.js';
import path from 'node:path';

async function main(){
  const input = path.resolve(process.cwd(), '..', 'sample_files.txt');
  const out = path.resolve(process.cwd(), '..', 'out_test');
  try{
    const res = await runCompressionJob({ inputPath: input, outputDir: out, tools: ['gzip'], level: 6 });
    console.log('Result:', res);
  }catch(e){
    console.error('Error:', e.message);
    process.exitCode = 1;
  }
}

main();
