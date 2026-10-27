// Chores (Todoist): one card per person (calendar name label) + "Anyone", for the current routine
// (Morning / After school / Evening = sections), with tabs for the other two. Due today + overdue.
(function () {
  'use strict';
  var V = { el: null, routine: null, busy: {} };

  function routine() {
    var all = App.routines();
    return (V.routine && all.filter(function (r) { return r.id === V.routine; })[0]) || App.currentRoutine();
  }
  function listFor(who, r) {
    return App.choresIn(r).filter(function (c) { return App.choreWho(c) === who; })
      .sort(function (a, b) { return (a.done - b.done) || (b.overdue - a.overdue) || (a.order - b.order); });
  }
  // A leading emoji in the Todoist title becomes the tile icon.
  var EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍(?:\p{Extended_Pictographic})|\p{Emoji_Modifier})*)\s*/u;
  function split(title) {
    var m = title.match(EMOJI);
    return m ? { emoji: m[1], text: title.slice(m[0].length) } : { emoji: '', text: title };
  }

  function row(c) {
    var t = split(c.title);
    return '<button class="ch' + (c.done ? ' is-done' : '') + (V.busy[c.id] ? ' is-checking' : '') + (c.overdue && !c.done ? ' is-overdue' : '') + '" data-ch="' + App.esc(c.id) + '">' +
      '<span class="ch-emoji">' + (t.emoji ? App.esc(t.emoji) : '<i class="ch-dot"></i>') + '<span class="ch-check"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span></span>' +
      '<span class="ch-text"><b>' + App.esc(t.text) + '</b>' + (c.overdue && !c.done ? '<small class="ch-late">Overdue</small>' : '') + '</span>' +
      '</button>';
  }

  function lane(who, r) {
    var p = App.cal(who), list = listFor(who, r);
    var done = list.filter(function (c) { return c.done; }).length;
    var all = list.length && done === list.length;
    return '<section class="ch-lane' + (all ? ' is-complete' : '') + (who === 'any' ? ' ch-lane--any' : '') + '" data-lane="' + App.esc(who) + '" style="' + App.pstyle(p) + '">' +
      '<header class="ch-head">' + App.avatar(p, 42) +
      '<div><b>' + App.esc(p.name) + '</b><span class="ch-sub">' + (who === 'any' ? 'Up for grabs' : (list.length ? done + ' of ' + list.length : 'Nothing')) + '</span></div>' +
      '<div class="ch-ring">' + App.ring(done, list.length || 1, 46) + '<span class="num">' + (all ? '✓' : list.length ? done + '/' + list.length : '–') + '</span></div>' +
      '</header>' +
      '<div class="ch-list">' + (list.length ? list.map(row).join('') : '<div class="ch-none serif"><i>Nothing this ' + (r.id === 'evening' ? 'evening' : r.id === 'morning' ? 'morning' : 'afternoon') + '</i></div>') +
      (all ? '<div class="ch-alldone serif">All done<i>!</i></div>' : '') + '</div>' +
      '</section>';
  }

  function render() {
    if (!App.data.chores || !App.routines().length) {
      V.el.innerHTML = '<div class="tasks"><div class="cal-empty serif">Loading chores…</div></div>';
      return;
    }
    var r = routine(), auto = App.currentRoutine();
    var inR = App.choresIn(r);
    var done = inR.filter(function (c) { return c.done; }).length;
    var who = App.choreCols();
    var st = {};
    App.$$('.ch-list', V.el).forEach(function (l) { st[l.parentNode.dataset.lane] = l.scrollTop; });
    V.el.innerHTML = '<div class="tasks">' +
      '<header class="t-head">' +
      '<div class="t-title"><div class="label">' + (r.id === auto.id ? 'Right now · ' : '') + App.routineRange(r) + '</div><h1 class="serif">' + App.esc(r.name) + '</h1></div>' +
      '<div class="seg">' + App.routines().map(function (x) { return '<button class="' + (x.id === r.id ? 'is-on' : '') + '" data-r="' + App.esc(x.id) + '">' + App.esc(x.name) + '</button>'; }).join('') + '</div>' +
      '<div class="t-progress"><span class="num">' + done + '<small>/' + inR.length + '</small></span><div class="t-bar"><i style="width:' + (inR.length ? done / inR.length * 100 : 0) + '%"></i></div><span class="label">done</span></div>' +
      '</header>' +
      '<div class="ch-lanes" style="--lanes:' + who.length + '">' + who.map(function (w) { return lane(w, r); }).join('') + '</div>' +
      '</div>';
    App.$$('.ch-list', V.el).forEach(function (l) { var k = l.parentNode.dataset.lane; if (st[k]) l.scrollTop = st[k]; });
  }

  function toggle(c) {
    var done = !c.done;
    V.busy[c.id] = true;
    render();
    App.api.setChore(c, done).then(function () {
      var r = routine();
      if (done && App.choresIn(r).every(function (x) { return x.done; })) App.toast('<b>' + App.esc(r.name) + ' routine complete!</b> Everyone crushed it.', { icon: 'star', ms: 5000 });
    }, function () { /* data.js reverted it and showed the error */ }).then(function () {
      delete V.busy[c.id];
      if (App.current === 'tasks') render();
    });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-r]'))) { V.routine = t.dataset.r === App.currentRoutine().id ? null : t.dataset.r; return render(); }
    if ((t = e.target.closest('[data-ch]'))) {
      var c = ((App.data.chores && App.data.chores.chores) || []).filter(function (x) { return x.id === t.dataset.ch; })[0];
      if (c && !V.busy[c.id]) toggle(c);
    }
  }

  App.register('tasks', {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    }
  });
  App.on('data', function (what) { if ((what === 'chores' || what === 'calendar' || what === 'config') && App.current === 'tasks' && V.el) render(); });
  App.on('time', function () { V.routine = null; });
  App.on('idle', function () { V.routine = null; });
})();
