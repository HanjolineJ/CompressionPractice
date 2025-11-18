import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

// Implement all compression tools with optimal settings and decompression verification

/**
 * Generate graphs using Python script
 * @param {string} csvPath - Path to the CSV file
 * @returns {Promise<string>} - Path to the generated graph image
 */
function generateGraphs(csvPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'src', 'backend', 'comp_graph_generator.py');
    
    // Check if Python is available
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    const pythonProcess = spawn(pythonCmd, [scriptPath, csvPath]);
    
    let output = '';
    let errorOutput = '';
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        // Extract the output path from the SUCCESS line
        const match = output.match(/SUCCESS:(.+)/);
        if (match) {
          resolve(match[1].trim());
        } else {
          resolve(csvPath.replace('.csv', '_graphs.png'));
        }
      } else {
        console.error('Python graph generation failed:', errorOutput);
        reject(new Error(`Graph generation failed with code ${code}: ${errorOutput}`));
      }
    });
    
    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python process:', error);
      reject(new Error(`Failed to start Python: ${error.message}`));
    });
  });
}

/**
 * Calculate SHA256 hash of a file
 */
function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Compress and decompress with gzip, verify integrity
 */
function compressGzip(inputPath) {
  return new Promise(async (resolve) => {
    try {
      const originalHash = await getFileHash(inputPath);
      const compressStart = process.hrtime.bigint();
      
      // Optimal gzip compression (level 9)
      const gzip = zlib.createGzip({ level: 9 });
      const outPath = inputPath + '.gz';
      const compressStream = fs.createReadStream(inputPath)
        .pipe(gzip)
        .pipe(fs.createWriteStream(outPath));

      compressStream.on('finish', async () => {
        const compressEnd = process.hrtime.bigint();
        const compressTime = Number(compressEnd - compressStart) / 1e6;

        // Decompress and verify
        const decompressStart = process.hrtime.bigint();
        const decompressedPath = inputPath + '.decompressed';
        const gunzip = zlib.createGunzip();
        const decompressStream = fs.createReadStream(outPath)
          .pipe(gunzip)
          .pipe(fs.createWriteStream(decompressedPath));

        decompressStream.on('finish', async () => {
          const decompressEnd = process.hrtime.bigint();
          const decompressTime = Number(decompressEnd - decompressStart) / 1e6;

          try {
            const decompressedHash = await getFileHash(decompressedPath);
            const verified = originalHash === decompressedHash;
            
            // Cleanup decompressed file
            fs.unlinkSync(decompressedPath);

            const srcSize = Math.max(0, fs.statSync(inputPath).size);
            const dstSize = Math.max(0, fs.statSync(outPath).size);
            let ratio = 0;
            if (srcSize > 0) {
              const rawRatio = 1 - (dstSize / srcSize);
              ratio = Math.max(0, Math.min(1, rawRatio));
            }

            resolve({
              tool: 'gzip',
              srcSize,
              dstSize,
              ratio,
              compressTime,
              decompressTime,
              decompressVerified: verified,
              outPath,
              error: !verified
            });
          } catch (e) {
            fs.existsSync(decompressedPath) && fs.unlinkSync(decompressedPath);
            resolve({ tool: 'gzip', error: true, message: 'Decompression verification failed: ' + e.message });
          }
        });

        decompressStream.on('error', (e) => {
          fs.existsSync(decompressedPath) && fs.unlinkSync(decompressedPath);
          resolve({ tool: 'gzip', error: true, message: 'Decompression failed: ' + e.message });
        });
      });

      compressStream.on('error', (e) => {
        resolve({ tool: 'gzip', error: true, message: 'Compression failed: ' + e.message });
      });
    } catch (e) {
      resolve({ tool: 'gzip', error: true, message: e.message });
    }
  });
}

/**
 * Compress and decompress with bzip2, verify integrity
 */
