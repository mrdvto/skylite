// Shopping (Todoist): store tabs, add field, the list in the order added, and a "Got it" drawer of
// the last 24 h. Tick, untick, add by typing; nothing else is changed from the panel.
(function () {
  'use strict';
  var V = { el: null, store: 'All', drawer: false, busy: {}, flash: null };

  function stores() { return (App.data.config && App.data.config.stores) || []; }
  function isTab(name) { return stores().some(function (s) { return s.tab && s.name === name; }); }
  // Items under a tab: a tab store's own items; Other = minor stores (badged) + no store.
  function inTab(item, tab) {
    if (tab === 'All') return true;
    if (tab === 'Other') return !isTab(item.store);
    return item.store === tab;
  }
  function items() { var s = App.data.shopping; return s ? s.items.filter(function (i) { return inTab(i, V.store); }) : []; }
  function got() { var s = App.data.shopping; return s ? s.got.filter(function (i) { return inTab(i, V.store); }) : []; }

  // Tabs: All, then each tab store with items, then Other (if it has items)
  function tabs() {
    var all = App.data.shopping ? App.data.shopping.items : [];
    var list = [['All', all.length]];
    stores().forEach(function (s) {
      if (!s.tab) return;
      var n = all.filter(function (i) { return i.store === s.name; }).length;
      if (n || V.store === s.name) list.push([s.name, n]);
    });
    var other = all.filter(function (i) { return !isTab(i.store); }).length;
    if (other || V.store === 'Other') list.push(['Other', other]);
    return list;
  }

  function badge(item) {
    if (item.store === 'Other') return '';
    if (V.store !== 'All' && isTab(item.store)) return '';
    var s = stores().filter(function (x) { return x.name === item.store; })[0];
    var style = s && s.color ? ' style="background:' + s.color + ';color:' + (s.ink || '#FFFFFF') + '"' : '';
    return '<span class="s-store' + (isTab(item.store) ? '' : ' s-store--minor') + '"' + style + '>' + App.esc(item.store) + '</span>';
  }

  function row(g) {
    return '<div class="s-row' + (V.busy[g.id] ? ' is-checking' : '') + (V.flash === g.id ? ' is-flash' : '') + '" data-id="' + App.esc(g.id) + '">' +
      '<button class="s-hit" data-check="' + App.esc(g.id) + '">' +
      '<span class="s-box">' + App.icon('check', 22) + '</span>' +
      '<span class="s-name"><b>' + App.esc(g.name) + '</b>' + (g.note ? '<small>' + App.esc(g.note) + '</small>' : '') + '</span>' +
      badge(g) +
      '</button></div>';
  }

  function listHTML() {
    if (!App.data.shopping) return '<div class="s-empty serif">Loading the list…</div>';
    var list = items(), d = got();
    return (list.length ? list.map(row).join('') : '<div class="s-empty serif">All stocked up.<br><i>Nothing left to buy.</i></div>') +
      (d.length ? '<div class="s-drawer' + (V.drawer ? ' is-open' : '') + '">' +
        '<button class="s-drawer-h" data-drawer><span>' + App.icon('check', 22) + ' Got it <b class="num">(' + d.length + ')</b></span><span class="label">' + (V.drawer ? 'Hide' : 'Last 24 h') + '</span></button>' +
        (V.drawer ? '<div class="s-drawer-list">' + d.map(function (g) {
          return '<button class="s-got" data-revive="' + App.esc(g.id) + '">' + App.esc(g.name) + '<span class="label">Put back</span></button>';
        }).join('') + '</div>' : '') +
        '</div>' : '');
  }

  // Later: "usuals" tiles (frequent items, one tap to add). Stub until there's a source for them.
  function usualsHTML() { return ''; }

  function paintHead() {
    var n = items().length;
    V.el.querySelector('.s-count').innerHTML = '<span class="num">' + n + '</span> to get';
    V.el.querySelector('.s-stores').innerHTML = tabs().map(function (t) {
      return '<button class="' + (V.store === t[0] ? 'is-on' : '') + '" data-store="' + App.esc(t[0]) + '">' + App.esc(t[0]) + ' <span class="num">' + t[1] + '</span></button>';
    }).join('');
    var input = V.el.querySelector('.s-input');
    input.placeholder = 'Add to ' + (V.store === 'All' || V.store === 'Other' ? 'the list' : V.store) + '…';
  }
  function paintList() {
    var l = V.el.querySelector('.s-list'), st = l.scrollTop;
    l.innerHTML = listHTML();
    l.scrollTop = st;
    paintHead();
  }

  function render() {
    V.el.innerHTML = '<div class="shop">' +
      '<header class="s-head"><div><div class="label">Shared list</div><h1 class="serif">Shopping</h1></div><div class="s-count"></div><div class="seg s-stores"></div></header>' +
      '<div class="s-add"><label class="s-input-wrap">' + App.icon('plus', 30) + '<input class="s-input" maxlength="120" autocomplete="off" autocapitalize="sentences" enterkeyhint="done"></label></div>' +
      '<div class="s-list"></div>' +
      '<aside class="s-side">' + usualsHTML() + '</aside>' +
      '</div>';
    var input = V.el.querySelector('.s-input');
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && input.value.trim()) add(input); });
    paintList();
  }

  function add(input) {
    var name = input.value.replace(/\s+/g, ' ').trim();
    var dupe = App.data.shopping && App.data.shopping.items.filter(function (i) { return i.name.toLowerCase() === name.toLowerCase(); })[0];
    if (dupe) { input.value = ''; flash(dupe.id); return App.toast('<b>' + App.esc(dupe.name) + '</b> is already on the list', { icon: 'cart', ms: 3000 }); }
    var store = isTab(V.store) ? V.store : null;
    input.disabled = true;
    App.api.addItem(name, store).then(function (item) {
      input.value = '';
      flash(item.id);
      App.toast('Added <b>' + App.esc(item.name) + '</b>' + (store ? ' · ' + App.esc(store) : ''), { icon: 'cart', ms: 3000 });
    }, function () {}).then(function () { input.disabled = false; if (App.current === 'shopping') input.focus(); });
  }

  function flash(id) {
    V.flash = id;
    paintList();
    var r = V.el.querySelector('.s-list [data-id="' + id + '"]');
    if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
    setTimeout(function () { if (V.flash === id) { V.flash = null; var x = V.el.querySelector('.s-row.is-flash'); if (x) x.classList.remove('is-flash'); } }, 1500);
  }

  function find(list, id) { return (list || []).filter(function (x) { return x.id === id; })[0]; }

  // Tick: strike through for a moment, then move it to Got it. A second tap in that moment cancels.
  function check(g, rowEl) {
    V.busy[g.id] = setTimeout(function () {
      delete V.busy[g.id];
      App.api.setItem(g, true).then(null, function () {});
      paintList();
    }, 900);
    rowEl.classList.add('is-checking');
  }

  function onClick(e) {
    var t, S = App.data.shopping;
    if ((t = e.target.closest('[data-check]'))) {
      var g = find(S && S.items, t.dataset.check);
      if (!g) return;
      if (V.busy[g.id]) { clearTimeout(V.busy[g.id]); delete V.busy[g.id]; t.parentNode.classList.remove('is-checking'); return; }
      return check(g, t.parentNode);
    }
    if ((t = e.target.closest('[data-store]'))) { V.store = t.dataset.store; return paintList(); }
    if ((t = e.target.closest('[data-drawer]'))) { V.drawer = !V.drawer; return paintList(); }
    if ((t = e.target.closest('[data-revive]'))) {
      var r = find(S && S.got, t.dataset.revive);
      if (!r) return;
      App.api.setItem(r, false).then(null, function () {});
      paintList();
      App.toast('Put back <b>' + App.esc(r.name) + '</b>', { icon: 'cart', ms: 2500 });
    }
  }

  App.register('shopping', {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    }
  });
  // Repaint the list only, so typing in the add field is never interrupted by a refresh.
  App.on('data', function (what) { if ((what === 'shopping' || what === 'config') && App.current === 'shopping' && V.el && V.el.firstChild) paintList(); });
  App.on('idle', function () {
    V.store = 'All'; V.drawer = false;
    var input = V.el && V.el.querySelector('.s-input');
    if (input) { input.value = ''; input.blur(); }
  });
})();
