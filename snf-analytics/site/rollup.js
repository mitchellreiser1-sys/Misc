/* Portfolio rollups. Every figure here is derived from published facility
   values and is labeled "derived" on screen. The averaging method (simple
   average of rated facilities) is the one CMS uses for chain averages, and the
   pipeline proves that on every refresh. Tested in tests/rollup.test.js. */
(function (root) {
  'use strict';
  // Column positions in data/index.json. Mirrors pipeline/build.py. Append only.
  var IX = { ccn: 0, name: 1, city: 2, state: 3, zip: 4, county: 5, chain: 6, overall: 7, beds: 8, sff: 9, abuse: 10,
    health: 11, staffing: 12, qm: 13, residents: 14, hprd: 15, rnHprd: 16, turnover: 17, c1defs: 18, weighted: 19,
    fines: 20, fineTotal: 21, denials: 22, chow: 23, chainId: 24, harm: 25, jeopardy: 26, risk: 27, repeats: 28,
    legal: 29, lat: 30, lon: 31 };

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
      facilitiesWithJeopardy: count(rows, function (r) { return r[IX.jeopardy] > 0; }),
      risk: mean(col(rows, IX.risk)),
      repeats: sum(rows, IX.repeats)
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

  /* Lowest score that sits at or above a national percentile, from the
     score-to-percentile table the pipeline publishes. */
  function scoreAtPercentile(table, pct) {
    var best = null;
    Object.keys(table).forEach(function (s) {
      if (table[s] >= pct && (best === null || +s < best)) best = +s;
    });
    return best;
  }
  /* Facilities in the top tier: at or above the tier's score, or any Special
     Focus Facility or SFF candidate, which are always placed in the top tier. */
  function countTopTier(rows, threshold) {
    return count(rows, function (r) { return !!r[IX.sff] || (r[IX.risk] != null && r[IX.risk] >= threshold); });
  }
  /* Index of a facility's tier in the tier list [[low, high, label], ...].
     A Special Focus Facility or SFF candidate is always in the top tier. */
  function tierOf(row, tiers) {
    if (row[IX.sff]) return tiers.length - 1;
    var s = row[IX.risk];
    if (s == null) return null;
    for (var i = 0; i < tiers.length; i++) if (s >= tiers[i][0] && s <= tiers[i][1]) return i;
    return tiers.length - 1;
  }
  /* Number of facilities in each tier, in tier order. */
  function tierCounts(rows, tiers) {
    var out = tiers.map(function () { return 0; });
    rows.forEach(function (row) { var t = tierOf(row, tiers); if (t != null) out[t]++; });
    return out;
  }
  function countAtOrAbove(rows, threshold) {
    return threshold === null ? 0 : count(rows, function (r) { return r[IX.risk] != null && r[IX.risk] >= threshold; });
  }

  var api = { IX: IX, summarize: summarize, parseCcns: parseCcns, mean: mean, scoreAtPercentile: scoreAtPercentile, countAtOrAbove: countAtOrAbove, countTopTier: countTopTier, tierOf: tierOf, tierCounts: tierCounts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rollup = api;
})(this);
