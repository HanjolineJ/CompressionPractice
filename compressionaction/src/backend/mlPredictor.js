// mlPredictor.js
// ─────────────────────────────────────────────────────────────────────────────
// Calls predict_cli.R to get a compression recommendation for a file.
//
// Usage:
//   import { getRecommendation } from './mlPredictor.js';
//   const result = await getRecommendation('/path/to/file.json');
//   // { algorithm, confidence, confident, scores, fileStats }
// ─────────────────────────────────────────────────────────────────────────────

import fs   from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the R CLI script and model — both live in MLFirstTry/
const R_SCRIPT = path.join(__dirname, '..', 'MLFirstTry', 'predict_cli.R');

// ── Shannon entropy (same logic as ML_compression_model_v3.R) ────────────────
function computeEntropy(filePath, sampleBytes = 65536) {
  try {
    const fd   = fs.openSync(filePath, 'r');
    const buf  = Buffer.alloc(Math.min(sampleBytes, fs.statSync(filePath).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);

    const freq = new Array(256).fill(0);
    for (const byte of buf) freq[byte]++;
    const total = buf.length;
    let entropy = 0;
    for (const count of freq) {
      if (count > 0) {
        const p = count / total;
        entropy -= p * Math.log2(p);
      }
    }
    return Math.round(entropy * 1000) / 1000;
  } catch {
    return null;
  }
}

// ── Magic-number / file-header detection ─────────────────────────────────────
// Reads the first 8 bytes and maps them to a content-type category.
// This is the single strongest predictor of best compression algorithm:
//   already_compressed → lz4 (general-purpose compressors can't help)
//   image_raw          → lz4 (pixel data has moderate entropy)
//   text / structured  → bzip2 / xz / zstd
//   binary / unknown   → zstd (safe default)
//
// The returned category is sent to R as `magic_type` and also used to
// set a `is_precompressed` boolean flag that suppresses low-confidence
// recommendations for already-compressed files.
function detectMagicType(filePath) {
  try {
    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    const bytesRead = fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    if (bytesRead < 2) return { magic_type: 'unknown', is_precompressed: false };

    const b = buf;

    // ── Already-compressed formats ──────────────────────────────────────────
    // These have entropy near 8.0 — general compressors make them LARGER.
    if (b[0] === 0x50 && b[1] === 0x4B)                          return { magic_type: 'already_compressed', is_precompressed: true };  // ZIP / JAR / DOCX / XLSX
    if (b[0] === 0x1F && b[1] === 0x8B)                          return { magic_type: 'already_compressed', is_precompressed: true };  // GZIP
    if (b[0] === 0x42 && b[1] === 0x5A && b[2] === 0x68)         return { magic_type: 'already_compressed', is_precompressed: true };  // BZ2
    if (b[0] === 0xFD && b[1] === 0x37 && b[2] === 0x7A)         return { magic_type: 'already_compressed', is_precompressed: true };  // XZ
    if (b[0] === 0x28 && b[1] === 0xB5 && b[2] === 0x2F && b[3] === 0xFD) return { magic_type: 'already_compressed', is_precompressed: true };  // ZSTD
    if (b[0] === 0x04 && b[1] === 0x22 && b[2] === 0x4D && b[3] === 0x18) return { magic_type: 'already_compressed', is_precompressed: true };  // LZ4 frame
    if (b[0] === 0x37 && b[1] === 0x7A && b[2] === 0xBC && b[3] === 0xAF) return { magic_type: 'already_compressed', is_precompressed: true };  // 7-ZIP
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return { magic_type: 'already_compressed', is_precompressed: true };  // RAR

    // ── Lossy-compressed image formats (JPEG) ────────────────────────────────
    if (b[0] === 0xFF && b[1] === 0xD8)                           return { magic_type: 'already_compressed', is_precompressed: true };  // JPEG

    // ── Lossless / raw image formats (can compress a little) ────────────────
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { magic_type: 'image_raw', is_precompressed: false };  // PNG
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)         return { magic_type: 'image_raw', is_precompressed: false };  // GIF
    if (b[0] === 0x42 && b[1] === 0x4D)                          return { magic_type: 'image_raw', is_precompressed: false };  // BMP
    if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A)         return { magic_type: 'image_raw', is_precompressed: false };  // TIFF LE
    if (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00 && b[3] === 0x2A) return { magic_type: 'image_raw', is_precompressed: false };  // TIFF BE

    // ── Audio / video raw (moderate entropy) ────────────────────────────────
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return { magic_type: 'audio_video', is_precompressed: false };  // RIFF (WAV/AVI)
    if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return { magic_type: 'already_compressed', is_precompressed: true };  // OGG

    // ── Game-specific formats ────────────────────────────────────────────────
    if (b[0] === 0x49 && b[1] === 0x57 && b[2] === 0x41 && b[3] === 0x44) return { magic_type: 'game_wad', is_precompressed: false };  // IWAD (Doom)
    if (b[0] === 0x50 && b[1] === 0x57 && b[2] === 0x41 && b[3] === 0x44) return { magic_type: 'game_wad', is_precompressed: false };  // PWAD (Doom)

    // ── Executables & shared libraries ──────────────────────────────────────
    if (b[0] === 0x4D && b[1] === 0x5A)                          return { magic_type: 'executable', is_precompressed: false };  // PE (Windows .exe/.dll)
    if (b[0] === 0x7F && b[1] === 0x45 && b[2] === 0x4C && b[3] === 0x46) return { magic_type: 'executable', is_precompressed: false };  // ELF (Linux)

    // ── Structured text formats ──────────────────────────────────────────────
    // UTF-8 BOM, XML declaration, JSON opening brace/bracket
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF)         return { magic_type: 'text_structured', is_precompressed: false };  // UTF-8 BOM
    if (b[0] === 0x3C && b[1] === 0x3F && b[2] === 0x78 && b[3] === 0x6D) return { magic_type: 'text_structured', is_precompressed: false };  // <?xm (XML)
    if (b[0] === 0x3C && (b[1] === 0x21 || b[1] === 0x68 || b[1] === 0x48)) return { magic_type: 'text_structured', is_precompressed: false };  // HTML
    if (b[0] === 0x7B || b[0] === 0x5B)                          return { magic_type: 'text_structured', is_precompressed: false };  // JSON { or [

    // ── Plain text (low entropy — best compression wins) ────────────────────
    // Heuristic: if all 8 bytes are printable ASCII, treat as text
    const allPrintable = Array.from(buf.slice(0, bytesRead)).every(c => c >= 0x09 && c <= 0x7E);
    if (allPrintable)                                             return { magic_type: 'text_plain', is_precompressed: false };

    // ── Fallback ─────────────────────────────────────────────────────────────
    return { magic_type: 'binary_unknown', is_precompressed: false };

  } catch {
    return { magic_type: 'unknown', is_precompressed: false };
  }
}