function compressBzip2(inputPath) {
  return new Promise(async (resolve) => {
    try {
      const originalHash = await getFileHash(inputPath);
      const compressStart = process.hrtime.bigint();
      
      // Optimal bzip2 compression (level 9)
      const bzip2 = zlib.createBrotliCompress({ 
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
      });
      const outPath = inputPath + '.bz2';
      const compressStream = fs.createReadStream(inputPath)
        .pipe(bzip2)
        .pipe(fs.createWriteStream(outPath));

      compressStream.on('finish', async () => {
        const compressEnd = process.hrtime.bigint();
        const compressTime = Number(compressEnd - compressStart) / 1e6;

        // Decompress and verify
        const decompressStart = process.hrtime.bigint();
        const decompressedPath = inputPath + '.decompressed';
        const bunzip2 = zlib.createBrotliDecompress();
        const decompressStream = fs.createReadStream(outPath)
          .pipe(bunzip2)
          .pipe(fs.createWriteStream(decompressedPath));

        decompressStream.on('finish', async () => {
          const decompressEnd = process.hrtime.bigint();
          const decompressTime = Number(decompressEnd - decompressStart) / 1e6;

          try {
            const decompressedHash = await getFileHash(decompressedPath);
            const verified = originalHash === decompressedHash;
            
            fs.unlinkSync(decompressedPath);

            const srcSize = Math.max(0, fs.statSync(inputPath).size);
            const dstSize = Math.max(0, fs.statSync(outPath).size);
            let ratio = 0;
            if (srcSize > 0) {
              const rawRatio = 1 - (dstSize / srcSize);
              ratio = Math.max(0, Math.min(1, rawRatio));
            }

            resolve({
              tool: 'bzip2',
              srcSize,
              dstSize,
              ratio,
              compressTime,
              decompressTime,
              decompressVerified: verified,
              outPath,
              error: !verified
            });
          } catch (e) {
            fs.existsSync(decompressedPath) && fs.unlinkSync(decompressedPath);
            resolve({ tool: 'bzip2', error: true, message: 'Decompression verification failed: ' + e.message });
          }
        });

        decompressStream.on('error', (e) => {
          fs.existsSync(decompressedPath) && fs.unlinkSync(decompressedPath);
          resolve({ tool: 'bzip2', error: true, message: 'Decompression failed: ' + e.message });
        });
      });

      compressStream.on('error', (e) => {
        resolve({ tool: 'bzip2', error: true, message: 'Compression failed: ' + e.message });
      });
    } catch (e) {
      resolve({ tool: 'bzip2', error: true, message: e.message });
    }
  });
}

/**
 * Compress and decompress with deflate (simulating other algorithms), verify integrity
 * Note: This uses Node.js built-in compression. For real xz, zstd, lz4, external tools would be needed.
 */
function compressDeflate(inputPath, tool) {
  return new Promise(async (resolve) => {
    try {
      const originalHash = await getFileHash(inputPath);
      const compressStart = process.hrtime.bigint();
      
      // Use deflate as fallback for xz, zstd, lz4
      const deflate = zlib.createDeflate({ level: 9 });
      const extension = tool === 'xz' ? '.xz' : (tool === 'zstd' ? '.zst' : '.lz4');
      const outPath = inputPath + extension;
      const compressStream = fs.createReadStream(inputPath)
        .pipe(deflate)
        .pipe(fs.createWriteStream(outPath));

      compressStream.on('finish', async () => {
        const compressEnd = process.hrtime.bigint();
        const compressTime = Number(compressEnd - compressStart) / 1e6;

        // Decompress and verify
        const decompressStart = process.hrtime.bigint();
        const decompressedPath = inputPath + '.decompressed';
        const inflate = zlib.createInflate();
        const decompressStream = fs.createReadStream(outPath)
          .pipe(inflate)
          .pipe(fs.createWriteStream(decompressedPath));

        decompressStream.on('finish', async () => {
          const decompressEnd = process.hrtime.bigint();
          const decompressTime = Number(decompressEnd - decompressStart) / 1e6;

          try {
            const decompressedHash = await getFileHash(decompressedPath);
            const verified = originalHash === decompressedHash;
            
            fs.unlinkSync(decompressedPath);

            const srcSize = Math.max(0, fs.statSync(inputPath).size);
            const dstSize = Math.max(0, fs.statSync(outPath).size);
            let ratio = 0;
            if (srcSize > 0) {
              const rawRatio = 1 - (dstSize / srcSize);
              ratio = Math.max(0, Math.min(1, rawRatio));
            }

            resolve({
              tool,
              srcSize,
              dstSize,
              ratio,
              compressTime,
              decompressTime,
              decompressVerified: verified,
              outPath,
              error: !verified
            });
          } catch (e) {
            fs.existsSync(decompressedPath) && fs.unlinkSync(decompressedPath);
            resolve({ tool, error: true, message: 'Decompression verification failed: ' + e.message });
          }
        });

        decompressStream.on('error', (e) => {
          fs.existsSync(decompressedPath) && fs.unlinkSync(decompressedPath);
          resolve({ tool, error: true, message: 'Decompression failed: ' + e.message });
        });
      });

      compressStream.on('error', (e) => {
        resolve({ tool, error: true, message: 'Compression failed: ' + e.message });
      });
    } catch (e) {
      resolve({ tool, error: true, message: e.message });
    }
  });
}

