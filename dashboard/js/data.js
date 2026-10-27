// Live data from the Worker (/api/*). The last good copy stays in memory only, so the panel keeps
// showing it when the network or a service drops; nothing is stored on the device. Each section
// re-fetches on its own interval and right after this panel writes to it, so ticks made on the
// other frame or on phones show up within the interval.
(function () {
  'use strict';
  var S = App.data = {
    config: null, calendars: [], events: [], chores: null, shopping: null, weather: null,
    net: { since: null, auth: false, trouble: {} }
  };
  var EVERY = { chores: 30e3, shopping: 30e3, calendar: 120e3, weather: 15 * 60e3 };
  var last = {}, busy = {};
  // Writes in flight or just made: id -> desired state, laid over fetched data so a refresh that
  // started before the write landed cannot flip the tick back. Kept SETTLE ms after the write
  // succeeds: Todoist's activity log, which says a recurring chore was done, lags a few seconds.
  // Once a write succeeded, fetched data that agrees with it ends the overlay early.
  var pending = { chores: {}, shopping: {} }, saved = { chores: {}, shopping: {} };
  var SETTLE = 40e3;

  function parseDay(s) { var p = s.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function parseEvent(e) {
    return { id: e.id, cal: e.cal, title: e.title, loc: e.loc, allDay: e.allDay,
      start: e.allDay ? parseDay(e.start) : new Date(e.start), end: e.allDay ? parseDay(e.end) : new Date(e.end) };
  }

  // Network down or Access expired: "Offline since …" / "Sign in needed". The Worker answering with
  // an error (a service down, a revoked token) is not offline: that section is marked instead.
  function failed(err, name) {
    if (err && err.status) { S.net.trouble[name || 'data'] = true; App.emit('net'); return; }
    if (err && err.auth) S.net.auth = true;
    if (!S.net.since) S.net.since = App.now();
    App.emit('net');
  }
  function ok(name) {
    var t = name && S.net.trouble[name];
    if (t) delete S.net.trouble[name];
    if (t || S.net.since || S.net.auth) { S.net.since = null; S.net.auth = false; App.emit('net'); }
  }

  // redirect: 'manual' so an expired Access session (302 to the sign-in page) shows as
  // "Sign in needed" instead of a CORS failure that looks like being offline.
  function request(method, path, body) {
    var opts = { method: method, redirect: 'manual', credentials: 'same-origin', headers: {} };
    if (body) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (r) {
      if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) throw { auth: true };
      if (!r.ok) throw { status: r.status };
      return r.json();
    });
  }

  // ------------------------------------------------------------ calendar range
  // Base range: from the Monday on/before the 1st of this month to six weeks ahead. Calendar
  // views showing another range ask for it with App.api.range(); one extra range is kept.
  var extra = null, rangeTicket = 0;
  function baseRange() {
    var now = App.now(), first = new Date(now.getFullYear(), now.getMonth(), 1);
    var from = App.addDays(first, -((first.getDay() + 6) % 7));
    var to = App.addDays(App.dayStart(now), 43);
    return [App.ymd(from), App.ymd(to)];
  }
  function loadRange(r) {
    return request('GET', '/api/calendar?from=' + r[0] + '&to=' + r[1]).then(function (j) {
      return { range: r, calendars: j.calendars, events: j.events.map(parseEvent) };
    });
  }
  function mergeEvents(parts) {
    var seen = {}, out = [];
    parts.forEach(function (p) {
      if (!p) return;
      p.events.forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; out.push(e); } });
    });
    return out;
  }
  var base = null;

  var loaders = {
    config: function () { return request('GET', '/api/config').then(function (j) { S.config = j; }); },
    calendar: function () {
      var jobs = [loadRange(baseRange())];
      if (extra) jobs.push(loadRange(extra.range));
      return Promise.all(jobs).then(function (res) {
        base = res[0];
        if (res[1]) extra = res[1];
        S.calendars = base.calendars;
        S.events = mergeEvents([base, extra]);
      });
    },
    chores: function () {
      return request('GET', '/api/chores').then(function (j) {
        var P = pending.chores, have = {};
        j.chores.forEach(function (c) { have[c.id] = true; if (overlay('chores', c.id, c.done)) c.done = P[c.id]; });
        // A recurring chore just ticked can be missing until the log catches up: keep the old copy.
        ((S.chores && S.chores.chores) || []).forEach(function (c) {
          if (c.id in P && !have[c.id]) j.chores.push(Object.assign({}, c, { done: P[c.id] }));
        });
        S.chores = j;
      });
    },
    shopping: function () {
      return request('GET', '/api/shopping').then(function (j) {
        var P = pending.shopping;
        j.items.forEach(function (i) { overlay('shopping', i.id, false); });
        j.got.forEach(function (i) { overlay('shopping', i.id, true); });
        var moved = j.items.filter(function (i) { return P[i.id] === true; })
          .concat(j.got.filter(function (i) { return P[i.id] === false; }));
        j.items = j.items.filter(function (i) { return P[i.id] !== true; });
        j.got = j.got.filter(function (i) { return P[i.id] !== false; });
        moved.forEach(function (i) { if (P[i.id]) j.got.unshift(i); else j.items.push(i); });
        S.shopping = j;
      });
    },
    weather: function () { return request('GET', '/api/weather').then(function (j) { S.weather = j; }); }
  };

  function load(name) {
    if (busy[name]) return busy[name];
    var p = busy[name] = loaders[name]().then(function () {
      last[name] = Date.now();
      ok(name);
      App.emit('data', name);
    }, function (err) {
      last[name] = Date.now() - (EVERY[name] || 0) + 15e3; // retry in ~15 s while it fails
      failed(err, name);
    }).then(function () { busy[name] = null; });
    return p;
  }

  // ------------------------------------------------------------ writes
  // Whether a pending write still overrides the fetched state of an item (not once it agrees).
  function overlay(kind, id, state) {
    if (!(id in pending[kind])) return false;
    if (saved[kind][id] && pending[kind][id] === state) { delete pending[kind][id]; delete saved[kind][id]; return false; }
    return true;
  }

  function write(kind, id, done, path) {
    pending[kind][id] = done;
    delete saved[kind][id];
    App.emit('data', kind);
    return request('POST', path, { done: done }).then(function () {
      saved[kind][id] = true;
      setTimeout(function () { if (saved[kind][id] && pending[kind][id] === done) { delete pending[kind][id]; delete saved[kind][id]; } }, SETTLE);
      return load(kind);
    }, function (err) {
      delete pending[kind][id];
      delete saved[kind][id];
      if (err && !err.status) failed(err, kind);
      load(kind);
      App.toast('Couldn’t save that — ' + (S.net.since ? 'the panel is offline' : 'try again in a moment'), { tone: 'error', icon: 'x' });
      throw err;
    });
  }

  App.api = {
    load: load,
    pending: pending,
    setChore: function (c, done) {
      c.done = done;
      return write('chores', c.id, done, '/api/chores/' + encodeURIComponent(c.id)).then(null, function (err) { c.done = !done; throw err; });
    },
    setItem: function (item, done) {
      var sh = S.shopping;
      if (done) { sh.items = sh.items.filter(function (i) { return i.id !== item.id; }); sh.got.unshift({ id: item.id, name: item.name, store: item.store, at: new Date().toISOString() }); }
      else { sh.got = sh.got.filter(function (i) { return i.id !== item.id; }); sh.items.push({ id: item.id, name: item.name, note: '', store: item.store }); }
      return write('shopping', item.id, done, '/api/shopping/' + encodeURIComponent(item.id)).then(null, function (err) {
        // Put it back where it was (the refetch in write() can't, while offline)
        var cur = App.data.shopping;
        if (done) { cur.got = cur.got.filter(function (i) { return i.id !== item.id; }); cur.items.push(item); }
        else { cur.items = cur.items.filter(function (i) { return i.id !== item.id; }); cur.got.unshift(item); }
        App.emit('data', 'shopping');
        throw err;
      });
    },
    addItem: function (name, store) {
      return request('POST', '/api/shopping', { name: name, store: store || null }).then(function (j) {
        S.shopping.items.push(j.item);
        App.emit('data', 'shopping');
        load('shopping');
        return j.item;
      }, function (err) {
        if (err && !err.status) failed(err, 'shopping');
        App.toast('Couldn’t add that — ' + (S.net.since ? 'the panel is offline' : 'try again in a moment'), { tone: 'error', icon: 'x' });
        throw err;
      });
    },
    // Make sure events for [from, to) are loaded (Calendar paging outside the base range).
    range: function (from, to) {
      var b = base && base.range, f = App.ymd(from), t = App.ymd(to);
      if (b && f >= b[0] && t <= b[1]) return;
      if (extra && f >= extra.range[0] && t <= extra.range[1]) return;
      var ticket = ++rangeTicket;
      loadRange([f, t]).then(function (r) {
        if (ticket !== rangeTicket) return; // a later page asked for another range
        extra = r;
        S.events = mergeEvents([base, extra]);
        ok('calendar');
        App.emit('data', 'calendar');
      }, function (err) { failed(err, 'calendar'); });
    }
  };

  // ------------------------------------------------------------ schedule
  // At night (black screen) refresh less often; waking refreshes anything older than its interval.
  function due(name) { return !last[name] || Date.now() - last[name] >= EVERY[name] * (App.mode === 'night' ? 10 : 1); }
  function sweep() { Object.keys(EVERY).forEach(function (n) { if (due(n)) load(n); }); }
  App.on('ready', function () {
    load('config').then(function () { sweep(); });
    setInterval(function () { if (!S.config) load('config'); else sweep(); }, 5000);
  });
  App.on('mode', function (m) { if (m === 'day') sweep(); });
  // A new day: the base calendar range and today's chores move.
  App.on('minute', function (n) { if (n.getHours() === 0 && n.getMinutes() === 0) { last = {}; sweep(); } });
})();
