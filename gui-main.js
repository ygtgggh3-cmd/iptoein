'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const { convert } = require('./converter');

function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 620, height: 560, resizable: false, title: 'Conversor IPK → EXE',
    backgroundColor: '#14161a',
    webPreferences: { nodeIntegration: true, contextIsolation: false } // solo carga index.html local
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('pick-ipk', async () => {
  const r = await dialog.showOpenDialog({ title: 'Elige un archivo .ipk', filters: [{ name: 'Apps webOS', extensions: ['ipk'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pick-out', async () => {
  const r = await dialog.showOpenDialog({ title: 'Carpeta de salida', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('convert', async (ev, ipk, outBase, force) => {
  const logs = [];
  try {
    const r = convert(ipk, outBase, { force, log: m => { logs.push(m); ev.sender.send('log', m); } });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code };
  }
});

ipcMain.handle('show', (ev, p) => { shell.showItemInFolder(p); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
