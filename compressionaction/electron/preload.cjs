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
  getFilePath: (file) => ipcRenderer.invoke('get-file-path', file)
});
