import { contextBridge, ipcRenderer } from 'electron';

console.log('Preload script is running...');

contextBridge.exposeInMainWorld('compressAPI', {
  pickInputFile: () => ipcRenderer.invoke('pick-input-file'),
  pickInputFiles: () => ipcRenderer.invoke('pick-input-files'),
  pickOutputDir: () => ipcRenderer.invoke('pick-output-dir'),
  runJob: (payload) => ipcRenderer.invoke('run-job', payload),
  getFilePath: (file) => ipcRenderer.invoke('get-file-path', file),
  findRecentFiles: (outputDir) => ipcRenderer.invoke('find-recent-files', outputDir),
  runDecompress: (payload) => ipcRenderer.invoke('run-decompress', payload)
});

console.log('compressAPI exposed to window object');
