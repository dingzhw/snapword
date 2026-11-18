// Comprehensive Unit + Adversarial Offline Chromium E2E + Privacy Gate Suite for 词哒 · SnapWord (v0.1.2)
// Covers Party A Round 1 (F01–F08) and Round 2 re-inspection items (R01–R08).
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const Curriculum = require('../src/curriculum');
const SnapCore = require('../src/core');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOT = process.env.SNAPWORD_SCAN_ROOT ? path.resolve(process.env.SNAPWORD_SCAN_ROOT) : ROOT;
const DIST_HTML = path.join(ROOT, 'dist', 'SnapWord-词哒.html');
const MEDIA_DIR = process.env.SNAPWORD_MEDIA_DIR ? path.resolve(process.env.SNAPWORD_MEDIA_DIR) : path.join(ROOT, 'docs', 'media');
const CHROME_EXE = process.env.SNAPWORD_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function loadPlaywright() {
  const candidates = [
    process.env.SNAPWORD_PLAYWRIGHT,
    'playwright',
    path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
  ].filter(Boolean);
  for (const mod of candidates) {
    try { return require(mod); } catch {}
  }
  return null;
}

// ==================== F08: Public Repository Privacy Gate ====================
function runPrivacyGate() {
  console.log('1/4 Running open-source privacy gate (F08)...');
  const crypto = require('node:crypto');
  const hash24 = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
  // Irreversible SHA-256 prefixes of private local identifiers (zero plaintext PII in public repo)
  const blockedHashes = new Set([
    'f62ff9ff27c76825705aca69',
    '0881aaf65572f65f4927e9c4',
    'bf7367a67e32537f8aff4b62',
    'a0c818402d888f8726afd74e'
  ]);

  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: SCAN_ROOT,
    encoding: 'utf8'
  });
  const files = out.split(/\r?\n/).filter(Boolean);
  assert.ok(!files.some(f => f.includes('评审')), 'Private review folder docs/评审/ must be ignored by Git');

  for (const rel of files) {
    if (/\.(mp3|png|wav|ogg|jpg|jpeg)$/i.test(rel)) continue;
    const full = path.join(SCAN_ROOT, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const content = fs.readFileSync(full, 'utf8');
    for (const tok of (content.match(/[A-Za-z0-9_]{5,20}/g) || [])) {
      assert.equal(blockedHashes.has(hash24(tok)), false, `Blocked private ASCII identifier in public file: ${rel}`);
    }
    const cjkRuns = content.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (const run of cjkRuns) {
      for (let i = 0; i <= run.length - 2; i++) {
        assert.equal(blockedHashes.has(hash24(run.slice(i, i + 2))), false, `Blocked private name in public file: ${rel}`);
        if (i + 3 <= run.length) {
          assert.equal(blockedHashes.has(hash24(run.slice(i, i + 3))), false, `Blocked private name in public file: ${rel}`);
        }
      }
    }
  }
  console.log(`   ✔ Privacy gate passed across ${files.length} public repo files.`);
}

