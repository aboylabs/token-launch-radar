/* Token Radar dashboard — vanilla JS, no network. Reads window.RADAR (data.js),
   renders the ranked board, filters, sorting, live-token view and a per-protocol
   detail that recomputes the implied value from the row's own figures. */
(function () {
  'use strict';
  var D = window.RADAR;
  var M = (D && D.model) || {};
  var ROWS = (D && D.rows) || [];
  var LIVE = (D && D.live) || [];
  var MAXV = ROWS.reduce(function (m, r) { return Math.max(m, r.implied_value_usd || 0); }, 0) || 1;

  var state = { tab: 'pre', q: '', cat: 'all', chain: 'all', wl: false,
    sort: 'implied_value_usd', dir: -1, detail: null };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null || !isFinite(n)) return '<span class="flat">n/a</span>';
    var c = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return '<span class="' + c + '">' + (n > 0 ? '+' : '') + n.toFixed(2) + '%</span>';
  }
  function age(d) {
    if (d == null) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  }
  function num(n, d) { return (n == null || !isFinite(n)) ? 'n/a' : n.toFixed(d == null ? 4 : d); }

  /* The model, recomputed in the page from the row's own figures. */
  function recompute(r) {
    var m = M;
    var ref = (r.ref_multiple != null) ? r.ref_multiple : m.global_ref_multiple;
    var disc = (m.pre_token_discount != null) ? m.pre_token_discount : 0.6;
    var raw = (r.change_7d == null) ? 0 : r.change_7d;
    var g = Math.min(m.growth_cap != null ? m.growth_cap : 150,
      Math.max(m.growth_floor != null ? m.growth_floor : -50, raw));
    var gMult = 1 + (g / 100) * (m.growth_weight != null ? m.growth_weight : 0.6);
    var a = (r.age_days == null) ? (m.unknown_age_days != null ? m.unknown_age_days : 365) : r.age_days;
    var mat = (m.maturity_floor != null ? m.maturity_floor : 0.7) +
      (Math.min(Math.max(a, 0), m.maturity_days || 1095) / (m.maturity_days || 1095)) *
      (m.maturity_range != null ? m.maturity_range : 0.3);
    var extra = Math.max(0, (r.chains || []).length - 1);
    var cMult = 1 + Math.min(extra, m.chain_max != null ? m.chain_max : 5) *
      (m.chain_step != null ? m.chain_step : 0.04);
    var implied = Math.max(1, Math.round(r.tvl_usd * ref * disc * gMult * mat * cMult));
    return { ref: ref, disc: disc, growthPct: g, growthMult: gMult, ageUsed: a,
      maturity: mat, chainMult: cMult, implied: implied,
      match: implied === r.implied_value_usd };
  }

  /* ---- hash state: #/detail/<slug> or #tab=..&q=..&cat=..&chain=..&wl=1&sort=..&dir=.. ---- */
  function readHash() {
    var h = location.hash.replace(/^#\/?/, '');
    if (h.indexOf('detail/') === 0) { state.detail = decodeURIComponent(h.slice(7)); return; }
    state.detail = null;
    var p = new URLSearchParams(h);
    if (p.get('tab')) state.tab = p.get('tab') === 'live' ? 'live' : 'pre';
    state.q = p.get('q') || ''; state.cat = p.get('cat') || 'all';
    state.chain = p.get('chain') || 'all'; state.wl = p.get('wl') === '1';
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = p.get('dir') === '1' ? 1 : -1;
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.detail) { history.replaceState(null, '', '#/detail/' + encodeURIComponent(state.detail)); return; }
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.wl) p.set('wl', '1');
    if (state.sort !== 'implied_value_usd') p.set('sort', state.sort);
    if (state.dir !== -1) p.set('dir', String(state.dir));
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  /* ---- static summaries ---- */
  function renderMeta() {
    $('stat-asof').textContent = D.as_of || 'n/a';
    $('stat-board').textContent = String(D.board_size || ROWS.length);
    $('stat-watch').textContent = (D.watchlist_size || 0) + ' / ' + (D.watchlist_size || 0);
    $('stat-tvl').textContent = usd(ROWS.reduce(function (s, r) { return s + (r.tvl_usd || 0); }, 0));
    $('stat-live').textContent = String(D.live_size || LIVE.length);
    $('stat-source').textContent = 'Source: ' + (D.source || 'snapshot') +
      ' · floor $' + ((D.floor_usd || 0).toLocaleString('en-US')) + ' · model ' + (D.model_version || '');
    $('global-ref').textContent = num(M.global_ref_multiple, 3);
    var cats = Object.keys(D.ref_multiples || {}).sort(function (a, b) {
      return (D.ref_multiples[b] || 0) - (D.ref_multiples[a] || 0);
    }).slice(0, 10);
    $('calib').querySelector('tbody').innerHTML = cats.map(function (c) {
      return '<tr><td>' + esc(c) + '</td><td class="num">' + num(D.ref_multiples[c], 3) + '&times;</td></tr>';
    }).join('') || '<tr><td colspan="2">No calibration data.</td></tr>';
  }

  function fillSelects() {
    var cats = {}, chains = {};
    ROWS.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      (r.chains || []).forEach(function (c) { chains[c] = 1; });
    });
    var co = $('f-cat'), ch = $('f-chain');
    Object.keys(cats).sort().forEach(function (c) {
      co.insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');
    });
    Object.keys(chains).sort().forEach(function (c) {
      ch.insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');
    });
  }

  /* ---- filtering + sorting ---- */
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = ROWS.filter(function (r) {
      if (q && (r.name || '').toLowerCase().indexOf(q) < 0 && (r.slug || '').toLowerCase().indexOf(q) < 0) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.wl && !r.watchlist) return false;
      return true;
    });
    var k = state.sort, d = state.dir;
    list.sort(function (a, b) {
      var av = a[k], bv = b[k];
      if (k === 'name') return d * String(av || '').localeCompare(String(bv || ''));
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1;
      return d * (av - bv);
    });
    return list;
  }
  function filteredLive() {
    var q = state.q.trim().toLowerCase();
    return LIVE.filter(function (r) {
      if (q && (r.name || '').toLowerCase().indexOf(q) < 0 && (r.slug || '').toLowerCase().indexOf(q) < 0) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      return true;
    });
  }

  function renderBoard() {
    var list = filtered();
    var tb = $('board').querySelector('tbody');
    tb.innerHTML = list.map(function (r) {
      var w = Math.max(2, Math.round((r.implied_value_usd / MAXV) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="pname">' + (r.watchlist ? '★ ' : '') + esc(r.name) + '</div><div class="pslug">' + esc(r.slug) + '</div></td>' +
        '<td><span class="badge">' + esc(r.category || 'uncategorised') + '</span></td>' +
        '<td class="chip">' + esc((r.chains || []).join(', ') || '—') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num">' + usd(r.implied_value_usd) + '<div class="bar"><i style="width:' + w + '%"></i></div></td></tr>';
    }).join('') || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
    $('count').textContent = 'Showing ' + list.length + ' of ' + ROWS.length + ' pre-token protocols' +
      (state.wl ? ' (watchlist only)' : '') + '. Click a row for its model breakdown and farm plan.';
    document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
      var on = th.getAttribute('data-sort') === state.sort;
      th.classList.toggle('sorted', on);
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (on ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
    });
  }

  function renderLive() {
    var list = filteredLive();
    $('live').querySelector('tbody').innerHTML = list.map(function (r) {
      return '<tr><td><div class="pname">' + esc(r.name) + '</div><div class="pslug">' + esc(r.slug) + '</div></td>' +
        '<td><span class="badge">' + esc(r.category || 'uncategorised') + '</span></td>' +
        '<td class="chip">' + esc((r.chains || []).join(', ') || '—') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + usd(r.mcap_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('') || '<tr><td colspan="6">No live tokens match these filters.</td></tr>';
    $('count').textContent = 'Showing ' + list.length + ' of ' + LIVE.length +
      ' live tokens at market value — not ranked, not on the board.';
  }

  /* ---- detail ---- */
  function renderDetail() {
    var sec = $('detail'), body = $('detail-body');
    if (!state.detail) { sec.hidden = true; body.innerHTML = ''; return; }
    var r = null;
    ROWS.forEach(function (x) { if (x.slug === state.detail) r = x; });
    sec.hidden = false;
    if (!r) { body.innerHTML = '<p>Protocol <b>' + esc(state.detail) + '</b> is not on this board.</p>'; return; }
    var c = recompute(r);
    var steps = (r.farm_steps || []).map(function (s) {
      var t = esc(s).replace(/ Cost: /g, ' <b>Cost:</b> ').replace(/ Time: /g, ' <b>Time:</b> ');
      return '<li>' + t + '</li>';
    }).join('');
    body.innerHTML =
      '<div class="d-head"><h2>' + esc(r.name) + '</h2><span class="badge">' + esc(r.category || 'uncategorised') + '</span>' +
      (r.watchlist ? '<span class="badge">★ watchlist</span>' : '') +
      '<span class="d-meta">rank #' + r.rank + ' · ' + esc(r.slug) + ' · ' + esc((r.chains || []).join(', ')) + '</span></div>' +
      '<p class="note">This protocol records no token (no market cap, no CoinGecko id, no symbol in the snapshot) — ' +
      'the value below is implied, not a market price.</p>' +
      '<dl class="d-grid">' +
      '<div><dt>TVL</dt><dd>' + usd(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + (r.change_7d == null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</dd></div>' +
      '<div><dt>Age</dt><dd>' + age(r.age_days) + (r.listed_at ? ' · since ' + esc(r.listed_at) : '') + '</dd></div>' +
      '<div><dt>Implied value</dt><dd>' + usd(r.implied_value_usd) + '</dd></div></dl>' +
      '<h3>Model breakdown — recomputed in this page</h3>' +
      '<table class="math"><thead><tr><th>Factor</th><th>Input</th><th class="num">Value</th></tr></thead><tbody>' +
      '<tr><td>TVL</td><td>snapshot TVL</td><td class="num">' + usd(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Ref multiple (' + esc(r.category || 'global') + ')</td><td>median mcap / TVL of listed peers</td><td class="num">' + num(c.ref, 3) + '&times;</td></tr>' +
      '<tr><td>Pre-token discount</td><td>fixed by model radar-2</td><td class="num">&times; ' + num(c.disc, 2) + '</td></tr>' +
      '<tr><td>Growth</td><td>7d ' + (r.change_7d == null ? 'n/a → 0%' : r.change_7d.toFixed(2) + '%') + ', clamped to ' + c.growthPct.toFixed(2) + '%</td><td class="num">&times; ' + num(c.growthMult) + '</td></tr>' +
      '<tr><td>Maturity</td><td>age ' + (r.age_days == null ? 'unknown → ' : '') + c.ageUsed + 'd of ' + (M.maturity_days || 1095) + 'd</td><td class="num">&times; ' + num(c.maturity) + '</td></tr>' +
      '<tr><td>Chain</td><td>' + (r.chains || []).length + ' chain(s), +' + num((c.chainMult - 1) * 100, 0) + '%</td><td class="num">&times; ' + num(c.chainMult) + '</td></tr>' +
      '<tr class="total"><td>Implied value (recomputed)</td><td>TVL &times; ref &times; 0.6 &times; growth &times; maturity &times; chain</td><td class="num">' + usd(c.implied) + '</td></tr>' +
      '<tr><td>Implied value (board)</td><td>as ranked</td><td class="num">' + usd(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p>Recompute check: ' + (c.match
        ? '<span class="ok">&#10003; matches the board value</span>'
        : '<span class="bad">&#10007; differs from the board value (' + usd(c.implied) + ' vs ' + usd(r.implied_value_usd) + ')</span>') + '</p>' +
      '<h3>Farm plan — six steps</h3><ol class="farm">' + steps + '</ol>';
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function render() {
    $('tab-pre').setAttribute('aria-selected', state.tab === 'pre' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
    $('board-view').hidden = state.tab !== 'pre';
    $('live-view').hidden = state.tab !== 'live';
    $('f-q').value = state.q; $('f-cat').value = state.cat;
    $('f-chain').value = state.chain; $('f-wl').checked = state.wl;
    if (state.tab === 'pre') renderBoard(); else renderLive();
    renderDetail();
  }

  /* ---- wiring ---- */
  if (!D) {
    document.querySelector('main').insertAdjacentHTML('afterbegin',
      '<p class="live-note">No data loaded: data.js did not provide window.RADAR.</p>');
    return;
  }
  renderMeta(); fillSelects(); readHash(); render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  $('f-q').addEventListener('input', function (e) { state.q = e.target.value; state.detail = null; writeHash(); render(); });
  $('f-cat').addEventListener('change', function (e) { state.cat = e.target.value; state.detail = null; writeHash(); render(); });
  $('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; state.detail = null; writeHash(); render(); });
  $('f-wl').addEventListener('change', function (e) { state.wl = e.target.checked; state.detail = null; writeHash(); render(); });
  $('f-clear').addEventListener('click', function () {
    state.q = ''; state.cat = 'all'; state.chain = 'all'; state.wl = false; state.detail = null;
    writeHash(); render();
  });
  $('tab-pre').addEventListener('click', function () { state.tab = 'pre'; state.detail = null; writeHash(); render(); });
  $('tab-live').addEventListener('click', function () { state.tab = 'live'; state.detail = null; writeHash(); render(); });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = (k === 'name') ? 1 : -1; }
      writeHash(); render();
    });
  });
  $('board').querySelector('tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.detail = tr.getAttribute('data-slug');
    writeHash(); render();
  });
  $('detail-close').addEventListener('click', function () {
    state.detail = null; writeHash(); render();
    $('board-sec').scrollIntoView({ behavior: 'smooth' });
  });
})();
