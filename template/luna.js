'use strict';
// Emulación del bus Luna de webOS para apps convertidas a Windows.
//  - Servicios del sistema más usados: reimplementados con equivalentes de Windows.
//  - Servicios JS propios del .ipk (usr/palm/services/*): se ejecutan de verdad con Node
//    (el propio Electron en modo Node) y un módulo "webos-service" simulado.
//  - Cualquier otro servicio devuelve el mismo error que webOS ("Service does not exist").
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

function parseUri(uri) {
  const m = /^(?:luna|palm):\/\/([^\/]+)\/?(.*)$/i.exec(String(uri || ''));
  return m ? { service: m[1], method: m[2] } : null;
}

function getProp(o, p) {
  return String(p).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
}

// ---------- db8 simplificado ----------
class DB {
  constructor(file) {
    this.file = file;
    this.data = { objects: {}, kinds: {} };
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* nuevo */ }
    this.data.objects = this.data.objects || {};
    this.data.kinds = this.data.kinds || {};
  }
  save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch (e) { /* ignorar */ }
  }
  newId() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36); }
  put(objs) {
    const res = objs.map(o => {
      const id = o._id || this.newId();
      const old = this.data.objects[id] || {};
      const rev = (old._rev || 0) + 1;
      this.data.objects[id] = Object.assign({}, o, { _id: id, _rev: rev });
      return { id, rev };
    });
    this.save();
    return res;
  }
  mergeById(id, props) {
    const old = this.data.objects[id];
    if (!old) return null;
    const rev = (old._rev || 0) + 1;
    this.data.objects[id] = Object.assign({}, old, props, { _id: id, _rev: rev });
    return { id, rev };
  }
  match(o, where) {
    return (where || []).every(c => {
      const v = getProp(o, c.prop), x = c.val;
      switch (c.op) {
        case '=': return JSON.stringify(v) === JSON.stringify(x);
        case '!=': return JSON.stringify(v) !== JSON.stringify(x);
        case '<': return v < x;
        case '<=': return v <= x;
        case '>': return v > x;
        case '>=': return v >= x;
        case '%': return typeof v === 'string' && v.toLowerCase().startsWith(String(x).toLowerCase());
        case '?': return typeof v === 'string' && v.toLowerCase().includes(String(x).toLowerCase());
        default: return false;
      }
    });
  }
  find(q) {
    q = q || {};
    let rows = Object.values(this.data.objects).filter(o => (!q.from || o._kind === q.from) && this.match(o, q.where));
    if (q.orderBy) {
      rows.sort((a, b) => { const x = getProp(a, q.orderBy), y = getProp(b, q.orderBy); return x < y ? -1 : x > y ? 1 : 0; });
      if (q.desc) rows.reverse();
    }
    rows = rows.slice(0, q.limit || 500);
    if (Array.isArray(q.select)) rows = rows.map(o => { const r = {}; q.select.forEach(k => { r[k] = getProp(o, k); }); return r; });
    return rows;
  }
  del(ids) {
    const res = [];
    ids.forEach(id => { const o = this.data.objects[id]; if (o) { delete this.data.objects[id]; res.push({ id, rev: (o._rev || 0) + 1 }); } });
    this.save();
    return res;
  }
}

class Luna {
  constructor(opts) {
    opts = opts || {};
    this.appInfo = opts.appInfo || {};
    this.appRoot = opts.appRoot || '.';
    this.shell = opts.shell || null;
    this.notify = opts.notify || (() => {});
    this.execPath = opts.execPath || process.execPath;
    this.runtimeModules = opts.runtimeModules || path.join(this.appRoot, 'service-runtime', 'node_modules');
    this.db = new DB(opts.userData ? path.join(opts.userData, 'db8.json') : null);
    this.settings = { localeInfo: { locales: { UI: (opts.locale || 'en-US') } }, volume: 50, muted: false };
    this.builtins = {};
    this.svc = {};      // nombre de servicio -> info
    this.rid = 0;
    this._registerBuiltins();
    this._loadServices();
  }

