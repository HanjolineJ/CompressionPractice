import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('compressAPI', {
  pickInputFile: () => ipcRenderer.invoke('pick-input-file'),
  pickOutputDir: () => ipcRenderer.invoke('pick-output-dir'),
  runJob: (payload) => ipcRenderer.invoke('run-job', payload)
});
