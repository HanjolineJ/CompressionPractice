// CommonJS preload to ensure contextBridge works regardless of ESM settings
// This avoids issues when package.json has "type":"module".
const { contextBridge, ipcRenderer } = require('electron');

// Optional: simple heartbeat to confirm preload executed (visible in DevTools console)
try { console.log('[preload.cjs] running and exposing compressAPI'); } catch {}

contextBridge.exposeInMainWorld('compressAPI', {
  pickInputFile: () => ipcRenderer.invoke('pick-input-file'),
  pickInputFiles: () => ipcRenderer.invoke('pick-input-files'),
  pickOutputDir: () => ipcRenderer.invoke('pick-output-dir'),
  runJob: (payload) => ipcRenderer.invoke('run-job', payload),
  getFilePath: (file) => ipcRenderer.invoke('get-file-path', file),
  findRecentFiles: (outputDir) => ipcRenderer.invoke('find-recent-files', outputDir),
  runDecompress: (payload) => ipcRenderer.invoke('run-decompress', payload),
  runBatchDecompress: (payload) => ipcRenderer.invoke('run-batch-decompress', payload),
  loadImageAsDataUrl: (imagePath) => ipcRenderer.invoke('load-image-as-data-url', imagePath),
  mlPredict: (filePath) => ipcRenderer.invoke('ml-predict', filePath),
  mlPredictFromBenchmark: (filePath, rows) => ipcRenderer.invoke('ml-predict-from-benchmark', { filePath, rows })
});
