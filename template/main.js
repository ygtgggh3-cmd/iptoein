'use strict';
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const cfg = require('./app-config.json');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: cfg.width, height: cfg.height, title: cfg.title,
    backgroundColor: '#000000', autoHideMenuBar: true,
    icon: cfg.icon ? path.join(__dirname, 'app', cfg.icon) : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      webSecurity: false
    }
  });
  win.loadFile(path.join(__dirname, 'app', cfg.main));
  win.on('page-title-updated', e => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
