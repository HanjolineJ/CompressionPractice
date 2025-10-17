import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { format } from '@fast-csv/format';

const TOOLS = {
  gzip:  { cmd: 'gzip',  args: (lvl) => ['-k', `-${lvl}`] },
  bzip2: { cmd: 'bzip2', args: (lvl) => ['-k', `-${Math.min(9, Math.max(1, lvl))}`] },
  xz:    { cmd: 'xz',    args: (lvl) => ['-k', `-${lvl}`] },
  zstd:  { cmd: 'zstd',  args: (lvl) => ['-k', `-${lvl}`] },
  lz4:   { cmd: 'lz4',   args: (lvl) => ['-k', `-${lvl}`] }
};

function existsOnPath(cmd) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? process.env.PATHEXT?.split(';') ?? ['.exe', '.cmd'] : [''];
  return (process.env.PATH || '').split(sep).some(dir =>
    exts.some(ext => fs.existsSync(path.join(dir, cmd + ext)))
  );
}

function runOne(tool, inputPath, level) {
  return new Promise((resolve) => {
    const t = TOOLS[tool];
    if (!t || !existsOnPath(t.cmd)) return resolve({ tool, skipped: true, reason: 'not_installed' });

    const args = [...t.args(level), inputPath];
    const start = process.hrtime.bigint();
    const child = spawn(t.cmd, args, { stdio: 'ignore' });

    child.on('close', (code) => {
      const end = process.hrtime.bigint();
      if (code !== 0) return resolve({ tool, error: true, code });

      const outPath = {
        gzip:  inputPath + '.gz',
        bzip2: inputPath + '.bz2',
        xz:    inputPath + '.xz',
        zstd:  inputPath + '.zst',
        lz4:   inputPath + '.lz4'
      }[tool];

      try {
        const srcSize = fs.statSync(inputPath).size;
        const dstSize = fs.statSync(outPath).size;
        const ratio = srcSize > 0 ? (1 - (dstSize / srcSize)) : 0;
        resolve({
          tool, level, srcSize, dstSize, ratio,
          elapsedNs: Number(end - start),
          outPath
        });
      } catch (e) {
        resolve({ tool, error: true, message: e.message });
      }
    });
  });
}

export async function runCompressionJob({ inputPath, outputDir, tools, level }) {
  if (!fs.existsSync(inputPath)) throw new Error('Input file not found');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Work in output dir (keep originals in place; copy results after)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compressaction-'));
  const tempInput = path.join(tempDir, path.basename(inputPath));
  fs.copyFileSync(inputPath, tempInput);

  const selected = tools.filter(t => TOOLS[t]);
  const results = [];
  for (const t of selected) {
    // cleanup any previous outputs
    ['.gz','.bz2','.xz','.zst','.lz4'].forEach(ext => {
      const p = tempInput + ext; if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    // run tool
    results.push(await runOne(t, tempInput, level));
  }

  // Move artifacts to outputDir
  for (const r of results) {
    if (r?.outPath && fs.existsSync(r.outPath)) {
      const dest = path.join(outputDir, path.basename(r.outPath));
      fs.copyFileSync(r.outPath, dest);
    }
  }

  // Write CSV log
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const csvPath = path.join(logsDir, `run_${Date.now()}.csv`);
  const csvStream = format({ headers: true });
  const writable = fs.createWriteStream(csvPath);
  csvStream.pipe(writable);
  for (const r of results) {
    csvStream.write({
      tool: r.tool,
      level: r.level ?? '',
      src_bytes: r.srcSize ?? '',
      dst_bytes: r.dstSize ?? '',
      ratio_saved: r.ratio?.toFixed(4) ?? '',
      elapsed_ms: r.elapsedNs ? (r.elapsedNs / 1e6).toFixed(3) : '',
      status: r.error ? 'error' : (r.skipped ? 'skipped' : 'ok')
    });
  }
  csvStream.end();

  // Return rows for UI
  return {
    rows: results,
    csvPath
  };
}
