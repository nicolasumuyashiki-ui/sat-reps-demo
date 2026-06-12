/* ============================================================
   SAT Reps Demo — Per-test configuration
   ============================================================
   Centralizes the few tunables the practice engine needs at
   runtime. Edit the values; do not edit the keys without also
   updating sat/app.js (which reads them by name).

   Loaded via a plain <script src="config.js"></script> on the
   practice + results pages; exposes a single global `SAT_CONFIG`.
   ============================================================ */

var SAT_CONFIG = {

  /* ---------- Module-level timing & length ---------- */
  /* Digital SAT R&W: 27 questions, 32 minutes per module.
     `questionsPerModule` is used to validate the bank length;
     `moduleSeconds` is the countdown timer's starting value. */
  questionsPerModule: 27,
  moduleSeconds: 32 * 60,        // 32:00 = 1920 s
  warnUnderSeconds: 5 * 60,      // turn timer red at 5:00 remaining

  /* ---------- Full-test (M1 → M2) adaptive routing ---------- */
  /* Only relevant when a test definition provides both
     module2-easier and module2-harder banks. With a single
     module2 bank (or no module2), this is ignored. The default
     threshold mirrors the public-domain estimate of ≥ ~60 %. */
  m1ToHarderThreshold: 17,       // M1 raw ≥ 17/27 → Harder M2

  /* ---------- Raw → scaled score conversion ---------- */
  /* Per-test lookup tables. Key = test_id (e.g. "test1"), value
     = an object whose keys are raw totals and values are scaled
     scores on the 200–800 SAT R&W section scale. The renderer
     MUST refuse to invent a scaled score: if a test_id isn't
     listed here, the results page shows raw + percent only and
     labels the scaled slot "not configured". DO NOT fill in
     placeholder/estimated tables — leave the test_id out. */
  rawToScaled: {
    // "test1": { 0: 200, 1: 210, /* ... */ 54: 800 }
  },

  /* ---------- GAS backend ---------- */
  /* By default, sat-reps-demo reuses the TCK Reps shared GAS
     endpoint baked into js/api.js (so auth + history work out of
     the box across the two demo apps). Set this to a non-empty
     string to override per-deployment without editing api.js. */
  apiUrlOverride: '',

  /* When saving an attempt to the ANSWERS sheet, this prefix is
     prepended to the test_id to keep SAT rows distinguishable
     from TOEFL ones in the shared sheet. */
  attemptSetPrefix: 'SAT R&W',

  /* ---------- Domain / skill display ---------- */
  /* Canonical order for the per-domain bar chart on Results.
     Anything not in this list is appended after, in the order
     it first appears in the bank. */
  domainOrder: [
    'Information and Ideas',
    'Craft and Structure',
    'Expression of Ideas',
    'Standard English Conventions'
  ],

  /* Domains whose `skill` field should be broken out as
     individual bars rather than rolled up into the parent
     domain. SEC is the deliberate one: it spreads across
     possessive, modifier placement, subject-verb, etc., and
     hiding that detail destroys learning value. */
  explodeSkillsInDomains: [
    'Standard English Conventions'
  ]
};