// ── Detect the R executable ───────────────────────────────────────────────────
function findRscript() {
  // Ordered list of candidate locations
  const candidates = process.platform === 'win32'
    ? [
        'Rscript',                                                    // on PATH
        'C:\\Program Files\\R\\R-4.4.0\\bin\\Rscript.exe',           // R 4.4
        'C:\\Program Files\\R\\R-4.3.0\\bin\\Rscript.exe',           // R 4.3
        'C:\\Program Files\\R\\R-4.2.0\\bin\\Rscript.exe',           // R 4.2
      ]
    : ['Rscript', '/usr/local/bin/Rscript', '/usr/bin/Rscript'];
  return candidates[0]; // spawn will find it on PATH; fallback paths are hints
}

// ── Core prediction call ──────────────────────────────────────────────────────
function callRPredictor(fileStats) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(R_SCRIPT)) {
      return reject(new Error(`predict_cli.R not found at ${R_SCRIPT}`));
    }

    const jsonArg = JSON.stringify(fileStats);
    const rscript = findRscript();
    const proc    = spawn(rscript, ['--vanilla', '--quiet', R_SCRIPT, jsonArg], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      // Find the JSON line in stdout (ignore any stray R messages before it)
      const jsonLine = stdout.split('\n').find(l => l.trim().startsWith('{'));
      if (!jsonLine) {
        const hint = stderr.includes('cannot open') ? 'Is rf_model_v3.rds present in MLFirstTry/?' :
                     stderr.includes('package')     ? 'Run: install.packages(c("jsonlite","randomForest","dplyr"))' :
                     stderr || `exit code ${code}`;
        return reject(new Error(`R predictor returned no JSON. ${hint}`));
      }
      try {
        resolve(JSON.parse(jsonLine.trim()));
      } catch (e) {
        reject(new Error(`Failed to parse R output: ${jsonLine}`));
      }
    });

    proc.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error('Rscript not found. Install R from https://r-project.org and ensure it is on your PATH.'));
      } else {
        reject(err);
      }
    });

    // 30-second timeout — R model load + prediction should be well under 5s
    setTimeout(() => {
      proc.kill();
      reject(new Error('R predictor timed out after 30 s'));
    }, 30_000);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a compression recommendation for a file.
 *
 * @param {string} filePath  Absolute path to the file to analyse.
 * @returns {Promise<{
 *   algorithm:  string,   // e.g. "zstd"
 *   confidence: number,   // 0–1
 *   confident:  boolean,
 *   scores:     object,   // { bzip2, gzip, lz4, xz, zstd }
 *   fileStats:  object,   // the features sent to R
 *   error?:     string    // present only on failure
 * }>}
 */
