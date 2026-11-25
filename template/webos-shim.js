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

  // --- Puente de servicios Luna: responde con error controlado ---
  window.PalmServiceBridge = function () {
    var self = this;
    this.onservicecallback = null;
    this.call = function (uri, params) {
      setTimeout(function () {
        if (typeof self.onservicecallback === 'function') {
          self.onservicecallback(JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'Servicio webOS no disponible en Windows: ' + uri }));
        }
      }, 0);
    };
    this.cancel = function () {};
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
      var res = { returnValue: false, errorCode: -1, errorText: 'Servicio webOS no disponible en Windows: ' + uri };
      setTimeout(function () { opts.onFailure && opts.onFailure(res); opts.onComplete && opts.onComplete(res); }, 0);
      return { cancel: function () {}, send: function () {} };
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
})();
