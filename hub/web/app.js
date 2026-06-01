'use strict';
/* ConsoleGate Web UI — vanilla JS, no build step. Talks to the Hub REST API and
   subscribes to the live WebSocket stream (with a polling fallback). */

var API = '/api/v1';
var state = {
  token: localStorage.getItem('cg_token') || null,
  pinSession: localStorage.getItem('cg_pin') || null,
  consoles: [],
  schedConsole: null,
  ws: null,
  poll: null,
};

/* ---------- helpers ---------- */
function $(id) { return document.getElementById(id); }
function show(id, on) { var e = typeof id === 'string' ? $(id) : id; if (e) e.hidden = !on; }
function toast(msg) {
  var t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2500);
}
function fmtClock(ms) { return new Date(ms).toLocaleString(); }
function rel(ms) {
  if (!ms) return 'never';
  var s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  return Math.round(s / 3600) + 'h ago';
}

function api(method, path, body, usePin) {
  var headers = {};
  if (state.token) headers['authorization'] = 'Bearer ' + state.token;
  if (usePin && state.pinSession) headers['x-pin-session'] = state.pinSession;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(API + path, {
    method: method,
    headers: headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(function (res) {
    return res.text().then(function (text) {
      var json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        var err = new Error((json && json.error) || res.status);
        err.status = res.status;
        throw err;
      }
      return json;
    });
  });
}

/* ---------- auth ---------- */
function boot() {
  api('GET', '/setup').then(function (s) {
    if (!s.pinSet) { showAuth('setup'); return; }
    if (state.token) {
      api('GET', '/consoles').then(enterApp).catch(function () { showAuth('login'); });
    } else {
      showAuth('login');
    }
  }).catch(function () { showAuth('login'); });
}

function showAuth(which) {
  show('app', false); show('auth', true); show('logout', false);
  show('auth-setup', which === 'setup'); show('auth-login', which === 'login');
}

$('setup-go').onclick = function () {
  var p = $('setup-pin').value, p2 = $('setup-pin2').value;
  $('setup-err').textContent = '';
  if (p !== p2) { $('setup-err').textContent = 'PINs do not match'; return; }
  api('POST', '/setup/pin', { pin: p }).then(function () {
    return login(p);
  }).catch(function (e) { $('setup-err').textContent = String(e.message); });
};

$('login-go').onclick = function () { login($('login-pin').value); };
$('login-pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(this.value); });

function login(pin) {
  $('login-err').textContent = '';
  return api('POST', '/web/login', { pin: pin }).then(function (r) {
    state.token = r.deviceToken; state.pinSession = r.pinSession;
    localStorage.setItem('cg_token', r.deviceToken);
    localStorage.setItem('cg_pin', r.pinSession);
    return api('GET', '/consoles').then(enterApp);
  }).catch(function (e) { $('login-err').textContent = e.status === 401 ? 'Wrong PIN' : String(e.message); });
}

$('logout').onclick = function () {
  localStorage.removeItem('cg_token'); localStorage.removeItem('cg_pin');
  state.token = null; state.pinSession = null;
  if (state.ws) state.ws.close();
  showAuth('login');
};

function onAuthError(e) {
  if (e && (e.status === 401 || e.status === 403)) { toast('Session expired — please log in'); $('logout').onclick(); }
  else toast(String(e && e.message || e));
}

/* ---------- app shell ---------- */
function enterApp(consolesResp) {
  show('auth', false); show('app', true); show('logout', true);
  state.consoles = consolesResp.consoles || [];
  renderDashboard();
  loadRequests();
  populateSchedConsoles();
  loadEvents();
  loadSystem();
  connectStream();
}

var tabs = document.querySelectorAll('.tabs button');
for (var i = 0; i < tabs.length; i++) {
  tabs[i].onclick = function () {
    for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
    this.classList.add('active');
    var name = this.getAttribute('data-tab');
    ['dashboard', 'schedule', 'events', 'system'].forEach(function (t) { show('tab-' + t, t === name); });
    if (name === 'system') loadSystem();
    if (name === 'events') loadEvents();
  };
}

/* ---------- dashboard ---------- */
function refreshConsoles() {
  return api('GET', '/consoles').then(function (r) {
    state.consoles = r.consoles || [];
    renderDashboard();
  }).catch(function () {});
}

function renderDashboard() {
  var wrap = $('cards'); wrap.innerHTML = '';
  show('no-consoles', state.consoles.length === 0);
  state.consoles.forEach(function (c) {
    wrap.appendChild(consoleCard(c));
  });
}

function consoleCard(c) {
  var con = c.console, e = c.effective, q = c.quota;
  var card = document.createElement('div'); card.className = 'console';
  var h = document.createElement('h3');
  h.appendChild(document.createTextNode(con.name + ' '));
  var badge = document.createElement('span'); badge.className = 'badge ' + e.state; badge.textContent = e.state;
  h.appendChild(badge);
  card.appendChild(h);

  var sub = document.createElement('div'); sub.className = 'muted';
  sub.textContent = con.kind + ' · ' + e.reason + ' · agent ' + rel(con.lastSeen);
  card.appendChild(sub);

  var kvs = document.createElement('div'); kvs.className = 'kvs';
  var used = q.minutesUsed, total = q.quotaTotalMin;
  kvs.appendChild(kv('Played today', used + ' / ' + total + ' min'));
  kvs.appendChild(kv('Remaining', e.quotaRemainingMin + ' min'));
  kvs.appendChild(kv('Enforcement', e.enforcement));
  card.appendChild(kvs);

  var bar = document.createElement('div'); bar.className = 'bar';
  var fill = document.createElement('i');
  fill.style.width = Math.min(100, total ? (used / total) * 100 : 0) + '%';
  bar.appendChild(fill); card.appendChild(bar);

  var actions = document.createElement('div'); actions.className = 'actions';
  actions.appendChild(btn('Lock now', function () { act(con.id, 'lock'); }));
  actions.appendChild(btn('Unlock', function () { act(con.id, 'unlock'); }));
  actions.appendChild(btn('Pause', function () { act(con.id, 'pause'); }));
  actions.appendChild(btn('Resume', function () { act(con.id, 'resume'); }));
  actions.appendChild(btn('+15 min', function () { grant(con.id, 15); }));
  actions.appendChild(btn('Bonus…', function () {
    var m = prompt('Bonus minutes for today:', '30'); if (m) grant(con.id, parseInt(m, 10));
  }));
  card.appendChild(actions);
  return card;
}

function kv(k, v) {
  var d = document.createElement('div');
  var a = document.createElement('span'); a.textContent = k;
  var b = document.createElement('span'); b.textContent = v;
  d.appendChild(a); d.appendChild(b); return d;
}
function btn(label, fn) { var b = document.createElement('button'); b.className = 'sm'; b.textContent = label; b.onclick = fn; return b; }

function act(id, action) {
  api('POST', '/consoles/' + id + '/' + action, {}, true)
    .then(function () { toast(action + ' sent'); refreshConsoles(); })
    .catch(onAuthError);
}
function grant(id, minutes) {
  if (!minutes || minutes < 1) return;
  api('POST', '/consoles/' + id + '/grant', { minutes: minutes }, true)
    .then(function () { toast('Granted ' + minutes + ' min'); refreshConsoles(); })
    .catch(onAuthError);
}

/* ---------- requests ---------- */
function loadRequests() {
  api('GET', '/requests?status=pending').then(function (r) {
    var wrap = $('requests'); wrap.innerHTML = '';
    (r.requests || []).forEach(function (req) {
      var name = (state.consoles.find(function (c) { return c.console.id === req.consoleId; }) || {}).console;
      var d = document.createElement('div'); d.className = 'req';
      var t = document.createElement('span');
      t.textContent = '⏱ ' + (name ? name.name : req.consoleId) + ' requests +' + req.minutes + ' min' + (req.reason ? ' (“' + req.reason + '”)' : '');
      d.appendChild(t);
      d.appendChild(btn('Approve', function () { resolveReq(req.id, 'approve'); }));
      d.appendChild(btn('Deny', function () { resolveReq(req.id, 'deny'); }));
      wrap.appendChild(d);
    });
  }).catch(function () {});
}
function resolveReq(id, action) {
  api('POST', '/requests/' + id + '/' + action, {}, true)
    .then(function () { toast('Request ' + action + 'd'); loadRequests(); refreshConsoles(); })
    .catch(onAuthError);
}

/* ---------- schedule + flags ---------- */
function populateSchedConsoles() {
  var sel = $('sched-console'); sel.innerHTML = '';
  state.consoles.forEach(function (c) {
    var o = document.createElement('option'); o.value = c.console.id; o.textContent = c.console.name; sel.appendChild(o);
  });
  sel.onchange = function () { loadSchedule(this.value); };
  if (state.consoles.length) loadSchedule(state.consoles[0].console.id);
}

var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function loadSchedule(consoleId) {
  state.schedConsole = consoleId;
  Promise.all([api('GET', '/schedule/' + consoleId), api('GET', '/flags/' + consoleId)])
    .then(function (res) { renderSchedule(res[0], res[1]); }).catch(onAuthError);
}

function renderSchedule(sched, flags) {
  var box = $('sched-editor'); box.innerHTML = '';
  DAYS.forEach(function (d) {
    var day = sched.days[d];
    var row = document.createElement('div'); row.className = 'day';
    var lab = document.createElement('label'); lab.textContent = d; row.appendChild(lab);
    var win = document.createElement('input'); win.id = 'win-' + d;
    win.value = (day.windows || []).map(function (w) { return w.start + '-' + w.end; }).join(', ');
    win.placeholder = '08:00-21:00, 16:00-18:00'; row.appendChild(win);
    var q = document.createElement('input'); q.id = 'q-' + d; q.type = 'number'; q.value = day.quotaMin; row.appendChild(q);
    box.appendChild(row);
  });

  var tz = inputRow('Timezone', 'sched-tz', sched.tz, 'text');
  box.appendChild(tz);
  var enf = document.createElement('div'); enf.className = 'row';
  enf.appendChild(document.createTextNode('Enforcement '));
  var sel = document.createElement('select'); sel.id = 'sched-enf';
  ['hard', 'soft'].forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v; if (flags.enforcement === v) o.selected = true; sel.appendChild(o); });
  enf.appendChild(sel); box.appendChild(enf);

  box.appendChild(inputRow('Warn thresholds (min, comma)', 'sched-warn', (flags.warnThresholdsMin || []).join(','), 'text'));
  box.appendChild(inputRow('Grace seconds', 'sched-grace', flags.graceSeconds, 'number'));
  box.appendChild(inputRow('Wii min session (min)', 'sched-wiimin', flags.wiiMinSessionMin, 'number'));

  var wb = document.createElement('label'); wb.className = 'row';
  var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'sched-wiiblock'; cb.checked = !!flags.wiiBlockUnfinishable;
  cb.style.width = 'auto';
  wb.appendChild(cb); wb.appendChild(document.createTextNode(' Block Wii launches that can’t finish before downtime'));
  box.appendChild(wb);

  var save = document.createElement('button'); save.textContent = 'Save schedule'; save.onclick = saveSchedule;
  box.appendChild(save);
}

