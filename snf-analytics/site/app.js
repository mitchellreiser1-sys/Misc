/* SNF Analytics front end. Renders published CMS values prepared by the pipeline.
   No metric is calculated here except display formatting. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var S = { index: null, lookups: null, manifest: null, q: '', state: '' };
  var IX = { ccn: 0, name: 1, city: 2, state: 3, zip: 4, county: 5, chain: 6, overall: 7, beds: 8, sff: 9, abuse: 10 };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJSON(url) {
    return fetch(url).then(function (r) {
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
    var terms = S.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length && !S.state) { el.innerHTML = '<p class="muted">Enter a search term or choose a state.</p>'; return; }
    var hits = S.index.filter(function (r) {
      if (S.state && r[IX.state] !== S.state) return false;
      if (!terms.length) return true;
      var hay = (r[0] + ' ' + r[1] + ' ' + r[2] + ' ' + r[4] + ' ' + r[5] + ' ' + r[6]).toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    });
    var shown = hits.slice(0, 200);
    el.innerHTML = '<p class="muted small">' + hits.length.toLocaleString() + ' matching facilities' +
      (hits.length > shown.length ? ', showing the first ' + shown.length : '') + '.</p>' +
      '<div class="scroll"><table><thead><tr><th>Facility</th><th>CCN</th><th>City</th><th>State</th><th>Chain</th><th class="n">Beds</th><th>Overall rating</th><th>Flags</th></tr></thead><tbody>' +
      shown.map(function (r) {
        var flags = (r[IX.sff] ? '<span class="chip ' + (r[IX.sff] === 'SFF' ? 'bad' : 'warn') + '">' + esc(r[IX.sff]) + '</span> ' : '') +
          (r[IX.abuse] ? '<span class="chip bad">Abuse icon</span>' : '');
        return '<tr class="hit" data-ccn="' + esc(r[0]) + '"><td><a href="#/f/' + esc(r[0]) + '">' + esc(r[1]) + '</a></td><td>' + esc(r[0]) +
          '</td><td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td>' + esc(r[6]) + '</td><td class="n">' + fmt(r[IX.beds], 0) +
          '</td><td>' + stars(r[IX.overall]) + '</td><td>' + flags + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    Array.prototype.forEach.call(el.querySelectorAll('tr.hit'), function (tr) {
      tr.addEventListener('click', function (e) { if (e.target.tagName !== 'A') location.hash = '#/f/' + tr.dataset.ccn; });
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
    var h = '<a class="back" href="#/">← Back to search</a> <button onclick="window.print()" style="float:right">Print or save as PDF</button>';

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
    h += '<div class="card"><h1>' + esc(f.name) + '</h1><div class="muted">CCN ' + esc(f.ccn) + ' · ' + esc(f.address) + ', ' + esc(f.city) + ', ' +
      esc(f.state) + ' ' + esc(f.zip) + (f.county ? ' · ' + esc(f.county) + ' County' : '') + '</div>' +
      '<div class="muted small" style="margin-top:6px">' + [f.ownership_type, f.provider_type,
        f.urban == null ? null : (f.urban ? 'Urban' : 'Rural'),
        f.certified ? 'Certified ' + fdate(f.certified) : null,
        f.legal_name && f.legal_name !== f.name ? 'Legal name: ' + f.legal_name : null,
        f.chain ? 'Chain: ' + f.chain.name + (f.chain.count ? ' (' + f.chain.count + ' facilities' + (f.chain.avg_overall != null ? ', average overall rating ' + f.chain.avg_overall : '') + ')' : '') : 'No chain reported'
      ].filter(Boolean).map(esc).join(' · ') + '</div>' +
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

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    if (h.indexOf('f/') === 0) renderFacility(decodeURIComponent(h.slice(2)));
    else if (h === 'status') renderStatus();
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
