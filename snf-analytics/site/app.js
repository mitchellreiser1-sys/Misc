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
    var name = prompt('Name for the new portfolio (saved in this browser only)');
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
    var h = '<a class="back" href="#/">← Back to search</a> <span style="float:right" class="controls">' +
      '<span id="addmsg" class="muted small" style="align-self:center"></span><select id="addsel" aria-label="Portfolio to add to">' + pfOptions(S.target) + '</select><button id="addbtn">Add to portfolio</button>' +
      '<button onclick="window.print()">Print or save as PDF</button></span>';

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
    h += '<div class="card" style="clear:both"><h1>' + esc(f.name) + '</h1><div class="muted">CCN ' + esc(f.ccn) + ' · ' + esc(f.address) + ', ' + esc(f.city) + ', ' +
      esc(f.state) + ' ' + esc(f.zip) + (f.county ? ' · ' + esc(f.county) + ' County' : '') + '</div>' +
      '<div class="muted small" style="margin-top:6px">' + [f.ownership_type, f.provider_type,
        f.urban == null ? null : (f.urban ? 'Urban' : 'Rural'),
        f.certified ? 'Certified ' + fdate(f.certified) : null,
        f.legal_name && f.legal_name !== f.name ? 'Legal name: ' + f.legal_name : null,
        f.chain ? null : 'No chain reported'
      ].filter(Boolean).map(esc).join(' · ') +
      (f.chain ? ' · Chain: <a href="#/chain/' + esc(f.chain.id) + '">' + esc(f.chain.name) + '</a>' + (f.chain.count ? ' (' + esc(f.chain.count) + ' facilities)' : '') : '') + '</div>' +
      (chips.length ? '<div class="chips">' + chips.map(function (c) { return '<span class="chip ' + c[0] + '">' + esc(c[1]) + '</span>'; }).join('') + '</div>' : '') +
      '</div>';

    /* tiles */
    var R = f.ratings;
    function rt(label, r, key) {
      return '<div class="tile"><div class="k">' + label + '</div><div class="v">' + stars(r[0]) + '</div>' +
        (r[1] ? '<div class="s">' + esc(fnText(r[1])) + '</div>' :
          (key ? '<div class="s">State avg ' + fmt(bs.ratings[key], 1) + ' · US ' + fmt(bn.ratings[key], 1) + '</div>' : '')) + '</div>';
    }
    h += '<div class="tiles">' + rt('Overall rating', R.overall, 'Overall Rating') + rt('Health inspection', R.health, 'Health Inspection Rating') +
      rt('Staffing', R.staffing, 'Staffing Rating') + rt('Quality measures', R.qm, 'QM Rating') +
      '<div class="tile"><div class="k">Certified beds</div><div class="v">' + fmt(f.beds, 0) + '</div></div>' +
      '<div class="tile"><div class="k">Avg residents per day</div><div class="v">' + fmt(f.residents, 1) + '</div>' + (f.residents_fn ? '<div class="s">' + esc(fnText(f.residents_fn)) + '</div>' : '') + '</div>' +
      '<div class="tile"><div class="k">Occupancy (derived)</div><div class="v">' + (f.occupancy == null ? NA : fmt(f.occupancy * 100, 1) + '%') + '</div><div class="s">Avg residents ÷ certified beds</div></div>' +
      '</div>';

    /* star build-up + QM sub ratings */
    h += '<div class="grid2"><div class="card"><h2>How the overall rating is built</h2>';
    if (f.star_steps) {
      h += '<ul class="steps">' + f.star_steps.map(function (s) {
        var adj = s[1] == null ? '' : s[1] > 0 ? '+1 star' : s[1] < 0 ? '−1 star' : 'No change';
        return '<li><span>' + esc(s[0]) + (adj ? ' <span class="muted">(' + adj + ')</span>' : '') + '</span><span>' + stars(s[2]) + '</span></li>';
      }).join('') + '<li><span>Published overall rating</span><span>' + stars(R.overall[0]) + '</span></li></ul>';
    } else {
      h += '<p>' + (R.overall[1] ? esc(fnText(R.overall[1])) : 'CMS has not published an overall rating for this facility.') + '</p>';
    }
    h += '<p class="src">The build-up follows the CMS Five-Star rules and is checked against the published rating at every refresh.</p></div>' +
      '<div class="card"><h2>Quality measure ratings</h2><table><tbody>' +
      '<tr><td>Overall QM rating</td><td>' + stars(R.qm[0]) + fnNote(R.qm[1]) + '</td></tr>' +
      '<tr><td>Long-stay QM rating</td><td>' + stars(R.qm_long[0]) + fnNote(R.qm_long[1]) + '</td></tr>' +
      '<tr><td>Short-stay QM rating</td><td>' + stars(R.qm_short[0]) + fnNote(R.qm_short[1]) + '</td></tr>' +
      '</tbody></table>' + src('Provider Information') + '</div></div>';

    /* survey */
    var sv = f.survey;
    function cyc(label, c) {
      return '<tr><td>' + label + (c.fn ? fnNote(c.fn) : '') + '</td><td>' + fdate(c.date) + '</td><td class="n">' + fmt(c.total, 0) + '</td><td class="n">' + fmt(c.complaint, 0) +
        '</td><td class="n">' + fmt(c.def_score, 0) + '</td><td class="n">' + fmt(c.revisits, 0) + '</td><td class="n">' + fmt(c.revisit_score, 0) + '</td><td class="n">' + fmt(c.score, 0) + '</td></tr>';
    }
    h += '<div class="card"><h2>Health inspections</h2><div class="scroll"><table><thead><tr><th>Rating cycle</th><th>Standard survey date</th><th class="n">Health deficiencies</th><th class="n">From complaints</th><th class="n">Deficiency score</th><th class="n">Revisits</th><th class="n">Revisit score</th><th class="n">Total score</th></tr></thead><tbody>' +
      cyc('Cycle 1 (most recent)', sv.c1) + cyc('Cycles 2 and 3', sv.c23) +
      '<tr><td colspan="7"><strong>Total weighted health survey score</strong> <span class="muted">(lower is better; 3/4 cycle 1, 1/4 cycles 2 and 3)</span></td><td class="n"><strong>' + fmt(sv.weighted, 3) + '</strong></td></tr>' +
      '</tbody></table></div>' +
      '<p class="small muted">State average cycle 1 health deficiencies: ' + fmt(bs['Cycle 1 Total Number of Health Deficiencies'], 1) + ' · US: ' + fmt(bn['Cycle 1 Total Number of Health Deficiencies'], 1) +
      ' · Citations from infection control inspections: ' + fmt(sv.infection_citations, 0) + '</p>' + src('Provider Information and State US Averages') + '</div>';

    /* deficiencies */
    var D = f.deficiencies;
    var bandRows = SEV_BANDS.map(function (b) {
      var c = { H: 0, F: 0 };
      D.forEach(function (d) { if (b[0].indexOf(d[3]) !== -1) c[d[1]]++; });
      return '<tr><td><span class="sev ' + b[2] + '">' + b[0][0] + ' to ' + b[0][2] + '</span> ' + b[1] + '</td><td class="n">' + c.H + '</td><td class="n">' + c.F + '</td></tr>';
    }).join('');
    h += '<div class="card"><h2>Deficiencies cited (' + D.length + ')</h2>' +
      '<div class="scroll"><table style="max-width:640px"><thead><tr><th>Scope and severity</th><th class="n">Health</th><th class="n">Fire safety</th></tr></thead><tbody>' + bandRows + '</tbody></table></div>' +
      '<div class="controls" style="margin-top:14px"><label class="cb"><input type="checkbox" id="fH" checked> Health</label><label class="cb"><input type="checkbox" id="fF" checked> Fire safety</label><label class="cb"><input type="checkbox" id="fG"> Actual harm or immediate jeopardy only (G to L)</label></div>' +
      '<div class="scroll" id="deftable"></div>' + src('Health Deficiencies and Fire Safety Deficiencies (three most recent inspection cycles)') + '</div>';

    /* staffing */
    h += '<div class="card"><h2>Staffing</h2><div class="scroll"><table><thead><tr><th>Measure</th><th class="n">Facility</th><th class="n">' + esc(f.state) + ' average</th><th class="n">US average</th></tr></thead><tbody>' +
      f.staffing.map(function (r) {
        var sb = bs.staffing[r[0]], nb = bn.staffing[r[0]], has = r[0] in bn.staffing;
        return '<tr><td>' + esc(r[0]) + (r[1] == null ? fnNote(r[2]) : '') + '</td><td class="n">' + fmt(r[1], r[3]) + '</td><td class="n">' +
          (has ? fmt(sb, r[3]) : '<span class="na">Not published</span>') + '</td><td class="n">' + (has ? fmt(nb, r[3]) : '<span class="na">Not published</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (R.staffing[1] ? '<p class="small muted">Staffing rating note: ' + esc(fnText(R.staffing[1])) + '</p>' : '') +
      src('Provider Information (Payroll-Based Journal staffing as published by CMS) and State US Averages') + '</div>';

    /* QMs */
    h += '<div class="card"><h2>Quality measures</h2><div class="scroll"><table><thead><tr><th>Measure</th><th>Stay</th><th>Used in Five-Star</th><th class="n">Facility</th><th class="n">' + esc(f.state) + ' average</th><th class="n">US average</th><th>Period</th></tr></thead><tbody>' +
      f.qm.map(function (q) {
        var m = L.measures[q[0]] || { desc: 'Measure ' + q[0], type: '', period: '' };
        return '<tr><td>' + esc(m.desc) + (q[1] == null ? fnNote(q[2]) : '') + '</td><td>' + esc(m.type) + '</td><td>' + (m.five_star ? 'Yes' : 'No') + '</td><td class="n">' + fmt(q[1], 2) +
          '</td><td class="n">' + fmt(bs.qm[q[0]], 2) + '</td><td class="n">' + fmt(bn.qm[q[0]], 2) + '</td><td class="small">' + esc(period(m.period)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="small muted">MDS measures show the four-quarter average. Claims-based measures show the risk-adjusted score.</p>' +
      src('MDS Quality Measures, Medicare Claims Quality Measures, and State US Averages') + '</div>';

    /* penalties */
    var P = f.penalties;
    h += '<div class="card"><h2>Penalties (last three years)</h2><div class="tiles" style="margin-bottom:10px">' +
      '<div class="tile"><div class="k">Fines</div><div class="v">' + fmt(P.fines, 0) + '</div><div class="s">State avg ' + fmt(bs['Number of Fines'], 1) + ' · US ' + fmt(bn['Number of Fines'], 1) + '</div></div>' +
      '<div class="tile"><div class="k">Total fines</div><div class="v">' + money(P.fine_total) + '</div><div class="s">State avg ' + money(bs['Fine Amount in Dollars']) + ' · US ' + money(bn['Fine Amount in Dollars']) + '</div></div>' +
      '<div class="tile"><div class="k">Payment denials</div><div class="v">' + fmt(P.denials, 0) + '</div></div></div>' +
      (P.rows.length ? '<div class="scroll"><table><thead><tr><th>Penalty date</th><th>Type</th><th class="n">Fine amount</th><th>Denial start</th><th class="n">Denial length (days)</th></tr></thead><tbody>' +
        P.rows.map(function (r) {
          var fine = r[1] === 'Fine';
          return '<tr><td>' + fdate(r[0]) + '</td><td>' + esc(r[1]) + '</td><td class="n">' + (fine ? money(r[2]) : '') + '</td><td>' + (fine ? '' : fdate(r[3])) + '</td><td class="n">' + (fine ? '' : fmt(r[4], 0)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p>No fines or payment denials reported by CMS in the last three years.</p>') +
      src('Penalties and Provider Information') + '</div>';

    /* ownership */
    h += '<div class="card"><h2>Ownership and management (' + f.owners.length + ')</h2>' +
      (f.owners.length ? '<div class="scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Type</th><th class="n">Ownership</th><th>Association date</th></tr></thead><tbody>' +
        f.owners.map(function (o) {
          return '<tr><td>' + (o[2] ? esc(o[2]) : NA) + '</td><td>' + esc(o[0]) + '</td><td>' + esc(o[1] || '') + '</td><td class="n">' + esc(o[3] || '') + '</td><td>' + esc((o[4] || '').replace(/^since\s+/i, '')) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p>' + NA + '</p>') + src('Ownership') + '</div>';

    app.innerHTML = h;

    function drawDefs() {
      var showH = document.getElementById('fH').checked, showF = document.getElementById('fF').checked, gOnly = document.getElementById('fG').checked;
      var rows = D.filter(function (d) {
        return ((d[1] === 'H' && showH) || (d[1] === 'F' && showF)) && (!gOnly || 'GHIJKL'.indexOf(d[3]) !== -1);
      });
      document.getElementById('deftable').innerHTML = rows.length ?
        '<table><thead><tr><th>Survey date</th><th>Type</th><th>Tag</th><th>Scope/severity</th><th>Cycle</th><th>Deficiency</th><th>Found during</th><th>Correction</th></tr></thead><tbody>' +
        rows.map(function (d) {
          var ds = L.descs[d[5]] || ['', ''];
          var found = [d[6] ? 'Standard survey' : null, d[7] ? 'Complaint' : null, d[8] ? 'Infection control' : null].filter(Boolean).join(', ');
          return '<tr><td>' + fdate(d[0]) + (d[12] ? fnNote(d[12]) : '') + '</td><td>' + (d[1] === 'H' ? 'Health' : 'Fire safety') + '</td><td>' + esc(d[2]) + '</td><td><span class="sev ' + sevClass(d[3]) + '">' + esc(d[3]) +
            '</span></td><td>' + esc(d[4]) + '</td><td>' + esc(ds[0]) + '<div class="muted small">' + esc(ds[1]) + (d[11] ? ' · Under dispute resolution' : '') + '</div></td><td>' + esc(found) +
            '</td><td>' + esc(d[9]) + (d[10] ? '<div class="muted small">' + fdate(d[10]) + '</div>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="muted">No deficiencies match the selected filters.</p>';
    }
    ['fH', 'fF', 'fG'].forEach(function (id) { document.getElementById(id).addEventListener('change', drawDefs); });
    drawDefs();
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
    app.innerHTML = '<div class="card"><h1>Portfolios</h1>' +
      '<p class="muted">Saved portfolios are stored only in this browser. Names and lists are not uploaded anywhere and will not appear on another device. Use "Copy link" inside a portfolio to move a list between devices; the link carries CCNs only, not the name.</p>' +
      (list.length ? '<div class="scroll"><table><thead><tr><th>Name</th><th class="n">Facilities</th><th></th></tr></thead><tbody>' +
        list.map(function (p) {
          return '<tr><td><a href="#/portfolio/' + esc(p.id) + '">' + esc(p.name) + '</a></td><td class="n">' + p.ccns.length + '</td><td><button data-del="' + esc(p.id) + '">Delete</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p>No saved portfolios yet.</p>') + '</div>' +
      '<div class="card"><h2>New portfolio</h2><div class="controls"><input id="pname" type="search" placeholder="Portfolio name" style="max-width:340px"></div>' +
      '<textarea id="pccns" rows="4" placeholder="Optional. Paste CCNs separated by commas, spaces, or new lines, or leave blank and add facilities afterwards. Leading zeros dropped by Excel are restored."></textarea>' +
      '<div class="controls" style="margin-top:10px"><button id="pcreate">Save portfolio</button><span id="pmsg" class="muted small"></span></div></div>' +
      '<div class="card"><h2>CMS chains</h2><p class="muted">Every chain CMS identifies is available as a ready-made portfolio.</p>' +
      '<div class="controls"><input id="cq" type="search" placeholder="Chain name"></div><div id="chains"></div></div>';
    Array.prototype.forEach.call(app.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete this saved portfolio from this browser?')) return;
        savePortfolios(loadPortfolios().filter(function (p) { return p.id !== b.dataset.del; }));
        renderPortfolios();
      });
    });
    document.getElementById('pcreate').addEventListener('click', function () {
      var name = document.getElementById('pname').value.trim(), ccns = Rollup.parseCcns(document.getElementById('pccns').value), msg = document.getElementById('pmsg');
      if (!name) { msg.textContent = 'Enter a name.'; return; }
      if (!ccns.length && document.getElementById('pccns').value.trim()) { msg.textContent = 'No valid CCNs found in the text. Clear the box to create an empty portfolio.'; return; }
      var p = createPortfolio(name, ccns);
      if (!p) { msg.textContent = 'This browser would not save the portfolio. Use the link view instead.'; return; }
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
    ['Facility', IX.name, 's'], ['State', IX.state, 's'], ['Beds', IX.beds, 0], ['Avg residents', IX.residents, 1], ['Occupancy (derived)', 'occ', 'p'],
    ['Overall', IX.overall, '*'], ['Health', IX.health, '*'], ['Staffing', IX.staffing, '*'], ['QM', IX.qm, '*'],
    ['Nurse HPRD', IX.hprd, 2], ['RN HPRD', IX.rnHprd, 2], ['Turnover %', IX.turnover, 1],
    ['Cycle 1 defs', IX.c1defs, 0], ['Weighted score', IX.weighted, 1], ['Harm cites', IX.harm, 0], ['IJ cites', IX.jeopardy, 0],
    ['Fines', IX.fines, 0], ['Fine $', IX.fineTotal, '$'], ['Pay denials', IX.denials, 0], ['Flags', 'flags', 'f']
  ];
  function pval(r, key) { return key === 'occ' ? (r[IX.beds] && r[IX.residents] != null ? r[IX.residents] / r[IX.beds] : null) : r[key]; }

  function drawPortfolio(o) {
    var map = byCcn(), rows = [], missing = [];
    o.ccns.forEach(function (c) { if (map[c]) rows.push(map[c]); else missing.push(c); });
    var s = Rollup.summarize(rows), nat = S.lookups.benchmarks.NATION.ratings;
    var sort = { key: IX.name, dir: 1 };
    function avg(m, dec) { return m.avg == null ? NA : fmt(m.avg, dec); }
    function tile(k, v, sub) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>'; }
    function rtile(label, key, natKey, chainVal) {
      var m = s.ratings[key];
      return tile(label, avg(m, 2), m.n + ' of ' + s.facilities + ' rated · US ' + fmt(nat[natKey], 1) + (o.chain ? ' · CMS chain avg ' + fmt(chainVal, 1) : ''));
    }
    var h = '<a class="back" href="#/portfolios">← Portfolios</a> <span style="float:right" class="controls">' +
      (o.savedId ? '<button id="prename">Rename</button>' : '<button id="psave">Save as portfolio</button>') +
      '<button id="plink">Copy link</button><button id="pcsv">Download CSV</button><button onclick="window.print()">Print or save as PDF</button></span>' +
      '<div class="card" style="clear:both"><h1>' + esc(o.title) + '</h1><div class="muted">' + (o.chain ? 'CMS chain · ' : '') + s.facilities.toLocaleString() + ' facilities in the current CMS release' +
      (o.chain && o.chain.count != null ? ' (CMS reports ' + o.chain.count + ')' : '') + '</div>' +
      (missing.length ? '<p class="chip warn" style="display:inline-block;margin-top:10px">' + missing.length + ' CCN' + (missing.length > 1 ? 's' : '') + ' not in the current CMS release: ' + esc(missing.join(', ')) + '</p><p class="muted small">A CCN drops out when a facility closes, loses certification, or receives a new CCN. These are excluded from every figure below.</p>' : '') + '</div>';
    var addCard = !o.savedId ? '' : '<div class="card"><h2>Add facilities</h2>' +
      '<div class="controls"><input id="addq" type="search" placeholder="Search by facility name, CCN, city, county, ZIP, or chain"></div><div id="addhits"></div>' +
      '<details style="margin-top:8px"><summary class="small">Paste a list of CCNs instead</summary><textarea id="addccns" rows="3" style="margin-top:8px" placeholder="CCNs separated by commas, spaces, or new lines"></textarea>' +
      '<div class="controls" style="margin-top:8px"><button id="addpaste">Add CCNs</button><span id="addpmsg" class="muted small"></span></div></details></div>';
    h += addCard;
    if (!rows.length) {
      app.innerHTML = h + '<div class="card"><p>' + (o.savedId ? 'This portfolio is empty. Add facilities above, or from any facility report or search result.' : 'No facilities to show.') + '</p></div>';
      wire(); wireAdd(); return;
    }

    h += '<div class="tiles">' +
      tile('Certified beds', fmt(s.beds, 0)) + tile('Avg residents per day', fmt(s.residents, 0)) +
      tile('Occupancy (derived)', s.occupancy == null ? NA : fmt(s.occupancy * 100, 1) + '%', 'Residents ÷ beds, ' + s.occupancyFacilities + ' facilities reporting both') +
      rtile('Avg overall rating', 'overall', 'Overall Rating', o.chain && o.chain.overall) + rtile('Avg health inspection', 'health', 'Health Inspection Rating', o.chain && o.chain.health) +
      rtile('Avg staffing rating', 'staffing', 'Staffing Rating', o.chain && o.chain.staffing) + rtile('Avg QM rating', 'qm', 'QM Rating', o.chain && o.chain.qm) +
      tile('1-star overall', fmt(s.oneStar, 0), 'facilities') +
      tile('SFF / candidates', s.sff + ' / ' + s.sffCandidates) + tile('Abuse icon', fmt(s.abuse, 0), 'facilities') +
      tile('Changed ownership', fmt(s.chow, 0), 'in last 12 months') +
      tile('Immediate jeopardy', fmt(s.jeopardy, 0), 'health citations at ' + s.facilitiesWithJeopardy + ' facilities, last 3 cycles') +
      tile('Actual harm', fmt(s.harm, 0), 'health citations, last 3 cycles') +
      tile('Fines (3 years)', money(s.fineTotal), s.fines + ' fines · ' + s.denials + ' payment denials') +
      tile('Avg nurse HPRD', avg(s.hprd, 2), 'simple average, ' + s.hprd.n + ' reporting') + tile('Avg turnover', s.turnover.avg == null ? NA : fmt(s.turnover.avg, 1) + '%', 'simple average, ' + s.turnover.n + ' reporting') +
      '</div>';

    var D = s.distribution;
    h += '<div class="card"><h2>Rating distribution</h2><div class="scroll"><table style="max-width:680px"><thead><tr><th>Rating</th><th class="n">Overall</th><th class="n">Health inspection</th><th class="n">Staffing</th><th class="n">Quality measures</th></tr></thead><tbody>' +
      [5, 4, 3, 2, 1, 'unrated'].map(function (k) {
        return '<tr><td>' + (k === 'unrated' ? '<span class="na">Not rated</span>' : stars(k)) + '</td>' + ['overall', 'health', 'staffing', 'qm'].map(function (c) { return '<td class="n">' + D[c][k] + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="src">Portfolio figures are derived from published facility values. Averages are simple averages of facilities with a published value, the method CMS uses for chain averages; the pipeline confirms that method against every CMS chain at each refresh. Source: CMS Provider Information and Health Deficiencies, processing date ' + fdate(S.manifest.processing_date) + '.</p></div>';

    h += '<div class="card"><h2>Facilities</h2><p class="muted small">Select a column heading to sort.</p><div class="scroll" id="ptable"></div></div>';
    app.innerHTML = h;

    function cell(r, c) {
      var v = pval(r, c[1]), t = c[2];
      if (t === 'f') return '<td>' + (r[IX.sff] ? '<span class="chip ' + (r[IX.sff] === 'SFF' ? 'bad' : 'warn') + '">' + esc(r[IX.sff]) + '</span> ' : '') + (r[IX.abuse] ? '<span class="chip bad">Abuse</span> ' : '') + (r[IX.chow] ? '<span class="chip warn">CHOW</span>' : '') + '</td>';
      if (c[1] === IX.name) return '<td><a href="#/f/' + esc(r[0]) + '">' + esc(v) + '</a><div class="muted small">' + esc(r[0]) + ' · ' + esc(r[IX.city]) + '</div></td>';
      if (t === 's') return '<td>' + esc(v) + '</td>';
      if (t === '*') return '<td class="n">' + (v == null ? '<span class="na">NR</span>' : v + ' <span class="stars">★</span>') + '</td>';
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
        return '<th class="' + (typeof c[2] === 'number' || '*p$'.indexOf(c[2]) !== -1 ? 'n' : '') + '"' + (c[1] === 'flags' ? '' : ' data-i="' + i + '" style="cursor:pointer"') + '>' + c[0] + (sort.key === c[1] ? (sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
      }).join('') + (o.savedId ? '<th></th>' : '') + '</tr></thead><tbody>' + sorted.map(function (r) {
        return '<tr>' + PCOLS.map(function (c) { return cell(r, c); }).join('') + (o.savedId ? '<td><button data-rm="' + esc(r[0]) + '">Remove</button></td>' : '') + '</tr>';
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
        var name = prompt('Portfolio name (saved in this browser only)', o.title === 'Portfolio' ? '' : o.title);
        if (!name || !name.trim()) return;
        var l = loadPortfolios(), p = { id: newId(), name: name.trim(), ccns: o.ccns.slice() };
        l.push(p);
        if (savePortfolios(l)) location.hash = '#/portfolio/' + p.id; else ps.textContent = 'Could not save';
      });
      pc.addEventListener('click', function () { downloadCsv(o.title, rows); });
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

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    if (h.indexOf('f/') === 0) renderFacility(decodeURIComponent(h.slice(2)));
    else if (h === 'status') renderStatus();
    else if (h === 'portfolios') renderPortfolios();
    else if (h.indexOf('portfolio/') === 0) renderSaved(decodeURIComponent(h.slice(10)));
    else if (h.indexOf('p/') === 0) drawPortfolio({ title: 'Portfolio', ccns: Rollup.parseCcns(decodeURIComponent(h.slice(2))) });
    else if (h.indexOf('chain/') === 0) renderChain(decodeURIComponent(h.slice(6)));
    else renderSearch();
  }

  Promise.all([getJSON('data/index.json'), getJSON('data/lookups.json'), getJSON('data/manifest.json')]).then(function (r) {
    S.index = r[0]; S.lookups = r[1]; S.manifest = r[2];
    document.getElementById('asof').textContent = 'CMS data as of ' + fdate(S.manifest.processing_date).replace(/<[^>]+>/g, '');
    window.addEventListener('hashchange', route);
    route();
  }).catch(function (e) {
    app.innerHTML = '<div class="card"><h1>Data could not be loaded</h1><p>' + esc(e.message) + '</p></div>';
  });
})();
