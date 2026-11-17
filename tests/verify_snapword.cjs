// Automated Unit + Offline Chromium E2E Verification & Screenshot Generator for 词哒 · SnapWord
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

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

const Curriculum = require('../src/curriculum');
const SnapCore = require('../src/core');

const ROOT = path.resolve(__dirname, '..');
const DIST_HTML = path.join(ROOT, 'dist', 'SnapWord-词哒.html');
const MEDIA_DIR = path.join(ROOT, 'docs', 'media');
const CHROME_EXE = process.env.SNAPWORD_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function runUnitTests() {
  console.log('1/3 Running SnapCore unit tests...');
  const st = SnapCore.freshState(Curriculum);

  // 1. Spelling & variant judgment
  const sat = st.items.find(x => x.id === 'u5_saturday');
  assert.equal(SnapCore.judgeSpelling(sat, 'Saturday').ok, true);
  assert.equal(SnapCore.judgeSpelling(sat, 'saturday').ok, false);
  assert.equal(SnapCore.judgeSpelling(sat, 'saturday').kind, 'case_missing');

  const stay = st.items.find(x => x.id === 'fnd_stay_up_late');
  assert.equal(SnapCore.judgeSpelling(stay, 'stay uplate').kind, 'space_missing');

  const hwPhrase = st.items.find(x => x.id === 'u6_do_homework');
  assert.equal(SnapCore.judgeSpelling(hwPhrase, 'do my homework').ok, true);
  assert.equal(SnapCore.judgeSpelling(hwPhrase, 'do my homework').kind, 'variant');

  // 2. Actor isolation: parent_demo NEVER alters student badges or accuracy
  SnapCore.recordEvent(st, {
    actor: 'parent_demo',
    itemId: 'u5_saturday',
    taskType: 'paper_check',
    outcome: 'paper_independent',
    dateStr: '2026-11-17'
  });
  assert.equal(st.mastery['u5_saturday'], undefined);
  assert.equal(SnapCore.getStatsSummary(st).paperTestedCount, 0);

  // 3. Bronze -> Silver (Day 0) -> Gold ONLY on a distinct subsequent date!
  SnapCore.recordEvent(st, {
    actor: 'student',
    itemId: 'u5_saturday',
    taskType: 'scaffold_snap',
    outcome: 'done',
    dateStr: '2026-11-17',
    timestamp: 1794915000000
  });
  assert.equal(st.mastery['u5_saturday'].badge, 'bronze');

  SnapCore.recordEvent(st, {
    actor: 'student',
    itemId: 'u5_saturday',
    taskType: 'paper_check',
    outcome: 'paper_independent',
    dateStr: '2026-11-17',
    timestamp: 1794915600000
  });
  assert.equal(st.mastery['u5_saturday'].badge, 'silver');
  assert.equal(st.mastery['u5_saturday'].nextDueDate, '2026-11-18');

  // Same-day repeat paper pass does NOT prematurely unlock Gold
  SnapCore.recordEvent(st, {
    actor: 'student',
    itemId: 'u5_saturday',
    taskType: 'paper_check',
    outcome: 'paper_independent',
    dateStr: '2026-11-17',
    timestamp: 1794916000000
  });
  assert.equal(st.mastery['u5_saturday'].badge, 'silver');

  // Next-day (2026-11-18) unassisted paper pass unlocks Gold!
  SnapCore.recordEvent(st, {
    actor: 'student',
    itemId: 'u5_saturday',
    taskType: 'paper_check',
    outcome: 'paper_independent',
    dateStr: '2026-11-18',
    timestamp: 1795001400000
  });
  assert.equal(st.mastery['u5_saturday'].badge, 'gold');
  assert.equal(st.mastery['u5_saturday'].nextDueDate, '2026-11-21');

  // 4. Red-pen correction keeps word in review queue without downgrading existing badge
  SnapCore.recordEvent(st, {
    actor: 'student',
    itemId: 'fnd_homework',
    taskType: 'paper_check',
    outcome: 'answer_corrected',
    errorTags: ['chunk_replace'],
    dateStr: '2026-11-18',
    timestamp: 1795001500000
  });
  assert.equal(st.mastery['fnd_homework'].badge, 'bronze');
  assert.equal(st.mastery['fnd_homework'].needsReview, true);
  const due = SnapCore.getDueQueue(st, '2026-11-18', 3);
  assert.equal(due.todayPick[0].item.id, 'fnd_homework');

  // 5. Legacy backup isolation & native backup deduplication
  const exported = SnapCore.clone(st);
  const mergedOnce = SnapCore.mergeSnapwordBackup(st, exported, { includeDemo: false });
  const mergedTwice = SnapCore.mergeSnapwordBackup(mergedOnce, exported, { includeDemo: false });
  assert.equal(mergedOnce.events.filter(e => e.actor === 'student').length, mergedTwice.events.filter(e => e.actor === 'student').length);

  const fakeLegacy = {
    schema: 1,
    words: [{ id: 'w0', en: 'lantern', zh: '灯笼', tip: 'lan + tern' }],
    events: [{ id: 'ev1', word: 'w0', answer: 'lantern', correct: true, mode: 'train', at: 1700000000000, run: 'r1' }]
  };
  const preview = SnapCore.inspectBackupJSON(fakeLegacy, st);
  assert.equal(preview.kind, 'legacy_extraction');
  const afterLegacy = SnapCore.importLegacyWordsOnly(st, fakeLegacy);
  assert.equal(afterLegacy.items.some(i => i.en === 'lantern'), true);
  assert.equal(afterLegacy.events.length, st.events.length); // Zero legacy test-log pollution!

  console.log('   ✔ Unit tests passed.');
}

