'use strict';
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');
const cfg = require('./app-config.json');
window.__IPK2EXE__ = cfg;

// Canal hacia el emulador Luna del proceso principal
const handlers = [];
ipcRenderer.on('luna-reply', (e, m) => handlers.forEach(h => h(m)));
window.__luna = {
  call: (id, uri, params) => ipcRenderer.send('luna-call', { id, uri, params }),
  cancel: id => ipcRenderer.send('luna-cancel', { id }),
  onReply: cb => handlers.push(cb)
};

// hls.js bajo demanda (solo si la app reproduce .m3u8); se aísla de AMD/CommonJS de la página
let hlsCache = null;
window.__loadHls = () => {
  if (hlsCache) return hlsCache;
  try {
    const src = fs.readFileSync(path.join(__dirname, 'hls.min.js'), 'utf8');
    const prev = window.Hls, had = 'Hls' in window;
    new Function('exports', 'module', 'define', src).call(window);
    hlsCache = window.Hls;
    if (had) window.Hls = prev; else delete window.Hls;
  } catch (e) { return null; }
  return hlsCache;
};

const shim = fs.readFileSync(path.join(__dirname, 'webos-shim.js'), 'utf8');
(0, eval)(shim);
