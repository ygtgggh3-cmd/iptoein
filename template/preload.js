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

const shim = fs.readFileSync(path.join(__dirname, 'webos-shim.js'), 'utf8');
(0, eval)(shim);
