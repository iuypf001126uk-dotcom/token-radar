// Token Launch Radar (model radar-2). Reads window.RADAR, written beside dashboard/ by main.ts,
// and renders the ranked board, a filterable and sortable table, a per-protocol detail view with
// the model's own arithmetic and the protocol's farm plan, and the live-token set the category
// multiples are read from. No network: every byte it shows is in data.js. State lives in the URL
// hash (#q=, #cat=, #chain=, #min=, #watch=1, #sort=, #p=<slug>) so any view can be linked.
(function () {
  'use strict';
  var D = window.RADAR;
  var main = document.getElementById('board');
  if (!D || !D.rows) { main.innerHTML = '<p class="empty">No radar data: run main.ts first.</p>'; return; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(v) {
    if (v == null) return '<span class="flat">—</span>';
    var cls = v > 0 ? 'up' : (v < 0 ? 'down' : 'flat');
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageFmt(days) {
    if (days == null) return '—';
    if (days < 365) return days + 'd';
    var y = Math.floor(days / 365), r = days % 365;
    return y + 'y ' + r + 'd';
  }
  function mult(x) { return '×' + Number(x).toFixed(2); }

  // ---- state -------------------------------------------------------------
  function readHash() {
    var s = { q: '', cat: '', chain: '', min: 0, watch: false, sort: 'rank', dir: 1, p: '' };
    var h = location.hash.replace(/^#/, '');
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (k === 'q') s.q = v; else if (k === 'cat') s.cat = v; else if (k === 'chain') s.chain = v;
      else if (k === 'min') s.min = Number(v) || 0; else if (k === 'watch') s.watch = v === '1';
      else if (k === 'sort') s.sort = v; else if (k === 'dir') s.dir = v === '-1' ? -1 : 1;
      else if (k === 'p') s.p = v;
    });
    return s;
  }
  var S = readHash();
  function writeHash() {
    var parts = [];
    if (S.q) parts.push('q=' + encodeURIComponent(S.q));
    if (S.cat) parts.push('cat=' + encodeURIComponent(S.cat));
    if (S.chain) parts.push('chain=' + encodeURIComponent(S.chain));
    if (S.min) parts.push('min=' + S.min);
    if (S.watch) parts.push('watch=1');
    if (S.sort !== 'rank') parts.push('sort=' + S.sort);
    if (S.dir === -1) parts.push('dir=-1');
    if (S.p) parts.push('p=' + encodeURIComponent(S.p));
    history.replaceState(null, '', '#' + parts.join('&'));
  }

  // ---- static frame --------------------------------------------------------
  var cats = [], chainsSeen = {};
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { chainsSeen[c] = true; });
  });
  cats.sort();
  var chainNames = Object.keys(chainsSeen).sort();
  var topMults = D.category_multiples.slice(0, 10);

  var html = '';
  html += '<header class="hero"><p class="eyebrow">Token Launch Radar · model ' + esc(D.model_version) + '</p>'
    + '<h1>Protocols with no token yet, ranked by what their launch would be worth</h1>'
    + '<p class="lede">Every protocol in the snapshot that <b>records no token</b> — no market cap, no CoinGecko id, no ticker — '
    + 'is scored by one stated model and ranked by <b>implied value</b>. The house watchlist is the floor, not the ceiling: '
    + 'the board also carries the early protocols below it. Protocols whose token already trades are kept apart, at the foot of the page, '
    + 'because their value is the market\u2019s, not a model\u2019s.</p>'
    + '<div class="stats">'
    + '<div class="stat"><div class="n">' + D.board_size + '</div><div class="l">protocols ranked</div></div>'
    + '<div class="stat"><div class="n">' + D.watchlist_size + ' / ' + D.watchlist_size + '</div><div class="l">watchlist covered</div></div>'
    + '<div class="stat"><div class="n">' + D.early_size + '</div><div class="l">early, below the floor</div></div>'
    + '<div class="stat"><div class="n">' + money(D.rows.reduce(function (a, r) { return a + r.tvl_usd; }, 0)) + '</div><div class="l">combined TVL ranked</div></div>'
    + '<div class="stat"><div class="n">' + D.as_of + '</div><div class="l">snapshot date</div></div>'
    + '</div></header>';

  html += '<section class="panel"><h2>How the implied value is worked out</h2>'
    + '<p>One formula for every row, from the snapshot\u2019s own figures only. The base multiple is not a guess: for each category it is the '
    + '<b>median market-cap / TVL of that category\u2019s already-trading protocols in this same snapshot</b>, shrunk toward the global median '
    + '(' + D.global_multiple.toFixed(2) + '×) when a category has few trading members, and clamped to 0.05–2.50×. Growth uses the 7-day TVL '
    + 'change clamped to −60%…+120% at half weight; maturity rewards a longer record of running with no token (0.60× on day one, 1.00× at three years); '
    + 'reach adds 4% per extra chain, up to five. No protocol name is ever special-cased.</p>'
    + '<p class="formula">implied value = TVL × category multiple × (1 + clamped 7d growth × 0.5) × maturity × (1 + 4% × extra chains)</p>'
    + '<table class="mults"><tr><th>Category</th><th>Multiple</th><th>Trading members it is read from</th></tr>'
    + topMults.map(function (m) { return '<tr><td>' + esc(m.category) + '</td><td>' + m.multiple.toFixed(2) + '×</td><td>' + m.live_count + '</td></tr>'; }).join('')
    + '</table></section>';

  html += '<div class="controls">'
    + '<label>Search<input id="f-q" type="search" placeholder="Protocol name" value="' + esc(S.q) + '"></label>'
    + '<label>Category<select id="f-cat"><option value="">All categories</option>'
    + cats.map(function (c) { return '<option' + (S.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>'
    + '<label>Chain<select id="f-chain"><option value="">All chains</option>'
    + chainNames.map(function (c) { return '<option' + (S.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>'
    + '<label>Min TVL<select id="f-min">'
    + [[0, 'Any TVL'], [1e6, '$1M'], [1e7, '$10M'], [5e7, '$50M (watchlist floor)'], [1e8, '$100M'], [1e9, '$1B']].map(function (o) {
        return '<option value="' + o[0] + '"' + (S.min === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>'
    + '<label class="check"><input id="f-watch" type="checkbox"' + (S.watch ? ' checked' : '') + '> Watchlist only</label>'
    + '</div>'
    + '<p class="count" id="count"></p>'
    + '<div id="detail"></div>'
    + '<div style="overflow-x:auto"><table class="board" id="board-table"><thead><tr>'
    + '<th data-k="rank" class="l">Rank</th><th data-k="name" class="l">Protocol</th><th data-k="cat" class="l">Category</th>'
    + '<th data-k="chains" class="l">Chains</th><th data-k="tvl">TVL</th><th data-k="change">7d change</th>'
    + '<th data-k="age">Age</th><th data-k="iv">Implied value</th><th data-k="mult">IV / TVL</th>'
    + '</tr></thead><tbody id="tbody"></tbody></table></div>';

  html += '<section class="panel"><h2>Already trading — the market\u2019s own values</h2>'
    + '<p class="live-note">These protocols record a token, so they are never ranked by the model. They are shown because they are the '
    + 'evidence the category multiples come from: the multiple for a category is the median of this set\u2019s market-cap / TVL, category by category.</p>'
    + '<div style="overflow-x:auto"><table class="board"><thead><tr><th class="l">Protocol</th><th class="l">Category</th>'
    + '<th>Market cap</th><th>TVL</th><th>MCap / TVL</th><th>7d change</th></tr></thead><tbody>'
    + D.live.map(function (r) {
        return '<tr><td class="l name">' + esc(r.name) + '</td><td class="l cat">' + esc(r.category || '—') + '</td>'
          + '<td class="num">' + money(r.mcap_usd) + '</td><td class="num">' + money(r.tvl_usd) + '</td>'
          + '<td class="num">' + (r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : '—') + '</td><td>' + pct(r.change_7d) + '</td></tr>';
      }).join('')
    + '</tbody></table></div></section>';

  html += '<footer>Data: ' + esc(D.source) + ' · Snapshot as of ' + esc(D.as_of) + ', frozen: every run of this page reads the same bytes. '
    + '“Records no token” is what the snapshot says, not proof a token does not exist. Implied value is this model\u2019s claim about what a launch '
    + 'would be worth if the protocol\u2019s record stayed as it is; it is not a prediction that a token will be issued. Farm plans are starting '
    + 'points: check the protocol\u2019s own pages before moving funds.</footer>';

  main.innerHTML = html;
  main.setAttribute('aria-busy', 'false');

  // ---- board ---------------------------------------------------------------
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var tbody = document.getElementById('tbody');
  var count = document.getElementById('count');

  function filtered() {
    var q = S.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (S.cat && r.category !== S.cat) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (S.min && r.tvl_usd < S.min) return false;
      if (S.watch && !r.on_watchlist) return false;
      return true;
    });
    var k = S.sort, dir = S.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (k === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (k === 'cat') { va = (a.category || '').toLowerCase(); vb = (b.category || '').toLowerCase(); }
      else if (k === 'chains') { va = a.chains.length; vb = b.chains.length; }
      else if (k === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (k === 'change') { va = a.change_7d == null ? -1e9 : a.change_7d; vb = b.change_7d == null ? -1e9 : b.change_7d; }
      else if (k === 'age') { va = a.age_days == null ? -1 : a.age_days; vb = b.age_days == null ? -1 : b.age_days; }
      else if (k === 'iv') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (k === 'mult') { va = a.implied_value_usd / a.tvl_usd; vb = b.implied_value_usd / b.tvl_usd; }
      else { va = a.rank; vb = b.rank; }
      if (va < vb) return -1 * dir; if (va > vb) return 1 * dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function renderBoard() {
    var rows = filtered();
    count.innerHTML = 'Showing <b>' + rows.length + '</b> of ' + D.board_size + ' ranked protocols'
      + (S.watch ? ' · watchlist only' : '') + (S.cat ? ' · category: ' + esc(S.cat) : '') + (S.chain ? ' · chain: ' + esc(S.chain) : '');
    if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="9" class="empty">No protocol matches these filters.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function (r) {
      var chainTxt = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      if (chainTxt.length > 24) chainTxt = r.chains[0] + ' +' + (r.chains.length - 1);
      return '<tr data-slug="' + esc(r.slug) + '"' + (S.p === r.slug ? ' class="sel"' : '') + '>'
        + '<td class="l rank">#' + r.rank + '</td>'
        + '<td class="l"><span class="name">' + esc(r.name) + '</span>' + (r.on_watchlist ? '<span class="star">watchlist</span>' : '') + '</td>'
        + '<td class="l cat">' + esc(r.category || '—') + '</td>'
        + '<td class="l chains">' + esc(chainTxt || '—') + '</td>'
        + '<td class="num">' + money(r.tvl_usd) + '</td>'
        + '<td>' + pct(r.change_7d) + '</td>'
        + '<td class="num">' + ageFmt(r.age_days) + '</td>'
        + '<td class="num iv">' + money(r.implied_value_usd) + '</td>'
        + '<td class="num">' + (r.implied_value_usd / r.tvl_usd).toFixed(2) + '×</td></tr>';
    }).join('');
    Array.prototype.forEach.call(tbody.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        S.p = tr.getAttribute('data-slug'); writeHash(); renderBoard(); renderDetail(true);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('th[data-k]'), function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-k') === S.sort);
    });
  }

  // ---- detail ----------------------------------------------------------------
  var detail = document.getElementById('detail');
  function bar(label, value, scale, text) {
    var w = Math.max(2, Math.min(100, (value / scale) * 100));
    return '<div class="bar"><span class="bl">' + label + '</span><span class="track"><span class="fill" style="width:' + w + '%"></span></span><span class="bv">' + text + '</span></div>';
  }
  function renderDetail(scroll) {
    var r = bySlug[S.p];
    if (!r) { detail.innerHTML = ''; return; }
    var ivCheck = Math.max(1, Math.round(r.tvl_usd * r.base_multiple * r.growth_multiplier * r.maturity_multiplier * r.reach_multiplier));
    detail.innerHTML = '<section class="detail" id="detail-sec"><h2>' + esc(r.name)
      + (r.on_watchlist ? '<span class="star">watchlist</span>' : '') + '</h2>'
      + '<p class="sub">Rank #' + r.rank + ' of ' + D.board_size + ' · ' + esc(r.category || 'Uncategorised') + ' · '
      + esc(r.chains.join(', ') || 'no chains recorded') + ' · records no token</p>'
      + '<div class="kpis">'
      + '<div class="kpi"><div class="n">' + money(r.implied_value_usd) + '</div><div class="l">Implied value</div></div>'
      + '<div class="kpi"><div class="n">' + money(r.tvl_usd) + '</div><div class="l">TVL</div></div>'
      + '<div class="kpi"><div class="n">' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div><div class="l">TVL change, 7d</div></div>'
      + '<div class="kpi"><div class="n">' + ageFmt(r.age_days) + '</div><div class="l">Tracked for</div></div>'
      + '<div class="kpi"><div class="n">' + (r.listed_at || '—') + '</div><div class="l">First tracked</div></div>'
      + '</div>'
      + '<h3>How this row is valued</h3><div class="bars">'
      + bar('Category multiple (' + esc(r.category || 'global median') + ')', r.base_multiple, 2.5, mult(r.base_multiple))
      + bar('Growth, 7d TVL', r.growth_multiplier, 1.6, mult(r.growth_multiplier))
      + bar('Maturity (time with no token)', r.maturity_multiplier, 1.0, mult(r.maturity_multiplier))
      + bar('Reach (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')', r.reach_multiplier, 1.2, mult(r.reach_multiplier))
      + '</div>'
      + '<p class="formula">' + money(r.tvl_usd) + ' TVL × ' + r.base_multiple.toFixed(2) + ' × ' + r.growth_multiplier.toFixed(2)
      + ' × ' + r.maturity_multiplier.toFixed(2) + ' × ' + r.reach_multiplier.toFixed(2) + ' = ' + money(ivCheck) + ' implied value</p>'
      + '<h3>Farm plan</h3><ol class="steps">'
      + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('')
      + '</ol></section>';
    if (scroll) { var el = document.getElementById('detail-sec'); if (el) el.scrollIntoView({ block: 'start' }); }
  }

  // ---- controls ----------------------------------------------------------------
  function on(id, ev, fn) { document.getElementById(id).addEventListener(ev, fn); }
  on('f-q', 'input', function (e) { S.q = e.target.value; writeHash(); renderBoard(); });
  on('f-cat', 'change', function (e) { S.cat = e.target.value; writeHash(); renderBoard(); });
  on('f-chain', 'change', function (e) { S.chain = e.target.value; writeHash(); renderBoard(); });
  on('f-min', 'change', function (e) { S.min = Number(e.target.value) || 0; writeHash(); renderBoard(); });
  on('f-watch', 'change', function (e) { S.watch = e.target.checked; writeHash(); renderBoard(); });
  Array.prototype.forEach.call(document.querySelectorAll('th[data-k]'), function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (S.sort === k) { S.dir = S.dir === 1 ? -1 : 1; } else { S.sort = k; S.dir = k === 'name' || k === 'cat' ? 1 : -1; if (k === 'rank') S.dir = 1; }
      writeHash(); renderBoard();
    });
  });

  renderBoard();
  renderDetail(false);
})();
