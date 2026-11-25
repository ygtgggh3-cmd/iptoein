'use strict';
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const cfg = require('./app-config.json');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Red: la app usa la red de Windows tal cual (DNS, proxy del sistema, HTTP/HTTPS, WebSocket).
// Ajustes para que las apps de webOS (pensadas para cargarse desde file://) funcionen igual:
function setupNetwork(ses) {
  // Algunos servidores rechazan peticiones con "Origin: null" / "file://": se elimina esa cabecera.
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === 'origin' && (h[k] === 'null' || h[k] === 'file://')) delete h[k];
    }
    cb({ requestHeaders: h });
  });
}

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
      webSecurity: false,                 // sin restricciones CORS, como en la TV
      allowRunningInsecureContent: true   // permite http:// dentro de la app
    }
  });
  setupNetwork(win.webContents.session);
  win.loadFile(path.join(__dirname, 'app', cfg.main));
  win.on('page-title-updated', e => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