async function runBrowserE2E() {
  const pw = loadPlaywright();
  if (!pw?.chromium) {
    console.log('2/3 Playwright not installed in current PATH (skipping headless browser E2E; set SNAPWORD_PLAYWRIGHT to enable).');
    return;
  }
  const { chromium } = pw;
  console.log('2/3 Running offline Chromium E2E tests & capturing screenshots...');
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const fileUrl = pathToFileURL(DIST_HTML).href;

  const browser = await chromium.launch({ executablePath: CHROME_EXE, headless: true });
  try {
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 1280, height: 840 }
    });
    const page = await context.newPage();

    await page.addInitScript(() => {
      window.__ttsLog = [];
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      Object.defineProperty(window, 'speechSynthesis', {
        value: {
          cancel() {},
          getVoices() { return [{ name: 'MockUK', lang: 'en-GB', localService: true }]; },
          speak(u) { window.__ttsLog.push(u.text); }
        }
      });
    });

    await page.goto(fileUrl);
    await page.locator('h1').waitFor();
    await page.screenshot({ path: path.join(MEDIA_DIR, 'home-lobby.png') });

    // Start standard 15-min session (Pack 1: Saturday / Sunday / morning)
    await page.locator('[data-start-mode="standard"]').click();
    await page.locator('#board-live-sentence').waitFor();
    await page.screenshot({ path: path.join(MEDIA_DIR, 'slot-blackboard.png') });

    // Spin slot machine & advance to Snap-Block stage
    await page.locator('[data-act="spin-slot"]').click();
    await page.locator('[data-complete-step="board"]').click();

    // Test decoy bounce feedback on Saturday ('sat' lowercase decoy)
    await page.locator('.magnet-tile[data-tile-text="sat"]').click();
    await page.locator('.bounce-bubble').waitFor();
    const bounceText = await page.locator('.bounce-bubble').textContent();
    assert.ok(bounceText.includes('大写礼帽'));
    await page.screenshot({ path: path.join(MEDIA_DIR, 'snap-magnet-blocks.png') });

    // Assemble Saturday: Sat -> ur -> day
    await page.locator('.magnet-tile[data-tile-text="Sat"]').click();
    await page.locator('.magnet-tile[data-tile-text="ur"]').click();
    await page.locator('.magnet-tile[data-tile-text="day"]').click();
    await page.getByText('咔嗒合拢成功').waitFor();

    // Jump to Bug Hunter
    await page.locator('[data-jump-step="bug"]').click();
    await page.locator('.bug-token', { hasText: 'satday' }).click();
    await page.screenshot({ path: path.join(MEDIA_DIR, 'bug-hunter.png') });
    await page.locator('[data-bug-fix="Saturday"]').click();
    await page.locator('.bug-token', { hasText: 'moning.' }).click();
    await page.locator('[data-bug-fix="morning."]').click();
    await page.getByText('所有拼写臭虫都被你拍扁啦').waitFor();

    // Advance to Two-Pass Red-Pen Paper Check
    await page.locator('[data-complete-step="bug"]').click();
    // Verify answers are strictly hidden in Phase A (dictate)
    assert.equal(await page.locator('.four-line-answer').count(), 0);

    // Move to Phase B (blind_check) -> answers MUST STILL be hidden!
    await page.locator('[data-paper-phase="blind_check"]').click();
    assert.equal(await page.locator('.four-line-answer').count(), 0);
    await page.locator('[data-blind-box="cap"]').check();
    await page.locator('[data-blind-box="space"]').check();
    await page.locator('[data-blind-box="chunk"]').check();
    await page.screenshot({ path: path.join(MEDIA_DIR, 'red-pen-blind-check.png') });

    // Move to Phase C (reveal_grade) -> answers revealed!
    await page.locator('[data-paper-phase="reveal_grade"]').click();
    assert.ok((await page.locator('.four-line-answer').count()) >= 3);
    // Mark Sunday as blind_self_fixed -> verify it queues for review
    await page.locator('[data-grade-item="u5_sunday"][data-outcome="blind_self_fixed"]').click();
    await page.locator('[data-act="finish-paper-session"]').click();
    await page.getByText('今日闯关圆满收工').waitFor();

    // Verify stats: Saturday = Silver (1), Sunday = Bronze + Due Review!
    await page.locator('[data-exit-session="1"]').click();
    const statsNums = await page.locator('.stat-num').allTextContents();
    // [gold, silver, bronze, due]
    assert.equal(statsNums[0].trim(), '0'); // Gold requires 2 distinct dates!
    assert.equal(statsNums[1].trim(), '2'); // Saturday & morning first-pass paper_independent -> Silver
    assert.equal(statsNums[2].trim(), '1'); // Sunday blind_self_fixed -> Bronze
    assert.equal(statsNums[3].trim(), '1'); // Sunday needsReview -> Due today!

    // Verify Parent Demo Mode does NOT alter student stats
    await page.locator('#actor-toggle').click();
    await page.locator('#demo-banner').waitFor({ state: 'visible' });
    await page.locator('[data-start-mode="quick8"]').click();
    await page.locator('[data-jump-step="paper"]').click();
    await page.locator('[data-paper-phase="blind_check"]').click();
    await page.locator('[data-paper-phase="reveal_grade"]').click();
    await page.locator('[data-act="finish-paper-session"]').click();
    await page.locator('[data-exit-session="1"]').click();
    await page.locator('#actor-toggle').click(); // back to student
    const statsAfterDemo = await page.locator('.stat-num').allTextContents();
    assert.deepEqual(statsAfterDemo, statsNums);

    // Check responsive 390px mobile width has zero horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'Mobile 390px viewport must not overflow horizontally');

    await context.close();
    console.log('   ✔ Offline Chromium E2E tests & screenshots passed.');
  } finally {
    await browser.close();
  }
}

(async () => {
  runUnitTests();
  await runBrowserE2E();
  console.log('3/3 All SnapWord verifications succeeded!');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
