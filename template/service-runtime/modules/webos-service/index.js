'use strict';
// Versión simulada del módulo "webos-service" para ejecutar servicios JS de webOS en Windows.
const EventEmitter = require('events');

let helloSent = false;
let cidSeq = 0;
const outCalls = {};
const instances = [];
const live = {};

function send(m) { try { process.send(m); } catch (e) { /* el padre cerró */ } }

function lastFn(args) {
  for (let i = args.length - 1; i >= 0; i--) if (typeof args[i] === 'function') return args[i];
  return null;
}

function Service(id) {
  if (!(this instanceof Service)) return new Service(id);
  this.id = id || process.env.LUNA_SERVICE_NAME;
  this.methods = {};
  this.subscriptions = {};
  const self = this;
  const noop = function () { const cb = lastFn(arguments); if (cb) setImmediate(() => cb({ returnValue: true, activityId: 1 })); return { cancel() {} }; };
  this.activityManager = {
    create: noop, complete: noop, cancel: noop, adopt: noop, release: noop, start: noop, stop: noop,
    idLock: noop, idUnlock: noop, keepAlive: noop
  };
  this.keepAlive = noop;
  instances.push(this);
  if (!helloSent) { helloSent = true; setImmediate(() => send({ t: 'hello' })); }
}

Service.prototype.register = function (name, fn) {
  this.methods[String(name).replace(/^\/+/, '')] = fn;
  return this;
};
Service.prototype.register_pub = Service.prototype.register;
Service.prototype.method = Service.prototype.register;

Service.prototype.call = function (uri, args, cb) {
  const cid = ++cidSeq;
  outCalls[cid] = { cb, sub: !!(args && args.subscribe) };
  send({ t: 'call', cid, uri, params: args || {} });
  return { cancel() { delete outCalls[cid]; send({ t: 'callcancel', cid }); } };
};

Service.prototype.subscribe = function (uri, args) {
  const em = new EventEmitter();
  const cid = ++cidSeq;
  outCalls[cid] = { cb: m => em.emit('response', m), sub: true };
  send({ t: 'call', cid, uri, params: Object.assign({}, args, { subscribe: true }) });
  em.cancel = () => { delete outCalls[cid]; send({ t: 'callcancel', cid }); };
  return em;
};

process.on('message', m => {
  if (!m) return;
  if (m.t === 'req') {
    let fn = null;
    for (const s of instances) { if (s.methods[m.method]) { fn = s.methods[m.method]; break; } }
    if (!fn) { send({ t: 'resp', rid: m.rid, payload: { returnValue: false, errorCode: -1, errorText: 'Unknown method "' + m.method + '" for category "/"' } }); return; }
    const payload = m.payload || {};
    const message = {
      uri: m.uri, method: m.method, category: '/', payload,
      isSubscription: payload.subscribe === true,
      sender: 'app', applicationID: process.env.LUNA_SERVICE_NAME,
      respond(obj) { send({ t: 'resp', rid: m.rid, payload: obj }); },
      get(k) { return payload[k]; },
      cancel() {}
    };
    live[m.rid] = message;
    try { fn(message); } catch (e) {
      send({ t: 'resp', rid: m.rid, payload: { returnValue: false, errorCode: -1, errorText: String(e && e.message || e) } });
    }
  } else if (m.t === 'callres') {
    const c = outCalls[m.cid];
    if (c) { if (!c.sub) delete outCalls[m.cid]; if (c.cb) c.cb({ payload: m.payload, respond() {} }); }
  } else if (m.t === 'cancel') {
    delete live[m.rid];
  }
});

module.exports = Service;
module.exports.Service = Service;
