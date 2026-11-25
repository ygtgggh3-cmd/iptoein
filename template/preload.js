'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./app-config.json');
window.__IPK2EXE__ = cfg;
const shim = fs.readFileSync(path.join(__dirname, 'webos-shim.js'), 'utf8');
(0, eval)(shim);