  // ---------- servicios del .ipk ----------
  _loadServices() {
    const base = path.join(this.appRoot, 'services');
    if (!fs.existsSync(base)) return;
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(base, d.name);
      let names = [d.name];
      try {
        const sj = JSON.parse(fs.readFileSync(path.join(dir, 'services.json'), 'utf8').replace(/^﻿/, ''));
        const list = (sj.services || []).map(s => s.name).filter(Boolean);
        if (list.length) names = list;
      } catch (e) { /* sin services.json: se usa el nombre de la carpeta */ }
      let main = 'index.js';
      try { main = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).main || main; } catch (e) { /* por defecto */ }
      const info = { dir, entry: path.join(dir, main), proc: null, ready: false, queue: [], pending: {}, calls: {}, name: names[0] };
      names.forEach(n => { this.svc[n.toLowerCase()] = info; });
    }
  }

  _startService(info) {
    if (info.proc) return;
    const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', NODE_PATH: this.runtimeModules, LUNA_SERVICE_NAME: info.name });
    const proc = cp.fork(info.entry, [], { execPath: this.execPath, cwd: info.dir, env, silent: true });
    info.proc = proc; info.ready = false;
    const sink = d => { if (process.env.IPK2EXE_DEBUG) console.log('[' + info.name + '] ' + d); };
    if (proc.stdout) proc.stdout.on('data', sink);
    if (proc.stderr) proc.stderr.on('data', sink);
    proc.on('message', m => {
      if (!m) return;
      if (m.t === 'hello') {
        info.ready = true;
        info.queue.splice(0).forEach(q => proc.send(q));
      } else if (m.t === 'resp') {
        const p = info.pending[m.rid];
        if (p) { p.reply(m.payload); if (!p.sub) delete info.pending[m.rid]; }
      } else if (m.t === 'call') {
        const cancel = this.handle(m.uri, m.params || {}, payload => { try { proc.send({ t: 'callres', cid: m.cid, payload }); } catch (e) { /* servicio cerrado */ } });
        info.calls[m.cid] = cancel;
      } else if (m.t === 'callcancel') {
        const c = info.calls[m.cid]; if (c) { c(); delete info.calls[m.cid]; }
      }
    });
    proc.on('exit', () => {
      Object.keys(info.pending).forEach(k => info.pending[k].reply({ returnValue: false, errorCode: -1, errorText: 'El servicio ' + info.name + ' terminó inesperadamente' }));
      info.pending = {}; info.proc = null; info.ready = false;
    });
    proc.on('error', () => {});
  }

  _callService(info, uri, method, params, reply) {
    this._startService(info);
    const rid = ++this.rid;
    info.pending[rid] = { reply, sub: params && params.subscribe === true };
    const msg = { t: 'req', rid, uri, method, payload: params || {} };
    if (info.ready) info.proc.send(msg); else info.queue.push(msg);
    return () => { delete info.pending[rid]; try { if (info.proc) info.proc.send({ t: 'cancel', rid }); } catch (e) { /* nada */ } };
  }

  // ---------- punto de entrada ----------
  /** Procesa una llamada Luna. reply(payload) puede invocarse varias veces (suscripciones). Devuelve cancel(). */
  handle(uri, params, reply) {
    params = params || {};
    const u = parseUri(uri);
    const fail = (text, code) => { setImmediate(() => reply({ returnValue: false, errorCode: code || -1, errorText: text })); return () => {}; };
    if (!u) return fail('URI de servicio no válida: ' + uri);
    const key = u.service.toLowerCase();

    // 1) servicios propios del .ipk
    if (this.svc[key]) return this._callService(this.svc[key], uri, u.method, params, reply);

    // 2) servicios del sistema emulados
    const table = this.builtins[key];
    if (!table) return fail('Service does not exist: ' + u.service);
    const fn = table[u.method.toLowerCase()];
    if (!fn) return fail('Unknown method "' + u.method + '" for category "/"');
    setImmediate(() => {
      let out;
      try { out = fn.call(this, params, u); } catch (e) { out = { returnValue: false, errorCode: -1, errorText: String(e && e.message || e) }; }
      if (out && typeof out === 'object' && !('returnValue' in out)) out.returnValue = true;
      if (params.subscribe === true && out && out.returnValue !== false) out.subscribed = true;
      reply(out);
    });
    return () => {};
  }

  shutdown() {
    Object.values(this.svc).forEach(i => { try { if (i.proc) i.proc.kill(); } catch (e) { /* nada */ } });
  }

  // ---------- servicios del sistema ----------
  _reg(names, methods) {
    names.forEach(n => {
      const k = n.toLowerCase();
      this.builtins[k] = Object.assign(this.builtins[k] || {}, methods);
    });
  }

  _registerBuiltins() {
    const self = this;

    // Base de datos db8
    const db = this.db;
    this._reg(['com.webos.service.db', 'com.palm.db'], {
      put(p) { return { results: db.put(p.objects || []) }; },
      merge(p) {
        const results = [];
        if (p.objects) p.objects.forEach(o => { const r = db.mergeById(o._id, o); if (r) results.push(r); });
        else if (p.query) db.find(p.query).forEach(o => { const r = db.mergeById(o._id, p.props || {}); if (r) results.push(r); });
        db.save();
        return { results, count: results.length };
      },
      get(p) { return { results: (p.ids || []).map(id => db.data.objects[id]).filter(Boolean) }; },
      find(p) { const results = db.find(p.query); return { results, count: results.length }; },
      del(p) {
        const ids = p.ids || (p.query ? db.find(p.query).map(o => o._id) : []);
        const results = db.del(ids);
        return { results, count: results.length };
      },
      reserveids(p) { const ids = []; for (let i = 0; i < (p.count || 1); i++) ids.push(db.newId()); return { ids }; },
      putkind(p) { db.data.kinds[p.id] = p; db.save(); return {}; },
      delkind(p) { delete db.data.kinds[p.id]; db.save(); return {}; },
      putpermissions() { return {}; },
      putquotas() { return {}; },
      compact() { return {}; }
    });

    // Red
    this._reg(['com.webos.service.connectionmanager', 'com.palm.connectionmanager'], {
      getstatus() {
        let ip = null, mask = null;
        const ifs = os.networkInterfaces();
        Object.keys(ifs).forEach(n => ifs[n].forEach(a => { if (!ip && a.family === 'IPv4' && !a.internal) { ip = a.address; mask = a.netmask; } }));
        const on = !!ip;
        return {
          isInternetConnectionAvailable: on,
          wired: { state: on ? 'connected' : 'disconnected', ipAddress: ip || '', netmask: mask || '', onInternet: on ? 'yes' : 'no' },
          wifi: { state: 'disconnected' },
          wifiDirect: { state: 'disconnected' }
        };
      }
    });

    // Ajustes
    this._reg(['com.webos.settingsservice'], {
      getsystemsettings(p) {
        const cat = p.category || '';
        const settings = {};
        (p.keys || []).forEach(k => { if (k in self.settings) settings[k] = self.settings[k]; });
        if (!p.keys && self.settings[cat]) Object.assign(settings, self.settings[cat]);
        if (cat === 'localeInfo' || (p.keys || []).includes('localeInfo')) settings.localeInfo = self.settings.localeInfo;
        return { category: cat, settings };
      },
      setsystemsettings(p) { Object.assign(self.settings, p.settings || {}); return {}; }
    });

    // Información del sistema
    const devInfo = () => ({
      modelName: 'Windows PC', firmwareVersion: '6.0.0', platformVersion: '6.0.0', sdkVersion: '6.0.0',
      UHD: 'true', _3dsupport: 'false', countryCode: 'US', hardwareVersion: 'PC', manufacturer: os.platform() === 'win32' ? 'Microsoft' : 'PC'
    });
    const clock = () => {
      const d = new Date();
      return {
        utc: Math.floor(d.getTime() / 1000),
        localtime: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: -d.getTimezoneOffset(), timeZoneFile: ''
      };
    };
    this._reg(['com.webos.service.tv.systemproperty'], { getsysteminfo: devInfo, getsystemsettings: () => ({ settings: {} }) });
    this._reg(['com.webos.service.systemservice', 'com.palm.systemservice'], {
      'clock/gettime': clock, 'time/getsystemtime': clock, gettime: clock,
      'deviceinfo/query': devInfo,
      getpreferences(p) { const prefs = {}; (p.keys || []).forEach(k => { if (k in self.settings) prefs[k] = self.settings[k]; }); return prefs; },
      setpreferences(p) { Object.keys(p).forEach(k => { if (k !== 'subscribe') self.settings[k] = p[k]; }); return {}; }
    });

    // Gestor de aplicaciones
    const isUrl = s => /^https?:\/\//i.test(String(s || ''));
    const launch = p => {
      const target = p.target || (p.params && (p.params.target || p.params.url)) || (isUrl(p.id) ? p.id : null);
      if (isUrl(target) && self.shell) self.shell.openExternal(target);
      return {};
    };
    this._reg(['com.webos.applicationmanager', 'com.webos.service.applicationmanager', 'com.palm.applicationmanager'], {
      launch, open: launch,
      getappinfo() { return { appInfo: self.appInfo }; },
      listapps() { return { apps: [self.appInfo] }; },
      listlaunchpoints() { return { launchPoints: [] }; },
      running() { return { running: [{ id: self.appInfo.id, visible: true }] }; },
      close() { return {}; }
    });

    // Notificaciones
    const toast = p => { self.notify(self.appInfo.title || 'App', p.message || p.sourceId || ''); return { toastId: String(Date.now()) }; };
    this._reg(['com.webos.notification', 'com.palm.systemmanager'], { createtoast: toast, createalert: toast, closetoast: () => ({}) });

    // Audio
    const audio = () => ({ volumeStatus: { volume: self.settings.volume, muteStatus: self.settings.muted, soundOutput: 'external_speaker', activity: 'mixed' }, volume: self.settings.volume, muted: self.settings.muted });
    this._reg(['com.webos.audio'], {
      getstatus: audio, getvolume: audio,
      setvolume(p) { self.settings.volume = Math.max(0, Math.min(100, +p.volume || 0)); return {}; },
      setmuted(p) { self.settings.muted = !!p.muted; return {}; },
      volumeup() { self.settings.volume = Math.min(100, self.settings.volume + 1); return {}; },
      volumedown() { self.settings.volume = Math.max(0, self.settings.volume - 1); return {}; }
    });

    // Energía, configuración, actividades
    this._reg(['com.webos.service.tvpower'], { 'power/getpowerstate': () => ({ state: 'Active' }), 'power/turnoffscreen': () => ({}), 'power/turnonscreen': () => ({}) });
    this._reg(['com.webos.service.config'], { getconfigs: () => ({ configs: {} }), setconfigs: () => ({}) });
    const act = () => ({ activityId: 1 });
    this._reg(['com.webos.service.activitymanager', 'com.palm.activitymanager'], { create: act, complete: act, cancel: act, adopt: act, release: act, start: act, stop: act });
  }
}

module.exports = { Luna, DB, parseUri };
