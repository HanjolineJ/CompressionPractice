import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

// For now, implement a single-tool fallback that uses Node's gzip so the app
// works on Windows without requiring external CLI tools. Keep return shape similar.

function gzipFile(inputPath, level) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const gzip = zlib.createGzip({ level });
    const inStream = fs.createReadStream(inputPath);
    const outPath = inputPath + '.gz';
    const outStream = fs.createWriteStream(outPath);

    inStream.pipe(gzip).pipe(outStream);

    outStream.on('finish', () => {
      const end = process.hrtime.bigint();
      try {
        const srcSize = fs.statSync(inputPath).size;
        const dstSize = fs.statSync(outPath).size;
        const ratio = srcSize > 0 ? (1 - (dstSize / srcSize)) : 0;
        resolve({
          tool: 'gzip', level, srcSize, dstSize, ratio,
          elapsedNs: Number(end - start), outPath
        });
      } catch (e) {
        resolve({ tool: 'gzip', error: true, message: e.message });
      }
    });

    outStream.on('error', (e) => resolve({ tool: 'gzip', error: true, message: e.message }));
    inStream.on('error', (e) => resolve({ tool: 'gzip', error: true, message: e.message }));
  });
}

export async function runCompressionJob({ inputPath, outputDir, tools = ['gzip'], level = 6 }) {
  if (!fs.existsSync(inputPath)) throw new Error('Input file not found');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compressaction-'));
  const tempInput = path.join(tempDir, path.basename(inputPath));
  fs.copyFileSync(inputPath, tempInput);

  const results = [];
  // Use gzip only; if requested tools include gzip, run gzip, else skip others
  if (tools.includes('gzip')) {
    results.push(await gzipFile(tempInput, level));
  } else {
    // If gzip not requested, still perform gzip to produce a result but mark skipped
    results.push({ tool: 'gzip', skipped: true, reason: 'gzip_not_selected' });
  }

  // Move artifacts to outputDir
  for (const r of results) {
    if (r?.outPath && fs.existsSync(r.outPath)) {
      const dest = path.join(outputDir, path.basename(r.outPath));
      fs.copyFileSync(r.outPath, dest);
    }
  }

  // Write a simple CSV log without external libs
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const csvPath = path.join(logsDir, `run_${Date.now()}.csv`);
  const headers = ['tool','level','src_bytes','dst_bytes','ratio_saved','elapsed_ms','status'];
  const lines = [headers.join(',')];
  for (const r of results) {
    const line = [
      r.tool,
      r.level ?? '',
      r.srcSize ?? '',
      r.dstSize ?? '',
      r.ratio != null ? r.ratio.toFixed(4) : '',
      r.elapsedNs ? (r.elapsedNs / 1e6).toFixed(3) : '',
      r.error ? 'error' : (r.skipped ? 'skipped' : 'ok')
    ].map(v => String(v)).join(',');
    lines.push(line);
  }
  fs.writeFileSync(csvPath, lines.join('\n'));

  return { rows: results, csvPath };
}