// ==================== F01–F06 + R02–R08: Pure State Machine Unit Tests ====================
function runUnitTests() {
  console.log('2/4 Running SnapCore unit tests (F01–F06 & R02–R08)...');

  // --- F05: Exact Unit 6 Official 24-Item Wordlist Verification ---
  const st0 = SnapCore.freshState(Curriculum);
  const u6Words = st0.items.filter(it => it.unit === 6 && it.sourceScope === 'textbook_wordlist');
  const u6Core = u6Words.filter(it => it.textbookCore);
  const u6Star = u6Words.filter(it => !it.textbookCore);
  assert.equal(u6Words.length, 24, 'Unit 6 official wordlist must contain exact 24 items');
  assert.equal(u6Core.length, 19, 'Unit 6 must contain exact 19 unstarred core items');
  assert.equal(u6Star.length, 5, 'Unit 6 must contain exact 5 starred non-core items');
  assert.deepEqual(
    u6Star.map(x => x.en).sort(),
    ['advice', 'classmate', 'get along with', 'important', 'neighbour']
  );

  // Context & American variant judgment (F05 + R07)
  const fav = st0.items.find(x => x.id === 'u6_favourite');
  assert.equal(SnapCore.judgeSpelling(fav, 'favorite', { allowAmericanSpelling: false }).ok, false);
  assert.equal(SnapCore.judgeSpelling(fav, 'favorite', { allowAmericanSpelling: true }).ok, true);

  const hwPhrase = st0.items.find(x => x.id === 'u6_do_homework');
  assert.equal(SnapCore.judgeSpelling(hwPhrase, 'do your homework', { promptMode: 'zh_prompt' }).ok, true);
  assert.equal(SnapCore.judgeSpelling(hwPhrase, 'do my homework', { promptMode: 'zh_prompt' }).ok, false);
  assert.equal(SnapCore.judgeSpelling(hwPhrase, 'do my homework', { promptMode: 'sentence_context' }).ok, true);

  // R07: Unified expected answer & spokenText across person variants
  const tMy = SnapCore.getTargetAnswers(hwPhrase, { promptMode: 'sentence_context', variantKey: 'my' });
  assert.equal(tMy.primary, 'do my homework');
  assert.equal(tMy.spokenText, 'do my homework');
  const tYour = SnapCore.getTargetAnswers(hwPhrase, { promptMode: 'sentence_context', variantKey: 'your' });
  assert.equal(tYour.primary, 'do your homework');
  assert.equal(tYour.spokenText, 'do your homework');

  const wayBack = st0.items.find(x => x.id === 'u6_way_back');
  const wbTheir = SnapCore.getTargetAnswers(wayBack, { promptMode: 'sentence_context', variantKey: 'their' });
  assert.equal(wbTheir.primary, 'on their way back');
  assert.equal(wbTheir.spokenText, 'on their way back');
  const wbMy = SnapCore.getTargetAnswers(wayBack, { promptMode: 'sentence_context', variantKey: 'my' });
  assert.equal(wbMy.primary, 'on my way back');
  assert.equal(wbMy.spokenText, 'on my way back');

  // F05 + R02 Allocation Planner: [Saturday, Sunday, classmate, problem] + 0-paper & all-deferred cases
  const alloc = SnapCore.planPackAllocation(
    st0,
    'test_pack',
    ['u5_saturday', 'u5_sunday', 'u6_classmate', 'u6_problem'],
    { totalPaperCap: 4, dueIds: [] }
  );
  assert.deepEqual(alloc.paperNowIds, ['u5_saturday', 'u5_sunday', 'u6_problem']);
  assert.deepEqual(alloc.oralOnlyIds, ['u6_classmate']);
  assert.deepEqual(alloc.deferredIds, []);

  SnapCore.updateCurriculumItem(st0, 'u6_classmate', { classRequirement: 'dictation_verified' });
  const allocAfter = SnapCore.planPackAllocation(
    st0,
    'test_pack',
    ['u5_saturday', 'u5_sunday', 'u6_classmate', 'u6_problem'],
    { totalPaperCap: 3, dueIds: [] }
  );
  assert.deepEqual(allocAfter.paperNowIds, ['u5_saturday', 'u5_sunday', 'u6_classmate']);
  assert.deepEqual(allocAfter.deferredIds, ['u6_problem']);

  // R02: All oral_only -> 0 paper, 3 oral, hasAnyActiveTask = true
  st0.packOverrides.pack_oral = { u5_saturday: 'oral_only', u5_sunday: 'oral_only', fnd_morning: 'oral_only' };
  const allocOral = SnapCore.planPackAllocation(st0, 'pack_oral', ['u5_saturday', 'u5_sunday', 'fnd_morning'], { totalPaperCap: 5, dueIds: [] });
  assert.deepEqual(allocOral.combinedPaperIds, []);
  assert.deepEqual(allocOral.oralOnlyIds, ['u5_saturday', 'u5_sunday', 'fnd_morning']);
  assert.equal(allocOral.hasAnyActiveTask, true);

  // R02: All next_candidate -> 0 paper, 0 oral, hasAnyActiveTask = false
  st0.packOverrides.pack_cand = { u5_saturday: 'next_candidate', u5_sunday: 'next_candidate', fnd_morning: 'next_candidate' };
  const allocCand = SnapCore.planPackAllocation(st0, 'pack_cand', ['u5_saturday', 'u5_sunday', 'fnd_morning'], { totalPaperCap: 5, dueIds: [] });
  assert.deepEqual(allocCand.combinedPaperIds, []);
  assert.deepEqual(allocCand.oralOnlyIds, []);
  assert.equal(allocCand.hasAnyActiveTask, false);

  // R02: 3 due items + cap 3 -> 3 due + 0 new paper
  const allocDueFull = SnapCore.planPackAllocation(st0, 'pack_due_full', ['u6_wall', 'u6_space'], {
    totalPaperCap: 3,
    dueIds: ['u5_saturday', 'u5_sunday', 'fnd_morning']
  });
  assert.deepEqual(allocDueFull.paperNowIds, []);
  assert.deepEqual(allocDueFull.combinedPaperIds, ['u5_saturday', 'u5_sunday', 'fnd_morning']);

  // --- F01 + R03 + R08: Mixed Denominator, Actor-Guarded Pending Verify, Answered Wrong & Follow-up Correction ---
  const st1 = SnapCore.freshState(Curriculum);
  assert.equal(SnapCore.recordEvent(st1, { sessionId: 's_zero', itemId: 'u5_saturday', taskType: 'paper_check', outcome: 'unjudged' }), null);
  assert.equal(st1.events.length, 0);

  const mixedOutcomes = [
    ['u5_saturday', 'paper_independent'],
    ['u5_sunday', 'blind_self_fixed'],
    ['fnd_morning', 'answer_corrected'],
    ['fnd_homework', 'blank'],
    ['fnd_football', 'untested'],
    ['u5_sometimes', 'pending_verify']
  ];
  for (const [id, out] of mixedOutcomes) {
    SnapCore.recordEvent(st1, {
      sessionId: 's_mix',
      stageTag: 'paper',
      actor: 'student',
      itemId: id,
      taskType: 'paper_check',
      outcome: out,
      dateStr: '2026-11-17',
      timestamp: 1794915000000
    });
  }
  SnapCore.recordEvent(st1, {
    sessionId: 's_mix',
    stageTag: 'paper',
    actor: 'student',
    itemId: 'u5_saturday',
    taskType: 'paper_check',
    outcome: 'paper_independent',
    dateStr: '2026-11-17',
    timestamp: 1794915001000
  });
  assert.equal(st1.events.length, 6, 'Idempotent session+item key must prevent duplicate records');

  const summary1 = SnapCore.getStatsSummary(st1);
  assert.equal(summary1.paperRatioText, '1 / 4');
  assert.equal(summary1.pendingVerifyCount, 1);

  // R03 (P0): Attempting to verify a student pending_verify event while in parent_demo MUST be blocked!
  const pendingEvt = st1.events.find(e => e.itemId === 'u5_sometimes');
  st1.actorMode = 'parent_demo';
  for (const attemptOut of ['paper_independent', 'blind_self_fixed', 'answer_corrected', 'answered_wrong', 'blank']) {
    const blocked = SnapCore.resolvePendingVerify(st1, pendingEvt.id, attemptOut, ['missing_letter']);
    assert.equal(blocked?.blocked, true, `Demo mode must block ${attemptOut} on student pending event`);
  }
  assert.equal(SnapCore.getStatsSummary(st1, 'student').paperRatioText, '1 / 4', 'Student ratio must remain untouched after demo verify attempts');
  assert.equal(st1.mastery['u5_sometimes'].badge, 'none');

  // Switch back to student -> verify once -> updates to 2 / 5 and Silver; second call is idempotent
  st1.actorMode = 'student';
  SnapCore.resolvePendingVerify(st1, pendingEvt.id, 'paper_independent');
  const revAfterFirstVerify = pendingEvt.rev;
  assert.equal(SnapCore.getStatsSummary(st1).paperRatioText, '2 / 5');
  assert.equal(st1.mastery['u5_sometimes'].badge, 'silver');
  SnapCore.resolvePendingVerify(st1, pendingEvt.id, 'answered_wrong');
  assert.equal(pendingEvt.outcome, 'paper_independent', 'Already verified item must not be overwritten without allowReverify');
  assert.equal(pendingEvt.rev, revAfterFirstVerify);

  // R08: Pending verify -> answered_wrong + errorTags -> follow-up red_pen_correction
  const wrongPend = SnapCore.recordEvent(st1, {
    sessionId: 's_r08',
    actor: 'student',
    itemId: 'u6_space',
    taskType: 'paper_check',
    outcome: 'pending_verify',
    dateStr: '2026-11-17',
    timestamp: 1794917000000
  });
  SnapCore.resolvePendingVerify(st1, wrongPend.id, 'answered_wrong', ['missing_letter', 'letter_swap']);
  assert.equal(wrongPend.outcome, 'answered_wrong');
  assert.deepEqual(wrongPend.errorTags, ['missing_letter', 'letter_swap']);
  assert.equal(SnapCore.getStatsSummary(st1).paperRatioText, '2 / 6');
  assert.equal(SnapCore.getStatsSummary(st1).answeredWrongCount, 1);
  assert.equal(st1.mastery['u6_space'].pendingCorrection, true);
  assert.equal(st1.mastery['u6_space'].needsReview, true);
  assert.equal(st1.mastery['u6_space'].badge, 'none');

  const corrEvt = SnapCore.recordFollowUpCorrection(st1, wrongPend.id, '', { dateStr: '2026-11-18', timestamp: 1795001400000 });
  assert.equal(corrEvt.taskType, 'red_pen_correction');
  assert.equal(wrongPend.outcome, 'answered_wrong', 'Original first-attempt answered_wrong must remain traceable');
  assert.equal(st1.mastery['u6_space'].pendingCorrection, false);
  assert.equal(st1.mastery['u6_space'].badge, 'bronze');
  assert.equal(st1.mastery['u6_space'].needsReview, true, 'Follow-up correction still requires independent recall next session');

  // --- F04 + R04: Normal Path (17->18->20->24) vs Early Daily Practice Path (17->18->19->20) & Overdue Rollover ---
  {
    const stNormal = SnapCore.freshState(Curriculum);
    const pass = (d, ts) => SnapCore.recordEvent(stNormal, {
      actor: 'student', itemId: 'u5_saturday', taskType: 'paper_check', outcome: 'paper_independent', dateStr: d, timestamp: ts
    });
    pass('2026-11-17', 1794915000000);
    assert.equal(stNormal.mastery['u5_saturday'].nextDueDate, '2026-11-18');
    pass('2026-11-18', 1795001400000);
    assert.equal(stNormal.mastery['u5_saturday'].nextDueDate, '2026-11-20');
    pass('2026-11-20', 1795174200000);
    assert.equal(stNormal.mastery['u5_saturday'].nextDueDate, '2026-11-24');
    assert.equal(stNormal.mastery['u5_saturday'].stabilized, false);
    pass('2026-11-24', 1795519800000);
    assert.equal(stNormal.mastery['u5_saturday'].stabilized, true);
    assert.equal(stNormal.mastery['u5_saturday'].nextDueDate, null);

    // Slip & same-night recovery check
    SnapCore.recordEvent(stNormal, {
      actor: 'student', itemId: 'u5_saturday', taskType: 'paper_check', outcome: 'answer_corrected', dateStr: '2026-12-06', timestamp: 1796556600000
    });
    pass('2026-12-06', 1796557600000);
    assert.equal(stNormal.mastery['u5_saturday'].needsReview, true);
    pass('2026-12-07', 1796643000000);
    assert.equal(stNormal.mastery['u5_saturday'].anchorD0, '2026-12-07');
    assert.equal(stNormal.mastery['u5_saturday'].nextDueDate, '2026-12-08');
  }

  // R04 Early Practice Path: 11-17 -> 11-18 -> 11-19 -> 11-20 MUST NOT stabilize on 11-20!
  {
    const stEarly = SnapCore.freshState(Curriculum);
    const pass = (d, ts) => SnapCore.recordEvent(stEarly, {
      actor: 'student', itemId: 'u5_saturday', taskType: 'paper_check', outcome: 'paper_independent', dateStr: d, timestamp: ts
    });
    pass('2026-11-17', 1794915000000); // D0 = 17, due 18 (idx 1)
    pass('2026-11-18', 1795001400000); // Passed D+1, due 20 (idx 2)
    pass('2026-11-19', 1795087800000); // Early extra practice before 11-20!
    assert.equal(stEarly.events.length, 3, 'Extra practice event must be preserved');
    assert.equal(stEarly.mastery['u5_saturday'].checkpointIdx, 2, '11-19 early practice must not advance D+3 checkpoint');
    assert.equal(stEarly.mastery['u5_saturday'].nextDueDate, '2026-11-20');
    assert.equal(stEarly.mastery['u5_saturday'].stabilized, false);

    pass('2026-11-20', 1795174200000); // Now at D+3 (11-20) -> advances to idx 3, due 11-24!
    assert.equal(stEarly.mastery['u5_saturday'].checkpointIdx, 3);
    assert.equal(stEarly.mastery['u5_saturday'].stabilized, false, 'Must NOT enter stabilized on D+3 (11-20)');
    assert.equal(stEarly.mastery['u5_saturday'].nextDueDate, '2026-11-24');

    pass('2026-11-22', 1795347000000); // Early extra practice before 11-24
    assert.equal(stEarly.mastery['u5_saturday'].stabilized, false);
    assert.equal(stEarly.mastery['u5_saturday'].nextDueDate, '2026-11-24');

    pass('2026-11-24', 1795519800000); // Reaches D+7 -> now stabilized!
    assert.equal(stEarly.mastery['u5_saturday'].stabilized, true);
    assert.equal(stEarly.mastery['u5_saturday'].nextDueDate, null);
  }

  // R04 Overdue Rollover Path: D0=11-17, missed until 11-21 -> rolls forward +2 days to 11-23
  {
    const stLate = SnapCore.freshState(Curriculum);
    SnapCore.recordEvent(stLate, { actor: 'student', itemId: 'u6_wall', taskType: 'paper_check', outcome: 'paper_independent', dateStr: '2026-11-17', timestamp: 1794915000000 });
    SnapCore.recordEvent(stLate, { actor: 'student', itemId: 'u6_wall', taskType: 'paper_check', outcome: 'paper_independent', dateStr: '2026-11-21', timestamp: 1795260600000 });
    assert.equal(stLate.mastery['u6_wall'].checkpointIdx, 2);
    assert.equal(stLate.mastery['u6_wall'].nextDueDate, '2026-11-23');
  }

  // --- R07: Decoupled testedAt / dateStr vs submittedAt ---
  {
    const stCross = SnapCore.freshState(Curriculum);
    const crossEvt = SnapCore.recordEvent(stCross, {
      sessionId: 's_cross',
      actor: 'student',
      itemId: 'u5_saturday',
      taskType: 'paper_check',
      outcome: 'paper_independent',
      testedAt: 1794915000000,   // 2026-11-17
      submittedAt: 1795001400000, // 2026-11-18
      dateStr: '2026-11-17',
      paperRef: '2026-11-17 #1'
    });
    assert.equal(crossEvt.dateStr, '2026-11-17');
    assert.equal(crossEvt.paperRef, '2026-11-17 #1');
    assert.equal(crossEvt.submittedAt, 1795001400000);
    assert.equal(stCross.mastery['u5_saturday'].anchorD0, '2026-11-17');
    assert.equal(stCross.mastery['u5_saturday'].nextDueDate, '2026-11-18');
  }

  // --- F06 + R06: Backup Pending Upgrade AND Strict Conflict Policy across Higher/Equal/Lower rev ---
  for (const incomingRev of [2, 1, 0]) {
    const baseLoc = SnapCore.freshState(Curriculum);
    SnapCore.recordEvent(baseLoc, {
      id: 'conf_evt',
      rev: 1,
      actor: 'student',
      itemId: 'u5_saturday',
      taskType: 'paper_check',
      outcome: 'answered_wrong',
      dateStr: '2026-11-18',
      timestamp: 1795001400000
    });
    const incBackup = SnapCore.freshState(Curriculum);
    SnapCore.recordEvent(incBackup, {
      id: 'conf_evt',
      rev: incomingRev,
      actor: 'student',
      itemId: 'u5_saturday',
      taskType: 'paper_check',
      outcome: 'paper_independent',
      dateStr: '2026-11-18',
      timestamp: 1795001500000
    });

    const preview = SnapCore.inspectBackupJSON(incBackup, baseLoc);
    assert.equal(preview.conflicts, 1, `Must detect conflict for incoming rev=${incomingRev}`);

    // Policy 1: keep_local MUST preserve answered_wrong even when incomingRev === 2!
    const kept = SnapCore.mergeSnapwordBackup(baseLoc, incBackup, { conflictPolicy: 'keep_local' });
    assert.equal(kept.events.find(e => e.id === 'conf_evt').outcome, 'answered_wrong', `keep_local failed for rev=${incomingRev}`);
    assert.equal(SnapCore.getStatsSummary(kept).paperRatioText, '0 / 1');
    assert.equal(SnapCore.getStatsSummary(kept).silver, 0);

    // Policy 2: prefer_incoming MUST adopt paper_independent even when incomingRev === 0!
    const adopted = SnapCore.mergeSnapwordBackup(baseLoc, incBackup, { conflictPolicy: 'prefer_incoming' });
    assert.equal(adopted.events.find(e => e.id === 'conf_evt').outcome, 'paper_independent', `prefer_incoming failed for rev=${incomingRev}`);
    assert.equal(SnapCore.getStatsSummary(adopted).paperRatioText, '1 / 1');
    assert.equal(SnapCore.getStatsSummary(adopted).silver, 1);

    // Re-importing the exact same backup must deduplicate (1 event total)
    const reimported = SnapCore.mergeSnapwordBackup(adopted, incBackup, { conflictPolicy: 'prefer_incoming' });
    assert.equal(reimported.events.length, 1);
  }

  console.log('   ✔ SnapCore unit tests passed (F01–F06 & R02–R08).');
}

