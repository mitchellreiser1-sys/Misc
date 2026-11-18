/* SNF Analytics front end. Renders published CMS values prepared by the pipeline.
   No metric is calculated here except display formatting. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var S = { index: null, lookups: null, manifest: null, q: '', state: '' };
  var IX = Rollup.IX;
  var STORE = 'snf.portfolios.v1';

  /* Saved portfolios live only in this browser's storage. Names never leave the device. */
  function loadPortfolios() {
    try { var v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function savePortfolios(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  /* Add CCNs to a saved portfolio. Returns how many were new. */
  function addCcns(id, ccns) {
    var list = loadPortfolios(), added = 0, name = null;
    list.forEach(function (p) {
      if (p.id !== id) return;
      name = p.name;
      ccns.forEach(function (c) { if (p.ccns.indexOf(c) === -1) { p.ccns.push(c); added++; } });
    });
    return savePortfolios(list) && name != null ? { added: added, name: name } : null;
  }
  function createPortfolio(name, ccns) {
    var l = loadPortfolios(), p = { id: newId(), name: name, ccns: ccns || [] };
    l.push(p);
    return savePortfolios(l) ? p : null;
  }
  function pfOptions(selected) {
    return loadPortfolios().map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + ' (' + p.ccns.length + ')</option>';
    }).join('') + '<option value="__new">New portfolio…</option>';
  }
  /* Resolve the portfolio chosen in a dropdown, creating one if "New portfolio" is selected. */
  function targetPortfolio(sel) {
    if (sel.value !== '__new') return sel.value;
    var name = prompt('Name for the new portfolio');
    if (!name || !name.trim()) return null;
    var p = createPortfolio(name.trim(), []);
    if (!p) { alert('This browser would not save the portfolio.'); return null; }
    S.target = p.id;
    sel.innerHTML = pfOptions(p.id);
    return p.id;
  }
  function matchRows(q, state) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return S.index.filter(function (r) {
      if (state && r[IX.state] !== state) return false;
      if (!terms.length) return true;
      var hay = (r[0] + ' ' + r[1] + ' ' + r[2] + ' ' + r[4] + ' ' + r[5] + ' ' + r[6]).toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    });
  }
  /* ---- Saving for everyone ----
     The site has no server, so a shared change is sent as a pre-filled request
     to the repository. Once submitted, the site rebuilds with the change. */
  var PENDING = 'snf.pending.v1';
  function pslug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'portfolio'; }
  function sameSet(a, b) { return a.length === b.length && a.slice().sort().join(',') === b.slice().sort().join(','); }
  function sharedByName(name) { return (S.shared || []).filter(function (p) { return pslug(p.name) === pslug(name); })[0]; }
  function canShare() { return !!(S.manifest && S.manifest.repo); }
  function loadPending() {
    try {
      var v = JSON.parse(localStorage.getItem(PENDING) || '[]');
      return (Array.isArray(v) ? v : []).filter(function (x) { return Date.now() - x.at < 30 * 60 * 1000; });
    } catch (e) { return []; }
  }
  function savePending(list) { try { localStorage.setItem(PENDING, JSON.stringify(list)); } catch (e) { /* not essential */ } }
  /* A request is finished once the shared list reflects it. */
  function pendingOpen() {
    var open = loadPending().filter(function (x) {
      var sp = sharedByName(x.name);
      return x.action === 'delete' ? !!sp : !(sp && sameSet(sp.ccns, x.ccns || []));
    });
    savePending(open);
    return open;
  }
  function sendForEveryone(action, name, ccns) {
    var body = 'action: ' + action + '\nname: ' + name + (action === 'save' ? '\nccns: ' + ccns.join(',') : '') +
      '\n\nSubmit this request to apply it. Do not edit the lines above.';
    var url = 'https://github.com/' + S.manifest.repo + '/issues/new?title=' + encodeURIComponent('[portfolio] ' + action + ': ' + name) + '&body=' + encodeURIComponent(body);
    var list = loadPending().filter(function (x) { return pslug(x.name) !== pslug(name); });
    list.push({ action: action, name: name, ccns: ccns || [], at: Date.now() });
    savePending(list);
    window.open(url, '_blank', 'noopener');
  }
  function pendingBanner() {
    var open = pendingOpen();
    if (!open.length) return '';
    return '<div class="callout">' + open.map(function (x) {
      return '<div><strong>' + (x.action === 'delete' ? 'Deleting' : 'Saving') + ' "' + esc(x.name) + '" for everyone.</strong> Select <b>Submit new issue</b> in the GitHub tab that opened. The change shows here about three minutes later; refresh this page to see it.</div>';
    }).join('') + '</div>';
  }
  /* Drop this device's copy of a portfolio once the shared list holds the same thing. */
  function tidyLocal() {
    var list = loadPortfolios(), keep = list.filter(function (p) { var sp = sharedByName(p.name); return !(sp && sameSet(sp.ccns, p.ccns)); });
    if (keep.length !== list.length) savePortfolios(keep);
  }

  function byCcn() {
    if (!S.map) { S.map = {}; S.index.forEach(function (r) { S.map[r[0]] = r; }); }
    return S.map;
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' returned ' + r.status);
      return r.json();
    });
  }
  var NA = '<span class="na">Not available</span>';
  function fmt(v, dec) {
    if (v == null) return NA;
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function money(v) { return v == null ? NA : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function fdate(s) {
    if (!s) return NA;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? m[2] + '/' + m[3] + '/' + m[1] : esc(s);
  }
  function fnText(code) {
    if (!code) return '';
    var t = S.lookups.footnotes[code];
    return t || ('CMS footnote ' + code);
  }
  function fnNote(code) { return code ? '<div class="muted small">' + esc(fnText(code)) + '</div>' : ''; }
  function stars(n) {
    if (n == null) return '<span class="na">Not rated</span>';
    var s = '';
    for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '<span class="off">★</span>';
    return '<span class="stars" role="img" aria-label="' + n + ' of 5 stars">' + s + '</span>';
  }
  function period(p) {
    var m = /^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/.exec(p || '');
    return m ? m[2] + '/' + m[3] + '/' + m[1] + ' to ' + m[5] + '/' + m[6] + '/' + m[4] : (p || '');
  }

  /* ---------- Search ---------- */
  function renderSearch() {
    var states = {};
    S.index.forEach(function (r) { states[r[IX.state]] = 1; });
    var opts = Object.keys(states).sort().map(function (s) {
      return '<option' + (s === S.state ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
    app.innerHTML =
      '<div class="card"><h1>Facility search</h1>' +
      '<p class="muted">' + S.index.length.toLocaleString() + ' Medicare and Medicaid certified nursing homes.</p>' +
      '<div class="controls"><input id="q" type="search" placeholder="Facility name, CCN, city, county, ZIP, or chain" value="' + esc(S.q) + '" autofocus>' +
      '<select id="st" aria-label="State"><option value="">All states</option>' + opts + '</select></div>' +
      '<div id="results"></div></div>';
    var q = document.getElementById('q'), st = document.getElementById('st');
    q.addEventListener('input', function () { S.q = q.value; results(); });
    st.addEventListener('change', function () { S.state = st.value; results(); });
    results();
  }
  function results() {
    var el = document.getElementById('results');
    if (!S.q.trim() && !S.state) { el.innerHTML = '<p class="muted">Enter a search term or choose a state.</p>'; return; }
    var hits = matchRows(S.q, S.state);
    var shown = hits.slice(0, 200);
    el.innerHTML = '<p class="muted small">' + hits.length.toLocaleString() + ' matching facilities' +
      (hits.length > shown.length ? ', showing the first ' + shown.length : '') + '.' +
      (hits.length && hits.length <= 1000 ? ' <a href="#/p/' + hits.map(function (r) { return r[0]; }).join(',') + '">View these as a portfolio</a>' : '') + '</p>' +
      (hits.length ? '<div class="controls"><label class="cb">Add facilities to <select id="searchsel" aria-label="Portfolio to add to">' + pfOptions(S.target) + '</select></label><span id="searchmsg" class="muted small"></span></div>' : '') +
      '<div class="scroll"><table><thead><tr><th>Facility</th><th>CCN</th><th>City</th><th>State</th><th>Chain</th><th class="n">Beds</th><th>Overall rating</th><th>Flags</th><th></th></tr></thead><tbody>' +
      shown.map(function (r) {
        var flags = (r[IX.sff] ? '<span class="chip ' + (r[IX.sff] === 'SFF' ? 'bad' : 'warn') + '">' + esc(r[IX.sff]) + '</span> ' : '') +
          (r[IX.abuse] ? '<span class="chip bad">Abuse icon</span>' : '');
        return '<tr class="hit" data-ccn="' + esc(r[0]) + '"><td><a href="#/f/' + esc(r[0]) + '">' + esc(r[1]) + '</a></td><td>' + esc(r[0]) +
          '</td><td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td>' + esc(r[6]) + '</td><td class="n">' + fmt(r[IX.beds], 0) +
          '</td><td>' + stars(r[IX.overall]) + '</td><td>' + flags + '</td><td><button class="addrow" data-ccn="' + esc(r[0]) + '">+ Add</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    Array.prototype.forEach.call(el.querySelectorAll('tr.hit'), function (tr) {
      tr.addEventListener('click', function (e) { if (e.target.tagName !== 'A' && e.target.tagName !== 'BUTTON') location.hash = '#/f/' + tr.dataset.ccn; });
    });
    var sel = document.getElementById('searchsel');
    if (sel) sel.addEventListener('change', function () { if (sel.value !== '__new') S.target = sel.value; });
    Array.prototype.forEach.call(el.querySelectorAll('button.addrow'), function (b) {
      b.addEventListener('click', function () {
        var id = targetPortfolio(sel);
        if (!id) return;
        var r = addCcns(id, [b.dataset.ccn]), msg = document.getElementById('searchmsg');
        if (!r) { msg.textContent = 'Could not save.'; return; }
        b.textContent = r.added ? 'Added' : 'Already in';
        b.disabled = true;
        msg.textContent = (r.added ? 'Added to ' : 'Already in ') + r.name + '.';
        sel.innerHTML = pfOptions(id);
      });
    });
  }

  /* ---------- Facility report ---------- */
  var SEV_BANDS = [
    ['ABC', 'No actual harm, potential for minimal harm', ''],
    ['DEF', 'No actual harm, potential for more than minimal harm', ''],
    ['GHI', 'Actual harm', 'h'],
    ['JKL', 'Immediate jeopardy', 'ij']
  ];
  function sevClass(code) { return 'JKL'.indexOf(code) !== -1 ? 'ij' : 'GHI'.indexOf(code) !== -1 ? 'h' : ''; }

  function renderFacility(ccn) {
    app.innerHTML = '<p class="muted">Loading facility ' + esc(ccn) + '…</p>';
    getJSON('data/f/' + encodeURIComponent(ccn) + '.json').then(function (f) { drawFacility(f); })
      .catch(function () {
        app.innerHTML = '<a class="back" href="#/">← Back to search</a><div class="card"><h1>Facility not found</h1><p>No facility with CCN ' + esc(ccn) + ' is in the current CMS release.</p></div>';
      });
  }

  function drawFacility(f) {
    var L = S.lookups, bs = L.benchmarks[f.state] || { staffing: {}, qm: {}, ratings: {} }, bn = L.benchmarks.NATION;
    var asof = fdate(S.manifest.processing_date);
    var src = function (file) { return '<p class="src">Source: CMS ' + esc(file) + ', processing date ' + asof + '.</p>'; };
    var R = f.ratings, D = f.deficiencies, P = f.penalties, sv = f.survey;

    /* header */
    var chips = [];
    if (f.sff === 'SFF') chips.push(['bad', 'Special Focus Facility']);
    if (f.sff === 'SFF Candidate') chips.push(['warn', 'SFF candidate']);
    if (f.abuse) chips.push(['bad', 'Abuse icon']);
    if (f.chow_12m) chips.push(['warn', 'Changed ownership in last 12 months']);
    if (f.insp_over_2y) chips.push(['warn', 'Most recent health inspection more than 2 years ago']);
    if (f.sprinklers && f.sprinklers !== 'Yes') chips.push(['warn', 'Sprinklers in all required areas: ' + f.sprinklers]);
    if (f.high_performing) chips.push(['good', 'High performing icon']);
    if (f.in_hospital) chips.push(['', 'Resides in hospital']);
    if (f.ccrc) chips.push(['', 'Continuing care retirement community']);
    var facts = [
      ['Ownership type', f.ownership_type], ['Participation', f.provider_type],
      ['Setting', f.urban == null ? null : (f.urban ? 'Urban' : 'Rural')],
      ['Certified since', f.certified ? fdate(f.certified) : null],
      ['Legal name', f.legal_name && f.legal_name !== f.name ? f.legal_name : null]
    ].filter(function (x) { return x[1]; }).map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') +
      '<div><dt>Chain</dt><dd>' + (f.chain ? '<a href="#/chain/' + esc(f.chain.id) + '">' + esc(f.chain.name) + '</a>' + (f.chain.count ? ' <span class="muted">(' + esc(f.chain.count) + ' facilities)</span>' : '') : '<span class="muted">None reported</span>') + '</dd></div>';

    var h = printHead('Facility report') + '<a class="back" href="#/">← Back to search</a>' +
      '<div class="phead"><div><h1>' + esc(f.name) + '</h1><div class="sub">CCN ' + esc(f.ccn) + ' · ' + esc(f.address) + ', ' + esc(f.city) + ', ' + esc(f.state) + ' ' + esc(f.zip) + (f.county ? ' · ' + esc(f.county) + ' County' : '') + '</div>' +
      (chips.length ? '<div class="chips">' + chips.map(function (c) { return '<span class="chip ' + c[0] + '">' + esc(c[1]) + '</span>'; }).join('') + '</div>' : '') + '</div>' +
      '<div class="controls"><span id="addmsg" class="muted small"></span><select id="addsel" aria-label="Portfolio to add to">' + pfOptions(S.target) + '</select><button id="addbtn" class="primary">Add to portfolio</button><button id="fxlsx">Download Excel</button><button onclick="window.print()">Print / PDF</button></div></div>';

    /* section navigation */
    var SECTIONS = [['risk', 'Risk'], ['ratings', 'Ratings'], ['inspections', 'Inspections'], ['deficiencies', 'Deficiencies'], ['staffing', 'Staffing'], ['quality', 'Quality measures'], ['penalties', 'Penalties'], ['ownership', 'Ownership'], ['narrative', 'Narrative draft']];
    h += '<div class="secnav" role="navigation" aria-label="Report sections">' + SECTIONS.map(function (x) { return '<button data-go="sec-' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';

    /* overview */
    h += '<div class="card strip">' +
      '<div class="stat"><div class="k">Overall rating</div><div class="v">' + stars(R.overall[0]) + '</div><div class="s">' + (R.overall[1] ? esc(fnText(R.overall[1])) : esc(f.state) + ' average ' + fmt(bs.ratings['Overall Rating'], 1) + ' · US ' + fmt(bn.ratings['Overall Rating'], 1)) + '</div></div>' +
      '<div class="stat"><div class="k">Certified beds</div><div class="v">' + fmt(f.beds, 0) + '</div></div>' +
      '<div class="stat"><div class="k">Average residents per day</div><div class="v">' + fmt(f.residents, 1) + '</div>' + (f.residents_fn ? '<div class="s">' + esc(fnText(f.residents_fn)) + '</div>' : '<div class="s">' + esc(f.state) + ' average ' + fmt(bs['Average Number of Residents per Day'], 1) + '</div>') + '</div>' +
      '<div class="stat"><div class="k">Occupancy (derived)</div><div class="v">' + (f.occupancy == null ? NA : fmt(f.occupancy * 100, 1) + '%') + '</div>' +
      (f.occupancy == null ? '' : '<div class="meter" role="img" aria-label="Occupancy ' + fmt(f.occupancy * 100, 1) + ' percent"><i style="width:' + Math.min(100, f.occupancy * 100).toFixed(1) + '%"></i></div>') +
      '<div class="s">Average residents ÷ certified beds</div></div></div>';

    h += '<div class="card"><dl class="facts">' + facts + '</dl></div>';

    /* risk snapshot */
    var ij = D.filter(function (d) { return d[1] === 'H' && 'JKL'.indexOf(d[3]) !== -1; }).length;
    var harm = D.filter(function (d) { return d[1] === 'H' && 'GHI'.indexOf(d[3]) !== -1; }).length;
    function rstat(label, value, sub) {
      var zero = value === 0 || value === '$0';
      return '<div class="stat"><div class="k">' + label + '</div><div class="v' + (zero ? ' zero' : '') + '">' + value + '</div><div class="s">' + sub + '</div></div>';
    }
    var RK = f.risk, RL = S.lookups.risk;
    var parts = RL.components.filter(function (c) { return RK.parts[c[0]] > 0; });
    var riskCard = '<div class="card riskcard"><div class="rk-score"><div class="stat"><div class="k">Regulatory screening score</div><div class="v">' + RK.score + '<span class="rk-of"> / 100</span> <span class="chip tier t' + tierIndexOf(RK.tier) + '">' + esc(RK.tier) + '</span></div>' +
      (RK.tier_by_status ? '<div class="s strong" style="color:var(--bad)">Placed in ' + esc(RK.tier) + ' because it is ' + (f.sff === 'SFF' ? 'a Special Focus Facility' : 'an SFF candidate') + '. Its points alone would place it lower.</div>' : '') +
      '<div class="meter risk-meter" role="img" aria-label="Regulatory screening score ' + RK.score + ' of 100"><i style="width:' + RK.score + '%"></i></div>' +
      '<div class="s">Higher than ' + RK.pct_us + '% of facilities nationally and ' + RK.pct_state + '% in ' + esc(f.state) + '. A Bravo screening aid for regulatory risk. Not a CMS figure and not a credit risk measure. <a href="#/risk">How it works</a></div></div></div>' +
      '<div class="rk-parts">' + (parts.length ? '<table><thead><tr><th>What contributes</th><th class="n">Points</th></tr></thead><tbody>' + parts.map(function (c) {
        return '<tr><td>' + esc(c[1]) + ' <span class="muted small">(of ' + c[3] + ')</span><div class="muted small">' + esc(c[2]) + (c[0] === 'survey' && RK.survey_pct != null ? '. This facility\'s score is worse than ' + RK.survey_pct + '% of facilities.' : '') + '</div></td><td class="n strong">' + RK.parts[c[0]] + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="muted" style="margin:0">No component of the score applies to this facility.</p>') +
      '</div></div>';
    h += '<div class="sect" id="sec-risk"><span>Risk snapshot</span></div>' + riskCard + '<div class="card strip">' +
      rstat('Immediate jeopardy citations', ij, 'Health, scope and severity J to L, last 3 cycles') +
      rstat('Actual harm citations', harm, 'Health, scope and severity G to I, last 3 cycles') +
      rstat('Fines, last 3 years', money(P.fine_total), fmt(P.fines, 0) + (P.fines === 1 ? ' fine' : ' fines') + ' · ' + esc(f.state) + ' average per facility ' + money(bs['Fine Amount in Dollars'])) +
      rstat('Payment denials, last 3 years', P.denials == null ? NA : P.denials, 'Denials of payment for new admissions') + '</div>';

    /* ratings */
    function rcard(label, r, key) {
      return '<div class="card rcard"><div class="stat"><div class="k">' + label + '</div></div><div class="v">' + (r[0] == null ? '<span class="na" style="font-size:18px">Not rated</span>' : r[0] + ' <span class="stars" style="margin-left:6px">' + stars(r[0]).replace(/^<span[^>]*>|<\/span>$/g, '') + '</span>') + '</div>' +
        '<div class="rsub">' + (r[1] ? esc(fnText(r[1])) : key ? esc(f.state) + ' average <b>' + fmt(bs.ratings[key], 1) + '</b> · US average <b>' + fmt(bn.ratings[key], 1) + '</b>' : '&nbsp;') + '</div></div>';
    }
    h += '<div class="sect" id="sec-ratings"><span>Star ratings</span></div><div class="rgrid four">' +
      rcard('Overall', R.overall, 'Overall Rating') + rcard('Health inspection', R.health, 'Health Inspection Rating') + rcard('Staffing', R.staffing, 'Staffing Rating') + rcard('Quality measures', R.qm, 'QM Rating') + '</div>';

    var HS = f.history;
    if (HS && HS.dates.length > 1) {
      h += '<div class="sect"><span>Rating history <span class="muted" style="font-weight:400">· ' + HS.dates.length + ' CMS releases, ' + monthLabel(HS.dates[0]) + ' to ' + monthLabel(HS.dates[HS.dates.length - 1]) + '</span></span></div><div class="rgrid four">' +
        historyChart('Overall', HS.dates, HS.overall) + historyChart('Health inspection', HS.dates, HS.health) + historyChart('Staffing', HS.dates, HS.staffing) + historyChart('Quality measures', HS.dates, HS.qm) + '</div>' +
        '<details style="margin-top:10px"><summary class="small">View rating history as a table</summary><div class="card" style="margin-top:10px"><div class="scroll tall"><table><thead><tr><th>CMS release</th><th class="n">Overall</th><th class="n">Health inspection</th><th class="n">Staffing</th><th class="n">Quality measures</th></tr></thead><tbody>' +
        HS.dates.map(function (d, i) { return [d, i]; }).reverse().map(function (x) {
          var c = function (v) { return '<td class="n">' + (v == null ? '<span class="na">NR</span>' : v) + '</td>'; };
          return '<tr><td>' + fdate(x[0]) + '</td>' + c(HS.overall[x[1]]) + c(HS.health[x[1]]) + c(HS.staffing[x[1]]) + c(HS.qm[x[1]]) + '</tr>';
        }).join('') + '</tbody></table></div><p class="src">Published ratings from each CMS monthly release. NR means not rated or not in that release. Source: CMS Provider Information archives.</p></div></details>';
    }
    h += '<div class="grid2" style="margin-top:12px"><div class="card"><h2>How the overall rating is built</h2>';
    if (f.star_steps) {
      h += '<ul class="steps">' + f.star_steps.map(function (s) {
        var adj = s[1] == null ? '' : s[1] > 0 ? '+1 star' : s[1] < 0 ? '−1 star' : 'No change';
        return '<li><span>' + esc(s[0]) + (adj ? ' <span class="muted">(' + adj + ')</span>' : '') + '</span><span>' + stars(s[2]) + '</span></li>';
      }).join('') + '<li><span>Published overall rating</span><span>' + stars(R.overall[0]) + '</span></li></ul>';
    } else {
      h += '<p>' + (R.overall[1] ? esc(fnText(R.overall[1])) : 'CMS has not published an overall rating for this facility.') + '</p>';
    }
    h += '<p class="src">The build-up follows the CMS Five-Star rules and is checked against the published rating at every refresh.</p></div>' +
      '<div class="card"><h2>Quality measure sub-ratings</h2><ul class="steps plain">' +
      '<li><span>Overall quality measure rating' + fnNote(R.qm[1]) + '</span><span>' + stars(R.qm[0]) + '</span></li>' +
      '<li><span>Long-stay rating' + fnNote(R.qm_long[1]) + '</span><span>' + stars(R.qm_long[0]) + '</span></li>' +
      '<li><span>Short-stay rating' + fnNote(R.qm_short[1]) + '</span><span>' + stars(R.qm_short[0]) + '</span></li>' +
      '</ul>' + src('Provider Information') + '</div></div>';

    /* inspections */
    function cyc(label, c) {
      return '<tr><td>' + label + (c.fn ? fnNote(c.fn) : '') + '</td><td>' + fdate(c.date) + '</td><td class="n">' + fmt(c.total, 0) + '</td><td class="n">' + fmt(c.complaint, 0) +
        '</td><td class="n">' + fmt(c.def_score, 0) + '</td><td class="n">' + fmt(c.revisits, 0) + '</td><td class="n">' + fmt(c.revisit_score, 0) + '</td><td class="n">' + fmt(c.score, 0) + '</td></tr>';
    }
    h += '<div class="sect" id="sec-inspections"><span>Health inspections <span class="muted" style="font-weight:400">· lower scores are better</span></span></div><div class="card"><div class="scroll"><table><thead><tr><th>Rating cycle</th><th>Standard survey date</th><th class="n">Health deficiencies</th><th class="n">From complaints</th><th class="n">Deficiency score</th><th class="n">Revisits</th><th class="n">Revisit score</th><th class="n">Total score</th></tr></thead><tbody>' +
      cyc('Cycle 1 (most recent)', sv.c1) + cyc('Cycles 2 and 3', sv.c23) +
      '<tr class="total"><td colspan="7">Total weighted health survey score <span class="muted" style="font-weight:400">(3/4 cycle 1, 1/4 cycles 2 and 3)</span></td><td class="n">' + fmt(sv.weighted, 3) + '</td></tr>' +
      '</tbody></table></div>' +
      '<p class="small muted" style="margin:12px 0 0">Cycle 1 health deficiencies: ' + esc(f.state) + ' average ' + fmt(bs['Cycle 1 Total Number of Health Deficiencies'], 1) + ' · US average ' + fmt(bn['Cycle 1 Total Number of Health Deficiencies'], 1) +
      ' · Citations from infection control inspections: ' + fmt(sv.infection_citations, 0) + '</p>' +
      (f.cut && sv.weighted != null ? (function () {
        var t = f.cut.thresholds, lab = ['5 stars: ' + fmt(t[0], 1) + ' or lower', '4 stars: up to ' + fmt(t[1], 1), '3 stars: up to ' + fmt(t[2], 1), '2 stars: up to ' + fmt(t[3], 1), '1 star: above ' + fmt(t[3], 1)];
        var implied = f.abuse ? Math.min(f.cut.band, 2) : f.cut.band;
        return '<div class="cutbox"><div class="strong">' + esc(f.state) + ' cut points for the current release</div><div class="cuts">' + lab.map(function (x, i) { return '<span class="' + (5 - i === f.cut.band ? 'on' : '') + '">' + x + '</span>'; }).join('') + '</div>' +
          (function () {
            var ps = f.cut.pos, matches = R.health[0] != null && implied === R.health[0] && !(f.abuse && f.cut.band > 2);
            if (!ps) return '';
            var bits = [];
            if (ps.to_better != null) bits.push('<b>' + fmt(ps.to_better, 1) + '</b> points above the ' + (ps.band + 1) + '-star cut point');
            if (ps.to_worse != null) bits.push('<b>' + fmt(ps.to_worse, 1) + '</b> points below the ' + (ps.band - 1) + '-star cut point');
            return '<div class="bandpos">' + (matches && ps.label ? '<span class="chip">' + ps.label + ' ' + ps.band + '-star</span> ' : '') + 'Weighted score of ' + fmt(sv.weighted, 1) + ' is ' + bits.join(' and ') + '.' +
              (matches && ps.label ? ' <span class="muted">High, Mid, and Low split the band into thirds; High is nearest the next star up.</span>' : '') + '</div>';
          })() +
          '<div class="small muted">This facility\'s weighted score of ' + fmt(sv.weighted, 3) + ' falls in the ' + f.cut.band + '-star band' + (f.abuse && f.cut.band > 2 ? ', and the abuse icon caps the rating at 2 stars' : '') + '. ' +
          (R.health[0] != null && implied !== R.health[0] ? 'The published rating is ' + R.health[0] + (R.health[0] === 1 ? ' star' : ' stars') + '. CMS holds a rating until new survey activity, so the published rating can differ from the current band.' : 'Cut points are recalculated by CMS, and a new survey also changes how earlier surveys are weighted, so this is the current position only and not a forecast.') + '</div></div>';
      })() : '') +
      (f.surveys && f.surveys.length ? '<details class="printopen" style="margin-top:12px"><summary class="small">View all ' + f.surveys.length + ' inspection dates</summary><div class="scroll tall" style="margin-top:8px"><table><thead><tr><th>Survey date</th><th>Type</th><th>Cycle</th></tr></thead><tbody>' +
        f.surveys.map(function (x) { return '<tr><td>' + fdate(x[0]) + '</td><td>' + esc(x[1]) + '</td><td>' + esc(x[2]) + '</td></tr>'; }).join('') + '</tbody></table></div></details>' : '') +
      src('Provider Information, Inspection Dates, State-Level Health Inspection Cut Points, and State US Averages') + '</div>';

    /* deficiencies */
    var bands = SEV_BANDS.map(function (b) {
      var c = { H: 0, F: 0 };
      D.forEach(function (d) { if (b[0].indexOf(d[3]) !== -1) c[d[1]]++; });
      return '<div class="band ' + b[2] + '"><div class="k"><span class="sev ' + b[2] + '">' + b[0][0] + ' to ' + b[0][2] + '</span> ' + b[1] + '</div><div class="nums"><span><b>' + c.H + '</b> health</span><span><b>' + c.F + '</b> fire safety</span></div></div>';
    }).join('');
    var cycles = {};
    D.forEach(function (d) { cycles[d[4]] = 1; });
    h += '<div class="sect" id="sec-deficiencies"><span>Deficiencies cited <span class="muted" style="font-weight:400">· ' + D.length + ' in the three most recent inspection cycles</span></span></div>' +
      '<div class="bands">' + bands + '</div>' +
      (f.repeat && f.repeat.length ? '<div class="callout"><strong>' + f.repeat.length + (f.repeat.length === 1 ? ' repeat citation' : ' repeat citations') + ':</strong> ' + esc(f.repeat.join(', ')) + '<div class="small muted" style="margin-top:4px">Health deficiency tags cited in more than one of the last three inspection cycles.</div></div>' : '') +
      '<div class="card"><div class="controls"><label class="cb"><input type="checkbox" id="fH" checked> Health</label><label class="cb"><input type="checkbox" id="fF" checked> Fire safety</label>' +
      '<label class="cb"><input type="checkbox" id="fG"> Actual harm or immediate jeopardy only</label>' +
      '<label class="cb"><input type="checkbox" id="fR"> Repeat citations only</label>' +
      '<select id="fC" aria-label="Inspection cycle"><option value="">All cycles</option>' + Object.keys(cycles).sort().map(function (c) { return '<option value="' + esc(c) + '">Cycle ' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<span id="defcount" class="muted small"></span></div>' +
      '<div class="scroll tall" id="deftable"></div>' + src('Health Deficiencies and Fire Safety Deficiencies') + '</div>';

    /* staffing */
    h += '<div class="sect" id="sec-staffing"><span>Staffing</span></div><div class="card"><div class="scroll"><table><thead><tr><th>Measure</th><th class="n">Facility</th><th class="n">' + esc(f.state) + ' average</th><th class="n">US average</th><th class="n">Facility vs US</th></tr></thead><tbody>' +
      f.staffing.map(function (r) {
        var sb = bs.staffing[r[0]], nb = bn.staffing[r[0]], has = r[0] in bn.staffing;
        var diff = r[1] != null && nb != null ? r[1] - nb : null;
        return '<tr><td>' + esc(r[0]) + (r[1] == null ? fnNote(r[2]) : '') + '</td><td class="n strong">' + fmt(r[1], r[3]) + '</td><td class="n">' +
          (has ? fmt(sb, r[3]) : '<span class="na">Not published</span>') + '</td><td class="n">' + (has ? fmt(nb, r[3]) : '<span class="na">Not published</span>') + '</td><td class="n muted">' +
          (diff == null ? '' : (diff > 0 ? '+' : diff < 0 ? '−' : '') + fmt(Math.abs(diff), r[3])) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (R.staffing[1] ? '<p class="small muted" style="margin:12px 0 0">Staffing rating note: ' + esc(fnText(R.staffing[1])) + '</p>' : '') +
      src('Provider Information (Payroll-Based Journal staffing as published by CMS) and State US Averages') + '</div>';
    if (S.lookups.pbj) {
      var pb = f.pbj, pq = S.lookups.pbj;
      h += '<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">' +
        '<div class="tile"><div class="k">Contract staff share of nurse hours (derived)</div><div class="v">' + (pb ? fmt(pb.contract_share * 100, 1) + '%' : NA) + '</div><div class="s">Contract hours ÷ total nurse hours, ' + esc(pq.period || pq.quarter) + '</div></div>' +
        '<div class="tile"><div class="k">Days with no RN hours reported (derived)</div><div class="v">' + (pb ? pb.zero_rn_days : NA) + '</div><div class="s">' + (pb ? 'Of ' + pb.days + ' days reported, ' : '') + esc(pq.period || pq.quarter) + '</div></div></div>' +
        '<p class="src" style="margin-top:-6px">Derived from the CMS Payroll Based Journal Daily Nurse Staffing file for ' + esc(pq.quarter) + '. The pipeline confirms that file reproduces the published hours per resident day before these figures are shown.</p>';
    }

    /* quality measures, grouped by stay type */
    function qmTable(type) {
      var rows = f.qm.filter(function (q) { return ((L.measures[q[0]] || {}).type || '') === type; });
      if (!rows.length) return '';
      return '<h2 style="margin-top:' + (type === 'Long Stay' ? '0' : '22px') + '">' + (type === 'Long Stay' ? 'Long-stay residents' : 'Short-stay residents') + '</h2><div class="scroll"><table><thead><tr><th>Measure</th><th class="n">Facility</th><th class="n">' + esc(f.state) + ' average</th><th class="n">US average</th><th>Period</th></tr></thead><tbody>' +
        rows.map(function (q) {
          var m = L.measures[q[0]];
          return '<tr><td>' + esc(m.desc) + (m.five_star ? ' <span class="chip tiny">Five-Star</span>' : '') + (q[1] == null ? fnNote(q[2]) : '') + '</td><td class="n strong">' + fmt(q[1], 2) +
            '</td><td class="n">' + fmt(bs.qm[q[0]], 2) + '</td><td class="n">' + fmt(bn.qm[q[0]], 2) + '</td><td class="small muted" style="white-space:nowrap">' + esc(period(m.period)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '<div class="sect" id="sec-quality"><span>Quality measures <span class="muted" style="font-weight:400">· measures marked Five-Star count toward the quality measure rating</span></span></div><div class="card">' + qmTable('Long Stay') + qmTable('Short Stay') +
      '<p class="small muted" style="margin:12px 0 0">MDS measures show the four-quarter average. Claims-based measures show the risk-adjusted score.</p>' +
      src('MDS Quality Measures, Medicare Claims Quality Measures, and State US Averages') + '</div>';

    /* value-based purchasing */
    if (S.lookups.vbp_fy) {
      var vb = f.vbp, fy = S.lookups.vbp_fy;
      h += '<div class="sect"><span>Medicare value-based purchasing <span class="muted" style="font-weight:400">· fiscal year ' + fy + '</span></span></div>' +
        (vb ? '<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">' +
          '<div class="tile"><div class="k">Incentive payment multiplier</div><div class="v">' + (vb.multiplier == null ? NA : vb.multiplier.toFixed(4)) + '</div><div class="s">' + (vb.multiplier == null ? '' : vb.multiplier > 1 ? 'Above 1.0: Medicare Part A rates are increased by ' + ((vb.multiplier - 1) * 100).toFixed(2) + '%' : vb.multiplier === 1 ? 'Exactly 1.0: no net change to Medicare Part A rates' : 'Below 1.0: Medicare Part A rates are reduced by ' + ((1 - vb.multiplier) * 100).toFixed(2) + '%') + '</div></div>' +
          '<div class="tile"><div class="k">Performance score</div><div class="v">' + fmt(vb.score, 1) + '</div><div class="s">Out of 100</div></div>' +
          '<div class="tile"><div class="k">National ranking</div><div class="v">' + fmt(vb.ranking, 0) + '</div><div class="s">1 is the best performer</div></div></div>' :
          '<div class="card"><p style="margin:0">This facility is not in the CMS value-based purchasing file for fiscal year ' + fy + '.</p></div>') +
        '<p class="src" style="margin-top:-6px">Source: CMS FY ' + fy + ' SNF VBP Facility-Level Dataset. The multiplier is applied to the facility\'s Medicare Part A payments for the fiscal year.</p>';
    }

    /* penalties */
    h += '<div class="sect" id="sec-penalties"><span>Penalties <span class="muted" style="font-weight:400">· last three years</span></span></div><div class="card">' +
      (P.rows.length ? '<div class="scroll"><table><thead><tr><th>Penalty date</th><th>Type</th><th class="n">Fine amount</th><th>Denial start</th><th class="n">Denial length (days)</th></tr></thead><tbody>' +
        P.rows.map(function (r) {
          var fine = r[1] === 'Fine';
          return '<tr><td>' + fdate(r[0]) + '</td><td>' + esc(r[1]) + '</td><td class="n">' + (fine ? money(r[2]) : '') + '</td><td>' + (fine ? '' : fdate(r[3])) + '</td><td class="n">' + (fine ? '' : fmt(r[4], 0)) + '</td></tr>';
        }).join('') + '<tr class="total"><td colspan="2">Total fines (' + fmt(P.fines, 0) + ')</td><td class="n">' + money(P.fine_total) + '</td><td colspan="2"></td></tr></tbody></table></div>' :
        '<p style="margin:0">No fines or payment denials reported by CMS in the last three years.</p>') +
      '<p class="small muted" style="margin:12px 0 0">Number of fines: ' + esc(f.state) + ' average ' + fmt(bs['Number of Fines'], 1) + ' · US average ' + fmt(bn['Number of Fines'], 1) + '. Fine dollars: ' + esc(f.state) + ' average ' + money(bs['Fine Amount in Dollars']) + ' · US average ' + money(bn['Fine Amount in Dollars']) + '.</p>' +
      src('Penalties, Provider Information, and State US Averages') + '</div>';

    /* ownership */
    h += '<div class="sect" id="sec-ownership"><span>Ownership and management <span class="muted" style="font-weight:400">· ' + f.owners.length + ' reported</span></span></div><div class="card">' +
      (f.owners.length ? '<div class="scroll tall"><table><thead><tr><th>Name</th><th>Role</th><th>Type</th><th class="n">Ownership</th><th>Associated since</th></tr></thead><tbody>' +
        f.owners.map(function (o) {
          return '<tr><td class="strong">' + (o[2] ? '<a href="#/owner/' + encodeURIComponent(o[2]) + '">' + esc(o[2]) + '</a>' : NA) + '</td><td>' + esc(o[0]) + '</td><td>' + esc(o[1] || '') + '</td><td class="n">' + esc(o[3] || '') + '</td><td>' + esc((o[4] || '').replace(/^since\s+/i, '')) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p style="margin:0">' + NA + '</p>') + src('Ownership') + '</div>';

    h += '<div class="sect noprint" id="sec-narrative"><span>Lender narrative draft <span class="muted" style="font-weight:400">· Subject\'s State Surveys section</span></span></div><div class="card noprint">' +
      '<p class="muted small" style="margin-top:0">Filled only from the CMS figures on this page, in the wording of approved Bravo narratives. The POC column shows the correction date CMS publishes for each survey, using the latest date when a survey has more than one, as in approved Bravo narratives. Surveys listed are those with health deficiencies, plus any annual survey with none. Anything CMS does not publish is marked [TBD]. Review against the state survey documents before use.</p>' +
      '<pre id="narr" class="narr"></pre><div class="controls" style="margin:10px 0 0"><button id="narrcopy">Copy text</button><span id="narrmsg" class="muted small"></span></div></div>';
    app.innerHTML = h;
    setPrintFooter('Bravo Capital · SNF Analytics · ' + f.name + ' (CCN ' + f.ccn + ') · CMS data as of ' + fdate(S.manifest.processing_date));
    document.getElementById('narr').textContent = narrativeDraft(f);
    document.getElementById('narrcopy').addEventListener('click', function () {
      var t = document.getElementById('narr').textContent, msg = document.getElementById('narrmsg');
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { msg.textContent = 'Copied.'; }, function () { msg.textContent = 'Select the text and copy it manually.'; });
      else msg.textContent = 'Select the text and copy it manually.';
    });
    document.getElementById('fxlsx').addEventListener('click', function () { exportXlsx(fileSafe(f.name) + '_' + f.ccn + '_' + S.manifest.processing_date + '.xlsx', facilitySheets(f), this); });

    function drawDefs() {
      var showH = document.getElementById('fH').checked, showF = document.getElementById('fF').checked, gOnly = document.getElementById('fG').checked, cyc = document.getElementById('fC').value, rOnly = document.getElementById('fR').checked;
      var isRepeat = function (d) { return d[1] === 'H' && f.repeat && f.repeat.indexOf(d[2]) !== -1; };
      var rows = D.filter(function (d) {
        return ((d[1] === 'H' && showH) || (d[1] === 'F' && showF)) && (!gOnly || 'GHIJKL'.indexOf(d[3]) !== -1) && (!cyc || d[4] === cyc) && (!rOnly || isRepeat(d));
      });
      document.getElementById('defcount').textContent = rows.length + ' of ' + D.length + ' shown';
      document.getElementById('deftable').innerHTML = rows.length ?
        '<table><thead><tr><th>Survey date</th><th>Type</th><th>Tag</th><th>Severity</th><th>Cycle</th><th>Deficiency</th><th>Found during</th><th>Correction</th></tr></thead><tbody>' +
        rows.map(function (d) {
          var ds = L.descs[d[5]] || ['', ''];
          var found = [d[6] ? 'Standard survey' : null, d[7] ? 'Complaint' : null, d[8] ? 'Infection control' : null].filter(Boolean).join(', ');
          return '<tr><td style="white-space:nowrap">' + fdate(d[0]) + (d[12] ? fnNote(d[12]) : '') + '</td><td>' + (d[1] === 'H' ? 'Health' : 'Fire safety') + '</td><td>' + esc(d[2]) + (isRepeat(d) ? '<div><span class="chip tiny warn">Repeat</span></div>' : '') + '</td><td><span class="sev ' + sevClass(d[3]) + '">' + esc(d[3]) +
            '</span></td><td>' + esc(d[4]) + '</td><td>' + esc(ds[0]) + '<div class="muted small">' + esc(ds[1]) + (d[11] ? ' · Under dispute resolution' : '') + '</div></td><td>' + esc(found) +
            '</td><td>' + esc(d[9]) + (d[10] ? '<div class="muted small">' + fdate(d[10]) + '</div>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="muted">No deficiencies match the selected filters.</p>';
    }
    ['fH', 'fF', 'fG', 'fC', 'fR'].forEach(function (id) { document.getElementById(id).addEventListener('change', drawDefs); });
    drawDefs();
    Array.prototype.forEach.call(app.querySelectorAll('.secnav [data-go]'), function (b) {
      b.addEventListener('click', function () { document.getElementById(b.dataset.go).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
    var addsel = document.getElementById('addsel');
    addsel.addEventListener('change', function () { if (addsel.value !== '__new') S.target = addsel.value; });
    document.getElementById('addbtn').addEventListener('click', function () {
      var id = targetPortfolio(addsel);
      if (!id) return;
      var r = addCcns(id, [f.ccn]);
      document.getElementById('addmsg').textContent = !r ? 'Could not save.' : (r.added ? 'Added to ' : 'Already in ') + r.name + '.';
      if (r) addsel.innerHTML = pfOptions(id);
    });
    window.scrollTo(0, 0);
  }

  /* ---------- Data status ---------- */
  function renderStatus() {
    var m = S.manifest, ds = m.datasets;
    app.innerHTML = '<div class="card"><h1>Data status</h1>' +
      '<p>CMS release processing date: <strong>' + fdate(m.processing_date) + '</strong> · ' + m.facility_count.toLocaleString() + ' facilities · Last built ' + esc(m.built_at.replace('T', ' ').replace('Z', ' UTC')) + ' · Pipeline version ' + esc(m.pipeline_version) + '</p>' +
      '<p class="muted">The pipeline checks CMS daily. A new release is published here only if every gate below passes. If a gate fails, this site keeps showing the last release that passed.</p></div>' +
      '<div class="card"><h2>Reconciliation checks for this release</h2><div class="scroll"><table><thead><tr><th>Check</th><th>Type</th><th>Result</th><th>Detail</th></tr></thead><tbody>' +
      m.checks.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td>' + (c.level === 'gate' ? 'Gate' : 'Informational') + '</td><td class="status-' + c.status + '">' + (c.status === 'pass' ? 'Pass' : c.status === 'warn' ? 'Note' : 'Fail') + '</td><td>' + esc(c.detail) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '<div class="card"><h2>Source files</h2><div class="scroll"><table><thead><tr><th>CMS dataset</th><th>File</th><th class="n">Rows</th><th>CMS modified</th><th>CMS released</th><th>Next CMS update</th><th>SHA-256</th></tr></thead><tbody>' +
      Object.keys(ds).map(function (k) {
        var d = ds[k];
        return '<tr><td>' + esc(d.title) + '</td><td class="small">' + esc(d.file) + '</td><td class="n">' + fmt(d.rows, 0) + '</td><td>' + fdate(d.modified) + '</td><td>' + fdate(d.released) + '</td><td>' + fdate(d.next_update) + '</td><td class="small" title="' + esc(d.sha256) + '">' + esc((d.sha256 || '').slice(0, 12)) + '…</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ---------- Portfolios ---------- */
  function renderPortfolios() {
    var list = loadPortfolios();
    tidyLocal();
    list = loadPortfolios();
    var rowsHtml = S.shared.map(function (p) {
      return '<tr><td><a href="#/shared/' + esc(p.id) + '">' + esc(p.name) + '</a></td><td class="n">' + p.ccns.length + '</td><td></td><td class="n">' +
        (canShare() ? '<button data-sdel="' + esc(p.id) + '">Delete</button>' : '') + '</td></tr>';
    }).concat(list.map(function (p) {
      return '<tr><td><a href="#/portfolio/' + esc(p.id) + '">' + esc(p.name) + '</a></td><td class="n">' + p.ccns.length + '</td><td class="muted small">' + (sharedByName(p.name) ? 'Unsaved changes on this device' : 'On this device only') + '</td>' +
        '<td class="n">' + (canShare() && p.ccns.length ? '<button data-share="' + esc(p.id) + '" class="primary">Save for everyone</button> ' : '') + '<button data-del="' + esc(p.id) + '">' + (sharedByName(p.name) ? 'Discard changes' : 'Delete') + '</button></td></tr>';
    })).join('');
    app.innerHTML = '<div class="card"><h1>Portfolios</h1>' +
      '<p class="muted">Everyone sees the same portfolios. Creating, changing, or deleting one opens a short request on GitHub; select "Submit new issue" there and the change shows for everyone about three minutes later.</p>' + pendingBanner() +
      (rowsHtml ? '<div class="scroll"><table><thead><tr><th>Name</th><th class="n">Facilities</th><th></th><th></th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' : '<p>No portfolios yet.</p>') +
      '</div>' +
      '<div class="card"><h2>New portfolio</h2><div class="controls"><input id="pname" type="search" placeholder="Portfolio name" style="max-width:340px"></div>' +
      '<textarea id="pccns" rows="4" placeholder="Optional. Paste CCNs separated by commas, spaces, or new lines, or leave blank and add facilities afterwards. Leading zeros dropped by Excel are restored."></textarea>' +
      '<div class="controls" style="margin-top:10px"><button id="pcreate">Create portfolio</button><span id="pmsg" class="muted small"></span></div></div>' +
      '<div class="card"><h2>CMS chains</h2><p class="muted">Every chain CMS identifies is available as a ready-made portfolio.</p>' +
      '<div class="controls"><input id="cq" type="search" placeholder="Chain name"></div><div id="chains"></div></div>';
    Array.prototype.forEach.call(app.querySelectorAll('[data-sdel]'), function (b) {
      b.addEventListener('click', function () {
        var p = S.shared.filter(function (x) { return x.id === b.dataset.sdel; })[0];
        if (!p || !confirm('Delete "' + p.name + '" for everyone?')) return;
        sendForEveryone('delete', p.name, []);
        renderPortfolios();
      });
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-share]'), function (b) {
      b.addEventListener('click', function () {
        var p = loadPortfolios().filter(function (x) { return x.id === b.dataset.share; })[0];
        if (!p) return;
        sendForEveryone('save', p.name, p.ccns);
        renderPortfolios();
      });
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete this portfolio from this device?')) return;
        savePortfolios(loadPortfolios().filter(function (p) { return p.id !== b.dataset.del; }));
        renderPortfolios();
      });
    });
    var ct = document.getElementById('copytracked');
    if (ct) ct.addEventListener('click', function () {
      var all = [];
      loadPortfolios().forEach(function (p) { p.ccns.forEach(function (c) { if (all.indexOf(c) === -1) all.push(c); }); });
      var text = all.join(','), msg = document.getElementById('trackedmsg');
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { msg.textContent = all.length + ' CCNs copied from ' + loadPortfolios().length + ' portfolios.'; }, function () { prompt('Copy these CCNs', text); });
      else prompt('Copy these CCNs', text);
    });
    document.getElementById('pcreate').addEventListener('click', function () {
      var name = document.getElementById('pname').value.trim(), ccns = Rollup.parseCcns(document.getElementById('pccns').value), msg = document.getElementById('pmsg');
      if (!name) { msg.textContent = 'Enter a name.'; return; }
      if (!ccns.length && document.getElementById('pccns').value.trim()) { msg.textContent = 'No valid CCNs found in the text. Clear the box to create an empty portfolio.'; return; }
      if (sharedByName(name)) { msg.textContent = 'A portfolio with that name already exists. Open it and choose Edit.'; return; }
      var p = createPortfolio(name, ccns);
      if (!p) { msg.textContent = 'This browser would not save the portfolio. Use the link view instead.'; return; }
      if (canShare() && ccns.length) sendForEveryone('save', name, ccns);
      location.hash = '#/portfolio/' + p.id;
    });
    var cq = document.getElementById('cq');
    function drawChains() {
      var t = cq.value.toLowerCase().trim(), C = S.lookups.chains;
      var ids = Object.keys(C).filter(function (id) { return !t || C[id].name.toLowerCase().indexOf(t) !== -1; })
        .sort(function (a, b) { return (C[b].count || 0) - (C[a].count || 0); });
      document.getElementById('chains').innerHTML = '<p class="muted small">' + ids.length + ' chains' + (ids.length > 50 ? ', showing the 50 largest' : '') + '.</p><div class="scroll"><table><thead><tr><th>Chain</th><th class="n">Facilities</th><th class="n">Avg overall rating (CMS)</th></tr></thead><tbody>' +
        ids.slice(0, 50).map(function (id) {
          return '<tr><td><a href="#/chain/' + esc(id) + '">' + esc(C[id].name) + '</a></td><td class="n">' + fmt(C[id].count, 0) + '</td><td class="n">' + fmt(C[id].overall, 1) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    cq.addEventListener('input', drawChains);
    drawChains();
  }

  /* Open a link of the form #/import/<name>/<ccns> to save a named portfolio in
     this browser in one step. The part of a web address after # is never sent
     to the server, so the name stays on this device. Opening the same link
     twice does not create a duplicate. */
  function importPortfolio(rest) {
    var i = rest.indexOf('/');
    var name = '', ccns = [];
    try { name = decodeURIComponent(i === -1 ? rest : rest.slice(0, i)).trim(); } catch (e) { name = ''; }
    if (i !== -1) ccns = Rollup.parseCcns(decodeURIComponent(rest.slice(i + 1)));
    if (!name || !ccns.length) {
      app.innerHTML = '<a class="back" href="#/portfolios">← All portfolios</a><div class="card"><h1>This link is incomplete</h1><p>It needs a portfolio name and at least one CCN.</p></div>';
      return;
    }
    var key = ccns.slice().sort().join(',');
    var existing = loadPortfolios().filter(function (p) { return p.name === name && p.ccns.slice().sort().join(',') === key; })[0];
    var p = existing || createPortfolio(name, ccns);
    if (!p) { drawPortfolio({ title: name, ccns: ccns }); return; }   // storage unavailable: show it unsaved
    location.replace('#/portfolio/' + p.id);
  }

  function renderShared(id) {
    var p = S.shared.filter(function (x) { return x.id === id; })[0];
    if (!p) { app.innerHTML = '<a class="back" href="#/portfolios">← All portfolios</a><div class="card"><h1>Portfolio not found</h1><p>No portfolio has that name.</p></div>'; return; }
    drawPortfolio({ title: p.name, ccns: p.ccns, shared: true });
  }

  function renderSaved(id) {
    var p = loadPortfolios().filter(function (x) { return x.id === id; })[0];
    if (!p) { app.innerHTML = '<a class="back" href="#/portfolios">← Portfolios</a><div class="card"><h1>Portfolio not found</h1><p>This portfolio is not saved in this browser.</p></div>'; return; }
    drawPortfolio({ title: p.name, ccns: p.ccns, savedId: p.id });
  }

  function renderChain(id) {
    var c = S.lookups.chains[id];
    if (!c) { app.innerHTML = '<a class="back" href="#/portfolios">← Portfolios</a><div class="card"><h1>Chain not found</h1><p>No chain with ID ' + esc(id) + ' is in the current CMS release.</p></div>'; return; }
    var ccns = S.index.filter(function (r) { return r[IX.chainId] === id; }).map(function (r) { return r[0]; });
    drawPortfolio({ title: c.name, ccns: ccns, chain: c });
  }

  var PCOLS = [
    ['Facility', IX.name, 's'], ['State', IX.state, 's'], ['Beds', IX.beds, 0], ['Avg residents', IX.residents, 1, 'np'], ['Occupancy (derived)', 'occ', 'p'],
    ['Overall ★', IX.overall, '*'], ['Health ★', IX.health, '*'], ['Staffing ★', IX.staffing, '*'], ['QM ★', IX.qm, '*'],
    ['Nurse HPRD', IX.hprd, 2, 'np'], ['RN HPRD', IX.rnHprd, 2, 'np'], ['Turnover %', IX.turnover, 1, 'np'],
    ['Cycle 1 defs', IX.c1defs, 0], ['Weighted score', IX.weighted, 1, 'np'], ['Harm cites', IX.harm, 0], ['IJ cites', IX.jeopardy, 0],
    ['Repeat tags', IX.repeats, 0, 'np'], ['Fines', IX.fines, 0, 'np'], ['Fine $', IX.fineTotal, '$'], ['Pay denials', IX.denials, 0, 'np'], ['Screening score', IX.risk, 0], ['Flags', 'flags', 'f']
  ];
  function pval(r, key) { return key === 'occ' ? (r[IX.beds] && r[IX.residents] != null ? r[IX.residents] / r[IX.beds] : null) : r[key]; }

  function drawPortfolio(o) {
    var map = byCcn(), rows = [], missing = [];
    o.ccns.forEach(function (c) { if (map[c]) rows.push(map[c]); else missing.push(c); });
    var s = Rollup.summarize(rows), nat = S.lookups.benchmarks.NATION.ratings;
    var sort = { key: IX.name, dir: 1 };
    var US = S.lookups.benchmarks.NATION;
    function avg(m, dec) { return m.avg == null ? NA : fmt(m.avg, dec); }
    function pct(n) { return s.facilities ? fmt(100 * n / s.facilities, 1) + '%' : ''; }
    var h = printHead('Portfolio report') + '<a class="back" href="#/portfolios">← All portfolios</a>' +
      '<div class="phead"><div><h1>' + esc(o.title) + '</h1><div class="sub">' + (o.chain ? 'CMS chain · ' : o.shared ? 'Portfolio · ' : o.savedId ? (sharedByName(o.title) ? 'Unsaved changes on this device · ' : 'On this device only until saved for everyone · ') : 'Unsaved list · ') +
      s.facilities.toLocaleString() + (s.facilities === 1 ? ' facility' : ' facilities') +
      (o.chain && o.chain.count != null && o.chain.count !== s.facilities ? ' (CMS reports ' + o.chain.count + ')' : '') + ' · CMS data as of ' + fdate(S.manifest.processing_date) + '</div></div>' +
      '<div class="controls">' + (o.savedId ? (canShare() ? '<button id="pshare" class="primary"' + (o.ccns.length ? '' : ' disabled') + '>Save for everyone</button>' : '') + '<button id="prename">Rename</button>' :
        o.shared ? '<button id="pedit">Edit</button>' + (canShare() ? '<button id="psdel">Delete</button>' : '') : '<button id="psave" class="primary">Save as portfolio</button>') +
      '<button id="plink">Copy link</button><button id="pxlsx">Download Excel</button><button id="pcsv">CSV</button><button onclick="window.print()">Print / PDF</button></div></div>' +
      (o.savedId || o.shared ? pendingBanner() : '') +
      (s.sff + s.sffCandidates > 0 ? '<div class="callout sffnote"><strong>This portfolio includes ' +
        [s.sff ? s.sff + (s.sff === 1 ? ' Special Focus Facility' : ' Special Focus Facilities') : '', s.sffCandidates ? s.sffCandidates + (s.sffCandidates === 1 ? ' SFF candidate' : ' SFF candidates') : ''].filter(Boolean).join(' and ') +
        '.</strong> ' + rows.filter(function (r) { return r[IX.sff]; }).slice(0, 12).map(function (r) { return '<a href="#/f/' + esc(r[0]) + '">' + esc(r[1]) + '</a> (' + esc(r[IX.sff]) + ')'; }).join(', ') +
        (s.sff + s.sffCandidates > 12 ? ', and ' + (s.sff + s.sffCandidates - 12) + ' more' : '') + '</div>' : '') +
      (missing.length ? '<div class="callout"><strong>' + missing.length + ' CCN' + (missing.length > 1 ? 's are' : ' is') + ' not in the current CMS release:</strong> ' + esc(missing.join(', ')) +
        '<div class="small muted" style="margin-top:4px">A CCN drops out when a facility closes, loses certification, or receives a new CCN. These are excluded from every figure below.</div></div>' : '');
    var addCard = !o.savedId ? '' : '<div class="card addcard"><h2>Add facilities</h2>' +
      '<div class="controls"><input id="addq" type="search" placeholder="Search by facility name, CCN, city, county, ZIP, or chain"></div><div id="addhits"></div>' +
      '<details style="margin-top:8px"><summary class="small">Paste a list of CCNs instead</summary><textarea id="addccns" rows="3" style="margin-top:8px" placeholder="CCNs separated by commas, spaces, or new lines"></textarea>' +
      '<div class="controls" style="margin-top:8px"><button id="addpaste">Add CCNs</button><span id="addpmsg" class="muted small"></span></div></details></div>';
    h += addCard;
    if (!rows.length) {
      app.innerHTML = h + '<div class="card"><p>' + (o.savedId ? 'This portfolio is empty. Add facilities above, or from any facility report or search result.' : 'No facilities to show.') + '</p></div>';
      wire(); wireAdd(); return;
    }

    /* Overview */
    h += '<div class="card strip">' +
      '<div class="stat"><div class="k">Facilities</div><div class="v">' + fmt(s.facilities, 0) + '</div></div>' +
      '<div class="stat"><div class="k">Certified beds</div><div class="v">' + fmt(s.beds, 0) + '</div></div>' +
      '<div class="stat"><div class="k">Average residents per day</div><div class="v">' + fmt(s.residents, 0) + '</div></div>' +
      '<div class="stat"><div class="k">Occupancy (derived)</div><div class="v">' + (s.occupancy == null ? NA : fmt(s.occupancy * 100, 1) + '%') + '</div>' +
      (s.occupancy == null ? '' : '<div class="meter" role="img" aria-label="Occupancy ' + fmt(s.occupancy * 100, 1) + ' percent"><i style="width:' + Math.min(100, s.occupancy * 100).toFixed(1) + '%"></i></div>') +
      '<div class="s">Residents ÷ beds at ' + s.occupancyFacilities + ' facilities reporting both</div></div></div>';

    /* Star ratings */
    var D = s.distribution;
    var legend = '<span class="legend">' + [1, 2, 3, 4, 5].map(function (k) { return '<span><i class="s' + k + '"></i>' + k + ' star' + (k > 1 ? 's' : '') + '</span>'; }).join('') + '<span><i class="sna"></i>Not rated</span></span>';
    function seg(key, label) {
      var d = D[key], total = s.facilities;
      var parts = [1, 2, 3, 4, 5, 'unrated'].map(function (k) {
        var n = d[k];
        if (!n) return '';
        var share = n / total, name = k === 'unrated' ? 'Not rated' : k + (k === 1 ? ' star' : ' stars');
        return '<span class="' + (k === 'unrated' ? 'sna' : 's' + k) + (share < 0.07 ? ' tight' : '') + '" style="flex:' + n + ' 1 0" tabindex="0" data-tip="' + esc(label + ', ' + name + ': ' + n + ' of ' + total + ' facilities (' + fmt(share * 100, 1) + '%)') + '">' + (share < 0.07 ? '' : n) + '</span>';
      }).join('');
      return '<div class="seg" role="img" aria-label="' + esc(label + ' distribution: ' + [1, 2, 3, 4, 5].map(function (k) { return d[k] + ' at ' + k + ' star' + (k > 1 ? 's' : ''); }).join(', ') + ', ' + d.unrated + ' not rated') + '">' + parts + '</div>';
    }
    function rcard(label, key, natKey, chainVal) {
      var m = s.ratings[key];
      return '<div class="card rcard"><div class="top2"><div><div class="stat"><div class="k">' + label + '</div></div><div class="v">' + avg(m, 2) + (m.avg == null ? '' : '<span class="stars">★</span>') + '</div></div>' +
        '<div class="cmp">US average <b>' + fmt(US.ratings[natKey], 1) + '</b>' + (o.chain ? '<br>CMS chain average <b>' + fmt(chainVal, 1) + '</b>' : '') + '<br><span class="muted">' + m.n + ' of ' + s.facilities + ' rated</span></div></div>' + seg(key, label) + '</div>';
    }
    h += '<div class="sect"><span>Star ratings <span class="muted" style="font-weight:400">· simple average of rated facilities</span></span>' + legend + '</div><div class="rgrid">' +
      rcard('Overall rating', 'overall', 'Overall Rating', o.chain && o.chain.overall) + rcard('Health inspection rating', 'health', 'Health Inspection Rating', o.chain && o.chain.health) +
      rcard('Staffing rating', 'staffing', 'Staffing Rating', o.chain && o.chain.staffing) + rcard('Quality measure rating', 'qm', 'QM Rating', o.chain && o.chain.qm) + '</div>' +
      '<details class="printopen" style="margin-top:10px"><summary class="small">View rating distribution as a table</summary><div class="card" style="margin-top:10px"><div class="scroll"><table style="max-width:680px"><thead><tr><th>Rating</th><th class="n">Overall</th><th class="n">Health inspection</th><th class="n">Staffing</th><th class="n">Quality measures</th></tr></thead><tbody>' +
      [5, 4, 3, 2, 1, 'unrated'].map(function (k) {
        return '<tr><td>' + (k === 'unrated' ? '<span class="na">Not rated</span>' : stars(k)) + '</td>' + ['overall', 'health', 'staffing', 'qm'].map(function (c) { return '<td class="n">' + D[c][k] + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></div></details>';

    /* Risk indicators */
    function risk(label, value, sub, share, cls) {
      var zero = value === 0 || value === '$0';
      return '<div class="row ' + (cls || '') + '"><div class="lab">' + label + '</div><div class="val' + (zero ? ' zero' : '') + '">' + value + '</div>' +
        (sub ? '<div class="sub">' + sub + '</div>' : '') +
        (share == null ? '' : '<div class="meter" aria-hidden="true"><i style="width:' + Math.min(100, share * 100).toFixed(1) + '%"></i></div>') + '</div>';
    }
    var n = s.facilities;
    var fac = function (k) { return k + (k === 1 ? ' facility' : ' facilities'); };
    h += '<div class="sect"><span>Risk indicators</span></div><div class="card risk"><div>' +
      risk('Facilities with a 1-star overall rating', s.oneStar, pct(s.oneStar) + ' of facilities', s.oneStar / n) +
      risk('Special Focus Facilities', s.sff, pct(s.sff) + ' of facilities', s.sff / n) +
      risk('SFF candidates', s.sffCandidates, pct(s.sffCandidates) + ' of facilities', s.sffCandidates / n) +
      risk('Facilities with the abuse icon', s.abuse, pct(s.abuse) + ' of facilities', s.abuse / n) +
      risk('Changed ownership in the last 12 months', s.chow, pct(s.chow) + ' of facilities', s.chow / n) +
      '</div><div>' +
      (function () {
        var RL = S.lookups.risk, top = RL.tiers[RL.tiers.length - 1], hi = Rollup.countTopTier(rows, top[0]);
        return risk('Average regulatory screening score', s.risk.avg == null ? NA : fmt(s.risk.avg, 0),
          hi + (hi === 1 ? ' facility is ' : ' facilities are ') + esc(top[2]) + ' (score of ' + top[0] + ' or higher, or SFF or SFF candidate) · not a CMS figure · <a href="#/risk">How it works</a>', hi / n);
      })() +
      risk('Immediate jeopardy citations', s.jeopardy, 'Scope and severity J to L, last 3 inspection cycles · at ' + fac(s.facilitiesWithJeopardy) + ' (' + pct(s.facilitiesWithJeopardy) + ')', s.facilitiesWithJeopardy / n) +
      risk('Actual harm citations', s.harm, 'Scope and severity G to I, last 3 inspection cycles') +
      risk('Repeat citations', s.repeats, 'Health tags cited in more than one of the last three inspection cycles') +
      risk('Fines, last 3 years', money(s.fineTotal), s.fines + (s.fines === 1 ? ' fine' : ' fines')) +
      risk('Payment denials, last 3 years', s.denials, 'Denials of payment for new admissions') +
      '</div></div>';

    /* Staffing */
    function stile(label, m, dec, unit, usKey) {
      return '<div class="tile"><div class="k">' + label + '</div><div class="v">' + (m.avg == null ? NA : fmt(m.avg, dec) + unit) + '</div><div class="s">US average ' + fmt(US.staffing[usKey], dec) + unit + ' · ' + m.n + ' of ' + n + ' reporting</div></div>';
    }
    h += '<div class="sect"><span>Staffing <span class="muted" style="font-weight:400">· simple average of reporting facilities</span></span></div><div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">' +
      stile('Total nurse hours per resident day', s.hprd, 2, '', 'Total nurse hours per resident day') +
      stile('RN hours per resident day', s.rnHprd, 2, '', 'RN hours per resident day') +
      stile('Total nursing staff turnover', s.turnover, 1, '%', 'Total nursing staff turnover (%)') + '</div>';

    h += '<div class="sect newpage"><span>Facilities <span class="muted noprint" style="font-weight:400">· select a column heading to sort</span></span></div><div class="card" style="padding:6px 8px"><div class="scroll ptable" id="ptable"></div></div>' +
      '<p class="src printonly">The printed table shows the main columns. Average residents, staffing hours, turnover, weighted survey score, repeat tags, and fine and denial counts are on screen and in the Excel download.</p>' +
      '<p class="src">Portfolio figures are derived from published facility values. Averages are simple averages of facilities with a published value, the method CMS uses for chain averages; the pipeline confirms that method against every CMS chain at each refresh. Source: CMS Provider Information and Health Deficiencies, processing date ' + fdate(S.manifest.processing_date) + '.</p>';
    app.innerHTML = h;

    function cell(r, c) {
      var v = pval(r, c[1]), t = c[2];
      if (t === 'f') return '<td>' + (r[IX.sff] ? '<span class="chip ' + (r[IX.sff] === 'SFF' ? 'bad' : 'warn') + '">' + esc(r[IX.sff]) + '</span> ' : '') + (r[IX.abuse] ? '<span class="chip bad">Abuse</span> ' : '') + (r[IX.chow] ? '<span class="chip warn">CHOW</span>' : '') + '</td>';
      if (c[1] === IX.name) return '<td><a class="fname" href="#/f/' + esc(r[0]) + '">' + esc(v) + '</a><div class="muted small">' + esc(r[0]) + ' · ' + esc(r[IX.city]) + '</div></td>';
      if (t === 's') return '<td>' + esc(v) + '</td>';
      if (t === '*') return '<td class="n">' + (v == null ? '<span class="na" title="Not rated">NR</span>' : '<i class="sw s' + v + '" aria-hidden="true"></i>' + v) + '</td>';
      if (t === 'p') return '<td class="n">' + (v == null ? NA : fmt(v * 100, 1) + '%') + '</td>';
      if (t === '$') return '<td class="n">' + money(v) + '</td>';
      return '<td class="n">' + fmt(v, t) + '</td>';
    }
    function drawTable() {
      var sorted = rows.slice().sort(function (a, b) {
        var x = pval(a, sort.key), y = pval(b, sort.key);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
      document.getElementById('ptable').innerHTML = '<table><thead><tr>' + PCOLS.map(function (c, i) {
        return '<th' + (c[3] ? ' data-np' : '') + ' class="' + (typeof c[2] === 'number' || '*p$'.indexOf(c[2]) !== -1 ? 'n' : '') + (sort.key === c[1] ? ' sorted' : '') + '"' + (c[1] === 'flags' ? '' : ' data-i="' + i + '"') + (sort.key === c[1] ? ' aria-sort="' + (sort.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' + c[0] + (sort.key === c[1] ? (sort.dir > 0 ? ' ↑' : ' ↓') : '') + '</th>';
      }).join('') + (o.savedId ? '<th></th>' : '') + '</tr></thead><tbody>' + sorted.map(function (r) {
        return '<tr>' + PCOLS.map(function (c) { var td = cell(r, c); return c[3] ? td.replace('<td', '<td data-np') : td; }).join('') + (o.savedId ? '<td><button data-rm="' + esc(r[0]) + '">Remove</button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
      Array.prototype.forEach.call(document.querySelectorAll('#ptable th[data-i]'), function (th) {
        th.addEventListener('click', function () {
          var key = PCOLS[+th.dataset.i][1];
          sort = sort.key === key ? { key: key, dir: -sort.dir } : { key: key, dir: 1 };
          drawTable();
        });
      });
      Array.prototype.forEach.call(document.querySelectorAll('#ptable [data-rm]'), function (b) {
        b.addEventListener('click', function () {
          var l = loadPortfolios();
          l.forEach(function (p) { if (p.id === o.savedId) p.ccns = p.ccns.filter(function (c) { return c !== b.dataset.rm; }); });
          savePortfolios(l);
          drawPortfolio({ title: o.title, ccns: o.ccns.filter(function (c) { return c !== b.dataset.rm; }), savedId: o.savedId, keepScroll: true });
        });
      });
    }
    drawTable();
    wire();
    wireAdd();
    if (!o.keepScroll) window.scrollTo(0, 0);

    function wireAdd() {
      if (!o.savedId) return;
      var aq = document.getElementById('addq'), box = document.getElementById('addhits');
      function refresh() { drawPortfolio({ title: o.title, ccns: (loadPortfolios().filter(function (p) { return p.id === o.savedId; })[0] || { ccns: [] }).ccns, savedId: o.savedId, keepScroll: true }); }
      function hits() {
        S.addq = aq.value;
        if (!aq.value.trim()) { box.innerHTML = ''; return; }
        var m = matchRows(aq.value, '');
        box.innerHTML = '<p class="muted small">' + m.length.toLocaleString() + ' matching facilities' + (m.length > 10 ? ', showing the first 10. Add more words to narrow the list' : '') + '.</p>' +
          (m.length ? '<table><tbody>' + m.slice(0, 10).map(function (r) {
            var inP = o.ccns.indexOf(r[0]) !== -1;
            return '<tr><td>' + esc(r[1]) + '<div class="muted small">' + esc(r[0]) + ' · ' + esc(r[2]) + ', ' + esc(r[3]) + (r[6] ? ' · ' + esc(r[6]) : '') + '</div></td><td class="n"><button data-add="' + esc(r[0]) + '"' + (inP ? ' disabled' : '') + '>' + (inP ? 'In portfolio' : '+ Add') + '</button></td></tr>';
          }).join('') + '</tbody></table>' : '');
        Array.prototype.forEach.call(box.querySelectorAll('[data-add]'), function (b) {
          b.addEventListener('click', function () { if (addCcns(o.savedId, [b.dataset.add])) refresh(); });
        });
      }
      aq.addEventListener('input', hits);
      if (o.keepScroll && S.addq) { aq.value = S.addq; hits(); aq.focus(); }
      else S.addq = '';
      document.getElementById('addpaste').addEventListener('click', function () {
        var ccns = Rollup.parseCcns(document.getElementById('addccns').value), msg = document.getElementById('addpmsg');
        if (!ccns.length) { msg.textContent = 'No valid CCNs found.'; return; }
        if (addCcns(o.savedId, ccns)) { S.addq = ''; refresh(); } else msg.textContent = 'Could not save.';
      });
      document.getElementById('prename').addEventListener('click', function () {
        var name = prompt('New name for this portfolio', o.title);
        if (!name || !name.trim()) return;
        var l = loadPortfolios();
        l.forEach(function (p) { if (p.id === o.savedId) p.name = name.trim(); });
        if (savePortfolios(l)) renderSaved(o.savedId);
      });
    }

    function wire() {
      var link = location.origin + location.pathname + '#/p/' + o.ccns.join(',');
      var pl = document.getElementById('plink'), ps = document.getElementById('psave'), pc = document.getElementById('pcsv');
      pl.addEventListener('click', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { pl.textContent = 'Link copied'; }, function () { prompt('Copy this link', link); });
        else prompt('Copy this link', link);
      });
      if (ps) ps.addEventListener('click', function () {
        var name = prompt('Portfolio name', o.title === 'Portfolio' ? '' : o.title);
        if (!name || !name.trim()) return;
        var l = loadPortfolios(), p = { id: newId(), name: name.trim(), ccns: o.ccns.slice() };
        l.push(p);
        if (savePortfolios(l)) location.hash = '#/portfolio/' + p.id; else ps.textContent = 'Could not save';
      });
      pc.addEventListener('click', function () { downloadCsv(o.title, rows); });
      var psh = document.getElementById('pshare'), ped = document.getElementById('pedit'), psd = document.getElementById('psdel');
      if (psh) psh.addEventListener('click', function () { sendForEveryone('save', o.title, o.ccns); renderSaved(o.savedId); });
      if (ped) ped.addEventListener('click', function () {
        // Editing works on a copy held on this device until it is saved for everyone
        var mine = loadPortfolios().filter(function (x) { return pslug(x.name) === pslug(o.title); })[0] || createPortfolio(o.title, o.ccns.slice());
        if (mine) location.hash = '#/portfolio/' + mine.id; else ped.textContent = 'Could not start editing';
      });
      if (psd) psd.addEventListener('click', function () {
        if (!confirm('Delete "' + o.title + '" for everyone?')) return;
        sendForEveryone('delete', o.title, []);
        location.hash = '#/portfolios';
      });

      document.getElementById('pxlsx').addEventListener('click', function () {
        exportXlsx(fileSafe(o.title) + '_portfolio_' + S.manifest.processing_date + '.xlsx', portfolioSheets(o.title, rows, s, missing), this);
      });
      setPrintFooter('Bravo Capital · SNF Analytics · ' + o.title + ' · ' + s.facilities + ' facilities · CMS data as of ' + fdate(S.manifest.processing_date));
    }
  }

  function csvText(rows) {
    var head = ['CCN', 'Facility', 'City', 'State', 'Chain', 'Certified beds', 'Avg residents per day', 'Occupancy (derived)', 'Overall rating', 'Health inspection rating', 'Staffing rating', 'QM rating',
      'Total nurse HPRD', 'RN HPRD', 'Total nursing turnover %', 'Cycle 1 health deficiencies', 'Total weighted health survey score', 'Actual harm citations (3 cycles)', 'Immediate jeopardy citations (3 cycles)',
      'Fines', 'Fine dollars', 'Payment denials', 'Special focus status', 'Abuse icon', 'Changed ownership in last 12 months'];
    var DQ = '"';
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? DQ + v.replace(/"/g, DQ + DQ) + DQ : v; };
    var lines = [head.join(',')].concat(rows.map(function (r) {
      var occ = pval(r, 'occ');
      // The ="015009" form keeps Excel from stripping the CCN's leading zeros
      return [q('="' + r[0] + '"')].concat([r[IX.name], r[IX.city], r[IX.state], r[IX.chain], r[IX.beds], r[IX.residents], occ == null ? '' : occ.toFixed(4), r[IX.overall], r[IX.health], r[IX.staffing], r[IX.qm],
        r[IX.hprd], r[IX.rnHprd], r[IX.turnover], r[IX.c1defs], r[IX.weighted], r[IX.harm], r[IX.jeopardy], r[IX.fines], r[IX.fineTotal], r[IX.denials], r[IX.sff], r[IX.abuse] ? 'Y' : 'N', r[IX.chow] ? 'Y' : 'N'
      ].map(q)).join(',');
    }));
    lines.push('', q('Source: CMS Provider Data Catalog, processing date ' + S.manifest.processing_date + '. Blank means not available. Occupancy is derived.'));
    return '﻿' + lines.join('\r\n');
  }
  function downloadCsv(title, rows) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csvText(rows)], { type: 'text/csv' }));
    a.download = (title || 'portfolio').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_' + S.manifest.processing_date + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- Shared: Excel export ---------- */
  var scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise(function (resolve, reject) {
        var el = document.createElement('script');
        el.src = src; el.onload = resolve; el.onerror = function () { delete scripts[src]; reject(new Error('Could not load ' + src)); };
        document.head.appendChild(el);
      });
    }
    return scripts[src];
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  function fileSafe(s) { return String(s || 'report').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60); }

  /* sheets: [{ name, title, note, columns: [{ header, width, fmt, wrap }], rows: [[...]], totals: bool }]
     Values are written as real numbers so they can be summed and sorted in Excel.
     A blank cell means CMS did not publish a value. */
  function exportXlsx(filename, sheets, btn) {
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    return Promise.all([loadScript('vendor/exceljs.min.js'), fetch('vendor/bravo-logo.png').then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; })]).then(function (got) {
      var wb = new ExcelJS.Workbook();
      wb.creator = 'Bravo Capital';
      wb.company = 'Bravo Capital';
      var logo = got[1] ? wb.addImage({ buffer: got[1], extension: 'png' }) : null;
      wb.created = new Date();
      var INK = 'FF141A26', MUTED = 'FF5B6578', HEAD = 'FFE8F1FC', LINE = 'FFD0D5DD';
      sheets.forEach(function (sh) {
        var ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 5, showGridLines: false }] });
        ws.getRow(1).height = 36;
        if (logo != null) ws.addImage(logo, { tl: { col: 0, row: 0.12 }, ext: { width: 99, height: 30 }, editAs: 'oneCell' });
        else { ws.getCell('A1').value = 'Bravo Capital'; ws.getCell('A1').font = { name: 'Calibri', size: 12, bold: true, color: { argb: INK } }; }
        ws.getCell('A2').value = sh.title;
        ws.getCell('A2').font = { name: 'Calibri', size: 14, bold: true, color: { argb: INK } };
        ws.getCell('A3').value = (sh.note ? sh.note + ' ' : '') + 'Source: CMS Provider Data Catalog, processing date ' + S.manifest.processing_date + '. Blank cells were not published by CMS.';
        ws.getCell('A3').font = { name: 'Calibri', size: 9, italic: true, color: { argb: MUTED } };
        var hr = ws.getRow(5);
        sh.columns.forEach(function (c, i) {
          var cell = hr.getCell(i + 1);
          cell.value = c.header;
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } };
          cell.border = { bottom: { style: 'thin', color: { argb: 'FF256ABF' } } };
          cell.alignment = { vertical: 'middle', wrapText: true, horizontal: c.fmt ? 'right' : 'left' };
          ws.getColumn(i + 1).width = c.width || 14;
        });
        hr.height = 30;
        sh.rows.forEach(function (r, ri) {
          var row = ws.getRow(6 + ri);
          r.forEach(function (v, i) {
            var c = sh.columns[i] || {}, cell = row.getCell(i + 1);
            cell.value = v == null ? null : v;
            cell.font = { name: 'Calibri', size: 10, color: { argb: INK }, bold: !!(sh.boldFirst && i === 0) };
            if (c.fmt && typeof v === 'number') cell.numFmt = c.fmt;
            cell.alignment = { vertical: 'top', wrapText: !!c.wrap, horizontal: c.fmt && typeof v === 'number' ? 'right' : 'left' };
            cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
          });
        });
        if (sh.rows.length && !sh.noFilter) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + sh.rows.length, column: sh.columns.length } };
        ws.pageSetup = { orientation: sh.columns.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
        ws.pageSetup.printTitlesRow = '5:5';
        ws.headerFooter = { oddFooter: '&L&8Bravo Capital · SNF Analytics · CMS data as of ' + fdate(S.manifest.processing_date) + '&R&8Page &P of &N' };
      });
      return wb.xlsx.writeBuffer();
    }).then(function (buf) {
      saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    }).catch(function (e) { alert('The Excel file could not be created: ' + e.message); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = label; } });
  }
  window.__exportXlsx = exportXlsx; // exposed for automated tests only

  /* ---------- Excel workbooks ---------- */
  function facilitySheets(f) {
    var L = S.lookups, bs = L.benchmarks[f.state] || { staffing: {}, qm: {}, ratings: {} }, bn = L.benchmarks.NATION, R = f.ratings, sv = f.survey, P = f.penalties;
    var who = f.name + ' (CCN ' + f.ccn + ')';
    var fnv = function (r) { return r[0] == null ? (r[1] ? 'Not rated: ' + fnText(r[1]) : 'Not rated') : r[0]; };
    var yn = function (v) { return v == null ? '' : v ? 'Yes' : 'No'; };
    var D = f.deficiencies;
    var summary = [
      ['Facility', f.name], ['CCN', f.ccn], ['Address', f.address + ', ' + f.city + ', ' + f.state + ' ' + f.zip], ['County', f.county || ''],
      ['Legal name', f.legal_name || ''], ['Ownership type', f.ownership_type || ''], ['Participation', f.provider_type || ''],
      ['Chain', f.chain ? f.chain.name : 'None reported'], ['Certified since', f.certified || ''],
      ['Certified beds', f.beds], ['Average residents per day', f.residents], ['Occupancy (derived: residents / beds)', f.occupancy == null ? null : Math.round(f.occupancy * 10000) / 10000],
      ['Overall rating', fnv(R.overall)], ['Health inspection rating', fnv(R.health)], ['Staffing rating', fnv(R.staffing)], ['Quality measure rating', fnv(R.qm)],
      ['Long-stay QM rating', fnv(R.qm_long)], ['Short-stay QM rating', fnv(R.qm_short)],
      ['Special focus status', f.sff || 'None'], ['Abuse icon', yn(f.abuse)], ['Changed ownership in last 12 months', yn(f.chow_12m)],
      ['Most recent health inspection more than 2 years ago', yn(f.insp_over_2y)], ['Sprinklers in all required areas', f.sprinklers || ''],
      ['Immediate jeopardy citations, last 3 cycles', D.filter(function (d) { return d[1] === 'H' && 'JKL'.indexOf(d[3]) !== -1; }).length],
      ['Actual harm citations, last 3 cycles', D.filter(function (d) { return d[1] === 'H' && 'GHI'.indexOf(d[3]) !== -1; }).length],
      ['Repeat citation tags', (f.repeat || []).join(', ')],
      ['Fines, last 3 years', P.fines], ['Fine dollars, last 3 years', P.fine_total], ['Payment denials, last 3 years', P.denials],
      ['Total weighted health survey score', sv.weighted],
      ['Regulatory screening score (not a CMS figure)', f.risk.score], ['Screening score risk tier', f.risk.tier], ['Screening score national percentile', f.risk.pct_us], ['Screening score state percentile', f.risk.pct_state]
    ];
    if (f.pbj) summary.push(['Contract staff share of nurse hours (derived, ' + L.pbj.quarter + ')', Math.round(f.pbj.contract_share * 10000) / 10000], ['Days with no RN hours reported (' + L.pbj.quarter + ')', f.pbj.zero_rn_days]);
    if (f.vbp) summary.push(['FY ' + L.vbp_fy + ' VBP incentive payment multiplier', f.vbp.multiplier], ['FY ' + L.vbp_fy + ' VBP performance score', f.vbp.score], ['FY ' + L.vbp_fy + ' VBP national ranking', f.vbp.ranking]);
    var sheets = [{ name: 'Summary', title: who, noFilter: true, boldFirst: true, columns: [{ header: 'Item', width: 52 }, { header: 'Value', width: 46, wrap: true }], rows: summary }];
    sheets.push({ name: 'Screening score', title: who + ': regulatory screening score ' + f.risk.score + ' of 100 (' + f.risk.tier + ')', note: 'A Bravo screening aid for regulatory risk, not a CMS figure.', noFilter: true,
      columns: [{ header: 'Component', width: 34 }, { header: 'How points are assigned', width: 80, wrap: true }, { header: 'Maximum', width: 10, fmt: '0' }, { header: 'Points', width: 9, fmt: '0' }],
      rows: L.risk.components.map(function (c) { return [c[1], c[2], c[3], f.risk.parts[c[0]]]; }).concat([['Total', '', 100, f.risk.score]]) });
    if (f.history) sheets.push({ name: 'Rating history', title: who + ': published star ratings by CMS release',
      columns: [{ header: 'CMS release', width: 13 }, { header: 'Overall', width: 10, fmt: '0' }, { header: 'Health inspection', width: 12, fmt: '0' }, { header: 'Staffing', width: 10, fmt: '0' }, { header: 'Quality measures', width: 12, fmt: '0' }],
      rows: f.history.dates.map(function (d, i) { return [d, f.history.overall[i], f.history.health[i], f.history.staffing[i], f.history.qm[i]]; }).reverse() });
    sheets.push({ name: 'Inspections', title: who + ': health inspection rating cycles', noFilter: true,
      columns: [{ header: 'Rating cycle', width: 24 }, { header: 'Standard survey date', width: 14 }, { header: 'Health deficiencies', width: 12, fmt: '0' }, { header: 'From complaints', width: 12, fmt: '0' }, { header: 'Deficiency score', width: 12, fmt: '0' }, { header: 'Revisits', width: 10, fmt: '0' }, { header: 'Revisit score', width: 10, fmt: '0' }, { header: 'Total score', width: 10, fmt: '0.000' }],
      rows: [['Cycle 1 (most recent)', sv.c1.date, sv.c1.total, sv.c1.complaint, sv.c1.def_score, sv.c1.revisits, sv.c1.revisit_score, sv.c1.score],
        ['Cycles 2 and 3', sv.c23.date, sv.c23.total, sv.c23.complaint, sv.c23.def_score, sv.c23.revisits, sv.c23.revisit_score, sv.c23.score],
        ['Total weighted health survey score', '', null, null, null, null, null, sv.weighted]] });
    sheets.push({ name: 'Deficiencies', title: who + ': deficiencies cited, three most recent inspection cycles',
      columns: [{ header: 'Survey date', width: 12 }, { header: 'Type', width: 11 }, { header: 'Tag', width: 8 }, { header: 'Scope and severity', width: 9 }, { header: 'Cycle', width: 7 }, { header: 'Deficiency', width: 70, wrap: true }, { header: 'Category', width: 34, wrap: true },
        { header: 'Standard survey', width: 9 }, { header: 'Complaint', width: 9 }, { header: 'Infection control', width: 9 }, { header: 'Repeat tag', width: 8 }, { header: 'Correction status', width: 30, wrap: true }, { header: 'Correction date', width: 12 }],
      rows: D.map(function (d) { var ds = L.descs[d[5]] || ['', '']; return [d[0], d[1] === 'H' ? 'Health' : 'Fire safety', d[2], d[3], d[4], ds[0], ds[1], d[6] ? 'Y' : 'N', d[7] ? 'Y' : 'N', d[8] ? 'Y' : 'N', d[1] === 'H' && (f.repeat || []).indexOf(d[2]) !== -1 ? 'Y' : 'N', d[9], d[10]]; }) });
    sheets.push({ name: 'Staffing', title: who + ': staffing',
      columns: [{ header: 'Measure', width: 48 }, { header: 'Facility', width: 11, fmt: '0.000' }, { header: f.state + ' average', width: 11, fmt: '0.000' }, { header: 'US average', width: 11, fmt: '0.000' }],
      rows: f.staffing.map(function (r) { return [r[0], r[1], bs.staffing[r[0]], bn.staffing[r[0]]]; }) });
    sheets.push({ name: 'Quality measures', title: who + ': quality measures',
      columns: [{ header: 'Measure', width: 76, wrap: true }, { header: 'Stay', width: 11 }, { header: 'Used in Five-Star', width: 9 }, { header: 'Facility', width: 10, fmt: '0.00' }, { header: f.state + ' average', width: 10, fmt: '0.00' }, { header: 'US average', width: 10, fmt: '0.00' }, { header: 'Period', width: 24 }, { header: 'Note', width: 50, wrap: true }],
      rows: f.qm.map(function (q) { var m = L.measures[q[0]] || {}; return [m.desc, m.type, m.five_star ? 'Y' : 'N', q[1], bs.qm[q[0]], bn.qm[q[0]], period(m.period), q[1] == null && q[2] ? fnText(q[2]) : '']; }) });
    sheets.push({ name: 'Penalties', title: who + ': penalties, last three years',
      columns: [{ header: 'Penalty date', width: 13 }, { header: 'Type', width: 16 }, { header: 'Fine amount', width: 13, fmt: '$#,##0' }, { header: 'Denial start', width: 13 }, { header: 'Denial length (days)', width: 12, fmt: '0' }],
      rows: P.rows.map(function (r) { return [r[0], r[1], r[1] === 'Fine' ? r[2] : null, r[3], r[4]]; }) });
    sheets.push({ name: 'Ownership', title: who + ': ownership and management',
      columns: [{ header: 'Name', width: 40 }, { header: 'Role', width: 46 }, { header: 'Type', width: 14 }, { header: 'Ownership', width: 16 }, { header: 'Associated since', width: 14 }],
      rows: f.owners.map(function (o) { return [o[2], o[0], o[1], o[3], (o[4] || '').replace(/^since\s+/i, '')]; }) });
    return sheets;
  }

  function portfolioSheets(title, rows, s, missing) {
    var US = S.lookups.benchmarks.NATION, r4 = function (v) { return v == null ? null : Math.round(v * 10000) / 10000; };
    var summary = [
      ['Facilities', s.facilities], ['Certified beds', s.beds], ['Average residents per day', Math.round(s.residents * 10) / 10],
      ['Occupancy (derived: residents / beds, ' + s.occupancyFacilities + ' facilities reporting both)', r4(s.occupancy)],
      ['Average overall rating (' + s.ratings.overall.n + ' rated)', r4(s.ratings.overall.avg)], ['US average overall rating', US.ratings['Overall Rating']],
      ['Average health inspection rating (' + s.ratings.health.n + ' rated)', r4(s.ratings.health.avg)], ['US average health inspection rating', US.ratings['Health Inspection Rating']],
      ['Average staffing rating (' + s.ratings.staffing.n + ' rated)', r4(s.ratings.staffing.avg)], ['US average staffing rating', US.ratings['Staffing Rating']],
      ['Average quality measure rating (' + s.ratings.qm.n + ' rated)', r4(s.ratings.qm.avg)], ['US average quality measure rating', US.ratings['QM Rating']],
      ['Facilities with a 1-star overall rating', s.oneStar], ['Special Focus Facilities', s.sff], ['SFF candidates', s.sffCandidates],
      ['Facilities with the abuse icon', s.abuse], ['Changed ownership in the last 12 months', s.chow],
      ['Immediate jeopardy citations, last 3 cycles', s.jeopardy], ['Facilities with immediate jeopardy citations', s.facilitiesWithJeopardy],
      ['Actual harm citations, last 3 cycles', s.harm], ['Repeat citation tags', s.repeats],
      ['Fines, last 3 years', s.fines], ['Fine dollars, last 3 years', s.fineTotal], ['Payment denials, last 3 years', s.denials],
      ['Average total nurse hours per resident day (' + s.hprd.n + ' reporting)', r4(s.hprd.avg)], ['Average RN hours per resident day (' + s.rnHprd.n + ' reporting)', r4(s.rnHprd.avg)],
      ['Average total nursing staff turnover % (' + s.turnover.n + ' reporting)', r4(s.turnover.avg)],
      ['Average regulatory screening score (not a CMS figure)', r4(s.risk.avg)]
    ];
    if (missing.length) summary.push(['CCNs not in the current CMS release (excluded)', missing.join(', ')]);
    var D = s.distribution;
    return [
      { name: 'Summary', title: title + ': portfolio summary', note: 'Averages are simple averages of facilities with a published value.', noFilter: true, boldFirst: true, columns: [{ header: 'Item', width: 66 }, { header: 'Value', width: 22, wrap: true }], rows: summary },
      { name: 'Rating distribution', title: title + ': facilities at each star level', noFilter: true,
        columns: [{ header: 'Rating', width: 14 }, { header: 'Overall', width: 11, fmt: '0' }, { header: 'Health inspection', width: 11, fmt: '0' }, { header: 'Staffing', width: 11, fmt: '0' }, { header: 'Quality measures', width: 11, fmt: '0' }],
        rows: [5, 4, 3, 2, 1, 'unrated'].map(function (k) { return [k === 'unrated' ? 'Not rated' : k + (k === 1 ? ' star' : ' stars'), D.overall[k], D.health[k], D.staffing[k], D.qm[k]]; }) },
      { name: 'Facilities', title: title + ': facilities',
        columns: [{ header: 'CCN', width: 9 }, { header: 'Facility', width: 42 }, { header: 'City', width: 18 }, { header: 'State', width: 7 }, { header: 'Chain', width: 30 },
          { header: 'Certified beds', width: 9, fmt: '#,##0' }, { header: 'Avg residents per day', width: 10, fmt: '#,##0.0' }, { header: 'Occupancy (derived)', width: 10, fmt: '0.0%' },
          { header: 'Overall rating', width: 8, fmt: '0' }, { header: 'Health inspection rating', width: 9, fmt: '0' }, { header: 'Staffing rating', width: 8, fmt: '0' }, { header: 'QM rating', width: 8, fmt: '0' },
          { header: 'Total nurse HPRD', width: 9, fmt: '0.00' }, { header: 'RN HPRD', width: 8, fmt: '0.00' }, { header: 'Nursing turnover %', width: 9, fmt: '0.0' },
          { header: 'Cycle 1 health deficiencies', width: 10, fmt: '0' }, { header: 'Weighted health survey score', width: 10, fmt: '0.0' }, { header: 'Actual harm citations', width: 9, fmt: '0' }, { header: 'Immediate jeopardy citations', width: 9, fmt: '0' }, { header: 'Repeat citation tags', width: 9, fmt: '0' },
          { header: 'Fines', width: 7, fmt: '0' }, { header: 'Fine dollars', width: 12, fmt: '$#,##0' }, { header: 'Payment denials', width: 8, fmt: '0' },
          { header: 'Regulatory screening score', width: 10, fmt: '0' }, { header: 'Special focus status', width: 14 }, { header: 'Abuse icon', width: 7 }, { header: 'Changed ownership, 12 months', width: 10 }],
        rows: rows.map(function (r) {
          var occ = r[IX.beds] && r[IX.residents] != null ? r[IX.residents] / r[IX.beds] : null;
          return [r[0], r[IX.name], r[IX.city], r[IX.state], r[IX.chain], r[IX.beds], r[IX.residents], occ, r[IX.overall], r[IX.health], r[IX.staffing], r[IX.qm], r[IX.hprd], r[IX.rnHprd], r[IX.turnover],
            r[IX.c1defs], r[IX.weighted], r[IX.harm], r[IX.jeopardy], r[IX.repeats], r[IX.fines], r[IX.fineTotal], r[IX.denials], r[IX.risk], r[IX.sff] || '', r[IX.abuse] ? 'Y' : 'N', r[IX.chow] ? 'Y' : 'N'];
        }) }
    ];
  }

  /* ---------- Shared: print header and footer ---------- */
  function printHead(kind, title, sub) {
    return '<div class="printhead"><img class="ph-logo" src="vendor/bravo-logo.png" alt="Bravo Capital"><div class="ph-kind">SNF Analytics · ' + esc(kind) + '</div>' +
      '<div class="ph-meta">CMS data as of ' + fdate(S.manifest.processing_date) + ' · Prepared ' + new Date().toLocaleDateString('en-US') + '</div></div>';
  }
  function setPrintFooter(text, landscape) {
    var el = document.getElementById('printfoot-style') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'printfoot-style' }));
    var safe = String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
    el.textContent = '@page { ' + (landscape ? 'size: letter landscape; ' : '') + '@bottom-left { content: "' + safe + '"; font: 8pt system-ui, sans-serif; color: #5b6578; } ' +
      '@bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt system-ui, sans-serif; color: #5b6578; } }';
  }

  /* ---------- Shared: rating history chart ---------- */
  function monthLabel(d) { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4); }
  function historyChart(label, dates, values) {
    var W = 280, H = 118, L = 22, R = 10, T = 8, B = 22, n = dates.length;
    var t0 = Date.parse(dates[0]), t1 = Date.parse(dates[n - 1]) || t0 + 1;
    var x = function (i) { return L + (W - L - R) * (n > 1 ? (Date.parse(dates[i]) - t0) / (t1 - t0) : 0.5); };
    var y = function (v) { return T + (H - T - B) * (5 - v) / 4; };
    var grid = [1, 2, 3, 4, 5].map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="hc-grid"/><text x="' + (L - 7) + '" y="' + (y(v) + 3.5) + '" class="hc-tick" text-anchor="end">' + v + '</text>';
    }).join('');
    var path = '', pen = false, dots = '';
    values.forEach(function (v, i) {
      if (v == null) { pen = false; return; }
      path += (pen ? ' H' + x(i).toFixed(1) + ' V' + y(v).toFixed(1) : ' M' + x(i).toFixed(1) + ' ' + y(v).toFixed(1));
      pen = true;
    });
    var last = -1;
    values.forEach(function (v, i) { if (v != null) last = i; });
    if (last >= 0) dots = '<circle cx="' + x(last).toFixed(1) + '" cy="' + y(values[last]).toFixed(1) + '" r="4" class="hc-dot"/>';
    var hits = values.map(function (v, i) {
      var left = i === 0 ? L : (x(i - 1) + x(i)) / 2, right = i === n - 1 ? W - R : (x(i) + x(i + 1)) / 2;
      return '<rect x="' + left.toFixed(1) + '" y="' + T + '" width="' + Math.max(1, right - left).toFixed(1) + '" height="' + (H - T - B) + '" class="hc-hit" tabindex="-1" data-tip="' + esc(label + ', ' + monthLabel(dates[i]) + ': ' + (v == null ? 'not rated or not in release' : v + (v === 1 ? ' star' : ' stars'))) + '"/>';
    }).join('');
    var rated = values.filter(function (v) { return v != null; });
    return '<div class="card hcard"><div class="hc-head"><span>' + esc(label) + '</span><b>' + (last >= 0 ? values[last] + ' ★' : 'Not rated') + '</b></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label + ' from ' + monthLabel(dates[0]) + ' to ' + monthLabel(dates[n - 1]) + (rated.length ? ': low ' + Math.min.apply(null, rated) + ', high ' + Math.max.apply(null, rated) + ', latest ' + values[last] : ': not rated')) + '">' +
      grid + '<path d="' + path + '" class="hc-line"/>' + dots +
      '<text x="' + L + '" y="' + (H - 6) + '" class="hc-tick">' + monthLabel(dates[0]) + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" class="hc-tick" text-anchor="end">' + monthLabel(dates[n - 1]) + '</text>' + hits + '</svg></div>';
  }

  function tierIndexOf(label) {
    var T = S.lookups.risk.tiers;
    for (var i = 0; i < T.length; i++) if (T[i][2] === label) return i;
    return T.length - 1;
  }
  function tierIndex(score) {
    var T = S.lookups.risk.tiers;
    for (var i = 0; i < T.length; i++) if (score >= T[i][0] && score <= T[i][1]) return i;
    return T.length - 1;
  }

  /* ---------- Shared: change descriptions ---------- */
  var CHANGE_TYPES = [
    ['overall', 'Overall rating'], ['health', 'Health inspection rating'], ['staffing', 'Staffing rating'], ['qm', 'Quality measure rating'],
    ['sff', 'Special Focus status'], ['abuse', 'Abuse icon'], ['ij', 'New immediate jeopardy citations'], ['fines', 'New fines'],
    ['denials', 'New payment denials'], ['chow', 'Change of ownership'], ['added', 'Added to CMS list'], ['dropped', 'Removed from CMS list']
  ];
  var CHANGE_LABEL = {};
  CHANGE_TYPES.forEach(function (t) { CHANGE_LABEL[t[0]] = t[1]; });
  function starTxt(v) { return v == null ? 'not rated' : v + (v === 1 ? ' star' : ' stars'); }
  function describeChange(c) {
    var k = c[1], o = c[2], n = c[3];
    if (k === 'overall' || k === 'health' || k === 'staffing' || k === 'qm') return starTxt(o) + ' → ' + starTxt(n);
    if (k === 'sff') return o + ' → ' + n;
    if (k === 'abuse') return n ? 'Abuse icon added' : 'Abuse icon removed';
    if (k === 'ij') return o + ' → ' + n + ' citations in the last 3 cycles';
    if (k === 'fines') return 'Fine total $' + Number(o).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' → $' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (k === 'denials') return o + ' → ' + n + ' payment denials';
    if (k === 'chow') return 'Newly flagged as changed ownership in the last 12 months';
    if (k === 'added') return 'New in this release';
    return 'No longer in the CMS list';
  }
  function changeDirection(c) {
    var k = c[1];
    if ((k === 'overall' || k === 'health' || k === 'staffing' || k === 'qm') && c[2] != null && c[3] != null) return c[3] > c[2] ? 'good' : 'bad';
    if (k === 'sff') return c[3] === 'None' ? 'good' : 'bad';
    if (k === 'abuse') return c[3] ? 'bad' : 'good';
    if (k === 'ij' || k === 'fines' || k === 'denials') return 'bad';
    return '';
  }
  function getChanges() {
    if (!S.manifest.has_changes) return Promise.resolve(null);
    if (!S.changes) S.changes = getJSON('data/changes.json');
    return S.changes;
  }

  /* ---------- What changed ---------- */
  function renderChanges() {
    app.innerHTML = '<p class="muted">Loading changes…</p>';
    getChanges().then(function (ch) {
      if (!ch) { app.innerHTML = '<div class="card"><h1>What changed</h1><p>There is no earlier release on hand to compare with yet.</p></div>'; return; }
      var saved = loadPortfolios(), map = byCcn();
      S.chScope = S.chScope || (S.shared.length ? 'bravo' : saved.length ? 'mine' : 'all');
      S.chTypes = S.chTypes || {};
      function draw() {
        var scopeSet = null;
        if (S.chScope === 'mine') { scopeSet = {}; saved.forEach(function (p) { p.ccns.forEach(function (c) { scopeSet[c] = 1; }); }); }
        else if (S.chScope === 'bravo') { scopeSet = {}; S.shared.forEach(function (p) { p.ccns.forEach(function (c) { scopeSet[c] = 1; }); }); }
        else if (S.chScope.indexOf('shared:') === 0) { scopeSet = {}; (S.shared.filter(function (p) { return 'shared:' + p.id === S.chScope; })[0] || { ccns: [] }).ccns.forEach(function (c) { scopeSet[c] = 1; }); }
        else if (S.chScope !== 'all') { scopeSet = {}; (saved.filter(function (p) { return p.id === S.chScope; })[0] || { ccns: [] }).ccns.forEach(function (c) { scopeSet[c] = 1; }); }
        var items = ch.items.filter(function (c) { return !scopeSet || scopeSet[c[0]]; });
        var counts = {};
        items.forEach(function (c) { counts[c[1]] = (counts[c[1]] || 0) + 1; });
        var up = items.filter(function (c) { return c[1] === 'overall' && c[2] != null && c[3] != null && c[3] > c[2]; }).length;
        var down = items.filter(function (c) { return c[1] === 'overall' && c[2] != null && c[3] != null && c[3] < c[2]; }).length;
        var active = CHANGE_TYPES.filter(function (t) { return S.chTypes[t[0]]; }).map(function (t) { return t[0]; });
        var shown = items.filter(function (c) { return !active.length || active.indexOf(c[1]) !== -1; });
        var order = {};
        CHANGE_TYPES.forEach(function (t, i) { order[t[0]] = i; });
        shown.sort(function (a, b) { return order[a[1]] - order[b[1]] || (map[a[0]] ? map[a[0]][1] : '').localeCompare(map[b[0]] ? map[b[0]][1] : ''); });
        var cap = 500;
        function tile(k, v, s) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }
        var h = printHead('What changed') + '<div class="phead"><div><h1>What changed</h1><div class="sub">CMS release ' + fdate(ch.to) + ' compared with ' + fdate(ch.from) + '</div></div>' +
          '<div class="controls"><select id="chscope" aria-label="Facilities to include"><option value="all">All facilities</option>' +
          (S.shared.length ? '<option value="bravo">All portfolios</option>' + S.shared.map(function (p) { return '<option value="shared:' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') : '') +
          (saved.length ? '<option value="mine">Portfolios on this device only</option>' : '') + saved.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') +
          '</select><button id="chxlsx">Download Excel</button><button onclick="window.print()">Print / PDF</button></div></div>' +
          (saved.length || S.shared.length ? '' : '<div class="callout" style="border-color:var(--line);background:var(--card)">Save a portfolio to filter this page to the facilities you track.</div>') +
          '<div class="tiles">' + tile('Overall rating upgrades', fmt(up, 0)) + tile('Overall rating downgrades', fmt(down, 0)) +
          tile('New immediate jeopardy', fmt(counts.ij || 0, 0), 'facilities') + tile('Special Focus status changes', fmt(counts.sff || 0, 0)) +
          tile('New fines', fmt(counts.fines || 0, 0), 'facilities') + tile('New payment denials', fmt(counts.denials || 0, 0), 'facilities') + '</div>' +
          '<div class="card"><div class="controls" id="chtypes">' + CHANGE_TYPES.map(function (t) {
            return '<label class="cb"><input type="checkbox" value="' + t[0] + '"' + (S.chTypes[t[0]] ? ' checked' : '') + '> ' + t[1] + ' <span class="muted">(' + (counts[t[0]] || 0) + ')</span></label>';
          }).join('') + '</div>' +
          '<p class="muted small">' + shown.length.toLocaleString() + ' changes' + (active.length ? ' of the selected types' : '') + (shown.length > cap ? ', showing the first ' + cap + '. Select change types or a portfolio to narrow the list, or download the Excel file for all of them' : '') + '.</p>' +
          (shown.length ? '<div class="scroll tall"><table><thead><tr><th>Change</th><th>Facility</th><th>State</th><th>Detail</th></tr></thead><tbody>' +
            shown.slice(0, cap).map(function (c) {
              var r = map[c[0]], dir = changeDirection(c);
              return '<tr><td>' + CHANGE_LABEL[c[1]] + '</td><td>' + (r ? '<a href="#/f/' + esc(c[0]) + '">' + esc(r[1]) + '</a><div class="muted small">' + esc(c[0]) + ' · ' + esc(r[2]) + '</div>' : 'CCN ' + esc(c[0])) +
                '</td><td>' + (r ? esc(r[3]) : '') + '</td><td>' + (dir ? '<span class="dir ' + dir + '" aria-hidden="true">' + (dir === 'good' ? '▲' : '▼') + '</span> ' : '') + esc(describeChange(c)) + '</td></tr>';
            }).join('') + '</tbody></table></div>' : '<p>No changes for the selected facilities and types.</p>') +
          '<p class="src">Changes compare the published values in two consecutive CMS releases. A fine or citation count that fell is not listed, since older events roll out of CMS\'s reporting window. Source: CMS Provider Information and Health Deficiencies.</p></div>';
        app.innerHTML = h;
        setPrintFooter('Bravo Capital · SNF Analytics · What changed · CMS release ' + ch.to + ' vs ' + ch.from);
        var sel = document.getElementById('chscope');
        sel.value = S.chScope;
        sel.addEventListener('change', function () { S.chScope = sel.value; draw(); });
        Array.prototype.forEach.call(document.querySelectorAll('#chtypes input'), function (cb) {
          cb.addEventListener('change', function () { S.chTypes[cb.value] = cb.checked; draw(); });
        });
        document.getElementById('chxlsx').addEventListener('click', function () {
          exportXlsx('What_changed_' + ch.to + '.xlsx', [{
            name: 'Changes', title: 'What changed: CMS release ' + ch.to + ' compared with ' + ch.from,
            note: (S.chScope === 'all' ? 'All facilities.' : 'Filtered to saved portfolio facilities.'),
            columns: [{ header: 'Change', width: 30 }, { header: 'CCN', width: 9 }, { header: 'Facility', width: 44 }, { header: 'City', width: 18 }, { header: 'State', width: 7 }, { header: 'Detail', width: 52 }],
            rows: shown.map(function (c) { var r = map[c[0]] || []; return [CHANGE_LABEL[c[1]], c[0], r[1] || '', r[2] || '', r[3] || '', describeChange(c)]; })
          }], this);
        });
      }
      draw();
    }).catch(function (e) { app.innerHTML = '<div class="card"><h1>What changed</h1><p>' + esc(e.message) + '</p></div>'; });
  }

  /* ---------- Owner lookup ---------- */
  function getOwners() {
    if (!S.owners) S.owners = getJSON('data/owners.json');
    return S.owners;
  }
  function renderOwners() {
    app.innerHTML = '<div class="card"><h1>Owner lookup</h1><p class="muted">Search every owner, officer, director, and managing entity CMS reports, across all facilities. Names are matched exactly as CMS publishes them, so the same person or company can appear under more than one spelling.</p>' +
      '<div class="controls"><input id="oq" type="search" placeholder="Person or entity name" value="' + esc(S.oq || '') + '" autofocus></div><div id="ohits"><p class="muted">Loading ownership records…</p></div></div>';
    getOwners().then(function (O) {
      var oq = document.getElementById('oq');
      if (!oq) return;
      function draw() {
        S.oq = oq.value;
        var terms = oq.value.toLowerCase().split(/\s+/).filter(Boolean), box = document.getElementById('ohits');
        if (!terms.length) { box.innerHTML = '<p class="muted">' + O.names.length.toLocaleString() + ' names on file. Enter a name to search.</p>'; return; }
        var hits = [];
        for (var i = 0; i < O.names.length; i++) {
          var nm = O.names[i].toLowerCase();
          if (terms.every(function (t) { return nm.indexOf(t) !== -1; })) hits.push(i);
        }
        var fc = function (i) { var s = {}; O.links[i].forEach(function (l) { s[l[0]] = 1; }); return Object.keys(s).length; };
        hits = hits.map(function (i) { return [i, fc(i)]; }).sort(function (a, b) { return b[1] - a[1] || O.names[a[0]].localeCompare(O.names[b[0]]); });
        box.innerHTML = '<p class="muted small">' + hits.length.toLocaleString() + ' matching names' + (hits.length > 100 ? ', showing the 100 with the most facilities' : '') + '.</p>' +
          (hits.length ? '<div class="scroll"><table><thead><tr><th>Name</th><th>Type</th><th class="n">Facilities</th></tr></thead><tbody>' + hits.slice(0, 100).map(function (h) {
            return '<tr><td><a href="#/owner/' + encodeURIComponent(O.names[h[0]]) + '">' + esc(O.names[h[0]]) + '</a></td><td>' + (O.types[h[0]] === 'I' ? 'Individual' : O.types[h[0]] === 'O' ? 'Organization' : '') + '</td><td class="n">' + h[1] + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '');
      }
      oq.addEventListener('input', draw);
      draw();
    }).catch(function (e) { document.getElementById('ohits').innerHTML = '<p>' + esc(e.message) + '</p>'; });
  }
  function renderOwner(name) {
    app.innerHTML = '<p class="muted">Loading ownership records…</p>';
    getOwners().then(function (O) {
      var i = O.names.indexOf(name);
      if (i === -1) { app.innerHTML = '<a class="back" href="#/owners">← Owner lookup</a><div class="card"><h1>Name not found</h1><p>No owner or manager named ' + esc(name) + ' is in the current CMS release.</p></div>'; return; }
      var by = {}, order = [];
      O.links[i].forEach(function (l) {
        if (!by[l[0]]) { by[l[0]] = []; order.push(l[0]); }
        by[l[0]].push([O.roles[l[1]], l[2]]);
      });
      var rows = order.map(function (fi) { return S.index[fi]; }).sort(function (a, b) { return a[3].localeCompare(b[3]) || a[1].localeCompare(b[1]); });
      var ccns = rows.map(function (r) { return r[0]; });
      var pos = {};
      S.index.forEach(function (r, k) { pos[r[0]] = k; });
      var s = Rollup.summarize(rows);
      function tile(k, v, sub) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>'; }
      app.innerHTML = printHead('Owner report') + '<a class="back" href="#/owners">← Owner lookup</a>' +
        '<div class="phead"><div><h1>' + esc(name) + '</h1><div class="sub">' + (O.types[i] === 'I' ? 'Individual' : O.types[i] === 'O' ? 'Organization' : 'Owner or manager') + ' · reported at ' + rows.length + (rows.length === 1 ? ' facility' : ' facilities') + ' · CMS data as of ' + fdate(S.manifest.processing_date) + '</div></div>' +
        '<div class="controls"><a class="btn primary" href="#/p/' + ccns.join(',') + '">Open as portfolio</a><button id="oxlsx">Download Excel</button><button onclick="window.print()">Print / PDF</button></div></div>' +
        '<div class="tiles">' + tile('Facilities', rows.length) + tile('Certified beds', fmt(s.beds, 0)) + tile('Average overall rating', s.ratings.overall.avg == null ? NA : fmt(s.ratings.overall.avg, 2), s.ratings.overall.n + ' rated') +
        tile('SFF / candidates', s.sff + ' / ' + s.sffCandidates) + tile('Abuse icon', s.abuse, 'facilities') + tile('Average screening score', s.risk.avg == null ? NA : fmt(s.risk.avg, 0), 'Regulatory screening score, 0 to 100') + '</div>' +
        '<div class="card" style="padding:6px 8px"><div class="scroll ptable"><table><thead><tr><th>Facility</th><th>State</th><th>Role at this facility</th><th class="n">Ownership</th><th class="n">Beds</th><th class="n">Overall ★</th><th class="n">Screening score</th><th>Flags</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var roles = by[pos[r[0]]];
          return '<tr><td><a class="fname" href="#/f/' + esc(r[0]) + '">' + esc(r[1]) + '</a><div class="muted small">' + esc(r[0]) + ' · ' + esc(r[2]) + '</div></td><td>' + esc(r[3]) + '</td><td class="small">' + roles.map(function (x) { return esc(x[0]); }).join('<br>') +
            '</td><td class="n small">' + roles.map(function (x) { return esc(x[1]) || '&nbsp;'; }).join('<br>') + '</td><td class="n">' + fmt(r[IX.beds], 0) + '</td><td class="n">' + (r[IX.overall] == null ? '<span class="na">NR</span>' : '<i class="sw s' + r[IX.overall] + '"></i>' + r[IX.overall]) +
            '</td><td class="n">' + fmt(r[IX.risk], 0) + '</td><td>' + (r[IX.sff] ? '<span class="chip ' + (r[IX.sff] === 'SFF' ? 'bad' : 'warn') + '">' + esc(r[IX.sff]) + '</span> ' : '') + (r[IX.abuse] ? '<span class="chip bad">Abuse</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' +
        '<p class="src">A name can appear for ownership, management, or governance roles; the role column shows which. Names are matched exactly as published, so check the Owner lookup for other spellings. Source: CMS Ownership, processing date ' + fdate(S.manifest.processing_date) + '.</p>';
      setPrintFooter('Bravo Capital · SNF Analytics · Owner report · ' + name + ' · CMS data as of ' + fdate(S.manifest.processing_date));
      document.getElementById('oxlsx').addEventListener('click', function () {
        var out = [];
        rows.forEach(function (r) { by[pos[r[0]]].forEach(function (x) { out.push([r[0], r[1], r[2], r[3], x[0], x[1], r[IX.beds], r[IX.overall], r[IX.risk], r[IX.sff] || '', r[IX.abuse] ? 'Y' : 'N']); }); });
        exportXlsx(fileSafe(name) + '_facilities_' + S.manifest.processing_date + '.xlsx', [{
          name: 'Facilities', title: name + ': facilities reported by CMS',
          columns: [{ header: 'CCN', width: 9 }, { header: 'Facility', width: 42 }, { header: 'City', width: 18 }, { header: 'State', width: 7 }, { header: 'Role at this facility', width: 44 }, { header: 'Ownership', width: 12 },
            { header: 'Certified beds', width: 10, fmt: '#,##0' }, { header: 'Overall rating', width: 9, fmt: '0' }, { header: 'Regulatory screening score', width: 12, fmt: '0' }, { header: 'Special focus status', width: 16 }, { header: 'Abuse icon', width: 8 }],
          rows: out
        }], this);
      });
      window.scrollTo(0, 0);
    }).catch(function (e) { app.innerHTML = '<div class="card"><h1>Owner lookup</h1><p>' + esc(e.message) + '</p></div>'; });
  }

  /* ---------- Risk score methodology ---------- */
  function renderRisk() {
    var R = S.lookups.risk, V = R.validation, pc = function (v, d) { return fmt(v * 100, d == null ? 1 : d) + '%'; };
    var p90 = Rollup.scoreAtPercentile(R.us_percentiles, 90), p75 = Rollup.scoreAtPercentile(R.us_percentiles, 75), p50 = Rollup.scoreAtPercentile(R.us_percentiles, 50);
    var h = printHead('Screening score methodology') + '<div class="phead"><div><h1>Regulatory screening score</h1><div class="sub">A Bravo screening aid, not a CMS figure and not a credit risk measure</div></div><div class="controls"><button onclick="window.print()">Print / PDF</button></div></div>' +
      '<div class="card"><h2>What it is</h2><p style="margin-top:0">A points score whose components add to exactly 100, where higher means more regulatory risk. Every input is a value CMS publishes or a simple count of published records, and every facility report shows the points behind its score.</p>' +
      '<p style="margin-bottom:0">It is a screening aid: it shows where to look first. It measures regulatory risk only. It has not been tested against credit outcomes such as defaults or operating losses, and it should not be used alone in a credit decision or a lender narrative.</p>' +
      '<p class="muted" style="margin-bottom:0">In the current release the median facility scores ' + p50 + ', the top quarter starts at ' + p75 + ', and the top 10% starts at ' + p90 + '.</p></div>';

    h += '<div class="card"><h2>How points are assigned</h2><div class="scroll"><table><thead><tr><th>Component</th><th class="n">Maximum</th><th>How points are earned</th></tr></thead><tbody>' +
      R.components.map(function (c) { return '<tr><td class="strong">' + esc(c[1]) + '</td><td class="n strong">' + c[3] + '</td><td>' + esc(c[2]) + '</td></tr>'; }).join('') +
      '<tr class="total"><td>Total</td><td class="n">' + R.components.reduce(function (a, c) { return a + c[3]; }, 0) + '</td><td></td></tr>' +
      '</tbody></table></div><p class="src">Citation points are rounded to a whole number. Older inspection cycles count less. A severe citation also raises CMS\'s survey score, so it affects the first component as well. Contract staffing and RN coverage use the daily Payroll Based Journal file and are left out when that file is unavailable. A facility with no published survey score gets no survey points.</p></div>';

    if (V) {
      var avgAuc = V.pooled_auc, cms = V.pooled_auc_cms;
      h += '<div class="sect"><span>How well it works <span class="muted" style="font-weight:400">· validation study run ' + fdate(V.run_date) + ' on scoring rules ' + esc(V.version.toLowerCase()) + '</span></span></div>' +
        '<div class="card"><p style="margin-top:0">Every facility was scored using only what CMS had published on October 1 of three different years. The following 12 months were then checked for a serious regulatory event: an immediate jeopardy citation or payment denial dated in that period, or new SFF or SFF candidate status.</p>' +
        '<div class="tiles" style="margin-bottom:6px">' +
        '<div class="tile"><div class="k">Ranking accuracy</div><div class="v">' + pc(avgAuc, 0) + '</div><div class="s">Given one facility that had an event and one that did not, the score ranks the event facility higher this often. 50% is a coin flip, 100% is perfect.</div></div>' +
        '<div class="tile"><div class="k">CMS weighted health score alone</div><div class="v">' + pc(cms, 0) + '</div><div class="s">The same test using only CMS\'s published survey score.</div></div>' +
        (V.prior_versions || []).map(function (pv) { return '<div class="tile"><div class="k">Earlier rules (' + esc(pv.name) + ')</div><div class="v">' + pc(pv.pooled_auc, 0) + '</div><div class="s">The same test on an earlier set of scoring rules.</div></div>'; }).join('') +
        '</div></div>';

      h += '<div class="card"><h2>Risk tiers</h2><p class="muted" style="margin-top:0">Tiers describe regulatory risk relative to other facilities. They say how closely to look, not whether a facility is acceptable. Even in the Very High Risk tier, most facilities had no serious event in the following year.</p><p style="margin-top:0"><b>Special Focus rule:</b> a Special Focus Facility or SFF candidate is always placed in the top tier, whatever its points. Its score still shows the points it earned.</p><div class="scroll"><table><thead><tr><th>Tier</th><th>Score</th>' +
        V.years.map(function (y) { return '<th class="n">Scored ' + fdate(y.as_of) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        V.years[0].tiers.map(function (t, i) {
          return '<tr><td><span class="chip tier t' + i + '">' + esc(t[0]) + '</span></td><td>' + t[1] + (t[2] >= 100 ? ' and up, or any SFF or SFF candidate' : ' to ' + t[2]) + '</td>' + V.years.map(function (y) { return '<td class="n"><span class="strong">' + pc(y.tiers[i][4]) + '</span> <span class="muted small">of ' + y.tiers[i][3].toLocaleString() + '</span></td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div><p class="src">Each cell is the share of facilities in that tier that had a serious event in the following 12 months, and the number of facilities in the tier.</p></div>';
      h += '<div class="card"><h2>Share of facilities with a serious event in the next 12 months, by score</h2><div class="scroll"><table><thead><tr><th>Score</th>' +
        V.years.map(function (y) { return '<th class="n">Scored ' + fdate(y.as_of) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        V.years[0].bands.map(function (b, i) {
          return '<tr><td>' + b[0] + (b[1] >= 100 ? ' and up' : ' to ' + b[1]) + '</td>' + V.years.map(function (y) { return '<td class="n"><span class="strong">' + pc(y.bands[i][3]) + '</span> <span class="muted small">of ' + y.bands[i][2].toLocaleString() + '</span></td>'; }).join('') + '</tr>';
        }).join('') +
        '<tr class="total"><td>All facilities</td>' + V.years.map(function (y) { return '<td class="n">' + pc(y.event_rate) + ' <span class="muted small" style="font-weight:400">of ' + y.facilities.toLocaleString() + '</span></td>'; }).join('') + '</tr>' +
        '</tbody></table></div>' +
        '<div class="scroll" style="margin-top:16px"><table><thead><tr><th>Scoring date</th><th class="n">Ranking accuracy</th><th class="n">CMS score alone</th><th class="n">Events found in the top 10% of scores</th><th class="n">Event rate in the top 10%</th><th class="n">Event rate in the lowest 20%</th></tr></thead><tbody>' +
        V.years.map(function (y) { return '<tr><td>' + fdate(y.as_of) + '</td><td class="n strong">' + pc(y.auc) + '</td><td class="n">' + pc(y.auc_cms) + '</td><td class="n">' + pc(y.top10_share, 0) + '</td><td class="n">' + pc(y.top10_rate, 0) + '</td><td class="n">' + pc(y.bottom20_rate) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div>';

      var comps = V.components.slice().sort(function (a, b) { return a.auc_without - b.auc_without; });
      h += '<div class="card"><h2>What each component contributes</h2><div class="scroll"><table><thead><tr><th>Component</th><th class="n">Facilities it applies to</th><th class="n">Event rate when it applies</th><th class="n">Event rate when it does not</th><th class="n">Accuracy lost if removed</th></tr></thead><tbody>' +
        comps.map(function (c) {
          var lost = -c.auc_without * 100;
          return '<tr><td class="strong">' + esc(c.label) + '</td><td class="n">' + pc(c.applies) + '</td><td class="n">' + (c.rate_with == null ? NA : pc(c.rate_with)) + '</td><td class="n">' + (c.rate_without == null ? NA : pc(c.rate_without)) + '</td><td class="n">' + (lost >= 0.05 ? fmt(lost, 1) + ' points' : '<span class="muted">None</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="src">"Accuracy lost if removed" is the drop in ranking accuracy, in percentage points, when that component is taken out of the score. Components showing "None" still mark higher-risk facilities, but the survey score, staffing, and penalties already capture most of what they add. They are kept because the status itself matters to a lender.</p></div>';

      h += '<div class="card"><h2>How to read it</h2><ul style="margin:0;padding-left:18px">' +
        '<li><b>It sorts well, but it is not a forecast for one facility.</b> About ' + pc(1 - V.years[V.years.length - 1].top10_rate, 0) + ' of facilities in the top 10% of scores had no serious event in the following year, and most events happened outside the top 10%.</li>' +
        '<li><b>It is modestly better than CMS\'s own survey score.</b> Most of its power comes from that score plus staffing and penalties.</li>' +
        '<li><b>It measures regulatory risk.</b> It has not been tested against financial or credit outcomes.</li>' +
        '<li><b>The weights are underwriting judgment.</b> Reasonable changes to the points, including those for Special Focus status, severe citations, and staffing, did not change the ranking accuracy in testing. The points reflect how much each item matters to HUD and to a lender.</li>' +
        '<li><b>Older citations count less.</b> Facilities whose most recent immediate jeopardy citation was in the latest inspection cycle had later events more often than those whose only such citation was in an older cycle.</li>' +
        '<li><b>Fines and payment denials count less as they age.</b> A penalty in the last 12 months counts in full, one from 12 to 24 months ago counts half, and an older one counts a quarter. Adding this discount did not change the ranking accuracy.</li>' +
        '<li><b>A single recent severe citation outweighs the repeat flag.</b> The citation is the direct evidence; the repeat is a pattern on top of it.</li>' +
        '<li><b>Star rating trend is not used.</b> Facilities with a recent star decline had later events at the same rate as everyone else.</li></ul></div>';
    } else {
      h += '<div class="card"><h2>How well it works</h2><p style="margin:0">No validation study is on file for ' + esc(R.version) + '. The score should be treated as untested until one is run.</p></div>';
    }

    if (R.backtest && R.backtest.length) {
      h += '<div class="card"><h2>Ongoing check</h2><p style="margin-top:0" class="muted">Rerun at every refresh from the release history. It compares two releases about a year apart, which is a rougher measure than the dated study above: older events roll out of CMS\'s reporting windows, so events are undercounted. Contract staffing and RN coverage are not in the history and are left out.</p>' +
        R.backtest.map(function (b) {
          return '<h2 style="margin-top:16px;font-size:14px">Scored ' + fdate(b.as_of) + ', compared with ' + fdate(b.later) + ' <span class="muted" style="font-weight:400">· ' + b.facilities.toLocaleString() + ' facilities</span></h2><div class="scroll"><table><thead><tr><th>Group</th><th class="n">Score range</th><th class="n">Facilities</th><th class="n">Had a serious event</th></tr></thead><tbody>' +
            b.rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td class="n">' + r[3] + ' to ' + r[4] + '</td><td class="n">' + r[1].toLocaleString() + '</td><td class="n strong">' + pc(r[2]) + '</td></tr>'; }).join('') + '</tbody></table></div>';
        }).join('') + '</div>';
    }
    app.innerHTML = h;
    setPrintFooter('Bravo Capital · SNF Analytics · Regulatory screening score methodology');
    window.scrollTo(0, 0);
  }

  /* ---------- Lender narrative draft ---------- */
  function narrativeDraft(f) {
    var asof = fdate(S.manifest.processing_date).replace(/^0/, '').replace(/\/0/, '/');
    var R = f.ratings, D = f.deficiencies, P = f.penalties;
    var gplus = D.filter(function (d) { return d[1] === 'H' && 'GHIJKL'.indexOf(d[3]) !== -1; }).length;
    var ij = D.filter(function (d) { return d[1] === 'H' && 'JKL'.indexOf(d[3]) !== -1; }).length;
    var rt = function (r) { return r[0] == null ? 'Not rated' : String(r[0]); };
    var d = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? (+m[2]) + '/' + (+m[3]) + '/' + m[1] : s; };
    var surveys = {};
    (f.surveys || []).forEach(function (x) {
      if (x[1].indexOf('Health') !== 0 && x[1] !== 'Infection Control') return;
      var kind = x[1] === 'Health Standard' ? 'annual' : x[1] === 'Health Complaint' ? 'complaint' : 'infection control';
      (surveys[x[0]] = surveys[x[0]] || []).push(kind);
    });
    // The POC column uses CMS's published correction date for each survey (the latest one when
    // a survey has several), which is what approved Bravo narratives carry in this column.
    var lines = Object.keys(surveys).sort().reverse().map(function (k) {
      var kinds = surveys[k].filter(function (v, i, a) { return a.indexOf(v) === i; });
      var cited = D.filter(function (x) { return x[1] === 'H' && x[0] === k; });
      var fixed = cited.filter(function (x) { return x[10]; }).map(function (x) { return x[10]; }).sort();
      if (!cited.length && kinds.indexOf('annual') === -1) return null;   // complaint or infection control visit with nothing cited
      var poc = !cited.length ? 'No deficiencies cited' : fixed.length ? d(fixed[fixed.length - 1]) :
        '[TBD - source needed: POC date, from the state survey documents; CMS shows no correction date for this survey]';
      return d(k) + ' (' + kinds.join(' and ') + ') | ' + poc;
    }).filter(Boolean);
    var money0 = function (v) { return '$' + Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); };
    var pen = (P.fines || 0) + (P.denials || 0) === 0 ?
      'Per CMS data as of ' + asof + ', the subject facility has not received any fines or payment denials within the last three years.' :
      'Per CMS data as of ' + asof + ', the subject facility has received ' + (P.fines || 0) + (P.fines === 1 ? ' fine' : ' fines') + (P.fines ? ' totaling ' + money0(P.fine_total) : '') + ' and ' + (P.denials || 0) + (P.denials === 1 ? ' payment denial' : ' payment denials') + ' within the last three years.';
    var sff = f.sff === 'SFF' ? 'is designated as a SFF' : f.sff === 'SFF Candidate' ? 'is listed as an SFF Candidate' : 'is neither designated as a SFF nor listed as an SFF Candidate';
    var summary = (R.overall[0] == null ? 'The subject facility does not currently have an overall CMS star rating.' : 'The subject is a ' + R.overall[0] + '-star facility.') +
      ' Over the last three survey cycles, it has ' + (gplus === 0 ? 'not received any citations at a scope and severity level of G or higher' : 'received ' + gplus + (gplus === 1 ? ' citation' : ' citations') + ' at a scope and severity level of G or higher' + (ij ? ', including ' + ij + ' at the immediate jeopardy level' : '')) + '.' +
      ' The facility ' + (f.abuse ? 'has been cited for abuse' : 'has not been cited for abuse') + ' and ' + sff + '.';
    return ['Subject\'s State Surveys', '',
      'The star ratings for the subject facility, as of ' + asof + ', are as follows:', '',
      'Overall Rating | Health Inspection | Staffing | Quality',
      rt(R.overall) + ' | ' + rt(R.health) + ' | ' + rt(R.staffing) + ' | ' + rt(R.qm), '',
      'The application includes the following state surveys issued on the following dates over the last three (3) years of operations:', '',
      '3 Years of Survey Inspections', 'Date of survey/inspection | Date state issued letter approving POC'].concat(lines.length ? lines : ['[TBD - source needed: survey dates, from the state survey documents]']).concat(['',
      'Penalties:', pen, '', 'Summary:', summary]).join('\n');
  }

  /* One shared tooltip for chart marks (hover and keyboard focus). */
  var tip = document.createElement('div');
  tip.id = 'tip';
  document.body.appendChild(tip);
  function showTip(el, x, y) {
    tip.textContent = el.getAttribute('data-tip');
    tip.style.display = 'block';
    var w = tip.offsetWidth, hgt = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
    tip.style.top = Math.max(8, y - hgt - 12) + 'px';
  }
  document.addEventListener('mousemove', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (el) showTip(el, e.clientX, e.clientY); else tip.style.display = 'none';
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (el) { var r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); }
  });
  document.addEventListener('focusout', function () { tip.style.display = 'none'; });

  window.addEventListener('beforeprint', function () {
    Array.prototype.forEach.call(document.querySelectorAll('details.printopen:not([open])'), function (d) { d.setAttribute('open', ''); d.setAttribute('data-printopen', ''); });
  });
  window.addEventListener('afterprint', function () {
    Array.prototype.forEach.call(document.querySelectorAll('details[data-printopen]'), function (d) { d.removeAttribute('open'); d.removeAttribute('data-printopen'); });
  });

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    tip.style.display = 'none';
    var section = h === 'status' ? 'status' : /^(portfolios|portfolio\/|p\/|chain\/|shared\/|import\/)/.test(h) ? 'portfolios' : /^owner/.test(h) ? 'owners' : h === 'changes' ? 'changes' : h === 'risk' ? 'risk' : 'search';
    setPrintFooter('Bravo Capital · SNF Analytics · CMS data as of ' + fdate(S.manifest.processing_date));
    Array.prototype.forEach.call(document.querySelectorAll('.top nav a'), function (a) { a.className = a.dataset.nav === section ? 'on' : ''; });
    if (h.indexOf('f/') === 0) renderFacility(decodeURIComponent(h.slice(2)));
    else if (h === 'status') renderStatus();
    else if (h === 'portfolios') renderPortfolios();
    else if (h.indexOf('portfolio/') === 0) renderSaved(decodeURIComponent(h.slice(10)));
    else if (h.indexOf('p/') === 0) drawPortfolio({ title: 'Portfolio', ccns: Rollup.parseCcns(decodeURIComponent(h.slice(2))) });
    else if (h.indexOf('import/') === 0) importPortfolio(h.slice(7));
    else if (h.indexOf('shared/') === 0) renderShared(decodeURIComponent(h.slice(7)));
    else if (h.indexOf('chain/') === 0) renderChain(decodeURIComponent(h.slice(6)));
    else if (h === 'owners') renderOwners();
    else if (h.indexOf('owner/') === 0) renderOwner(decodeURIComponent(h.slice(6)));
    else if (h === 'changes') renderChanges();
    else if (h === 'risk') renderRisk();
    else renderSearch();
  }

  Promise.all([getJSON('data/index.json'), getJSON('data/lookups.json'), getJSON('data/manifest.json'), getJSON('data/portfolios.json').catch(function () { return []; })]).then(function (r) {
    S.index = r[0]; S.lookups = r[1]; S.manifest = r[2]; S.shared = r[3] || [];
    document.getElementById('asof').textContent = 'CMS data as of ' + fdate(S.manifest.processing_date).replace(/<[^>]+>/g, '');
    window.addEventListener('hashchange', route);
    route();
  }).catch(function (e) {
    app.innerHTML = '<div class="card"><h1>Data could not be loaded</h1><p>' + esc(e.message) + '</p></div>';
  });
})();
