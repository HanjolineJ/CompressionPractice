import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCompressionJob } from '../src/backend/compressRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    title: 'CompressAction',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) mainWindow.loadURL(dev);
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// File dialogs
ipcMain.handle('pick-input-file', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose input file',
    properties: ['openFile']
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('pick-output-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output directory',
    properties: ['openDirectory', 'createDirectory']
  });
  return res.canceled ? null : res.filePaths[0];
});

// Run compression pipeline
ipcMain.handle('run-job', async (_evt, payload) => {
  return await runCompressionJob(payload); // returns { rows, csvPath }
});