// ==================== F01–F07 + R01–R08: Adversarial Offline Chromium E2E Tests ====================
async function runBrowserE2E() {
  const pw = loadPlaywright();
  if (!pw?.chromium) {
    console.log('3/4 Playwright not in PATH (skipping browser E2E).');
    return;
  }
  const { chromium } = pw;
  console.log('3/4 Running adversarial offline Chromium E2E tests (F01–F07 & R01–R08) & updating screenshots...');
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const fileUrl = pathToFileURL(DIST_HTML).href;
  const extraArgs = process.env.SNAPWORD_CHROME_ARGS ? process.env.SNAPWORD_CHROME_ARGS.split(/\s+/).filter(Boolean) : [];

  const browser = await chromium.launch({ executablePath: CHROME_EXE, headless: true, args: extraArgs });
  try {
    // --- Scenario A: F01 Zero-Judgment Block & Mixed 1/4 Tally ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 840 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);
      await page.locator('h1').waitFor();
      await page.screenshot({ path: path.join(MEDIA_DIR, 'home-lobby.png') });

      await page.locator('[data-start-mode="standard"]').click();
      await page.locator('#board-live-sentence').waitFor();
      await page.screenshot({ path: path.join(MEDIA_DIR, 'slot-blackboard.png') });

      await page.locator('[data-jump-step="snap"]').click();
      await page.locator('.magnet-tile[data-tile-text="sat"]').click();
      await page.locator('.bounce-bubble').waitFor();
      await page.screenshot({ path: path.join(MEDIA_DIR, 'snap-magnet-blocks.png') });

      await page.locator('[data-jump-step="bug"]').click();
      await page.locator('.bug-token', { hasText: 'satday' }).click();
      await page.screenshot({ path: path.join(MEDIA_DIR, 'bug-hunter.png') });

      await page.locator('.step-pill[data-jump-step="paper"]').click();
      await page.locator('[data-paper-phase="blind_check"]').click();
      await page.locator('[data-blind-box="cap"]').check();
      await page.locator('[data-blind-box="space"]').check();
      await page.locator('[data-blind-box="chunk"]').check();
      await page.screenshot({ path: path.join(MEDIA_DIR, 'red-pen-blind-check.png') });

      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      assert.equal(await page.locator('#sum-ratio').count(), 0, 'Unjudged submission must be blocked');

      await page.locator('[data-act="abandon-session"]').click();
      const lobbyStats = await page.locator('.stat-num').allTextContents();
      assert.deepEqual(lobbyStats.map(s => s.trim()), ['0', '0', '0', '0']);

      await page.locator('[data-quick-baseline="1"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="u5_saturday"][data-outcome="paper_independent"]').click();
      await page.locator('[data-grade-item="u5_sunday"][data-outcome="blind_self_fixed"]').click();
      await page.locator('[data-grade-item="fnd_morning"][data-outcome="answer_corrected"]').click();
      await page.locator('[data-grade-item="fnd_homework"][data-outcome="blank"]').click();
      await page.locator('[data-grade-item="fnd_football"][data-outcome="untested"]').click();
      await page.locator('[data-grade-item="u5_sometimes"][data-outcome="pending_verify"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();

      await page.locator('#sum-ratio').waitFor();
      assert.equal((await page.locator('#sum-ratio').textContent()).trim(), '1 / 4');
      assert.equal((await page.locator('#sum-blank-untested').textContent()).trim(), '空白 1 · 未测 1');
      assert.equal((await page.locator('#sum-pending').textContent()).trim(), '1 项');
      await ctx.close();
    }

    // --- Scenario B: F02 Zero Answer Leak across Ledger, Due-Only Entry, Blind Check & Masked Rewrite ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 840 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);

      await page.locator('[data-quick-baseline="1"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="u5_saturday"][data-outcome="answer_corrected"]').click();
      await page.locator('[data-grade-item="fnd_homework"][data-outcome="answer_corrected"]').click();
      await page.locator('[data-grade-item="fnd_football"][data-outcome="answer_corrected"]').click();
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.locator('[data-goto-tab="ledger"]').click();

      const visibleLedgerCards = await page.locator('section.card').nth(0).locator('.grid-3').innerText();
      assert.ok(!/Saturday|homework|football/i.test(visibleLedgerCards));

      await page.locator('[data-act="start-due-review"]').click();
      const dictateText = await page.locator('.paper-list').innerText();
      assert.ok(!/Saturday|Sat ｜ ur ｜ day|homework|home \+ work|football|foot \+ ball/i.test(dictateText));
      assert.equal(await page.locator('.paper-list .pill', { hasText: '到期复测' }).count(), 3);

      await page.locator('[data-paper-phase="blind_check"]').click();
      const blindText = await page.locator('#app-main').innerText();
      assert.ok(!/Saturday|homework|football/i.test(blindText));

      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-act="toggle-mask-all"]').click();
      const maskedListText = await page.locator('.paper-list').innerText();
      assert.ok(!/Saturday|Sat ｜ ur ｜ day|homework|home \+ work|football|foot \+ ball/i.test(maskedListText));
      await ctx.close();
    }

    // --- Scenario C: F03 Role Persistence + Mid-Lesson Reload + F06 Storage Failure Banner + Mobile ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 840 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);

      await page.locator('#actor-toggle').click();
      await page.locator('#demo-banner').waitFor({ state: 'visible' });
      await page.reload();
      await page.locator('#demo-banner').waitFor({ state: 'visible' });

      await page.locator('[data-start-mode="quick8"]').click();
      await page.locator('#actor-toggle').click();
      await page.locator('[data-role-modal="cancel"]').waitFor();
      await page.locator('[data-role-modal="cancel"]').click();

      await page.locator('.step-pill[data-jump-step="paper"]').click();
      await page.locator('[data-paper-phase="blind_check"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      const indCount = await page.locator('.outcome-btn[data-outcome="paper_independent"]').count();
      for (let i = 0; i < indCount; i++) {
        await page.locator('.outcome-btn[data-outcome="paper_independent"]').nth(i).click();
      }
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.locator('[data-act="close-summary"]').click();
      await page.reload();
      await page.locator('#demo-banner').waitFor({ state: 'visible' });
      await page.locator('#actor-toggle').click();
      const cleanStats = await page.locator('.stat-num').allTextContents();
      assert.deepEqual(cleanStats.map(s => s.trim()), ['0', '0', '0', '0']);

      await page.locator('[data-nav="prep"]').click();
      await page.locator('#qp-title').fill('测试四词分层包');
      await page.locator('#qp-lines').fill('Saturday | 星期六\nSunday | 星期日\nclassmate | 同班同学\nproblem | 问题');
      await page.locator('#quick-pack-form button[type="submit"]').click();

      await page.getByText('本轮新排纸写（3 项）').waitFor();
      await page.getByText('本轮仅听读认义（1 项）').waitFor();

      await page.locator('[data-start-mode="standard"]').click();
      await page.locator('.step-pill[data-jump-step="paper"]').click();
      await page.locator('[data-paper-phase="blind_check"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="u5_saturday"][data-outcome="paper_independent"]').click();
      await page.waitForTimeout(120);

      await page.reload();
      await page.locator('[data-grade-item="u5_saturday"].selected-good').waitFor();

      await page.evaluate(() => { window.__SNAPWORD_FORCE_STORAGE_FAIL = true; });
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.getByText('本机持久化存储受阻！').waitFor();

      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false);
      await ctx.close();
    }

    // --- Scenario D (R03 P0 + R08 P1): Demo Photo-Verify Hard Isolation + Answered-Wrong & Red-Pen Correction UI ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 840 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);

      // 1. Seed 1 student pending_verify item (Saturday)
      await page.locator('[data-quick-baseline="1"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="u5_saturday"][data-outcome="pending_verify"]').click();
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.locator('[data-act="close-summary"]').click();

      // 2. Switch to parent_demo -> inspect Ledger -> student pending item MUST NOT be exposed/mutable!
      await page.locator('#actor-toggle').click();
      await page.locator('#demo-banner').waitFor({ state: 'visible' });
      await page.locator('[data-nav="ledger"]').click();
      await page.getByText('1 条学生正式待核验项已锁定保护').waitFor();
      assert.equal(await page.locator('[data-pv-pick]').count(), 0, 'R03: Demo ledger must not expose student pending-verify buttons');

      // Also create & verify a demo pending_verify item in demo mode -> verify zero impact on student ledger!
      await page.locator('[data-nav="learn"]').click();
      await page.locator('[data-quick-baseline="1"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="u5_sunday"][data-outcome="pending_verify"]').click();
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.locator('[data-goto-tab="ledger"]').click();

      const demoEvId = await page.locator('[data-pv-pick]').first().getAttribute('data-pv-pick');
      await page.locator(`[data-pv-pick="${demoEvId}"][data-outcome="paper_independent"]`).click();
      await page.locator(`[data-confirm-verify="${demoEvId}"]`).click();

      // Switch back to student formal ledger -> Saturday MUST still be pending, ratio 0 / 0, medals 0!
      await page.locator('[data-act="switch-to-student-ledger"]').click();
      assert.equal((await page.locator('#ledger-ratio').textContent()).trim(), '0 / 0', 'R03: Student ratio must stay 0 / 0');
      assert.equal(await page.locator('[data-pv-pick][data-outcome="answered_wrong"]').count(), 1, 'R08: Student pending card must stay intact and offer answered_wrong');

      // 3. R08: Verify student Saturday as answered_wrong + error tag -> then append follow-up red-pen correction!
      const stuEvId = await page.locator('[data-pv-pick]').first().getAttribute('data-pv-pick');
      await page.locator(`[data-pv-pick="${stuEvId}"][data-outcome="answered_wrong"]`).click();
      await page.locator(`[data-pv-tag="${stuEvId}"][data-tag="missing_letter"]`).click();
      await page.locator(`[data-confirm-verify="${stuEvId}"]`).click();

      assert.equal((await page.locator('#ledger-ratio').textContent()).trim(), '0 / 1');
      await page.locator(`[data-followup-corr="${stuEvId}"]`).waitFor();
      await page.locator(`[data-followup-corr="${stuEvId}"]`).click();
      assert.equal(await page.locator(`[data-followup-corr="${stuEvId}"]`).count(), 0);

      await page.locator('[data-nav="learn"]').click();
      const postR08Stats = (await page.locator('.stat-num').allTextContents()).map(s => s.trim());
      assert.deepEqual(postR08Stats, ['0', '0', '1', '1'], 'R08: Follow-up correction grants Bronze while keeping due review = 1');
      await ctx.close();
    }

    // --- Scenario E (R01 + R02): Explicit Pause/Exit Draft Survival across Reloads & 0-Paper Pure Oral Lesson ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 840 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);

      // R01: Grade Saturday + custom paperRef -> click "暂存草稿" -> reload -> switch demo/student -> resume -> submit!
      await page.locator('[data-start-mode="standard"]').click();
      await page.locator('.step-pill[data-jump-step="paper"]').click();
      await page.locator('[data-paper-phase="blind_check"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="u5_saturday"][data-outcome="paper_independent"]').click();
      await page.locator('[data-paper-ref="u5_saturday"]').fill('BookA p.5 #1');
      await page.locator('[data-paper-ref="u5_saturday"]').dispatchEvent('change');
      await page.locator('[data-act="pause-session"]').click();

      await page.locator('#draft-resume-card').waitFor();
      await page.reload();
      await page.locator('#draft-resume-card').waitFor({ state: 'visible' });

      // Even toggling demo mode and reloading must NOT wipe the student's suspended draft!
      await page.locator('#actor-toggle').click();
      await page.reload();
      await page.locator('#actor-toggle').click();
      await page.locator('#draft-resume-card').waitFor({ state: 'visible' });

      await page.locator('[data-act="resume-draft"]').click();
      await page.locator('[data-grade-item="u5_saturday"].selected-good').waitFor();
      assert.equal(await page.locator('[data-paper-ref="u5_saturday"]').inputValue(), 'BookA p.5 #1');

      // Clicking "退出" (abandon-session) when progress exists also suspends to draft safely
      await page.locator('[data-act="abandon-session"]').click();
      await page.locator('#draft-resume-card').waitFor({ state: 'visible' });
      await page.reload();
      await page.locator('[data-act="resume-draft"]').click();
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      assert.equal((await page.locator('#sum-ratio').textContent()).trim(), '1 / 1');
      await page.locator('[data-act="close-summary"]').click();

      // R02: Select pack-autumn-2 -> set all 3 items to next_candidate -> start button disabled!
      await page.locator('#pack-select').selectOption('pack-autumn-2');
      for (const id of ['fnd_homework', 'fnd_football', 'u6_do_homework']) {
        await page.locator(`[data-pack-item-act="${id}"]`).selectOption('next_candidate');
      }
      await page.getByText('本轮新排纸写（0 项）').waitFor();
      await page.getByText('本轮仅听读认义（0 项）').waitFor();
      assert.equal(await page.locator('[data-start-mode="standard"]').isDisabled(), true, 'R02: All-candidate pack must block starting');

      // R02: Set all 3 items to oral_only -> 0 paper, 3 oral -> start lesson -> oral_wrapup with ZERO paper_check records!
      for (const id of ['fnd_homework', 'fnd_football', 'u6_do_homework']) {
        await page.locator(`[data-pack-item-act="${id}"]`).selectOption('oral_only');
      }
      await page.getByText('本轮新排纸写（0 项）').waitFor();
      await page.getByText('本轮仅听读认义（3 项）').waitFor();
      assert.equal(await page.locator('[data-start-mode="standard"]').isDisabled(), false);

      await page.locator('[data-start-mode="standard"]').click();
      assert.equal(await page.locator('.step-pill[data-jump-step="paper"]').count(), 0, 'R02: Pure oral lesson must have 0 paper step');
      await page.locator('.step-pill[data-jump-step="oral_wrapup"]').click();
      await page.locator('[data-act="finish-oral-session"]').click();
      await page.getByText('本轮听读预读收工！').waitFor();
      await page.locator('[data-goto-tab="ledger"]').click();
      assert.equal((await page.locator('#ledger-ratio').textContent()).trim(), '1 / 1', 'R02: Pure oral wrap-up must not add paper_check items');
      await ctx.close();
    }

    // --- Scenario F (R05): Regular Lesson Due Pre-Check Step/Tab Jump Protection Gate ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 840 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);

      // Seed Saturday into due queue
      await page.locator('[data-quick-baseline="1"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="u5_saturday"][data-outcome="answer_corrected"]').click();
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.locator('[data-act="close-summary"]').click();

      // Start regular lesson -> lands on Step 0 due_precheck
      await page.locator('[data-start-mode="standard"]').click();
      await page.locator('[data-act="finish-due-precheck"]').waitFor();

      // Attempt jumping to Step 1 Blackboard BEFORE confirming written -> Gate intercepts!
      await page.locator('.step-pill[data-jump-step="board"]').click();
      await page.locator('[data-due-gate="stay"]').waitFor();
      await page.locator('[data-due-gate="stay"]').click();

      // Attempt jumping to Vault tab -> Gate also intercepts!
      await page.locator('[data-nav="vault"]').click();
      await page.locator('[data-due-gate="mark_exposed"]').waitFor();

      // Choose mark_exposed -> navigates while locking Saturday as hadSpellingHint = true
      await page.locator('[data-due-gate="mark_exposed"]').click();
      await page.locator('[data-nav="learn"]').click();
      await page.locator('.step-pill[data-jump-step="paper"]').click();
      await page.locator('[data-paper-phase="blind_check"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();

      assert.equal(await page.locator('[data-toggle-hinted="u5_saturday"]').isChecked(), true);
      assert.equal(await page.locator('[data-toggle-hinted="u5_saturday"]').isDisabled(), true);
      await page.locator('[data-grade-item="u5_saturday"][data-outcome="paper_independent"]').click();
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();

      // Even though parent clicked the first button, Saturday was exposed before first attempt -> recorded as hinted_correct (0 independent)!
      assert.equal((await page.locator('#sum-ratio').textContent()).trim(), '0 / 1', 'R05: Exposed due item must downgrade to hinted_correct');
      await ctx.close();
    }

    // --- Scenario G (R06 UI Conflict keep_local + R07 Per-Item PromptMode, Cross-Day Draft Date & Context Audio Spy) ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 840 } });
      await ctx.addInitScript(() => {
        window.__MOCK_NOW = new Date('2026-11-16T20:00:00+08:00').getTime();
        const OrigDate = Date;
        class MockDate extends OrigDate {
          constructor(...args) {
            if (args.length === 0) super(window.__MOCK_NOW);
            else super(...args);
          }
          static now() { return window.__MOCK_NOW; }
        }
        window.Date = MockDate;

        window.__SPOKEN_TEXTS = [];
        if (window.speechSynthesis) {
          window.speechSynthesis.speak = utt => {
            window.__SPOKEN_TEXTS.push(utt?.text || String(utt));
            if (typeof utt?.onend === 'function') setTimeout(() => utt.onend(), 10);
          };
          window.speechSynthesis.cancel = () => {};
        }
      });

      const page = await ctx.newPage();
      await page.goto(fileUrl);

      // 1. Seed homework as due on 2026-11-16
      await page.locator('[data-quick-baseline="1"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="fnd_homework"][data-outcome="answered_wrong"]').click();
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.locator('[data-act="close-summary"]').click();

      // 2. R06 Browser File Import Test: incoming backup has HIGHER rev (rev 5) with paper_independent on the same homework event!
      const conflictBackupStr = await page.evaluate(() => {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open('snapword_workbench_v1', 1);
          req.onsuccess = () => {
            const tx = req.result.transaction('kv', 'readonly');
            const g = tx.objectStore('kv').get('main');
            g.onsuccess = () => {
              const copy = JSON.parse(JSON.stringify(g.result));
              const hwEvt = copy.events.find(e => e.itemId === 'fnd_homework' && e.taskType === 'paper_check');
              hwEvt.outcome = 'paper_independent';
              hwEvt.rev = 5; // Higher rev than local rev 1!
              resolve(JSON.stringify(copy));
            };
          };
          req.onerror = () => reject(req.error);
        });
      });

      await page.locator('[data-nav="ledger"]').click();
      await page.locator('#import-file-input').setInputFiles({
        name: 'higher_rev_conflict.json',
        mimeType: 'application/json',
        buffer: Buffer.from(conflictBackupStr, 'utf8')
      });
      await page.locator('input[name="conflict-pol"][value="keep_local"]').check();
      await page.getByText('将采用：本机现有版本').waitFor();
      await page.locator('[data-act="confirm-import-snapword"]').click();
      assert.equal((await page.locator('#ledger-ratio').textContent()).trim(), '0 / 1', 'R06: keep_local in UI must reject rev=5 incoming override');

      // 3. R07: Advance clock to 2026-11-17 -> run pack-autumn-2 with Step 0 due homework = audio_only & Step 4 new items = sentence_context!
      await page.evaluate(() => { window.__MOCK_NOW = new Date('2026-11-17T20:00:00+08:00').getTime(); });
      await page.locator('[data-nav="learn"]').click();
      await page.locator('#pack-select').selectOption('pack-autumn-2');
      await page.locator('[data-start-mode="standard"]').click();

      // Step 0: set due homework to audio_only and lock!
      await page.locator('#prompt-mode-select').selectOption('audio_only');
      await page.locator('[data-act="finish-due-precheck"]').click();

      // Jump to Step 4 paper -> switch new items to sentence_context!
      await page.locator('.step-pill[data-jump-step="paper"]').click();
      await page.locator('#prompt-mode-select').selectOption('sentence_context');

      // R07 Audio Alignment Check on u6_do_homework:
      // Variant 1 ('my' -> expected 'do my homework') via [data-speak-item] / [data-speak-context]
      await page.locator('[data-speak-item="u6_do_homework"]').click();
      const spokenMy = await page.evaluate(() => window.__SPOKEN_TEXTS.at(-1));
      assert.equal(spokenMy, 'do my homework', 'R07: 1st-person sentence_context must speak "do my homework"');

      // Switch to Variant 2 ('your' -> expected 'do your homework')
      await page.locator('[data-context-variant="u6_do_homework"]').selectOption('your');
      await page.locator('[data-speak-context="u6_do_homework"]').click();
      const spokenYour = await page.evaluate(() => window.__SPOKEN_TEXTS.at(-1));
      assert.equal(spokenYour, 'do your homework', 'R07: 2nd-person sentence_context must speak "do your homework"');

      // Switch back to 'my', lock & grade all 3 on 2026-11-17, then PAUSE draft!
      await page.locator('[data-context-variant="u6_do_homework"]').selectOption('my');
      await page.locator('[data-paper-phase="blind_check"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="fnd_homework"][data-outcome="paper_independent"]').click();
      await page.locator('[data-grade-item="fnd_football"][data-outcome="paper_independent"]').click();
      await page.locator('[data-grade-item="u6_do_homework"][data-outcome="paper_independent"]').click();
      await page.locator('[data-act="pause-session"]').click();
      await page.locator('#draft-resume-card').waitFor();

      // Advance clock to NEXT DAY 2026-11-18 -> resume draft & submit!
      await page.evaluate(() => { window.__MOCK_NOW = new Date('2026-11-18T20:30:00+08:00').getTime(); });
      await page.locator('[data-act="resume-draft"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.locator('#sum-ratio').waitFor();

      // Inspect persisted IndexedDB events & mastery!
      const savedAfterCrossDay = await page.evaluate(() => {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open('snapword_workbench_v1', 1);
          req.onsuccess = () => {
            const tx = req.result.transaction('kv', 'readonly');
            const g = tx.objectStore('kv').get('main');
            g.onsuccess = () => resolve(g.result);
          };
          req.onerror = () => reject(req.error);
        });
      });

      const latestHw = savedAfterCrossDay.events.filter(e => e.itemId === 'fnd_homework' && e.taskType === 'paper_check').at(-1);
      const latestDoHw = savedAfterCrossDay.events.filter(e => e.itemId === 'u6_do_homework' && e.taskType === 'paper_check').at(-1);

      assert.equal(latestHw.promptMode, 'audio_only', 'R07: Step 0 due item must preserve its locked audio_only promptMode');
      assert.equal(latestHw.dateStr, '2026-11-17', 'R07: Cross-day draft submission must keep original 2026-11-17 administration date');
      assert.equal(latestHw.paperRef, '2026-11-17 #1');
      assert.ok(latestHw.submittedAt > latestHw.testedAt, 'R07: submittedAt on 11-18 must be separate from testedAt on 11-17');

      assert.equal(latestDoHw.promptMode, 'sentence_context');
      assert.equal(latestDoHw.expectedAnswer, 'do my homework');
      assert.equal(latestDoHw.spokenText, 'do my homework');
      assert.equal(latestDoHw.dateStr, '2026-11-17');
      assert.equal(savedAfterCrossDay.mastery['u6_do_homework'].anchorD0, '2026-11-17', 'R07: D0 must anchor to 11-17 test date, not 11-18 submit date');
      assert.equal(savedAfterCrossDay.mastery['u6_do_homework'].nextDueDate, '2026-11-18');

      await ctx.close();
    }

    console.log('   ✔ Adversarial Chromium E2E tests & screenshots passed (F01–F07 & R01–R08).');
  } finally {
    await browser.close();
  }
}

(async () => {
  runPrivacyGate();
  runUnitTests();
  await runBrowserE2E();
  console.log('4/4 All SnapWord v0.1.2 verifications succeeded!');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
