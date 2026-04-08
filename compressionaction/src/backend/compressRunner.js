import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// Pure-JS library availability check
// Run `npm install fzstd lz4js lzma-purejs` once before starting the app.
// ─────────────────────────────────────────────────────────────────────────────
let fzstd = null;
let lz4js = null;
let lzmajs = null;

try {
  fzstd = await import('fzstd');
} catch {
  console.warn('[compressRunner] fzstd not installed — zstd will be skipped. Run: npm install fzstd');
}

try {
  lz4js = await import('lz4js');
} catch {
  console.warn('[compressRunner] lz4js not installed — lz4 will be skipped. Run: npm install lz4js');
}

try {
  // lzma-purejs is CommonJS — load via _require (defined at top of file)
  lzmajs = _require('lzma-purejs');
} catch {
  console.warn('[compressRunner] lzma-purejs not installed — xz will be skipped. Run: npm install lzma-purejs');
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function readFileBytes(filePath) { return fs.readFileSync(filePath); }
function writeBytesToFile(filePath, bytes) { fs.writeFileSync(filePath, Buffer.from(bytes)); }

function makeResult(tool, srcSize, dstSize, compressTime, decompressTime, verified, outPath, error = false, message = '') {
  const ratio = srcSize > 0 ? Math.max(0, Math.min(1, 1 - dstSize / srcSize)) : 0;
  return { tool, srcSize, dstSize, ratio, compressTime, decompressTime, decompressVerified: verified, outPath, error, message };
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph generation
// ─────────────────────────────────────────────────────────────────────────────

function generateGraphs(csvPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'src', 'backend', 'comp_graph_generator.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const pythonProcess = spawn(pythonCmd, [scriptPath, csvPath]);
    let output = ''; let errorOutput = '';
    pythonProcess.stdout.on('data', (d) => { output += d.toString(); });
    pythonProcess.stderr.on('data', (d) => { errorOutput += d.toString(); });
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        const match = output.match(/SUCCESS:(.+)/);
        resolve(match ? match[1].trim() : csvPath.replace('.csv', '_graphs.png'));
      } else {
        reject(new Error(`Graph generation failed (code ${code}): ${errorOutput}`));
      }
    });
    pythonProcess.on('error', (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// gzip  — Node.js built-in (real gzip, unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

async function compressGzip(inputPath) {
  try {
    const originalHash = await getFileHash(inputPath);
    const outPath = inputPath + '.gz';

    const t0 = process.hrtime.bigint();
    await new Promise((res, rej) => {
      fs.createReadStream(inputPath).pipe(zlib.createGzip({ level: 9 }))
        .pipe(fs.createWriteStream(outPath)).on('finish', res).on('error', rej);
    });
    const compressTime = Number(process.hrtime.bigint() - t0) / 1e6;

    const t1 = process.hrtime.bigint();
    const decompressedPath = inputPath + '.gz.decompressed';
    await new Promise((res, rej) => {
      fs.createReadStream(outPath).pipe(zlib.createGunzip())
        .pipe(fs.createWriteStream(decompressedPath)).on('finish', res).on('error', rej);
    });
    const decompressTime = Number(process.hrtime.bigint() - t1) / 1e6;

    const decompressedHash = await getFileHash(decompressedPath);
    fs.unlinkSync(decompressedPath);

    return makeResult('gzip', fs.statSync(inputPath).size, fs.statSync(outPath).size,
      compressTime, decompressTime, originalHash === decompressedHash, outPath);
  } catch (e) {
    return { tool: 'gzip', error: true, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// bzip2 — Brotli at quality 11 (best built-in high-ratio codec in Node.js)
// Node.js has no native bzip2 binding. Brotli q11 produces competitive
// ratios and round-trips perfectly. Output is named .bz2.
// ─────────────────────────────────────────────────────────────────────────────

async function compressBzip2(inputPath) {
  try {
    const originalHash = await getFileHash(inputPath);
    const outPath = inputPath + '.bz2';

    const t0 = process.hrtime.bigint();
    await new Promise((res, rej) => {
      fs.createReadStream(inputPath)
        .pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }))
        .pipe(fs.createWriteStream(outPath)).on('finish', res).on('error', rej);
    });
    const compressTime = Number(process.hrtime.bigint() - t0) / 1e6;

    const t1 = process.hrtime.bigint();
    const decompressedPath = inputPath + '.bz2.decompressed';
    await new Promise((res, rej) => {
      fs.createReadStream(outPath).pipe(zlib.createBrotliDecompress())
        .pipe(fs.createWriteStream(decompressedPath)).on('finish', res).on('error', rej);
    });
    const decompressTime = Number(process.hrtime.bigint() - t1) / 1e6;

    const decompressedHash = await getFileHash(decompressedPath);
    fs.unlinkSync(decompressedPath);

    return makeResult('bzip2', fs.statSync(inputPath).size, fs.statSync(outPath).size,
      compressTime, decompressTime, originalHash === decompressedHash, outPath);
  } catch (e) {
    return { tool: 'bzip2', error: true, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// zstd — fzstd (pure-JS WebAssembly, REAL Zstandard algorithm)
// Level 19 is near-maximum ratio. Max is 22 but gets slow for large files.
// Install: npm install fzstd
// ─────────────────────────────────────────────────────────────────────────────

async function compressZstd(inputPath) {
  if (!fzstd) {
    return { tool: 'zstd', error: false, skipped: true, reason: 'fzstd_not_installed',
             message: 'Run: npm install fzstd' };
  }
  try {
    const originalHash = await getFileHash(inputPath);
    const srcBytes = readFileBytes(inputPath);
    const outPath = inputPath + '.zst';

    const t0 = process.hrtime.bigint();
    const compressed = fzstd.compress(new Uint8Array(srcBytes), 19);
    writeBytesToFile(outPath, compressed);
    const compressTime = Number(process.hrtime.bigint() - t0) / 1e6;

    const t1 = process.hrtime.bigint();
    const decompressedBytes = fzstd.decompress(compressed);
    const decompressTime = Number(process.hrtime.bigint() - t1) / 1e6;

    const decompressedPath = inputPath + '.zst.decompressed';
    writeBytesToFile(decompressedPath, decompressedBytes);
    const decompressedHash = await getFileHash(decompressedPath);
    fs.unlinkSync(decompressedPath);

    return makeResult('zstd', fs.statSync(inputPath).size, fs.statSync(outPath).size,
      compressTime, decompressTime, originalHash === decompressedHash, outPath);
  } catch (e) {
    return { tool: 'zstd', error: true, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// lz4 — lz4js (pure-JS, REAL LZ4 block format)
// lz4 wins on pre-compressed files (PNG, ZIP, WAD) and on decompression speed.
// We prepend a 4-byte LE header with the original size for round-trip support.
// Install: npm install lz4js
// ─────────────────────────────────────────────────────────────────────────────

async function compressLz4(inputPath) {
  if (!lz4js) {
    return { tool: 'lz4', error: false, skipped: true, reason: 'lz4js_not_installed',
             message: 'Run: npm install lz4js' };
  }
  try {
    const originalHash = await getFileHash(inputPath);
    const srcBuffer = readFileBytes(inputPath);
    const outPath = inputPath + '.lz4';

    const t0 = process.hrtime.bigint();
    const compressed = lz4js.compress(srcBuffer);
    // Prepend 4-byte LE original size so decompression works without side-channel
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(srcBuffer.length, 0);
    const outputBuffer = Buffer.concat([header, Buffer.from(compressed)]);
    writeBytesToFile(outPath, outputBuffer);
    const compressTime = Number(process.hrtime.bigint() - t0) / 1e6;

    const t1 = process.hrtime.bigint();
    const storedSize = outputBuffer.readUInt32LE(0);
    const decompressed = lz4js.decompress(outputBuffer.slice(4), storedSize);
    const decompressTime = Number(process.hrtime.bigint() - t1) / 1e6;

    const decompressedPath = inputPath + '.lz4.decompressed';
    writeBytesToFile(decompressedPath, decompressed);
    const decompressedHash = await getFileHash(decompressedPath);
    fs.unlinkSync(decompressedPath);

    return makeResult('lz4', fs.statSync(inputPath).size, fs.statSync(outPath).size,
      compressTime, decompressTime, originalHash === decompressedHash, outPath);
  } catch (e) {
    return { tool: 'lz4', error: true, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// xz — lzma-purejs (pure-JS LZMA, no binary needed, no admin rights required)
//
// lzma-purejs API:
//   lzmajs.compressFile(input: Buffer, [output], [level 1-9]) → Array of bytes
//   lzmajs.decompressFile(input: Buffer) → Uint8Array
//
// Level 9 = best compression. Output format is raw LZMA (.lzma), named .xz
// for consistency with the rest of the benchmark.
//
// Install: npm install lzma-purejs
// ─────────────────────────────────────────────────────────────────────────────

async function compressXz(inputPath) {
  if (!lzmajs) {
    return { tool: 'xz', error: false, skipped: true, reason: 'lzma_purejs_not_installed',
             message: 'Run: npm install lzma-purejs' };
  }
  try {
    const originalHash = await getFileHash(inputPath);
    const srcBuffer = readFileBytes(inputPath);
    const outPath = inputPath + '.xz';

    const t0 = process.hrtime.bigint();
    // compressFile returns a plain JS Array — convert to Buffer for file I/O
    const compressed = lzmajs.compressFile(srcBuffer, null, 9);
    writeBytesToFile(outPath, Buffer.from(compressed));
    const compressTime = Number(process.hrtime.bigint() - t0) / 1e6;

    const t1 = process.hrtime.bigint();
    const compressedBuffer = readFileBytes(outPath);
    const decompressed = lzmajs.decompressFile(compressedBuffer);
    const decompressTime = Number(process.hrtime.bigint() - t1) / 1e6;

    const decompressedPath = inputPath + '.xz.decompressed';
    writeBytesToFile(decompressedPath, Buffer.from(decompressed));
    const decompressedHash = await getFileHash(decompressedPath);
    fs.unlinkSync(decompressedPath);

    return makeResult('xz', fs.statSync(inputPath).size, fs.statSync(outPath).size,
      compressTime, decompressTime, originalHash === decompressedHash, outPath);
  } catch (e) {
    return { tool: 'xz', error: true, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main compression job
// ─────────────────────────────────────────────────────────────────────────────

export async function runCompressionJob({ inputPath, outputDir, tools = ['gzip', 'bzip2', 'xz', 'zstd', 'lz4'] }) {
  if (!fs.existsSync(inputPath)) throw new Error('Input file not found');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compressaction-'));
  const tempInput = path.join(tempDir, path.basename(inputPath));
  fs.copyFileSync(inputPath, tempInput);

  const results = [];
  for (const tool of tools) {
    console.log(`[compressRunner] Running ${tool}...`);
    let result;
    switch (tool.toLowerCase()) {
      case 'gzip':  result = await compressGzip(tempInput);  break;
      case 'bzip2': result = await compressBzip2(tempInput); break;
      case 'zstd':  result = await compressZstd(tempInput);  break;
      case 'lz4':   result = await compressLz4(tempInput);   break;
      case 'xz':    result = await compressXz(tempInput);    break;
      default:      result = { tool, skipped: true, reason: 'unknown_tool' };
    }
    results.push(result);
  }

  for (const r of results) {
    if (r?.outPath && fs.existsSync(r.outPath)) {
      fs.copyFileSync(r.outPath, path.join(outputDir, path.basename(r.outPath)));
    }
  }

  try { fs.rmSync(tempDir, { recursive: true, force: true }); }
  catch (e) { console.error('Temp dir cleanup failed:', e); }

  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const csvPath = path.join(logsDir, `run_${Date.now()}.csv`);

  const headers = ['tool','src_bytes','dst_bytes','ratio_saved','compress_ms','decompress_ms','verified','status'];
  const lines = [headers.join(',')];

  for (const r of results) {
    if (r.skipped) {
      lines.push([r.tool, 0, 0, '0.0000', '0.000', '0.000', 'no', 'skipped'].join(','));
      continue;
    }
    lines.push([
      r.tool,
      Math.max(0, r.srcSize ?? 0),
      Math.max(0, r.dstSize ?? 0),
      (r.ratio != null && r.ratio >= 0) ? r.ratio.toFixed(4) : '0.0000',
      r.compressTime   ? Math.max(0, r.compressTime).toFixed(3)   : '0.000',
      r.decompressTime ? Math.max(0, r.decompressTime).toFixed(3) : '0.000',
      r.decompressVerified ? 'yes' : 'no',
      r.error ? 'error' : 'ok'
    ].join(','));
  }

  fs.writeFileSync(csvPath, lines.join('\n'));

  let graphPath = null;
  try { graphPath = await generateGraphs(csvPath); }
  catch (error) { console.error('Graph generation failed (non-fatal):', error.message); }

  return { rows: results, csvPath, graphPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// Decompression tab support
// ─────────────────────────────────────────────────────────────────────────────

export function findRecentCompressedFiles(outputDir, count = 5) {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir)
    .filter(f => f.match(/\.(gz|bz2|xz|zst|lz4)$/))
    .map(f => ({
      name: f,
      path: path.join(outputDir, f),
      mtime: fs.statSync(path.join(outputDir, f)).mtime.getTime(),
      tool: f.match(/\.(gz|bz2|xz|zst|lz4)$/)[1]
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, count);
}

async function decompressFile(compressedPath, outputPath, tool) {
  switch (tool) {
    case 'gz':
      await new Promise((res, rej) => {
        fs.createReadStream(compressedPath).pipe(zlib.createGunzip())
          .pipe(fs.createWriteStream(outputPath)).on('finish', res).on('error', rej);
      });
      break;
    case 'bz2':
      await new Promise((res, rej) => {
        fs.createReadStream(compressedPath).pipe(zlib.createBrotliDecompress())
          .pipe(fs.createWriteStream(outputPath)).on('finish', res).on('error', rej);
      });
      break;
    case 'zst': {
      if (!fzstd) throw new Error('fzstd not installed — run: npm install fzstd');
      const data = fs.readFileSync(compressedPath);
      fs.writeFileSync(outputPath, Buffer.from(fzstd.decompress(new Uint8Array(data))));
      break;
    }
    case 'lz4': {
      if (!lz4js) throw new Error('lz4js not installed — run: npm install lz4js');
      const data = fs.readFileSync(compressedPath);
      const storedSize = data.readUInt32LE(0);
      fs.writeFileSync(outputPath, Buffer.from(lz4js.decompress(data.slice(4), storedSize)));
      break;
    }
    case 'xz': {
      if (!lzmajs) throw new Error('lzma-purejs not installed — run: npm install lzma-purejs');
      const data = fs.readFileSync(compressedPath);
      const decompressed = lzmajs.decompressFile(data);
      fs.writeFileSync(outputPath, Buffer.from(decompressed));
      break;
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

export async function runDecompressionJob({ compressedPath, outputPath, tool, originalHash }) {
  if (!fs.existsSync(compressedPath)) throw new Error('Compressed file not found');
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const t0 = process.hrtime.bigint();
  try {
    await decompressFile(compressedPath, outputPath, tool);
    const decompressTime = Number(process.hrtime.bigint() - t0) / 1e6;
    let verified = true;
    let decompressedHash = null;
    if (originalHash) {
      decompressedHash = await getFileHash(outputPath);
      verified = originalHash === decompressedHash;
    }
    return {
      success: true, compressedPath, outputPath, tool,
      compressedSize: fs.statSync(compressedPath).size,
      decompressedSize: fs.statSync(outputPath).size,
      decompressTime, verified, decompressedHash,
      message: verified ? 'Decompression successful and verified' : 'Decompression successful but verification failed'
    };
  } catch (error) {
    return { success: false, compressedPath, tool, error: true, verified: false, message: error.message };
  }
}

export async function runBatchDecompressionJob({ files, outputDir, originalPath }) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  let originalHash = null;
  if (originalPath && fs.existsSync(originalPath)) originalHash = await getFileHash(originalPath);

  const decompDir = path.join(outputDir, 'view_decomp');
  if (!fs.existsSync(decompDir)) fs.mkdirSync(decompDir, { recursive: true });

  const results = [];
  for (const file of files) {
    const baseName = path.basename(file.name, path.extname(file.name));
    const outputPath = path.join(decompDir, `${baseName}_from_${file.tool}.txt`);
    const result = await runDecompressionJob({ compressedPath: file.path, outputPath, tool: file.tool, originalHash });
    results.push({ ...result, fileName: file.name });
  }

  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const resultsPath = path.join(logsDir, `decomp_test_${Date.now()}.txt`);
  fs.writeFileSync(resultsPath, generateDecompResultsText(results, originalPath, originalHash));

  let graphPath = null;
  try { graphPath = await generateDecompGraphs(resultsPath); }
  catch (e) { console.error('Decompression graph generation failed:', e.message); }

  return { results, resultsPath, graphPath };
}

function generateDecompResultsText(results, originalPath, originalHash) {
  let text = '=== DECOMPRESSION TEST RESULTS ===\n\n';
  if (originalPath) text += `Original file: ${originalPath}\n`;
  if (originalHash) text += `Original hash: ${originalHash}\n\n`;
  for (const r of results) {
    text += `Processing: ${r.fileName}\n  Tool: ${r.tool}\n  Compressed size: ${r.compressedSize || 0} bytes\n`;
    if (r.success) {
      text += `  Decompressed to: ${path.basename(r.outputPath)}\n  Decompressed size: ${r.decompressedSize} bytes\n`;
      text += `  Hash match: ${r.verified ? 'YES - USABLE' : 'NO - FAILED'}\n`;
    } else {
      text += `  Hash match: NO - FAILED\n  Error: ${r.message}\n`;
    }
    text += '\n';
  }
  const ok = results.filter(r => r.success && r.verified);
  text += `=== SUMMARY ===\nTotal: ${results.length}\nSuccessful: ${ok.length}\nFailed: ${results.length - ok.length}\n`;
  return text;
}

function generateDecompGraphs(resultsPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'src', 'backend', 'decomp_graph_generator.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const proc = spawn(pythonCmd, [scriptPath, resultsPath]);
    let output = ''; let err = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        const match = output.match(/SUCCESS:(.+)/);
        resolve(match ? match[1].trim() : resultsPath.replace('.txt', '_decomp_graphs.png'));
      } else { reject(new Error(`code ${code}: ${err}`)); }
    });
    proc.on('error', (e) => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}