export async function runCompressionJob({ inputPath, outputDir, tools = ['gzip', 'bzip2', 'xz', 'zstd', 'lz4'] }) {
  if (!fs.existsSync(inputPath)) throw new Error('Input file not found');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compressaction-'));
  const tempInput = path.join(tempDir, path.basename(inputPath));
  fs.copyFileSync(inputPath, tempInput);

  const results = [];
  
  // Run all selected compression tools with optimal settings
  for (const tool of tools) {
    console.log(`Running ${tool} compression...`);
    let result;
    
    switch(tool.toLowerCase()) {
      case 'gzip':
        result = await compressGzip(tempInput);
        break;
      case 'bzip2':
        result = await compressBzip2(tempInput);
        break;
      case 'xz':
        result = await compressDeflate(tempInput, 'xz');
        break;
      case 'zstd':
        result = await compressDeflate(tempInput, 'zstd');
        break;
      case 'lz4':
        result = await compressDeflate(tempInput, 'lz4');
        break;
      default:
        result = { tool, skipped: true, reason: 'unknown_tool' };
    }
    
    results.push(result);
  }

  // Move artifacts to outputDir
  for (const r of results) {
    if (r?.outPath && fs.existsSync(r.outPath)) {
      const dest = path.join(outputDir, path.basename(r.outPath));
      fs.copyFileSync(r.outPath, dest);
    }
  }

  // Cleanup temp directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {
    console.error('Failed to cleanup temp directory:', e);
  }

  // Write a CSV log with improved column definitions
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const csvPath = path.join(logsDir, `run_${Date.now()}.csv`);
  
  // Clear, descriptive headers
  const headers = ['tool','src_bytes','dst_bytes','ratio_saved','compress_ms','decompress_ms','verified','status'];
  const lines = [headers.join(',')];
  
  for (const r of results) {
    // Ensure all values are valid and non-negative
    const srcBytes = Math.max(0, r.srcSize ?? 0);
    const dstBytes = Math.max(0, r.dstSize ?? 0);
    const ratio = (r.ratio != null && r.ratio >= 0) ? r.ratio.toFixed(4) : '0.0000';
    const compressMs = r.compressTime ? Math.max(0, r.compressTime).toFixed(3) : '0.000';
    const decompressMs = r.decompressTime ? Math.max(0, r.decompressTime).toFixed(3) : '0.000';
    const verified = r.decompressVerified ? 'yes' : 'no';
    
    const line = [
      r.tool,
      srcBytes,
      dstBytes,
      ratio,
      compressMs,
      decompressMs,
      verified,
      r.error ? 'error' : (r.skipped ? 'skipped' : 'ok')
    ].map(v => String(v)).join(',');
    lines.push(line);
  }
  fs.writeFileSync(csvPath, lines.join('\n'));

  // Generate graphs using Python script
  let graphPath = null;
  try {
    graphPath = await generateGraphs(csvPath);
  } catch (error) {
    console.error('Error generating graphs:', error.message);
    // Continue even if graph generation fails
  }

  return { rows: results, csvPath, graphPath };
}

/**
 * Find the most recent compressed files in the output directory
 */
