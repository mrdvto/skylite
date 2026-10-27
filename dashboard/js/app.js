// Core shell: router, clock, idle/night, orientation, toasts, sheets, helpers.
(function () {
  'use strict';
  var App = window.App = { views: {}, current: null, mode: 'day', orient: 'landscape' };
  var $ = App.$ = function (s, r) { return (r || document).querySelector(s); };
  App.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------ events
  var handlers = {};
  App.on = function (e, fn) { (handlers[e] = handlers[e] || []).push(fn); };
  App.emit = function (e, a) { (handlers[e] || []).forEach(function (fn) { fn(a); }); };

  // ------------------------------------------------------------ time (?demo / ?at=HH:MM shift the clock)
  var offset = 0;
  App.now = function () { return new Date(Date.now() + offset); };
  App.setTime = function (h, m) {
    if (h == null) offset = 0;
    else { var d = new Date(); d.setHours(h, m, 0, 0); offset = d - Date.now(); }
    lastMin = -1;
    App.emit('time');
    App.rerender();
  };
  App.dayStart = function (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  App.addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  App.sameDay = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
  App.ymd = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  function mins(hm) { var p = String(hm).split(':'); return +p[0] * 60 + +(p[1] || 0); }
  App.minsOfDay = function (d) { return d.getHours() * 60 + d.getMinutes(); };
  // Black screen hours (config: night.start – night.end, wrapping midnight)
  App.isNight = function () {
    var n = (App.data.config && App.data.config.night) || { start: '20:30', end: '06:00' };
    var m = App.minsOfDay(App.now()), a = mins(n.start), b = mins(n.end);
    return a > b ? (m >= a || m < b) : (m >= a && m < b);
  };

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  App.fmt = {
    time: function (d, ampm) {
      var h = d.getHours(), m = d.getMinutes();
      var s = (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m;
      return ampm === false ? s : s + ' ' + (h >= 12 ? 'PM' : 'AM');
    },
    // "4 PM", "3:45 PM"
    hour: function (d) {
      var h = d.getHours(), m = d.getMinutes();
      return (h % 12 || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + (h >= 12 ? 'PM' : 'AM');
    },
    ampm: function (d) { return d.getHours() >= 12 ? 'PM' : 'AM'; },
    range: function (a, b) {
      var same = App.fmt.ampm(a) === App.fmt.ampm(b);
      return (same ? App.fmt.time(a, false) : App.fmt.time(a)) + ' – ' + App.fmt.time(b);
    },
    day: function (d) { return DAYS[d.getDay()]; },
    dayShort: function (d) { return DAYS[d.getDay()].slice(0, 3); },
    month: function (d) { return MONTHS[d.getMonth()]; },
    monthShort: function (d) { return MON_SHORT[d.getMonth()]; },
    mins: function (m) {
      m = Math.max(0, Math.round(m));
      if (m < 60) return m + ' min';
      var h = Math.floor(m / 60), r = m % 60;
      return h + ' hr' + (r ? ' ' + r + ' min' : '');
    },
    rel: function (d) {
      var t = App.dayStart(App.now()), x = App.dayStart(d), diff = Math.round((x - t) / 864e5);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff === -1) return 'Yesterday';
      return DAYS[d.getDay()];
    }
  };
  App.esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  App.norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };

  // ------------------------------------------------------------ icons + people (= calendars)
  App.icon = function (name, size, cls) {
    size = size || 24;
    return '<svg class="i ' + (cls || '') + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (window.ICONS[name] || '') + '</svg>';
  };
  function rgb(hex) {
    var n = parseInt(String(hex).slice(1), 16);
    return isNaN(n) ? '85 85 85' : ((n >> 16) & 255) + ' ' + ((n >> 8) & 255) + ' ' + (n & 255);
  }
  var ANY = { key: 'any', name: 'Anyone', color: '#3B3934', ink: '#FFFFFF' };
  var OTHER = { key: 'other', name: 'Other', color: '#7A756B', ink: '#FFFFFF' };
  App.MAX_COLS = 5;
  // Calendars as Today/Calendar columns: Family spans them all, so it is not a column. More than
  // MAX_COLS calendars: the first MAX_COLS - 1, then "Other" for the rest.
  App.people = function () { return (App.data.calendars || []).filter(function (c) { return !c.family; }); };
  App.familyCal = function () { return (App.data.calendars || []).filter(function (c) { return c.family; })[0] || null; };
  App.columns = function () {
    var p = App.people();
    return p.length > App.MAX_COLS ? p.slice(0, App.MAX_COLS - 1).concat([OTHER]) : p;
  };
  App.cal = function (key) {
    if (key === 'any') return ANY;
    if (key === 'other') return OTHER;
    return (App.data.calendars || []).filter(function (c) { return c.key === key; })[0] || OTHER;
  };
  App.colOf = function (calKey) {
    var cols = App.columns();
    for (var i = 0; i < cols.length; i++) if (cols[i].key === calKey) return cols[i].key;
    return 'other';
  };
  App.pstyle = function (c) {
    if (typeof c === 'string') c = App.cal(c);
    return '--c:' + c.color + ';--c-rgb:' + rgb(c.color) + ';--c-ink:' + c.ink;
  };
  App.avatar = function (c, size, cls) {
    if (typeof c === 'string') c = App.cal(c);
    size = size || 48;
    var ch = c.family ? '★' : c.key === 'any' ? '✱' : App.esc(Array.from(c.name)[0] || '?');
    return '<span class="avatar ' + (cls || '') + '" style="' + App.pstyle(c) + ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.46) + 'px">' + ch + '</span>';
  };

  // ------------------------------------------------------------ calendar helpers
  App.events = function () { return App.data.events || []; };
  App.isFamily = function (e) { var c = App.cal(e.cal); return !!c.family; };
  App.evColor = function (e) { return App.cal(e.cal); };
  // Timed events on a day; colKey filters to one column (Family excluded unless asked).
  App.timedOn = function (day, colKey) {
    var s = App.dayStart(day), e = App.addDays(s, 1);
    return App.events().filter(function (ev) {
      return !ev.allDay && ev.start < e && ev.end > s && (!colKey || (!App.isFamily(ev) && App.colOf(ev.cal) === colKey));
    }).sort(function (a, b) { return a.start - b.start || b.end - a.end; });
  };
  App.allDayOn = function (day, colKey) {
    var s = App.dayStart(day), e = App.addDays(s, 1);
    return App.events().filter(function (ev) {
      return ev.allDay && ev.start < e && ev.end > s && (!colKey || (!App.isFamily(ev) && App.colOf(ev.cal) === colKey));
    });
  };
  App.nextEvent = function () {
    var now = App.now();
    return App.timedOn(now).filter(function (e) { return e.start > now; })[0] || null;
  };
  App.findEvent = function (id) {
    return App.events().filter(function (e) { return e.id === id; })[0];
  };

  // ------------------------------------------------------------ chores + weather helpers
  // Chore owner: the first label matching a calendar name, else Anyone.
  App.choreWho = function (c) {
    var p = App.people(), labels = (c.labels || []).map(App.norm);
    for (var i = 0; i < p.length; i++) if (labels.indexOf(App.norm(p[i].name)) > -1) return App.colOf(p[i].key);
    return 'any';
  };
  App.choreCols = function () { return App.columns().map(function (c) { return c.key; }).concat(['any']); };
  // Due today + overdue, and those ticked today (they stay until midnight), in one list.
  App.chores = function () { return (App.data.chores && App.data.chores.chores) || []; };
  App.weatherNow = function () {
    var W = App.data.weather;
    if (!W) return null;
    var hrs = W.hours, rainAt = -1;
    for (var i = 0; i < Math.min(hrs.length, 12); i++) if (hrs[i].p >= 50) { rainAt = i; break; }
    function at(i) { return new Date(hrs[i].time); }
    var summary, advice, cold = W.now.t < 12;
    if (rainAt === 0) {
      var stop = 0; while (stop < hrs.length - 1 && hrs[stop].p >= 50) stop++;
      summary = (W.now.c === 'snow' ? 'Snow' : 'Rain') + ' until ' + App.fmt.hour(at(stop));
      advice = W.now.c === 'snow' ? 'Boots and mitts' : 'Umbrella weather';
    } else if (rainAt > 0) {
      summary = (hrs[rainAt].c === 'snow' ? 'Snow' : 'Rain') + ' from ' + App.fmt.hour(at(rainAt));
      advice = hrs[rainAt].c === 'snow' ? 'Dress warm' : 'Grab a rain jacket';
    } else {
      summary = cold ? 'Dry and cool' : 'Dry for now';
      advice = W.now.t < 0 ? 'Bundle up' : cold ? 'Jacket weather' : 'Light layers';
    }
    return { temp: W.now.t, cond: W.now.c, label: W.now.label, hi: W.hi, lo: W.lo, summary: summary, advice: advice };
  };
  App.hourly = function (count) {
    var W = App.data.weather;
    if (!W) return [];
    return W.hours.slice(0, count).map(function (h, i) {
      var x = new Date(h.time).getHours();
      return { t: h.t, c: h.c, p: h.p, label: i === 0 ? 'Now' : ((x % 12 || 12) + (x >= 12 ? 'p' : 'a')) };
    });
  };

  // ------------------------------------------------------------ router
  App.register = function (name, view) { App.views[name] = view; };
  // Views are built once and kept laid out (hidden with content-visibility), so switching tabs
  // only has to paint. A view is rebuilt when its data changed ('data'/'time' events) or, for
  // time-sensitive views (minutely: true), when the minute has rolled over since it was built.
  function minuteKey() { return Math.floor(App.now().getTime() / 60000); }
  function build(name, opts) {
    var view = App.views[name];
    view.show($('#view-' + name), opts || {});
    view._built = true; view._dirty = false; view._min = minuteKey();
  }
  App.go = function (name, opts) {
    opts = opts || {};
    if (!App.views[name]) name = 'home';
    if (App.current && App.current !== name && App.views[App.current].hide) App.views[App.current].hide();
    App.$$('.view').forEach(function (v) { v.classList.toggle('is-active', v.dataset.view === name); });
    App.$$('.rail-item').forEach(function (b) { b.classList.toggle('is-active', b.dataset.go === name); });
    App.current = name;
    var view = App.views[name];
    if (!view._built || view._dirty || opts.rerender || (view.minutely && view._min !== minuteKey())) build(name, opts);
    else if (view.resume) view.resume($('#view-' + name));
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  };
  function prebuild(name) {
    var el = $('#view-' + name), view = App.views[name];
    build(name);
    if (view.hide) view.hide();
    el.classList.add('is-warming');
    el.offsetHeight;
    el.classList.remove('is-warming');
  }
  var refreshTimer = null;
  function refreshStale(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function next() {
      var name = Object.keys(App.views).filter(function (k) {
        var v = App.views[k];
        return k !== App.current && (!v._built || v._dirty);
      })[0];
      if (!name) return;
      prebuild(name);
      refreshTimer = setTimeout(next, 400);
    }, delay);
  }
  // A data change only marks views stale; the current view repaints itself via its own 'data'
  // handler (so an open input or scroll position is not thrown away).
  App.on('data', function () {
    Object.keys(App.views).forEach(function (k) { if (k !== App.current) App.views[k]._dirty = true; });
    refreshStale(1500);
  });
  App.on('time', function () {
    Object.keys(App.views).forEach(function (k) { if (k !== App.current) App.views[k]._dirty = true; });
    refreshStale(1500);
  });
  App.rerender = function () {
    if (App.current) App.views[App.current].show($('#view-' + App.current), { rerender: true });
  };

  // ------------------------------------------------------------ toasts (single, with undo)
  var toastTimer;
  App.toast = function (html, opts) {
    opts = opts || {};
    var box = $('#toasts');
    box.innerHTML = '';
    clearTimeout(toastTimer);
    var ms = opts.ms || 5000;
    var t = document.createElement('div');
    t.className = 'toast' + (opts.tone ? ' toast--' + opts.tone : '');
    t.innerHTML = (opts.icon ? App.icon(opts.icon, 26) : '') + '<span class="toast-msg">' + html + '</span>' +
      (opts.undo ? '<button class="toast-undo">' + App.icon('undo', 22) + 'Undo</button>' : '');
    box.appendChild(t);
    t.classList.add('is-in');
    function kill() { t.remove(); }
    toastTimer = setTimeout(kill, ms);
    if (opts.undo) t.querySelector('.toast-undo').addEventListener('click', function () { clearTimeout(toastTimer); opts.undo(); kill(); });
  };

  // ------------------------------------------------------------ sheets (modal cards)
  App.sheet = function (html, opts) {
    opts = opts || {};
    var layer = $('#sheetLayer');
    layer.innerHTML = '<div class="sheet-scrim"></div><div class="sheet ' + (opts.cls || '') + '">' +
      '<button class="sheet-x" data-close aria-label="Close">' + App.icon('x', 28) + '</button>' + html + '</div>';
    layer.classList.add('is-open');
    function close() {
      if (!layer.classList.contains('is-open')) return;
      layer.classList.remove('is-open');
      if (opts.onClose) opts.onClose();
      layer.innerHTML = '';
    }
    App.closeSheet = close;
    layer.querySelector('.sheet-scrim').addEventListener('click', close);
    App.$$('[data-close]', layer).forEach(function (b) { b.addEventListener('click', close); });
    if (opts.onMount) opts.onMount(layer.querySelector('.sheet'), close);
    return close;
  };
  App.closeSheet = function () {};

  // ------------------------------------------------------------ modes: day / night (black)
  // The kiosk may expose a one-function bridge to drop the backlight while the page is black.
  function dim(on) { try { if (window.HomeHQ && window.HomeHQ.setDim) window.HomeHQ.setDim(!!on); } catch (e) { /* no kiosk */ } }
  App.setMode = function (m) {
    App.mode = m;
    $('#stage').dataset.mode = m;
    dim(m === 'night');
    App.emit('mode', m);
  };

  // ------------------------------------------------------------ idle
  // After idleSeconds: back to Today (and black, at night). A tap at night wakes the panel.
  var idleSec = 0;
  App.idleSeconds = function () { return (App.data.config && App.data.config.idleSeconds) || 300; };
  function onIdleTick() {
    idleSec++;
    var night = App.isNight();
    if (night && App.mode === 'day' && idleSec >= App.idleSeconds()) { App.closeSheet(); App.go('home'); App.setMode('night'); return; }
    if (!night && App.mode === 'night') { App.setMode('day'); App.go('home'); return; }
    if (App.mode === 'day' && idleSec === App.idleSeconds()) { App.closeSheet(); App.emit('idle'); if (App.current !== 'home') App.go('home'); }
  }
  App.resetIdle = function () { idleSec = 0; };
  App.wake = function () { App.resetIdle(); App.setMode('day'); App.go('home'); };

  // ------------------------------------------------------------ stage scaling
  // Two design sizes: portrait 800 wide (min 1280 tall) and landscape 800 tall (min 1280 wide).
  // The long side stretches to the screen's aspect; the result is scaled to fit.
  var fitW = 0, fitH = 0;
  function fit() {
    var stage = $('#stage'), W = window.innerWidth, H = window.innerHeight;
    // The on-screen keyboard shrinks the viewport: keep layout and scale, just pin to the top.
    var typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    stage.classList.toggle('is-kb', !!(typing && App.orient && fitW && W === fitW && H < fitH));
    if (stage.classList.contains('is-kb')) return;
    fitW = W; fitH = H;
    var portrait = H > W, w, h;
    if (portrait) { w = 800; h = Math.max(1280, Math.round(800 * H / W)); }
    else { h = 800; w = Math.max(1280, Math.round(800 * W / H)); }
    stage.style.setProperty('--stage-w', w + 'px');
    stage.style.setProperty('--stage-h', h + 'px');
    var s = Math.min(W / w, H / h);
    stage.style.transform = Math.abs(s - 1) < 0.01 ? '' : 'scale(' + s + ')';
    var o = portrait ? 'portrait' : 'landscape';
    if (o !== App.orient) {
      App.orient = o;
      stage.dataset.orient = o;
      Object.keys(App.views).forEach(function (k) { App.views[k]._dirty = true; });
      if (App.current) App.go(App.current, { rerender: true });
      App.emit('orient', o);
    }
  }

  // ------------------------------------------------------------ status marker (offline / sign-in)
  function paintNet() {
    var n = App.data.net, el = $('#netStatus');
    if (!el) return;
    if (n.auth) { el.className = 'net is-auth'; el.innerHTML = App.icon('lock', 18) + '<span>Sign in needed</span>'; return; }
    if (n.since) { el.className = 'net is-off'; el.innerHTML = App.icon('bolt', 18) + '<span>Offline since ' + App.fmt.time(n.since) + '</span>'; return; }
    var t = Object.keys(n.trouble);
    if (t.length) {
      var names = { calendar: 'Calendar', chores: 'Chores', shopping: 'Shopping', weather: 'Weather', config: 'Settings' };
      el.className = 'net is-off';
      el.innerHTML = App.icon('bolt', 18) + '<span>' + t.map(function (k) { return names[k] || k; }).join(', ') + ' not updating</span>';
      return;
    }
    el.className = 'net'; el.innerHTML = '';
  }
  App.on('net', paintNet);

  // ------------------------------------------------------------ clock tick
  var lastMin = -1;
  function tick() {
    var n = App.now();
    App.emit('second', n);
    if (n.getMinutes() !== lastMin) {
      lastMin = n.getMinutes();
      $('#railClock').innerHTML = '<b>' + App.fmt.time(n, false) + '</b><span>' + App.fmt.ampm(n) + '</span>';
      App.emit('minute', n);
      paintNet();
    }
    onIdleTick();
  }

  // ------------------------------------------------------------ boot
  App.start = function () {
    var at = location.search.match(/[?&]at=(\d{1,2}):(\d{2})/);
    if (at) App.setTime(+at[1], +at[2]);
    else if (/[?&]demo\b/.test(location.search)) App.setTime(15, 18);
    fit();
    window.addEventListener('resize', fit);
    document.addEventListener('focusout', function () { setTimeout(fit, 300); });
    // Switch tabs the instant a finger lands (pointerdown), not on release. Keyboard "clicks"
    // (detail === 0) still work.
    $('#rail').addEventListener('pointerdown', function (e) {
      var b = e.target.closest('[data-go]');
      if (b && e.button === 0) App.go(b.dataset.go);
    });
    $('#rail').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (b && e.detail === 0) App.go(b.dataset.go);
      if (e.target.closest('#netStatus.is-auth')) location.reload(); // top-level load reaches the Access sign-in
    });
    document.addEventListener('pointerdown', App.resetIdle, true);
    window.addEventListener('hashchange', function () { App.go(location.hash.slice(1)); });
    App.go(location.hash.slice(1) || 'home');
    tick();
    setInterval(tick, 1000);
    App.emit('ready');
    if (App.isNight()) App.setMode('night');
    refreshStale(1500);
  };
  document.addEventListener('DOMContentLoaded', function () { App.start(); });
})();
