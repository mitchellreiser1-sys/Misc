/* Portfolio rollups. Every figure here is derived from published facility
   values and is labeled "derived" on screen. The averaging method (simple
   average of rated facilities) is the one CMS uses for chain averages, and the
   pipeline proves that on every refresh. Tested in tests/rollup.test.js. */
(function (root) {
  'use strict';
  // Column positions in data/index.json. Mirrors pipeline/build.py. Append only.
  var IX = { ccn: 0, name: 1, city: 2, state: 3, zip: 4, county: 5, chain: 6, overall: 7, beds: 8, sff: 9, abuse: 10,
    health: 11, staffing: 12, qm: 13, residents: 14, hprd: 15, rnHprd: 16, turnover: 17, c1defs: 18, weighted: 19,
    fines: 20, fineTotal: 21, denials: 22, chow: 23, chainId: 24, harm: 25, jeopardy: 26 };

  function mean(values) {
    var v = values.filter(function (x) { return x != null; });
    if (!v.length) return { avg: null, n: 0 };
    return { avg: v.reduce(function (a, b) { return a + b; }, 0) / v.length, n: v.length };
  }
  function sum(rows, i) { return rows.reduce(function (a, r) { return a + (r[i] || 0); }, 0); }
  function count(rows, fn) { return rows.filter(fn).length; }
  function col(rows, i) { return rows.map(function (r) { return r[i]; }); }

  function distribution(rows, i) {
    var d = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unrated: 0 };
    rows.forEach(function (r) { if (r[i] == null) d.unrated++; else d[r[i]]++; });
    return d;
  }

  function summarize(rows) {
    // Occupancy uses only facilities reporting both beds and residents, so the
    // numerator and denominator always cover the same facilities.
    var both = rows.filter(function (r) { return r[IX.beds] && r[IX.residents] != null; });
    var occBeds = sum(both, IX.beds);
    var out = {
      facilities: rows.length,
      beds: sum(rows, IX.beds),
      residents: sum(rows, IX.residents),
      occupancy: occBeds ? sum(both, IX.residents) / occBeds : null,
      occupancyFacilities: both.length,
      ratings: {}, distribution: {},
      hprd: mean(col(rows, IX.hprd)), rnHprd: mean(col(rows, IX.rnHprd)), turnover: mean(col(rows, IX.turnover)),
      weighted: mean(col(rows, IX.weighted)),
      sff: count(rows, function (r) { return r[IX.sff] === 'SFF'; }),
      sffCandidates: count(rows, function (r) { return r[IX.sff] === 'SFF Candidate'; }),
      abuse: count(rows, function (r) { return r[IX.abuse] === 1; }),
      chow: count(rows, function (r) { return r[IX.chow] === 1; }),
      oneStar: count(rows, function (r) { return r[IX.overall] === 1; }),
      fines: sum(rows, IX.fines), fineTotal: sum(rows, IX.fineTotal), denials: sum(rows, IX.denials),
      harm: sum(rows, IX.harm), jeopardy: sum(rows, IX.jeopardy),
      facilitiesWithJeopardy: count(rows, function (r) { return r[IX.jeopardy] > 0; })
    };
    ['overall', 'health', 'staffing', 'qm'].forEach(function (k) {
      out.ratings[k] = mean(col(rows, IX[k]));
      out.distribution[k] = distribution(rows, IX[k]);
    });
    return out;
  }

  /* Parse pasted CCNs. Excel drops leading zeros, so all-digit entries shorter
     than six characters are padded back to six. */
  function parseCcns(text) {
    var seen = {}, out = [];
    String(text || '').toUpperCase().split(/[^0-9A-Z]+/).forEach(function (t) {
      if (!t) return;
      if (/^\d{1,5}$/.test(t)) t = ('000000' + t).slice(-6);
      if (!/^[0-9A-Z]{6}$/.test(t) || seen[t]) return;
      seen[t] = 1; out.push(t);
    });
    return out;
  }

  var api = { IX: IX, summarize: summarize, parseCcns: parseCcns, mean: mean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rollup = api;
})(this);
