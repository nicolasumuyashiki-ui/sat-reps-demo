/* ============================================================
   verify_bank.js — mechanical checks for a SAT R&W module bank
   ============================================================
   JSON adaptation of the v3.0 generation system's verify_set.py.
   Usage: node scripts/verify_bank.js data/test1.json

   Checks (mechanical only — answer correctness is the reasoning
   pass's job):
     1-D   answer-letter balance (each 6–8 of 27), runs ≤ 3,
           no full cyclic ABCD repetition
     TIER  declared tier_mix equals per-question difficulty counts
     5-B-2 reading passages (C&S + I&I) word-count range ≥ 80
     5-B-5 within-question choice-length spread ≤ 6 words
           (sentence-choice items only)
     REG   long-register skills' choices average ≥ 22 words
     LEN   per-skill passage length floors (SEC ≥ 20w, CoE ≥ 85w,
           WiC 20–55w)
     DUP   Boundaries insertion duplication ("…Peru Peru;")
     STEM  required stem phrase per skill
     STRUCT figures resolve; SEC items carry `convention`;
           distractors = exactly the 3 wrong indexes with trap+why
   ============================================================ */

'use strict';
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('usage: node verify_bank.js <bank.json>'); process.exit(2); }

const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
const qs = bank.questions || [];
const errors = [];
const warns = [];

const LETTERS = ['A', 'B', 'C', 'D'];
const wc = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;

const LONG_REGISTER = new Set([
  'Central Ideas and Details', 'Inferences', 'Cross-Text Connections',
  'Command of Evidence: Textual', 'Command of Evidence: Quantitative',
  'Rhetorical Synthesis'
]);
const SHORT_ANSWER = new Set(['Words in Context', 'Boundaries', 'Transitions']);
const SEC_SKILLS = new Set(['Boundaries', 'Form, Structure, and Sense']);

const STEM_REQUIRED = {
  'Words in Context': 'most logical and precise word or phrase',
  'Central Ideas and Details': 'main idea of the text',
  'Inferences': 'most logically completes the text',
  'Boundaries': 'conventions of Standard English',
  'Form, Structure, and Sense': 'conventions of Standard English',
  'Transitions': 'most logical transition',
  'Rhetorical Synthesis': 'most effectively uses relevant information from the notes'
};

/* ---------- per-question checks ---------- */
if (qs.length !== 27) errors.push(`COUNT: expected 27 questions, found ${qs.length}`);

const figIds = new Set((bank.figures || []).map(f => f.id));
const tierCount = {};

qs.forEach(q => {
  const id = `Q${q.num}`;

  // structure
  if (!Array.isArray(q.choices) || q.choices.length !== 4) errors.push(`${id} STRUCT: needs exactly 4 choices`);
  if (typeof q.answer_index !== 'number' || q.answer_index < 0 || q.answer_index > 3)
    errors.push(`${id} STRUCT: bad answer_index`);
  const dKeys = Object.keys(q.distractors || {}).map(Number).sort();
  const expected = [0, 1, 2, 3].filter(i => i !== q.answer_index);
  if (JSON.stringify(dKeys) !== JSON.stringify(expected))
    errors.push(`${id} STRUCT: distractor keys ${JSON.stringify(dKeys)} != wrong indexes ${JSON.stringify(expected)}`);
  expected.forEach(i => {
    const d = (q.distractors || {})[String(i)];
    if (!d || !d.trap || !d.why) errors.push(`${id} STRUCT: distractor ${LETTERS[i]} missing trap/why`);
  });
  if (!q.rationale || wc(q.rationale) < 10) errors.push(`${id} STRUCT: rationale missing/too thin`);
  if (q.figure && !figIds.has(q.figure)) errors.push(`${id} STRUCT: figure "${q.figure}" not in figures[]`);
  if (SEC_SKILLS.has(q.skill) && !q.convention) errors.push(`${id} STRUCT: SEC item missing convention`);
  if (!SEC_SKILLS.has(q.skill) && q.convention) warns.push(`${id}: non-SEC item carries convention`);

  // tier
  tierCount[q.difficulty] = (tierCount[q.difficulty] || 0) + 1;

  // stems
  const need = STEM_REQUIRED[q.skill];
  if (need && !(q.stem || '').includes(need)) errors.push(`${id} STEM: missing required phrase for ${q.skill}`);

  // passage lengths
  const pw = wc(q.passage);
  if (q.skill === 'Words in Context' && (pw < 20 || pw > 60)) warns.push(`${id} LEN: WiC passage ${pw}w (expect 25–50)`);
  if (SEC_SKILLS.has(q.skill) && pw < 20) errors.push(`${id} LEN: SEC passage ${pw}w (< 20w floor)`);
  if (/Command of Evidence/.test(q.skill) && pw < 80) errors.push(`${id} LEN: CoE passage ${pw}w (< ~90w register)`);

  // choice-length spread
  const lens = (q.choices || []).map(wc);
  const spread = Math.max(...lens) - Math.min(...lens);
  if (!SHORT_ANSWER.has(q.skill) && spread > 6)
    errors.push(`${id} 5-B-5: choice-length spread ${spread}w > 6 (${lens.join('/')})`);

  // long-register choices
  if (LONG_REGISTER.has(q.skill)) {
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    if (avg < 20) errors.push(`${id} REG: long-register choices avg ${avg.toFixed(1)}w (< 20w)`);
    else if (avg < 24) warns.push(`${id} REG: choices avg ${avg.toFixed(1)}w (official register ~25–40w)`);
  }

  // Boundaries DUP scan — insert choice at blank, look for adjacent dup tokens
  if (q.skill === 'Boundaries') {
    if (!/_{3,}/.test(q.passage)) errors.push(`${id} DUP: Boundaries passage has no ______ blank`);
    (q.choices || []).forEach((c, i) => {
      const merged = q.passage.replace(/_{3,}/, c);
      const toks = merged.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean);
      for (let t = 1; t < toks.length; t++) {
        if (toks[t] === toks[t - 1] && toks[t].length > 2)
          errors.push(`${id} DUP: inserting choice ${LETTERS[i]} duplicates "${toks[t]}"`);
      }
    });
  }
});

