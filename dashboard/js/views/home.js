// Home / Today: the glanceable overview. Never scrolls.
(function () {
  'use strict';
  var V = {};

  function clock() {
    var n = App.now();
    return '<div class="h-time num">' + App.fmt.time(n, false) + '<span class="h-ampm">' + App.fmt.ampm(n) + '</span></div>' +
      '<div class="h-date"><b>' + App.fmt.day(n) + '</b> ' + App.fmt.month(n) + ' ' + n.getDate() + '</div>';
  }

  function weather() {
    var w = App.weatherNow();
    if (!w) return '<div class="h-wx-none serif"><i>Weather is on its way…</i></div>';
    var hours = App.hourly(7);
    var ts = hours.map(function (h) { return h.t; });
    var tmin = Math.min.apply(null, ts), tmax = Math.max.apply(null, ts);
    return '<div class="h-wx-top">' +
      '<span class="h-wx-icon">' + App.icon(w.cond, 60) + '</span>' +
      '<span class="h-wx-temp num">' + w.temp + '°</span>' +
      '<span class="h-wx-meta"><b>' + App.esc(w.label) + '</b><span>H ' + w.hi + '°  L ' + w.lo + '°</span></span>' +
      '</div>' +
      '<div class="h-wx-say"><b>' + w.summary + '.</b> ' + w.advice + '.</div>' +
      '<div class="h-wx-hours">' + hours.map(function (h) {
        var lift = tmax === tmin ? 0 : Math.round((h.t - tmin) / (tmax - tmin) * 8);
        return '<div class="h-hr' + (h.p >= 50 ? ' is-wet' : '') + '"><span class="h-hr-l">' + h.label + '</span>' +
          '<span class="h-hr-i" style="transform:translateY(' + -lift + 'px)">' + App.icon(h.c, 22) + '</span><b>' + h.t + '°</b></div>';
      }).join('') + '</div>';
  }

  function hero() {
    var e = App.nextEvent(), now = App.now();
    if (!e) {
      var tomorrow = App.timedOn(App.addDays(now, 1))[0];
      return '<div class="h-hero h-hero--empty" data-go="calendar">' +
        '<div class="label label--light">Rest of today</div>' +
        '<div class="h-hero-title serif">Nothing else scheduled.<br><i>Enjoy the quiet.</i></div>' +
        (tomorrow ? '<div class="h-hero-meta">Tomorrow starts with <b>' + App.esc(tomorrow.title) + '</b> at ' + App.fmt.time(tomorrow.start) + '</div>' : '') +
        '</div>';
    }
    var c = App.evColor(e);
    var mins = (e.start - now) / 60000;
    var big = mins < 100
      ? '<div class="h-hero-count num">' + Math.max(1, Math.round(mins)) + '<small>min</small></div>'
      : '<div class="h-hero-count num">' + App.fmt.time(e.start, false) + '<small>' + App.fmt.ampm(e.start) + '</small></div>';
    return '<button class="h-hero" style="' + App.pstyle(c) + '" data-ev="' + App.esc(e.id) + '">' +
      '<div class="h-hero-main">' +
      '  <div class="label label--on">Next up · ' + App.esc(c.family ? 'Everyone' : c.name) + '</div>' +
      '  <div class="h-hero-title serif">' + App.esc(e.title) + '</div>' +
      '  <div class="h-hero-meta">' + App.fmt.range(e.start, e.end) + (e.loc ? ' · ' + App.esc(e.loc) : '') + '</div>' +
      '</div>' + big + '</button>';
  }

  function evRow(e, now) {
    var cur = !e.allDay && e.start <= now;
    return '<button class="h-ev' + (cur ? ' is-now' : '') + (e.allDay ? ' is-allday' : '') + '" data-ev="' + App.esc(e.id) + '">' +
      '<span class="h-ev-t">' + (e.allDay ? 'All day' : cur ? 'Now' : App.fmt.time(e.start, false)) + '</span>' +
      '<span class="h-ev-n">' + App.esc(e.title) + '</span></button>';
  }

  // Family events for the rest of today, full width above the columns
  function family() {
    var now = App.now(), fam = App.familyCal();
    if (!fam) return '';
    var list = App.allDayOn(now).concat(App.timedOn(now)).filter(function (e) { return App.isFamily(e) && e.end > now; });
    if (!list.length) return '';
    var max = App.orient === 'portrait' ? 3 : 2;
    return '<div class="h-fam" style="' + App.pstyle(fam) + '">' + list.slice(0, max).map(function (e) { return evRow(e, now); }).join('') +
      (list.length > max ? '<button class="h-more" data-go="calendar">+' + (list.length - max) + ' more</button>' : '') + '</div>';
  }

  function lanes(withFamily) {
    var now = App.now(), cols = App.columns();
    var max = App.orient === 'portrait' ? 7 : withFamily ? 2 : 3;
    if (!cols.length) return '<div class="h-free serif"><i>No calendars yet.</i></div>';
    return '<div class="h-lanes" style="grid-template-columns:repeat(' + cols.length + ',1fr)">' + cols.map(function (c) {
      var list = App.allDayOn(now, c.key).concat(App.timedOn(now, c.key).filter(function (e) { return e.end > now; }));
      var shown = list.slice(0, max), more = list.length - shown.length;
      return '<div class="h-lane" style="' + App.pstyle(c) + '">' +
        '<div class="h-lane-head">' + App.avatar(c, 30) + '<b>' + App.esc(c.name) + '</b></div>' +
        (list.length ? shown.map(function (e) { return evRow(e, now); }).join('') : '<div class="h-free serif"><i>Free</i> the rest of the day</div>') +
        (more > 0 ? '<button class="h-more" data-go="calendar">+' + more + ' more</button>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function ring(done, total, size) {
    var r = size / 2 - 5, c = 2 * Math.PI * r, f = total ? done / total : 0;
    return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-bg"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-fg" stroke-dasharray="' + (c * f) + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }
  App.ring = ring;

  function chores() {
    var r = App.currentRoutine();
    if (!r || !App.data.chores) return '<div class="label">Chores</div><div class="h-free serif"><i>Loading…</i></div>';
    var all = App.choresIn(r);
    var rings = App.choreCols().map(function (key) {
      var list = all.filter(function (c) { return App.choreWho(c) === key; });
      if (!list.length) return '';
      var done = list.filter(function (c) { return c.done; }).length, p = App.cal(key);
      return '<div class="h-ring' + (done === list.length ? ' is-done' : '') + '" style="' + App.pstyle(p) + '">' + ring(done, list.length, 64) +
        '<b class="num">' + (done === list.length ? '✓' : done + '/' + list.length) + '</b><span>' + App.esc(p.name) + '</span></div>';
    }).join('');
    return '<div class="label">Chores · ' + App.esc(r.name) + '</div><div class="h-rings">' + (rings || '<div class="h-free serif"><i>Nothing due</i></div>') + '</div>';
  }

  function shopping() {
    var sh = App.data.shopping;
    var open = sh ? sh.items : [];
    var recent = open.slice(-3).reverse();
    return '<div class="label">Shopping</div>' +
      '<div class="h-stat"><span class="num">' + (sh ? open.length : '–') + '</span><small>to get</small></div>' +
      '<ul class="h-recent">' + recent.map(function (g) { return '<li><i></i>' + App.esc(g.name) + '</li>'; }).join('') + '</ul>';
  }

  function paintCols() {
    var fam = family();
    V.el.querySelector('.h-cols').innerHTML = fam + lanes(!!fam);
  }

  function paint() {
    var el = V.el;
    el.querySelector('.h-clock').innerHTML = clock();
    el.querySelector('.h-weather').innerHTML = weather();
    el.querySelector('.h-hero-slot').innerHTML = hero();
    paintCols();
    el.querySelector('.h-chores').innerHTML = chores();
    el.querySelector('.h-shop').innerHTML = shopping();
  }

  App.register('home', {
    show: function (el) {
      V.el = el;
      if (!el.firstChild) {
        el.innerHTML = '<div class="home">' +
          '<div class="h-clock" data-go="calendar"></div>' +
          '<div class="h-weather"></div>' +
          '<div class="h-hero-slot"></div>' +
          '<div class="h-cols"></div>' +
          '<button class="h-chores card" data-go="tasks"></button>' +
          '<button class="h-shop card" data-go="shopping"></button>' +
          '</div>';
        el.addEventListener('click', function (e) {
          var ev = e.target.closest('[data-ev]');
          if (ev) { App.eventSheet(App.findEvent(ev.dataset.ev)); return; }
          var g = e.target.closest('[data-go]');
          if (g) App.go(g.dataset.go);
        });
      }
      paint();
    }
  });

  // Every minute: clock and countdown (cheap, even while hidden), the columns as events end, and a
  // few px of shift so nothing sits still for hours (image retention).
  App.on('minute', function () {
    if (!V.el || !V.el.firstChild) return;
    V.el.querySelector('.h-clock').innerHTML = clock();
    V.el.querySelector('.h-hero-slot').innerHTML = hero();
    paintCols();
    var x = Math.round(Math.random() * 6 - 3), y = Math.round(Math.random() * 6 - 3);
    V.el.querySelector('.home').style.transform = 'translate(' + x + 'px,' + y + 'px)';
  });
  App.on('data', function (what) {
    if (!V.el || !V.el.firstChild || App.current !== 'home') return;
    if (what === 'weather') V.el.querySelector('.h-weather').innerHTML = weather();
    else paint();
  });
})();
