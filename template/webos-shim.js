// Capa de compatibilidad webOS -> Windows (generada por ipk2exe)
(function () {
  var cfg = window.__IPK2EXE__ || {};
  // --- Mapeo del control remoto (teclas de webOS) ---
  var map = {
    'Escape': 461,        // Back
    'BrowserBack': 461,
    'F1': 403, 'F2': 404, 'F3': 405, 'F4': 406, // Rojo, verde, amarillo, azul
    'MediaPlay': 415, 'MediaPause': 19, 'MediaPlayPause': 415, 'MediaStop': 413,
    'MediaTrackNext': 417, 'MediaTrackPrevious': 412,
    'PageUp': 33, 'PageDown': 34,
    'Enter': 13
  };
  function remap(type) {
    return function (ev) {
      var code = map[ev.key];
      if (!code || ev.__ipk2exe) return;
      if (ev.key === 'Enter') return; // Enter ya es 13
      ev.preventDefault(); ev.stopImmediatePropagation();
      var ne = new KeyboardEvent(type, { key: ev.key, bubbles: true, cancelable: true });
      Object.defineProperty(ne, 'keyCode', { get: function () { return code; } });
      Object.defineProperty(ne, 'which', { get: function () { return code; } });
      ne.__ipk2exe = true;
      (document.activeElement || document.body).dispatchEvent(ne);
    };
  }
  window.addEventListener('keydown', remap('keydown'), true);
  window.addEventListener('keyup', remap('keyup'), true);

  // --- PalmSystem / webOSSystem ---
  var sys = {
    identifier: cfg.id || 'app',
    version: cfg.version || '1.0.0',
    isActivated: true,
    activityId: 1,
    country: 'US', locale: navigator.language || 'en-US', localeRegion: 'US',
    timeFormat: 'HH12', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenOrientation: 'landscape', launchParams: '{}',
    deviceInfo: JSON.stringify({ modelName: 'Windows PC', version: '6.0.0', platformVersion: '6.0.0', screenWidth: screen.width, screenHeight: screen.height, sdkVersion: '6.0.0', tvSystemVersion: '6.0.0' }),
    PmLogString: function () {}, setWindowProperty: function () {}, window: { setProperty: function () {} },
    platformBack: function () { try { window.history.length > 1 ? window.history.back() : window.close(); } catch (e) {} },
    activate: function () {}, deactivate: function () {}, stageReady: function () {},
    keepAlive: function () {}, addBannerMessage: function () { return 0; }, show: function () {}, hide: function () {},
    getIdentifier: function () { return this.identifier; }
  };
  window.PalmSystem = window.PalmSystem || sys;
  window.webOSSystem = window.webOSSystem || sys;

  // --- Puente de servicios Luna -> emulación en el proceso principal (luna.js) ---
  var lunaSeq = 0, lunaHandlers = {}, lunaCleanup = {};
  function lunaCall(uri, params, handler) {
    var id = ++lunaSeq;
    lunaHandlers[id] = handler;
    if (window.__luna) {
      window.__luna.call(id, uri, params || {});
    } else {
      setTimeout(function () { handler({ returnValue: false, errorCode: -1, errorText: 'Luna no disponible' }); }, 0);
    }
    // Suscripción al estado de red: se vuelve a consultar cuando Windows cambia de online/offline
    if (params && params.subscribe && /connectionmanager\/getstatus/i.test(uri)) {
      var again = function () { lunaCall(uri, Object.assign({}, params, { subscribe: false }), handler); };
      window.addEventListener('online', again);
      window.addEventListener('offline', again);
      lunaCleanup[id] = function () { window.removeEventListener('online', again); window.removeEventListener('offline', again); };
    }
    return id;
  }
  function lunaCancel(id) {
    delete lunaHandlers[id];
    if (lunaCleanup[id]) { lunaCleanup[id](); delete lunaCleanup[id]; }
    if (window.__luna) window.__luna.cancel(id);
  }
  if (window.__luna) window.__luna.onReply(function (m) { var h = lunaHandlers[m.id]; if (h) h(m.payload); });

  window.PalmServiceBridge = function () {
    var self = this, ids = [];
    this.onservicecallback = null;
    this.call = function (uri, params) {
      var p = {};
      try { p = JSON.parse(params || '{}'); } catch (e) {}
      ids.push(lunaCall(uri, p, function (res) {
        if (typeof self.onservicecallback === 'function') self.onservicecallback(JSON.stringify(res));
      }));
    };
    this.cancel = function () { ids.forEach(lunaCancel); ids = []; };
  };

  // --- webOS.js / webOSTV.js (API de alto nivel mínima) ---
  var webOSObj = window.webOS || {};
  webOSObj.platformBack = webOSObj.platformBack || sys.platformBack;
  webOSObj.fetchAppId = webOSObj.fetchAppId || function () { return sys.identifier; };
  webOSObj.fetchAppInfo = webOSObj.fetchAppInfo || function (cb) { cb && cb(cfg.appinfo || {}); };
  webOSObj.fetchAppRootPath = webOSObj.fetchAppRootPath || function () { return location.href.replace(/[^\/]*$/, ''); };
  webOSObj.deviceInfo = webOSObj.deviceInfo || function (cb) { cb && cb(JSON.parse(sys.deviceInfo)); };
  webOSObj.keyboard = webOSObj.keyboard || { isShowing: function () { return false; } };
  webOSObj.platform = webOSObj.platform || { tv: true, windows: true };
  webOSObj.systemInfo = webOSObj.systemInfo || function () { return { country: 'US', timezone: sys.timeZone }; };
  webOSObj.service = webOSObj.service || {
    request: function (uri, opts) {
      opts = opts || {};
      var full = String(uri).replace(/\/+$/, '');
      if (opts.method) full += '/' + opts.method;
      var params = Object.assign({}, opts.parameters || {});
      if (opts.subscribe || opts.resubscribe) params.subscribe = true;
      var id = lunaCall(full, params, function (res) {
        if (res && res.returnValue === false) { opts.onFailure && opts.onFailure(res); }
        else { opts.onSuccess && opts.onSuccess(res); }
        opts.onComplete && opts.onComplete(res);
      });
      return { cancel: function () { lunaCancel(id); }, send: function () {} };
    }
  };
  window.webOS = webOSObj;

  window.webOSTV = window.webOSTV || {
    platform: { tv: true },
    platformBack: sys.platformBack,
    systemInfo: window.webOS.systemInfo,
    deviceInfo: window.webOS.deviceInfo,
    fetchAppId: window.webOS.fetchAppId,
    fetchAppInfo: window.webOS.fetchAppInfo,
    fetchAppRootPath: window.webOS.fetchAppRootPath,
    service: window.webOS.service,
    keyboard: window.webOS.keyboard
  };

  // --- Eventos de ciclo de vida de webOS ---
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      try { document.dispatchEvent(new CustomEvent('webOSLaunch', { detail: {} })); } catch (e) {}
      try { document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: {} })); } catch (e) {}
    }, 0);
  });

  // --- HLS (.m3u8) en Chromium: reproducción con hls.js (la TV lo reproduce de forma nativa) ---
  (function () {
    try { if (document.createElement('video').canPlayType('application/vnd.apple.mpegurl')) return; } catch (e) {}
    var proto = window.HTMLMediaElement && HTMLMediaElement.prototype;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'src');
    if (!desc || !desc.set) return;
    var M3U8 = /\.m3u8(\?|#|$)/i, HLS_TYPE = /mpegurl/i;
    function isHls(url, type) { return M3U8.test(url || '') || HLS_TYPE.test(type || ''); }

    function detach(v) {
      var h = v.__hls;
      v.__hls = null; v.__hlsSrc = null;
      if (h) { try { h.destroy(); } catch (e) {} }
    }
    function attach(v, url) {
      var H = window.__loadHls && window.__loadHls();
      if (!H || !H.isSupported()) { desc.set.call(v, url); return; }
      detach(v);
      var hls = new H({ enableWorker: true });
      var retries = 0;
      v.__hls = hls; v.__hlsSrc = url;
      hls.on(H.Events.ERROR, function (ev, data) {
        if (!data || !data.fatal) return;
        if (retries++ < 3) {
          if (data.type === H.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
          if (data.type === H.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        }
        detach(v);
        try { v.dispatchEvent(new Event('error')); } catch (e) {}
      });
      hls.loadSource(url);
      hls.attachMedia(v);
    }

    Object.defineProperty(proto, 'src', {
      configurable: true, enumerable: desc.enumerable,
      get: function () { return this.__hlsSrc || desc.get.call(this); },
      set: function (u) {
        u = String(u);
        if (this.__hls && /^blob:/i.test(u)) { desc.set.call(this, u); return; } // MediaSource de hls.js
        if (isHls(u)) attach(this, u); else { detach(this); desc.set.call(this, u); }
      }
    });
    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (n, val) {
      if (this instanceof HTMLMediaElement && String(n).toLowerCase() === 'src') { this.src = val; return; }
      return origSetAttr.apply(this, arguments);
    };

    // <video src="...m3u8"> y <video><source src="...m3u8"></video> en el HTML
    function scan(v) {
      if (v.__hls) return;
      var s = v.getAttribute('src');
      if (s && isHls(s)) { attach(v, s); return; }
      var srcs = v.querySelectorAll('source');
      for (var i = 0; i < srcs.length; i++) {
        var u = srcs[i].getAttribute('src'), t = srcs[i].getAttribute('type');
        if (!u) continue;
        if (isHls(u, t)) { attach(v, u); return; }
        if (!t || v.canPlayType(t)) return; // otra fuente reproducible va primero
      }
    }
    function scanTree(n) {
      if (n.nodeType !== 1) return;
      if (n.tagName === 'VIDEO' || n.tagName === 'AUDIO') scan(n);
      else if (n.tagName === 'SOURCE' && n.parentNode && n.parentNode.tagName) { var p = n.parentNode; if (p.tagName === 'VIDEO' || p.tagName === 'AUDIO') scan(p); }
      var list = n.querySelectorAll ? n.querySelectorAll('video,audio') : [];
      for (var i = 0; i < list.length; i++) scan(list[i]);
    }
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'childList') m.addedNodes.forEach(scanTree);
        else if (m.type === 'attributes') scanTree(m.target);
      });
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'type'] });
  })();
})();