export async function getRecommendation(filePath) {
  if (!fs.existsSync(filePath)) {
    return { error: `File not found: ${filePath}` };
  }

  const stat      = fs.statSync(filePath);
  const src_bytes = stat.size;
  const file_ext  = path.extname(filePath).replace('.', '').toLowerCase() || 'unknown';
  const entropy   = computeEntropy(filePath);
  const { magic_type, is_precompressed } = detectMagicType(filePath);

  const fileStats = {
    src_bytes,
    file_ext,
    magic_type,
    is_precompressed,
    shannon_entropy: entropy,
    // These defaults match the model's training distribution.
    // They'll be overridden by real benchmark data once that is available.
    mean_savings:   0.60,
    min_savings:    0.55,
    max_savings:    0.65,
    spread_savings: 0.10,
    mean_decomp_ms: 10.0,
    mean_comp_ms:   5.0,
  };

  // Short-circuit for already-compressed files: no compressor can help.
  // Return a fast recommendation without calling R.
  if (is_precompressed) {
    return {
      algorithm:  'lz4',
      confidence: 0.95,
      confident:  true,
      scores:     { lz4: 0.95, zstd: 0.03, gzip: 0.01, bzip2: 0.005, xz: 0.005 },
      fileStats,
      note: `File appears already compressed (magic type: ${magic_type}). lz4 recommended to minimise overhead.`,
    };
  }

  try {
    const prediction = await callRPredictor(fileStats);
    if (prediction.error) {
      return { error: prediction.error, fileStats };
    }
    return { ...prediction, fileStats };
  } catch (err) {
    return { error: err.message, fileStats };
  }
}

/**
 * Same as getRecommendation but also passes in real benchmark results
 * from a previous compression run to give the model better features.
 *
 * @param {string} filePath
 * @param {Array}  benchmarkRows  The `rows` array returned by runCompressionJob.
 */
export async function getRecommendationFromBenchmark(filePath, benchmarkRows) {
  if (!fs.existsSync(filePath)) {
    return { error: `File not found: ${filePath}` };
  }

  const stat      = fs.statSync(filePath);
  const src_bytes = stat.size;
  const file_ext  = path.extname(filePath).replace('.', '').toLowerCase() || 'unknown';
  const entropy   = computeEntropy(filePath);
  const { magic_type, is_precompressed } = detectMagicType(filePath);

  // Extract per-algorithm savings from benchmark rows
  const verified  = benchmarkRows.filter(r => r.decompressVerified && !r.error && !r.skipped);
  const savings   = {};
  for (const r of verified) savings[r.tool] = r.ratio ?? 0;

  const ratios    = verified.map(r => r.ratio ?? 0);
  const decomp_ms = verified.map(r => r.decompressTime ?? 0);
  const comp_ms   = verified.map(r => r.compressTime ?? 0);

  const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const min  = arr => arr.length ? Math.min(...arr) : 0;
  const max  = arr => arr.length ? Math.max(...arr) : 0;

  const fileStats = {
    src_bytes,
    file_ext,
    magic_type,
    is_precompressed,
    shannon_entropy:  entropy,
    mean_savings:     Math.round(mean(ratios)    * 1000) / 1000,
    min_savings:      Math.round(min(ratios)     * 1000) / 1000,
    max_savings:      Math.round(max(ratios)     * 1000) / 1000,
    spread_savings:   Math.round((max(ratios) - min(ratios)) * 1000) / 1000,
    mean_decomp_ms:   Math.round(mean(decomp_ms) * 100)  / 100,
    mean_comp_ms:     Math.round(mean(comp_ms)   * 100)  / 100,
    bzip2_savings:    savings['bzip2'] ?? mean(ratios),
    gzip_savings:     savings['gzip']  ?? mean(ratios),
    lz4_savings:      savings['lz4']   ?? mean(ratios),
    xz_savings:       savings['xz']    ?? mean(ratios),
    zstd_savings:     savings['zstd']  ?? mean(ratios),
  };

  // Short-circuit for already-compressed files (same as getRecommendation).
  if (is_precompressed) {
    return {
      algorithm:  'lz4',
      confidence: 0.95,
      confident:  true,
      scores:     { lz4: 0.95, zstd: 0.03, gzip: 0.01, bzip2: 0.005, xz: 0.005 },
      fileStats,
      note: `File appears already compressed (magic type: ${magic_type}). lz4 recommended to minimise overhead.`,
    };
  }

  try {
    const prediction = await callRPredictor(fileStats);
    if (prediction.error) {
      return { error: prediction.error, fileStats };
    }
    return { ...prediction, fileStats };
  } catch (err) {
    return { error: err.message, fileStats };
  }
}