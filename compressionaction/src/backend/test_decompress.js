import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

/**
 * Decompress files and verify they match the original
 * Outputs decompressed files to view_decomp folder for inspection
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

function decompressFile(compressedPath, outputPath, tool) {
  return new Promise((resolve, reject) => {
    let decompressor;
    
    switch(tool) {
      case 'gzip':
      case 'gz':
        decompressor = zlib.createGunzip();
        break;
      case 'bzip2':
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

async function testDecompression() {
  const baseDir = process.cwd();
  const parentDir = path.dirname(baseDir);
  const outTestDir = path.join(parentDir, 'out_test');
  const viewDecompDir = path.join(baseDir, 'view_decomp');
  const originalFile = path.join(baseDir, 'test_file.txt');

  // Create output directory
  if (!fs.existsSync(viewDecompDir)) {
    fs.mkdirSync(viewDecompDir, { recursive: true });
  }

  console.log('\n=== DECOMPRESSION TEST ===\n');
  console.log(`Original file: ${originalFile}`);
  console.log(`Output directory: ${viewDecompDir}\n`);

  // Get original file hash
  let originalHash;
  try {
    originalHash = await getFileHash(originalFile);
    console.log(`Original file hash: ${originalHash}\n`);
  } catch (err) {
    console.error('Error reading original file:', err.message);
    return;
  }

  // Find all compressed files
  if (!fs.existsSync(outTestDir)) {
    console.error(`Directory not found: ${outTestDir}`);
    console.error('Please run compression first.');
    return;
  }

  const files = fs.readdirSync(outTestDir);
  const compressedFiles = files.filter(f => 
    f.endsWith('.gz') || f.endsWith('.bz2') || f.endsWith('.xz') || 
    f.endsWith('.zst') || f.endsWith('.lz4')
  );

  if (compressedFiles.length === 0) {
    console.error('No compressed files found in out_test directory.');
    return;
  }

  console.log(`Found ${compressedFiles.length} compressed files:\n`);

  const results = [];

  for (const file of compressedFiles) {
    const compressedPath = path.join(outTestDir, file);
    const extension = path.extname(file).slice(1);
    const baseName = path.basename(file, path.extname(file));
    const decompressedPath = path.join(viewDecompDir, `${baseName}_from_${extension}.txt`);

    console.log(`Processing: ${file}`);
    console.log(`  Tool: ${extension}`);
    console.log(`  Compressed size: ${fs.statSync(compressedPath).size} bytes`);

    try {
      // Decompress
      await decompressFile(compressedPath, decompressedPath, extension);
      
      // Verify
      const decompressedHash = await getFileHash(decompressedPath);
      const matches = originalHash === decompressedHash;
      const decompressedSize = fs.statSync(decompressedPath).size;

      console.log(`  Decompressed to: ${path.basename(decompressedPath)}`);
      console.log(`  Decompressed size: ${decompressedSize} bytes`);
      console.log(`  Hash match: ${matches ? 'YES - USABLE' : 'NO - CORRUPTED'}`);
      
      results.push({
        tool: extension,
        file: file,
        success: matches,
        outputFile: path.basename(decompressedPath)
      });

      // Read and display first 100 characters
      const content = fs.readFileSync(decompressedPath, 'utf8');
      console.log(`  Content preview: ${content.substring(0, 100)}...`);
      console.log('');

    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      console.log('');
      results.push({
        tool: extension,
        file: file,
        success: false,
        error: err.message
      });
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===\n');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Total files tested: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}\n`);

  if (successful.length > 0) {
    console.log('USABLE decompressed files:');
    successful.forEach(r => {
      console.log(`  - ${r.outputFile} (from ${r.tool})`);
    });
    console.log('');
  }

  if (failed.length > 0) {
    console.log('FAILED decompressions:');
    failed.forEach(r => {
      console.log(`  - ${r.file}: ${r.error || 'Hash mismatch'}`);
    });
    console.log('');
  }

  console.log(`All decompressed files are saved in: ${viewDecompDir}`);
  console.log('You can now open and inspect these files to verify they are usable.\n');

  // Save results to file for graph generation
  const resultsPath = path.join(baseDir, 'logs', `decomp_test_${Date.now()}.txt`);
  const resultsContent = `=== DECOMPRESSION TEST RESULTS ===

Original file: ${originalFile}
Original hash: ${originalHash}

${compressedFiles.map((file, idx) => {
  const result = results[idx];
  const compressedPath = path.join(outTestDir, file);
  const extension = path.extname(file).slice(1);
  const baseName = path.basename(file, path.extname(file));
  const decompressedPath = path.join(viewDecompDir, `${baseName}_from_${extension}.txt`);
  
  let output = `Processing: ${file}\n`;
  output += `  Tool: ${extension}\n`;
  output += `  Compressed size: ${fs.existsSync(compressedPath) ? fs.statSync(compressedPath).size : 0} bytes\n`;
  
  if (result.success) {
    const decompressedSize = fs.existsSync(decompressedPath) ? fs.statSync(decompressedPath).size : 0;
    output += `  Decompressed to: ${path.basename(decompressedPath)}\n`;
    output += `  Decompressed size: ${decompressedSize} bytes\n`;
    output += `  Hash match: YES - USABLE\n`;
  } else {
    output += `  Hash match: NO - FAILED\n`;
  }
  
  return output;
}).join('\n')}

=== SUMMARY ===
Total files tested: ${results.length}
Successful: ${successful.length}
Failed: ${failed.length}
`;

  fs.writeFileSync(resultsPath, resultsContent);
  console.log(`Results saved to: ${resultsPath}`);

  // Generate graphs
  console.log('\nGenerating decompression visualization graphs...');
  try {
    const { spawn } = await import('node:child_process');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(baseDir, 'src', 'backend', 'decomp_graph_generator.py');
    
    const pythonProcess = spawn(pythonCmd, [scriptPath, resultsPath]);
    
    let output = '';
    let errorOutput = '';
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
      console.log(data.toString().trim());
    });
    
    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('\nDecompression graphs generated successfully!');
      } else {
        console.error('Graph generation failed:', errorOutput);
      }
    });
  } catch (err) {
    console.error('Error generating graphs:', err.message);
  }
}

testDecompression().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