function inputRow(label, id, val, type) {
  var r = document.createElement('div'); r.className = 'row';
  r.appendChild(document.createTextNode(label + ' '));
  var inp = document.createElement('input'); inp.id = id; inp.type = type || 'text'; inp.value = val;
  r.appendChild(inp); return r;
}

function parseWindows(s) {
  return s.split(',').map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) {
    var m = p.split('-'); return { start: (m[0] || '').trim(), end: (m[1] || '').trim() };
  });
}

function saveSchedule() {
  var id = state.schedConsole;
  var days = {};
  DAYS.forEach(function (d) {
    days[d] = { windows: parseWindows($('win-' + d).value), quotaMin: parseInt($('q-' + d).value, 10) || 0 };
  });
  var sched = { days: days, tz: $('sched-tz').value.trim() };
  var flags = {
    enforcement: $('sched-enf').value,
    warnThresholdsMin: $('sched-warn').value.split(',').map(function (x) { return parseInt(x.trim(), 10); }).filter(function (n) { return !isNaN(n); }),
    graceSeconds: parseInt($('sched-grace').value, 10) || 0,
    wiiMinSessionMin: parseInt($('sched-wiimin').value, 10) || 0,
    wiiBlockUnfinishable: $('sched-wiiblock').checked,
  };
  Promise.all([
    api('PUT', '/schedule/' + id, sched, true),
    api('PUT', '/flags/' + id, flags, true),
  ]).then(function () { toast('Schedule saved'); refreshConsoles(); }).catch(onAuthError);
}