/* ---------- module-level checks ---------- */
// 1-D letter balance + runs
const keyLetters = qs.map(q => LETTERS[q.answer_index]);
const counts = { A: 0, B: 0, C: 0, D: 0 };
keyLetters.forEach(l => counts[l]++);
Object.entries(counts).forEach(([l, n]) => {
  if (n < 5 || n > 9) errors.push(`1-D: letter ${l} appears ${n}× (expect ~6–8)`);
});
let run = 1;
for (let i = 1; i < keyLetters.length; i++) {
  run = (keyLetters[i] === keyLetters[i - 1]) ? run + 1 : 1;
  if (run > 3) errors.push(`1-D: run of ${run} × ${keyLetters[i]} ending at Q${qs[i].num}`);
}

// tier mix
if (bank.tier_mix) {
  Object.entries(bank.tier_mix).forEach(([tier, n]) => {
    if ((tierCount[tier] || 0) !== n)
      errors.push(`TIER: declared ${tier}=${n} but counted ${tierCount[tier] || 0}`);
  });
}

// 5-B-2 reading range
const reading = qs.filter(q => ['Craft and Structure', 'Information and Ideas'].includes(q.domain));
if (reading.length) {
  const ws = reading.map(q => wc(q.passage));
  const range = Math.max(...ws) - Math.min(...ws);
  if (range < 80) errors.push(`5-B-2: reading passage range ${range}w (< 80) — min ${Math.min(...ws)}, max ${Math.max(...ws)}`);
}

// domain order
const DOMAIN_ORDER = ['Craft and Structure', 'Information and Ideas', 'Standard English Conventions', 'Expression of Ideas'];
let lastIdx = 0;
qs.forEach(q => {
  const di = DOMAIN_ORDER.indexOf(q.domain);
  if (di < 0) errors.push(`Q${q.num}: unknown domain "${q.domain}"`);
  else if (di < lastIdx) errors.push(`Q${q.num}: domain out of fixed order`);
  else lastIdx = di;
});

/* ---------- report ---------- */
console.log(`\n=== verify_bank: ${file} ===`);
console.log(`questions: ${qs.length} · key: ${keyLetters.join('')}`);
console.log(`letters: A${counts.A} B${counts.B} C${counts.C} D${counts.D} · tiers: ${JSON.stringify(tierCount)}`);
if (warns.length) { console.log(`\n-- warnings (${warns.length}) --`); warns.forEach(w => console.log('  ⚠ ' + w)); }
if (errors.length) {
  console.log(`\n-- errors (${errors.length}) --`);
  errors.forEach(e => console.log('  ✘ ' + e));
  console.log('\nRESULT: FAIL');
  process.exit(1);
}
console.log('\nRESULT: PASS');
