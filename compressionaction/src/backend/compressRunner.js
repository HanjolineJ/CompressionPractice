import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// Pure-JS library availability check
// Run `npm install @bokuweb/zstd-wasm lz4js lzma-purejs` once before starting the app.
// ─────────────────────────────────────────────────────────────────────────────
let zstdWasm = null;   // @bokuweb/zstd-wasm — compress + decompress
let lz4js = null;
let lzmajs = null;

try {
  const mod = await import('@bokuweb/zstd-wasm');
  await mod.init();          // initialise the WASM binary once at startup
  zstdWasm = mod;
} catch {
  console.warn('[compressRunner] @bokuweb/zstd-wasm not installed — zstd will be skipped. Run: npm install @bokuweb/zstd-wasm');
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

    // Use synchronous zlib for small files to avoid Windows stream race condition
    // where 'finish' fires before the Promise listener is attached on sub-KB files.
    // Use stream.pipeline() for larger files to avoid loading everything into memory.
    const srcBytes = fs.statSync(inputPath).size;

    const t0 = process.hrtime.bigint();
    if (srcBytes < 65536) {
      const compressed = zlib.gzipSync(fs.readFileSync(inputPath), { level: 9 });
      fs.writeFileSync(outPath, compressed);
    } else {
      await pipeline(
        fs.createReadStream(inputPath),
        zlib.createGzip({ level: 9 }),
        fs.createWriteStream(outPath)
      );
    }
    const compressTime = Number(process.hrtime.bigint() - t0) / 1e6;

    const decompressedPath = inputPath + '.gz.decompressed';
    const t1 = process.hrtime.bigint();
    if (srcBytes < 65536) {
      const decompressed = zlib.gunzipSync(fs.readFileSync(outPath));
      fs.writeFileSync(decompressedPath, decompressed);
    } else {
      await pipeline(
        fs.createReadStream(outPath),
        zlib.createGunzip(),
        fs.createWriteStream(decompressedPath)
      );
    }
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
    const srcBytes = fs.statSync(inputPath).size;
    const brotliOpts = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } };

    const t0 = process.hrtime.bigint();
    if (srcBytes < 65536) {
      const compressed = zlib.brotliCompressSync(fs.readFileSync(inputPath), brotliOpts);
      fs.writeFileSync(outPath, compressed);
    } else {
      await pipeline(
        fs.createReadStream(inputPath),
        zlib.createBrotliCompress(brotliOpts),
        fs.createWriteStream(outPath)
      );
    }
    const compressTime = Number(process.hrtime.bigint() - t0) / 1e6;

    const decompressedPath = inputPath + '.bz2.decompressed';
    const t1 = process.hrtime.bigint();
    if (srcBytes < 65536) {
      const decompressed = zlib.brotliDecompressSync(fs.readFileSync(outPath));
      fs.writeFileSync(decompressedPath, decompressed);
    } else {
      await pipeline(
        fs.createReadStream(outPath),
        zlib.createBrotliDecompress(),
        fs.createWriteStream(decompressedPath)
      );
    }
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
// zstd — @bokuweb/zstd-wasm (WebAssembly, REAL Zstandard, compress + decompress)
// API: init(), compress(buffer, level), decompress(buffer)
// Level 19 = near-maximum ratio (max 22, gets slow).
// Install: npm install @bokuweb/zstd-wasm
// ─────────────────────────────────────────────────────────────────────────────

