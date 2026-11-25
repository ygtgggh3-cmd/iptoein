'use strict';
// Núcleo del conversor: .ipk (app web de webOS) -> carpeta con .exe independiente.
// Truco: el propio runtime de Electron de este programa se copia y se le inyecta la app convertida,
// así NO hace falta internet ni Node.js para convertir.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

function readAr(buf) {
  if (buf.slice(0, 8).toString('latin1') !== '!<arch>\n') throw new Error('El archivo no es un .ipk válido.');
  const entries = {};
  let pos = 8;
  while (pos + 60 <= buf.length) {
    let name = buf.slice(pos, pos + 16).toString('latin1').trim();
    const size = parseInt(buf.slice(pos + 48, pos + 58).toString('latin1').trim(), 10);
    pos += 60;
    if (name.endsWith('/')) name = name.slice(0, -1);
    entries[name] = buf.slice(pos, pos + size);
    pos += size + (size % 2);
  }
  return entries;
}

function readTar(buf, destDir) {
  let pos = 0, longName = null;
  const str = (b, s, e) => { const x = b.slice(s, e); const z = x.indexOf(0); return x.slice(0, z === -1 ? x.length : z).toString('utf8'); };
  while (pos + 512 <= buf.length) {
    const h = buf.slice(pos, pos + 512);
    if (h.every(b => b === 0)) break;
    let name = str(h, 0, 100);
    const size = parseInt(str(h, 124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h, 345, 500);
    if (prefix) name = prefix + '/' + name;
    pos += 512;
    const data = buf.slice(pos, pos + size);
    pos += Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = str(data, 0, data.length); continue; }
    if (type === 'x' || type === 'g') { const m = /\d+ path=([^\n]+)\n/.exec(data.toString('utf8')); if (m) longName = m[1]; continue; }
    if (longName) { name = longName; longName = null; }
    name = name.replace(/^\.?\/+/, '');
    if (!name) continue;
    const target = path.join(destDir, name);
    if (path.relative(destDir, target).startsWith('..')) continue;
    if (type === '5') { fs.mkdirSync(target, { recursive: true }); continue; }
    if (type === '0' || type === '\0') { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); }
  }
}

function findAppInfo(dir) {
  const hits = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else if (f.name === 'appinfo.json') hits.push(p);
    }
  })(dir);
  hits.sort((a, b) => a.length - b.length);
  return hits[0] || null;
}

function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, f.name), d = path.join(dst, f.name);
    if (skip && skip(s)) continue;
    if (f.isDirectory()) copyDir(s, d, skip); else fs.copyFileSync(s, d);
  }
}

function looksNative(appDir, info) {
  if (info.type && info.type !== 'web') return true;
  const main = info.main || 'index.html';
  return !/\.html?$/i.test(main) || !fs.existsSync(path.join(appDir, main));
}

/**
 * @param {string} ipkPath
 * @param {string} outBase  carpeta donde se creará la subcarpeta de la app
 * @param {{runtimeDir?:string, log?:Function, force?:boolean}} opts
 */
function convert(ipkPath, outBase, opts) {
  opts = opts || {};
  const log = opts.log || (() => {});
  const runtimeDir = opts.runtimeDir || path.dirname(process.execPath);
  const runtimeExe = opts.runtimeExe || process.execPath;

  log('Leyendo ' + path.basename(ipkPath) + '…');
  const entries = readAr(fs.readFileSync(ipkPath));
  const dataKey = Object.keys(entries).find(n => n.startsWith('data.tar'));
  if (!dataKey) throw new Error('El .ipk no contiene data.tar.*');
  let tarBuf;
  if (dataKey.endsWith('.gz')) tarBuf = zlib.gunzipSync(entries[dataKey]);
  else if (dataKey.endsWith('.tar')) tarBuf = entries[dataKey];
  else throw new Error('Este .ipk usa compresión ' + dataKey + ' (no soportada). Ábrelo con 7-Zip, vuelve a comprimir data.tar como .gz y repite.');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipk2exe-'));
  try {
    readTar(tarBuf, tmp);
    const infoPath = findAppInfo(tmp);
    if (!infoPath) throw new Error('No se encontró appinfo.json dentro del .ipk.');
    const appDir = path.dirname(infoPath);
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8').replace(/^﻿/, ''));
    log('App: ' + (info.title || info.id) + ' (' + info.id + ') v' + info.version);

    if (looksNative(appDir, info) && !opts.force) {
      const e = new Error('Esta app es NATIVA (binario para ARM/Linux o sin página HTML). No se puede convertir a .exe; habría que portar su código fuente.');
      e.code = 'NATIVE';
      throw e;
    }

    const title = info.title || info.id || 'App';
    const safeName = String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'App';
    const outDir = path.join(outBase, safeName);
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });

    log('Copiando el motor (Electron)…');
    copyDir(runtimeDir, outDir, s => {
      const rel = path.relative(runtimeDir, s).replace(/\\/g, '/');
      return rel === 'resources/app' || rel === 'resources/app.asar' || rel === 'resources/default_app.asar';
    });

    // renombrar el ejecutable
    const exeName = path.basename(runtimeExe);
    const newExe = safeName + path.extname(exeName);
    fs.renameSync(path.join(outDir, exeName), path.join(outDir, newExe));

    log('Insertando la app de webOS…');
    const appRoot = path.join(outDir, 'resources', 'app');
    fs.mkdirSync(appRoot, { recursive: true });
    copyDir(appDir, path.join(appRoot, 'app'));

    let w = 1280, h = 720;
    const m = /^(\d+)x(\d+)$/.exec(String(info.resolution || ''));
    if (m) { w = Math.min(+m[1], 1920); h = Math.min(+m[2], 1080); }
    const cfg = { id: info.id, title, version: info.version || '1.0.0', main: info.main || 'index.html',
      icon: info.largeIcon || info.icon || null, width: w, height: h, fullscreen: false, appinfo: info };
    fs.writeFileSync(path.join(appRoot, 'app-config.json'), JSON.stringify(cfg, null, 2));
    for (const f of ['main.js', 'preload.js', 'webos-shim.js', 'luna.js']) {
      fs.copyFileSync(path.join(__dirname, 'template', f), path.join(appRoot, f));
    }
    copyDir(path.join(__dirname, 'template', 'service-runtime'), path.join(appRoot, 'service-runtime'));

    // Servicios JS propios del .ipk (usr/palm/services/<id>/): se incluyen para ejecutarlos con Node
    const svcDirs = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p); else if (f.name === 'services.json') svcDirs.push(path.dirname(p));
      }
    })(tmp);
    svcDirs.forEach(sd => copyDir(sd, path.join(appRoot, 'services', path.basename(sd))));
    if (svcDirs.length) log('Servicios incluidos: ' + svcDirs.map(d => path.basename(d)).join(', '));
    fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'webos-app', productName: title, version: String(cfg.version), main: 'main.js' }, null, 2));

    log('Listo: ' + path.join(outDir, newExe));
    return { outDir, exe: path.join(outDir, newExe), title };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { convert };
