import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCompressionJob, findRecentCompressedFiles, runDecompressionJob, runBatchDecompressionJob } from '../src/backend/compressRunner.js';
import { getRecommendation, getRecommendationFromBenchmark } from '../src/backend/mlPredictor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    title: 'CompressAction',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      // Use CommonJS preload to ensure it runs even with package.json type: module
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Allow loading local files via file:// protocol
    }
  });

  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) mainWindow.loadURL(dev);
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  // Register protocol to serve local files
  protocol.registerFileProtocol('local-file', (request, callback) => {
    const url = request.url.replace('local-file:///', '');
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error('Failed to load file:', error);
    }
  });
  
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// File dialogs
ipcMain.handle('pick-input-file', async () => {
  console.log('pick-input-file handler called');
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose input file',
      properties: ['openFile']
    });
    console.log('Dialog result:', res);
    return res.canceled ? null : res.filePaths[0];
  } catch (error) {
    console.error('Error in pick-input-file:', error);
    throw error;
  }
});

ipcMain.handle('pick-input-files', async () => {
  console.log('pick-input-files handler called');
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose input files',
      properties: ['openFile', 'multiSelections']
    });
    console.log('Dialog result:', res);
    return res.canceled ? null : res.filePaths;
  } catch (error) {
    console.error('Error in pick-input-files:', error);
    throw error;
  }
});

ipcMain.handle('pick-output-dir', async () => {
  console.log('pick-output-dir handler called');
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose output directory',
      properties: ['openDirectory', 'createDirectory']
    });
    console.log('Dialog result:', res);
    return res.canceled ? null : res.filePaths[0];
  } catch (error) {
    console.error('Error in pick-output-dir:', error);
    throw error;
  }
});

// For drag-and-drop file path extraction
ipcMain.handle('get-file-path', async (_evt, file) => {
  return file;
});

// Run compression pipeline
ipcMain.handle('run-job', async (_evt, payload) => {
  return await runCompressionJob(payload); // returns { rows, csvPath }
});

// Find recent compressed files
ipcMain.handle('find-recent-files', async (_evt, outputDir) => {
  console.log('find-recent-files handler called with:', outputDir);
  try {
    const files = findRecentCompressedFiles(outputDir);
    console.log('Found files:', files);
    return files;
  } catch (error) {
    console.error('Error finding recent files:', error);
    throw error;
  }
});

// Run decompression
ipcMain.handle('run-decompress', async (_evt, payload) => {
  console.log('run-decompress handler called with:', payload);
  try {
    return await runDecompressionJob(payload);
  } catch (error) {
    console.error('Error in decompression:', error);
    throw error;
  }
});

// Run batch decompression with visualization
ipcMain.handle('run-batch-decompress', async (_evt, payload) => {
  console.log('run-batch-decompress handler called with:', payload);
  try {
    const { runBatchDecompressionJob } = await import('../src/backend/compressRunner.js');
    return await runBatchDecompressionJob(payload);
  } catch (error) {
    console.error('Error in batch decompression:', error);
    throw error;
  }
});

// Load graph image as base64 data URL for reliable display
ipcMain.handle('load-image-as-data-url', async (_evt, imagePath) => {
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error('Error loading image:', error);
    throw error;
  }
});

// ── ML prediction handlers ────────────────────────────────────────────────────

// Pre-run prediction: called right after the user picks a file, before compression.
// Uses only file size, extension, and Shannon entropy.
ipcMain.handle('ml-predict', async (_evt, filePath) => {
  console.log('[ml-predict] requesting prediction for:', filePath);
  try {
    const result = await getRecommendation(filePath);
    console.log('[ml-predict] result:', result);
    return result;
  } catch (error) {
    console.error('[ml-predict] error:', error);
    return { error: error.message };
  }
});

// Post-run prediction: called after compression finishes with real benchmark data.
// Uses actual per-algorithm savings + timing from the completed benchmark run.
ipcMain.handle('ml-predict-from-benchmark', async (_evt, { filePath, rows }) => {
  console.log('[ml-predict-from-benchmark] requesting post-run prediction for:', filePath);
  try {
    const result = await getRecommendationFromBenchmark(filePath, rows);
    console.log('[ml-predict-from-benchmark] result:', result);
    return result;
  } catch (error) {
    console.error('[ml-predict-from-benchmark] error:', error);
    return { error: error.message };
  }
});