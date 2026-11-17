const test = require('node:test');
const assert = require('node:assert');
const { summarize, parseCcns, IX } = require('../site/rollup.js');

function row(o) {
  const r = new Array(27).fill(null);
  Object.keys(o).forEach(k => { r[IX[k]] = o[k]; });
  return r;
}

test('ratings use a simple average of rated facilities only', () => {
  const s = summarize([row({ overall: 2 }), row({ overall: 5 }), row({ overall: null })]);
  assert.strictEqual(s.ratings.overall.avg, 3.5);
  assert.strictEqual(s.ratings.overall.n, 2);
  assert.deepStrictEqual(s.distribution.overall, { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1, unrated: 1 });
});

test('no rated facilities gives not available, never zero', () => {
  const s = summarize([row({ overall: null })]);
  assert.strictEqual(s.ratings.overall.avg, null);
  assert.strictEqual(s.occupancy, null);
});

test('occupancy matches numerator and denominator facilities', () => {
  const s = summarize([row({ beds: 100, residents: 80 }), row({ beds: 50, residents: null }), row({ beds: 100, residents: 90 })]);
  assert.strictEqual(s.beds, 250);
  assert.strictEqual(s.residents, 170);
  assert.strictEqual(s.occupancy, 170 / 200);
  assert.strictEqual(s.occupancyFacilities, 2);
});

test('counts and sums', () => {
  const s = summarize([
    row({ sff: 'SFF', abuse: 1, chow: 1, fines: 2, fineTotal: 1000.5, denials: 1, harm: 1, jeopardy: 2, overall: 1 }),
    row({ sff: 'SFF Candidate', abuse: 0, chow: 0, fines: 1, fineTotal: 500, denials: 0, harm: 0, jeopardy: 0 }),
    row({ sff: '', abuse: 0 })
  ]);
  assert.strictEqual(s.facilities, 3);
  assert.strictEqual(s.sff, 1);
  assert.strictEqual(s.sffCandidates, 1);
  assert.strictEqual(s.abuse, 1);
  assert.strictEqual(s.chow, 1);
  assert.strictEqual(s.fines, 3);
  assert.strictEqual(s.fineTotal, 1500.5);
  assert.strictEqual(s.denials, 1);
  assert.strictEqual(s.jeopardy, 2);
  assert.strictEqual(s.facilitiesWithJeopardy, 1);
  assert.strictEqual(s.oneStar, 1);
});

test('parseCcns pads Excel-stripped zeros, dedupes, ignores junk', () => {
  assert.deepStrictEqual(parseCcns('15009, 015009\n335757; 01A193 abc 1234567'), ['015009', '335757', '01A193']);
  assert.deepStrictEqual(parseCcns(''), []);
});