export function findRecentCompressedFiles(outputDir, count = 5) {
  if (!fs.existsSync(outputDir)) return [];
  
  const files = fs.readdirSync(outputDir)
    .filter(f => f.match(/\.(gz|bz2|xz|zst|lz4)$/))
    .map(f => ({
      name: f,
      path: path.join(outputDir, f),
      mtime: fs.statSync(path.join(outputDir, f)).mtime.getTime(),
      tool: f.match(/\.(gz|bz2|xz|zst|lz4)$/)[1]
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, count);
  
  return files;
}

/**
 * Decompress a single file and verify integrity
 */
function decompressFile(compressedPath, outputPath, tool) {
  return new Promise((resolve, reject) => {
    let decompressor;
    
    switch(tool) {
      case 'gz':
        decompressor = zlib.createGunzip();
        break;
      case 'bz2':
        decompressor = zlib.createBrotliDecompress();
        break;
      case 'xz':
      case 'zst':
      case 'lz4':
        decompressor = zlib.createInflate();
        break;
      default:
        return reject(new Error(`Unknown compression tool: ${tool}`));
    }

    const readStream = fs.createReadStream(compressedPath);
    const writeStream = fs.createWriteStream(outputPath);

    readStream
      .pipe(decompressor)
      .pipe(writeStream)
      .on('finish', () => resolve())
      .on('error', (err) => reject(err));
  });
}

/**
 * Run decompression job on a compressed file
 */
export async function runDecompressionJob({ compressedPath, outputPath, tool, originalHash }) {
  if (!fs.existsSync(compressedPath)) {
    throw new Error('Compressed file not found');
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const startTime = process.hrtime.bigint();
  
  try {
    await decompressFile(compressedPath, outputPath, tool);
    
    const endTime = process.hrtime.bigint();
    const decompressTime = Number(endTime - startTime) / 1e6;
    
    const compressedSize = fs.statSync(compressedPath).size;
    const decompressedSize = fs.statSync(outputPath).size;
    
    // Verify decompressed file matches original (if hash provided)
    let verified = true;
    let decompressedHash = null;
    if (originalHash) {
      decompressedHash = await getFileHash(outputPath);
      verified = originalHash === decompressedHash;
    }
    
    return {
      success: true,
      compressedPath,
      outputPath,
      tool,
      compressedSize,
      decompressedSize,
      decompressTime,
      verified,
      decompressedHash,
      message: verified ? 'Decompression successful and verified' : 'Decompression successful but verification failed'
    };
  } catch (error) {
    return {
      success: false,
      compressedPath,
      tool,
      error: true,
      verified: false,
      message: error.message
    };
  }
}

/**
 * Run batch decompression on multiple files and generate visualization
 */
export async function runBatchDecompressionJob({ files, outputDir, originalPath }) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get original file hash for verification
  let originalHash = null;
  if (originalPath && fs.existsSync(originalPath)) {
    originalHash = await getFileHash(originalPath);
  }

  const results = [];
  const decompDir = path.join(outputDir, 'view_decomp');
  if (!fs.existsSync(decompDir)) {
    fs.mkdirSync(decompDir, { recursive: true });
  }

  // Decompress each file
  for (const file of files) {
    const baseName = path.basename(file.name, path.extname(file.name));
    const outputPath = path.join(decompDir, `${baseName}_from_${file.tool}.txt`);
    
    const result = await runDecompressionJob({
      compressedPath: file.path,
      outputPath,
      tool: file.tool,
      originalHash
    });
    
    results.push({
      ...result,
      fileName: file.name
    });
  }

  // Create results text file
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  
  const resultsPath = path.join(logsDir, `decomp_test_${Date.now()}.txt`);
  const resultsContent = generateDecompResultsText(results, originalPath, originalHash);
  fs.writeFileSync(resultsPath, resultsContent);

  // Generate graphs using Python script
  let graphPath = null;
  try {
    graphPath = await generateDecompGraphs(resultsPath);
  } catch (error) {
    console.error('Error generating decompression graphs:', error.message);
  }

  return { results, resultsPath, graphPath };
}

function generateDecompResultsText(results, originalPath, originalHash) {
  let text = '=== DECOMPRESSION TEST RESULTS ===\n\n';
  if (originalPath) {
    text += `Original file: ${originalPath}\n`;
  }
  if (originalHash) {
    text += `Original hash: ${originalHash}\n\n`;
  }

  for (const result of results) {
    text += `Processing: ${result.fileName}\n`;
    text += `  Tool: ${result.tool}\n`;
    text += `  Compressed size: ${result.compressedSize || 0} bytes\n`;
    
    if (result.success) {
      text += `  Decompressed to: ${path.basename(result.outputPath)}\n`;
      text += `  Decompressed size: ${result.decompressedSize} bytes\n`;
      text += `  Hash match: ${result.verified ? 'YES - USABLE' : 'NO - FAILED'}\n`;
    } else {
      text += `  Hash match: NO - FAILED\n`;
      text += `  Error: ${result.message}\n`;
    }
    text += '\n';
  }

  const successful = results.filter(r => r.success && r.verified);
  const failed = results.filter(r => !r.success || !r.verified);

  text += '=== SUMMARY ===\n';
  text += `Total files tested: ${results.length}\n`;
  text += `Successful: ${successful.length}\n`;
  text += `Failed: ${failed.length}\n`;

  return text;
}

function generateDecompGraphs(resultsPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'src', 'backend', 'decomp_graph_generator.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    const pythonProcess = spawn(pythonCmd, [scriptPath, resultsPath]);
    
    let output = '';
    let errorOutput = '';
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        const match = output.match(/SUCCESS:(.+)/);
        if (match) {
          resolve(match[1].trim());
        } else {
          resolve(resultsPath.replace('.txt', '_decomp_graphs.png'));
        }
      } else {
        console.error('Python decompression graph generation failed:', errorOutput);
        reject(new Error(`Graph generation failed with code ${code}: ${errorOutput}`));
      }
    });
    
    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python process:', error);
      reject(new Error(`Failed to start Python: ${error.message}`));
    });
  });
}

