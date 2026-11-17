// Comprehensive Unit + Adversarial Offline Chromium E2E + Privacy Gate Suite for 词哒 · SnapWord (v0.1.1)
// Covers Party A review items F01, F02, F03, F04, F05, F06, F07, and F08 (open-source PII gate).
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const Curriculum = require('../src/curriculum');
const SnapCore = require('../src/core');

const ROOT = path.resolve(__dirname, '..');
const DIST_HTML = path.join(ROOT, 'dist', 'SnapWord-词哒.html');
const MEDIA_DIR = path.join(ROOT, 'docs', 'media');
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
    cwd: ROOT,
    encoding: 'utf8'
  });
  const files = out.split(/\r?\n/).filter(Boolean);
  assert.ok(!files.some(f => f.includes('评审')), 'Private review folder docs/评审/ must be ignored by Git');

  for (const rel of files) {
    if (/\.(mp3|png|wav|ogg|jpg|jpeg)$/i.test(rel)) continue;
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const content = fs.readFileSync(full, 'utf8');
    // Scan ASCII tokens
    for (const tok of (content.match(/[A-Za-z0-9_]{5,20}/g) || [])) {
      assert.equal(blockedHashes.has(hash24(tok)), false, `Blocked private ASCII identifier in public file: ${rel}`);
    }
    // Scan 2-char and 3-char CJK windows
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

// ==================== F01–F06: Pure State Machine Unit Tests ====================
function runUnitTests() {
  console.log('2/4 Running SnapCore unit tests (F01–F06)...');

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

  // Context & American variant judgment (F05)
  const fav = st0.items.find(x => x.id === 'u6_favourite');
  assert.equal(SnapCore.judgeSpelling(fav, 'favorite', { allowAmericanSpelling: false }).ok, false);
  assert.equal(SnapCore.judgeSpelling(fav, 'favorite', { allowAmericanSpelling: true }).ok, true);

  const hwPhrase = st0.items.find(x => x.id === 'u6_do_homework');
  assert.equal(SnapCore.judgeSpelling(hwPhrase, 'do your homework', { promptMode: 'zh_prompt' }).ok, true);
  assert.equal(SnapCore.judgeSpelling(hwPhrase, 'do my homework', { promptMode: 'zh_prompt' }).ok, false);
  assert.equal(SnapCore.judgeSpelling(hwPhrase, 'do my homework', { promptMode: 'sentence_context' }).ok, true);

  // F05 Allocation Planner: [Saturday, Sunday, classmate, problem]
  const alloc = SnapCore.planPackAllocation(
    st0,
    'test_pack',
    ['u5_saturday', 'u5_sunday', 'u6_classmate', 'u6_problem'],
    { totalPaperCap: 4, dueIds: [] }
  );
  assert.deepEqual(alloc.paperNowIds, ['u5_saturday', 'u5_sunday', 'u6_problem']);
  assert.deepEqual(alloc.oralOnlyIds, ['u6_classmate']);
  assert.deepEqual(alloc.deferredIds, []);

  // Dynamically changing classmate's classRequirement updates allocation immediately
  SnapCore.updateCurriculumItem(st0, 'u6_classmate', { classRequirement: 'dictation_verified' });
  const allocAfter = SnapCore.planPackAllocation(
    st0,
    'test_pack',
    ['u5_saturday', 'u5_sunday', 'u6_classmate', 'u6_problem'],
    { totalPaperCap: 3, dueIds: [] }
  );
  assert.deepEqual(allocAfter.paperNowIds, ['u5_saturday', 'u5_sunday', 'u6_classmate']);
  assert.deepEqual(allocAfter.deferredIds, ['u6_problem']); // Visibly deferred, never dropped!

  // --- F01: Unjudged items ignored, Mixed 1/4 Denominator, Idempotency & Hint Downgrade ---
  const st1 = SnapCore.freshState(Curriculum);
  const ignored = SnapCore.recordEvent(st1, {
    sessionId: 's_zero',
    itemId: 'u5_saturday',
    taskType: 'paper_check',
    outcome: 'unjudged'
  });
  assert.equal(ignored, null);
  assert.equal(st1.events.length, 0);

  // Mixed 6 items: 1 independent, 1 blind_self_fixed, 1 answer_corrected, 1 blank, 1 untested, 1 pending_verify
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
  // Duplicate submission of same sessionId + itemId must be idempotent
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
  assert.equal(summary1.paperRatioText, '1 / 4', 'Denominator must include independent+self_fixed+corrected+blank (4), excluding untested & pending');
  assert.equal(summary1.blankCount, 1);
  assert.equal(summary1.untestedCount, 1);
  assert.equal(summary1.pendingVerifyCount, 1);
  assert.equal(st1.mastery['u5_sometimes'].badge, 'none', 'pending_verify must not award badge before parent confirmation');

  // Confirm pending_verify -> updates official ratio to 2 / 5 and grants Silver
  const pendingEvt = st1.events.find(e => e.itemId === 'u5_sometimes');
  SnapCore.resolvePendingVerify(st1, pendingEvt.id, 'paper_independent');
  assert.equal(SnapCore.getStatsSummary(st1).paperRatioText, '2 / 5');
  assert.equal(st1.mastery['u5_sometimes'].badge, 'silver');

  // Hinted paper answer downgrades to hinted_correct (no Silver/Gold!)
  SnapCore.recordEvent(st1, {
    sessionId: 's_hint',
    actor: 'student',
    itemId: 'u6_wall',
    taskType: 'paper_check',
    outcome: 'paper_independent',
    hadSpellingHint: true,
    dateStr: '2026-11-17',
    timestamp: 1794916000000
  });
  assert.equal(st1.mastery['u6_wall'].badge, 'bronze');
  assert.equal(st1.mastery['u6_wall'].needsReview, true);

  // --- F04: Strict D0-Anchored Checkpoints (11-17 -> 11-18 -> 11-20 -> 11-24 -> stabilized) & Slip Handling ---
  const stCal = SnapCore.freshState(Curriculum);
  const recPass = (dateStr, ts) => SnapCore.recordEvent(stCal, {
    actor: 'student',
    itemId: 'u5_saturday',
    taskType: 'paper_check',
    outcome: 'paper_independent',
    dateStr,
    timestamp: ts
  });

  recPass('2026-11-17', 1794915000000); // D0 = 11-17
  assert.equal(stCal.mastery['u5_saturday'].anchorD0, '2026-11-17');
  assert.equal(stCal.mastery['u5_saturday'].nextDueDate, '2026-11-18'); // D0 + 1
  assert.equal(stCal.mastery['u5_saturday'].badge, 'silver');

  // Same-day repeat pass does not jump checkpoint
  recPass('2026-11-17', 1794916000000);
  assert.equal(stCal.mastery['u5_saturday'].nextDueDate, '2026-11-18');

  recPass('2026-11-18', 1795001400000); // Passed D0 + 1
  assert.equal(stCal.mastery['u5_saturday'].nextDueDate, '2026-11-20'); // D0 + 3!
  assert.equal(stCal.mastery['u5_saturday'].badge, 'gold');

  recPass('2026-11-20', 1795174200000); // Passed D0 + 3
  assert.equal(stCal.mastery['u5_saturday'].nextDueDate, '2026-11-24'); // D0 + 7!

  recPass('2026-11-24', 1795519800000); // Passed D0 + 7 -> Graduated to stabilized!
  assert.equal(stCal.mastery['u5_saturday'].stabilized, true);
  assert.equal(stCal.mastery['u5_saturday'].nextDueDate, null, 'Must not infinitely schedule +7 days after D0+7');
  assert.equal(SnapCore.getDueQueue(stCal, '2026-12-05', 3).totalDue, 0);
  assert.equal(SnapCore.getDueQueue(stCal, '2026-12-05', 3).lowFreqPool.length, 1);

  // Subsequent error on Gold word -> keeps Gold medal, sets recentSlip = true, enters priority-1 queue;
  // AND same-night pass after that error does NOT clear needsReview!
  SnapCore.recordEvent(stCal, {
    actor: 'student',
    itemId: 'u5_saturday',
    taskType: 'paper_check',
    outcome: 'answer_corrected',
    dateStr: '2026-12-06',
    timestamp: 1796556600000
  });
  assert.equal(stCal.mastery['u5_saturday'].badge, 'gold');
  assert.equal(stCal.mastery['u5_saturday'].recentSlip, true);
  assert.equal(stCal.mastery['u5_saturday'].needsReview, true);

  // Same-night 'paper_independent' on 2026-12-06 after failing earlier on 2026-12-06
  recPass('2026-12-06', 1796557600000);
  assert.equal(stCal.mastery['u5_saturday'].needsReview, true, 'Same-night pass after error must still require next-day check');
  assert.equal(stCal.mastery['u5_saturday'].nextDueDate, '2026-12-07');

  // Next-day unassisted pass clears slip and starts new D0 = 2026-12-07 -> due 2026-12-08
  recPass('2026-12-07', 1796643000000);
  assert.equal(stCal.mastery['u5_saturday'].recentSlip, false);
  assert.equal(stCal.mastery['u5_saturday'].needsReview, false);
  assert.equal(stCal.mastery['u5_saturday'].anchorD0, '2026-12-07');
  assert.equal(stCal.mastery['u5_saturday'].nextDueDate, '2026-12-08');

  // --- F03 + F06: Backup Pending->Verified Upgrade, Item History & Local Role Preservation ---
  const stLocal = SnapCore.freshState(Curriculum);
  stLocal.actorMode = 'parent_demo';
  const pend = SnapCore.recordEvent(stLocal, {
    id: 'shared_evt_1',
    actor: 'student',
    itemId: 'u6_wall',
    taskType: 'paper_check',
    outcome: 'pending_verify',
    dateStr: '2026-11-18',
    timestamp: 1795001400000
  });
  assert.equal(pend.verificationStatus, 'pending');

  const remoteBackup = SnapCore.clone(stLocal);
  remoteBackup.actorMode = 'student';
  remoteBackup.boardNotes.unshift({ id: 'bn_new', en: 'Good idea!', zh: '好主意！', highlight: 'idea', at: 1795002000000 });
  SnapCore.resolvePendingVerify(remoteBackup, 'shared_evt_1', 'paper_independent');

  const diff = SnapCore.inspectBackupJSON(remoteBackup, stLocal);
  assert.equal(diff.verifiedUpgrades, 1);

  const merged = SnapCore.mergeSnapwordBackup(stLocal, remoteBackup, { includeDemo: false });
  assert.equal(merged.actorMode, 'parent_demo', 'Cross-device import must preserve local machine selected actorMode');
  assert.equal(merged.events.find(e => e.id === 'shared_evt_1').verificationStatus, 'verified');
  assert.equal(merged.mastery['u6_wall'].badge, 'silver');
  assert.equal(merged.boardNotes.some(n => n.id === 'bn_new'), true);

  // Item edit archives previous version in itemHistory
  SnapCore.updateCurriculumItem(merged, 'u6_wall', { en: 'stone wall' });
  assert.equal(merged.items.find(x => x.id === 'u6_wall').version, 2);
  assert.equal(merged.itemHistory.some(h => h.id === 'u6_wall' && h.version === 1 && h.en === 'wall'), true);

  console.log('   ✔ SnapCore unit tests passed.');
}

// ==================== F01–F07: Adversarial Offline Chromium E2E Tests ====================
async function runBrowserE2E() {
  const pw = loadPlaywright();
  if (!pw?.chromium) {
    console.log('3/4 Playwright not in PATH (skipping browser E2E).');
    return;
  }
  const { chromium } = pw;
  console.log('3/4 Running adversarial offline Chromium E2E tests & updating screenshots...');
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const fileUrl = pathToFileURL(DIST_HTML).href;

  const browser = await chromium.launch({ executablePath: CHROME_EXE, headless: true });
  try {
    // --- Scenario A: F01 Zero-Judgment Block & Mixed 1/4 Tally ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 840 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);
      await page.locator('h1').waitFor();
      await page.screenshot({ path: path.join(MEDIA_DIR, 'home-lobby.png') });

      // Enter standard lesson -> jump to paper -> blind_check -> reveal_grade -> click finish WITHOUT judging!
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
      // Attempt finish with 0 judgments -> MUST NOT advance to summary or award Silver!
      await page.locator('[data-act="finish-paper-session"]').click();
      assert.equal(await page.locator('#sum-ratio').count(), 0, 'Unjudged submission must be blocked');

      // Exit without judging -> verify 0 medals, 0 due items!
      await page.locator('[data-act="abandon-session"]').click();
      const lobbyStats = await page.locator('.stat-num').allTextContents();
      assert.deepEqual(lobbyStats.map(s => s.trim()), ['0', '0', '0', '0'], 'Zero-judgment exit must leave all stats at 0');

      // Run 6-item Baseline mixed judgment -> verify exact 1 / 4 ratio!
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

      // Seed 3 due items cleanly via quick baseline (3 corrected -> all 3 enter due review)
      await page.locator('[data-quick-baseline="1"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="u5_saturday"][data-outcome="answer_corrected"]').click();
      await page.locator('[data-grade-item="fnd_homework"][data-outcome="answer_corrected"]').click();
      await page.locator('[data-grade-item="fnd_football"][data-outcome="answer_corrected"]').click();
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.locator('[data-goto-tab="ledger"]').click();

      // Check Ledger visible text does NOT leak 'Saturday' or 'football' while details is collapsed
      const visibleLedgerCards = await page.locator('section.card').nth(0).locator('.grid-3').innerText();
      assert.ok(!/Saturday|homework|football/i.test(visibleLedgerCards), 'Ledger due cards must hide English answers on shared screen');

      // Click "立即独立纸写抽查前 3 项" -> Screen 1 MUST be paper dictation, with all 3 marked 到期复测, zero English leaks!
      await page.locator('[data-act="start-due-review"]').click();
      const dictateText = await page.locator('.paper-list').innerText();
      assert.ok(!/Saturday|Sat ｜ ur ｜ day|homework|home \+ work|football|foot \+ ball/i.test(dictateText));
      assert.equal(await page.locator('.paper-list .pill', { hasText: '到期复测' }).count(), 3);

      // Blind check -> still zero English leaks
      await page.locator('[data-paper-phase="blind_check"]').click();
      const blindText = await page.locator('#app-main').innerText();
      assert.ok(!/Saturday|homework|football/i.test(blindText));

      // Reveal grade -> click "全部遮住答案重写" -> verify chunks, variants & whole words are ALL hidden!
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-act="toggle-mask-all"]').click();
      const maskedListText = await page.locator('.paper-list').innerText();
      assert.ok(!/Saturday|Sat ｜ ur ｜ day|homework|home \+ work|football|foot \+ ball/i.test(maskedListText), 'Masked rewrite must hide chunks as well as whole words');

      await ctx.close();
    }

    // --- Scenario C: F03 Role Persistence across Reload & Mid-Session Lock + F05/F06 Draft Reload & Storage Error ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 840 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);

      // Switch to parent_demo -> reload -> MUST stay in parent_demo!
      await page.locator('#actor-toggle').click();
      await page.locator('#demo-banner').waitFor({ state: 'visible' });
      await page.reload();
      await page.locator('#demo-banner').waitFor({ state: 'visible' });

      // Start quick8 in demo mode -> attempt switching role mid-lesson -> modal intercepts!
      await page.locator('[data-start-mode="quick8"]').click();
      await page.locator('#actor-toggle').click();
      await page.locator('[data-role-modal="cancel"]').waitFor();
      await page.locator('[data-role-modal="cancel"]').click();

      // Finish demo session -> reload -> switch back to student -> verify 0 student records polluted!
      await page.locator('.step-pill[data-jump-step="paper"]').click();
      await page.locator('[data-paper-phase="blind_check"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      const indCount = await page.locator('.outcome-btn[data-outcome="paper_independent"]').count();
      for (let i = 0; i < indCount; i++) {
        await page.locator('.outcome-btn[data-outcome="paper_independent"]').nth(i).click();
      }
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.locator('[data-act="close-summary"]').waitFor();
      await page.locator('[data-act="close-summary"]').click();
      await page.reload();
      await page.locator('#demo-banner').waitFor({ state: 'visible' });
      await page.locator('#actor-toggle').click(); // Now back in student mode
      const cleanStats = await page.locator('.stat-num').allTextContents();
      assert.deepEqual(cleanStats.map(s => s.trim()), ['0', '0', '0', '0']);

      // F05 + F06: Quick Pack [Saturday, Sunday, classmate, problem] + Mid-Lesson Reload Draft Recovery
      await page.locator('[data-nav="prep"]').click();
      await page.locator('#qp-title').fill('测试四词分层包');
      await page.locator('#qp-lines').fill('Saturday | 星期六\nSunday | 星期日\nclassmate | 同班同学\nproblem | 问题');
      await page.locator('#quick-pack-form button[type="submit"]').click();

      // Lobby allocation preview must show 3 paper items and 1 oral-only item (classmate)
      await page.getByText('本轮新排纸写（3 项）').waitFor();
      await page.getByText('本轮仅听读认义（1 项）').waitFor();

      // Enter lesson -> jump to paper -> reveal_grade -> grade Saturday -> RELOAD mid-lesson!
      await page.locator('[data-start-mode="standard"]').click();
      await page.locator('.step-pill[data-jump-step="paper"]').click();
      await page.locator('[data-paper-phase="blind_check"]').click();
      await page.locator('[data-paper-phase="reveal_grade"]').click();
      await page.locator('[data-grade-item="u5_saturday"][data-outcome="paper_independent"]').click();
      await page.waitForTimeout(120);

      await page.reload();
      // Must auto-resume right back on reveal_grade with Saturday still selected!
      await page.locator('[data-grade-item="u5_saturday"].selected-good').waitFor();

      // Simulate storage failure (F06) -> finish session -> verify warning banner instead of false success message!
      await page.evaluate(() => { window.__SNAPWORD_FORCE_STORAGE_FAIL = true; });
      await page.locator('[data-batch-rest="untested"]').click();
      await page.locator('[data-act="finish-paper-session"]').click();
      await page.getByText('本机持久化存储受阻！').waitFor();

      // Check 390px mobile responsive width
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, 'Mobile 390px viewport must not overflow horizontally');

      await ctx.close();
    }

    console.log('   ✔ Adversarial Chromium E2E tests & screenshots passed.');
  } finally {
    await browser.close();
  }
}

(async () => {
  runPrivacyGate();
  runUnitTests();
  await runBrowserE2E();
  console.log('4/4 All SnapWord v0.1.1 verifications succeeded!');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