/* ---------- events ---------- */
function loadEvents() {
  api('GET', '/events?limit=200').then(function (r) {
    var list = $('event-list'); list.innerHTML = '';
    (r.events || []).forEach(function (e) { list.appendChild(eventRow(e)); });
  }).catch(function () {});
}
function eventRow(e) {
  var li = document.createElement('li');
  if (e.severity === 'warn') li.className = 'warn';
  if (e.severity === 'crit') li.className = 'crit';
  var t = document.createElement('span'); t.className = 'etime'; t.textContent = fmtClock(e.ts);
  var ty = document.createElement('span'); ty.className = 'etype'; ty.textContent = e.type;
  var d = document.createElement('span'); d.textContent = e.data && Object.keys(e.data).length ? JSON.stringify(e.data) : '';
  li.appendChild(t); li.appendChild(ty); li.appendChild(d);
  return li;
}
$('verify-log').onclick = function () {
  api('GET', '/system/verify-log', undefined, true).then(function (v) {
    $('verify-out').textContent = v.ok ? '✓ intact (' + v.count + ' records)' : '✗ TAMPERED at #' + v.brokenAt + ' (' + v.reason + ')';
  }).catch(onAuthError);
};

/* ---------- system ---------- */
function loadSystem() {
  api('GET', '/time').then(function (t) {
    $('time-status').textContent = 'Authoritative: ' + fmtClock(t.utcMs) + ' · source ' + t.source +
      (t.lastSync ? ' · synced ' + rel(t.lastSync) : ' · not yet synced');
  }).catch(function () {});
  api('GET', '/analytics/summary').then(renderAnalytics).catch(function () {});
}
$('time-refresh').onclick = function () {
  api('POST', '/time/refresh', {}, true).then(function (t) { toast('Time resynced (' + t.source + ')'); loadSystem(); }).catch(onAuthError);
};
$('pair-start').onclick = function () {
  api('POST', '/pair/start', {}, true).then(function (r) {
    var out = $('pair-out'); out.innerHTML = '';
    var c = document.createElement('div'); c.className = 'code'; c.textContent = r.code; out.appendChild(c);
  }).catch(onAuthError);
};
function renderAnalytics(a) {
  var box = $('analytics'); box.innerHTML = '';
  (a.consoles || []).forEach(function (c) {
    var d = document.createElement('div'); d.className = 'kvs';
    d.appendChild(kv(c.name, c.totalMinutesPlayed + ' min total'));
    d.appendChild(kv('Overage incidents', String(c.overageIncidents)));
    d.appendChild(kv('Bonuses granted', String(c.bonusesGranted)));
    box.appendChild(d);
  });
}

/* ---------- live stream ---------- */
function connectStream() {
  if (!state.token) return;
  if (state.ws) { try { state.ws.close(); } catch (e) {} }
  var proto = location.protocol === 'https:' ? 'wss' : 'ws';
  var url = proto + '://' + location.host + API + '/stream?token=' + encodeURIComponent(state.token);
  try {
    var ws = new WebSocket(url);
    state.ws = ws;
    ws.onopen = function () { $('conn').textContent = 'live'; $('conn').className = 'conn live'; stopPolling(); };
    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.kind === 'event') { $('event-list').insertBefore(eventRow(msg.event), $('event-list').firstChild); refreshConsoles(); loadRequests(); }
      else if (msg.kind === 'state') { refreshConsoles(); }
    };
    ws.onclose = function () { $('conn').textContent = 'offline'; $('conn').className = 'conn'; startPolling(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  } catch (e) { startPolling(); }
}
function startPolling() {
  if (state.poll || !state.token) return;
  state.poll = setInterval(function () { refreshConsoles(); loadRequests(); loadEvents(); }, 5000);
}
function stopPolling() { if (state.poll) { clearInterval(state.poll); state.poll = null; } }

boot();