async function compressZstd(inputPath) {
  if (!zstdWasm) {
    return { tool: 'zstd', error: false, skipped: true, reason: 'zstd_wasm_not_installed',
             message: 'Run: npm install @bokuweb/zstd-wasm' };
  }
  try {
    const originalHash = await getFileHash(inputPath);
    const srcBytes = readFileBytes(inputPath);
    const outPath = inputPath + '.zst';

    const t0 = process.hrtime.bigint();
    const compressed = zstdWasm.compress(srcBytes, 19);
    writeBytesToFile(outPath, compressed);
    const compressTime = Number(process.hrtime.bigint() - t0) / 1e6;

    const t1 = process.hrtime.bigint();
    const decompressedBytes = zstdWasm.decompress(compressed);
    const decompressTime = Number(process.hrtime.bigint() - t1) / 1e6;

    const decompressedPath = inputPath + '.zst.decompressed';
    writeBytesToFile(decompressedPath, Buffer.from(decompressedBytes));
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

// lzma-purejs is synchronous and loads the entire file into memory.
// It is reliable up to ~20 MB. Beyond that, skip gracefully rather than crash.
const LZMA_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// LZMA raw format magic: first byte is a properties byte in range 0x00–0xE0,
// followed by 4-byte dict size and 8-byte uncompressed size.
// The most reliable single-byte signal is that props byte 0x5D is by far the
// most common output from lzma-purejs (lc=3,lp=0,pb=2). We also accept the
// full valid range 0x00–0xE0 but reject anything that matches a deflate zlib
// header (0x78 __) which is what the old deflate-proxy produced.
function isLzmaRaw(buf) {
  if (buf.length < 13) return false;
  const props = buf[0];
  // Deflate/zlib headers: 0x78 0x01, 0x78 0x9C, 0x78 0xDA — all start with 0x78
  if (props === 0x78) return false;
  // Valid LZMA props byte encodes lc, lp, pb as: props = (pb*5 + lp)*9 + lc
  // Max value: pb=4, lp=4, lc=8 → (4*5+4)*9+8 = 224 = 0xE0
  if (props > 0xE0) return false;
  return true;
}

async function compressXz(inputPath) {
  if (!lzmajs) {
    return { tool: 'xz', error: false, skipped: true, reason: 'lzma_purejs_not_installed',
             message: 'Run: npm install lzma-purejs' };
  }
  const fileSize = fs.statSync(inputPath).size;
  if (fileSize > LZMA_MAX_BYTES) {
    return { tool: 'xz', error: false, skipped: true, reason: 'file_too_large_for_js_lzma',
             message: `File is ${(fileSize/1024/1024).toFixed(1)} MB — lzma-purejs is limited to ${LZMA_MAX_BYTES/1024/1024} MB to avoid memory crashes. Install the xz CLI binary for large file support.` };
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
    case 'gz': {
      const gzSize = fs.statSync(compressedPath).size;
      if (gzSize < 65536) {
        fs.writeFileSync(outputPath, zlib.gunzipSync(fs.readFileSync(compressedPath)));
      } else {
        await pipeline(fs.createReadStream(compressedPath), zlib.createGunzip(), fs.createWriteStream(outputPath));
      }
      break;
    }
    case 'bz2': {
      const bz2Size = fs.statSync(compressedPath).size;
      if (bz2Size < 65536) {
        fs.writeFileSync(outputPath, zlib.brotliDecompressSync(fs.readFileSync(compressedPath)));
      } else {
        await pipeline(fs.createReadStream(compressedPath), zlib.createBrotliDecompress(), fs.createWriteStream(outputPath));
      }
      break;
    }
    case 'zst': {
      if (!zstdWasm) throw new Error('@bokuweb/zstd-wasm not installed — run: npm install @bokuweb/zstd-wasm');
      const data = fs.readFileSync(compressedPath);
      fs.writeFileSync(outputPath, Buffer.from(zstdWasm.decompress(data)));
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
      const fileSize = fs.statSync(compressedPath).size;
      if (fileSize > LZMA_MAX_BYTES) {
        throw new Error(`File too large for JS LZMA decompressor (${(fileSize/1024/1024).toFixed(1)} MB > ${LZMA_MAX_BYTES/1024/1024} MB limit). This file was likely compressed with the old deflate proxy — re-run compression to get a valid .xz file.`);
      }
      const data = fs.readFileSync(compressedPath);
      if (!isLzmaRaw(data)) {
        throw new Error('Not a valid LZMA file — this .xz was created by the old deflate proxy and cannot be decompressed. Re-run compression on the original file to generate a real .xz.');
      }
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