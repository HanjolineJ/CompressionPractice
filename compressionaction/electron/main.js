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
      // Use CommonJS preload to ensure it runs even with package.json type: module
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
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
