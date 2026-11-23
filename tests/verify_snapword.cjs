// Comprehensive Unit + Paperless & Multi-LLM Chromium E2E + Privacy Gate Suite for 词哒 · SnapWord (v0.3.0)
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const Curriculum = require('../src/curriculum');
const SnapCore = require('../src/core');
const SnapAI = require('../src/ai');

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

// ==================== 1/4 Public Repository Privacy & Secret Key Gate ====================
function runPrivacyGate() {
  console.log('1/4 Running open-source privacy & API-secret gate (F08 + v0.3.0)...');
  const crypto = require('node:crypto');
  const hash24 = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
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
    if (/\.(mp3|png|wav|ogg|jpg|jpeg|zip)$/i.test(rel)) continue;
    const full = path.join(SCAN_ROOT, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const content = fs.readFileSync(full, 'utf8');

    // Never commit real OpenAI / Gemini / DeepSeek keys
    assert.equal(/sk-[A-Za-z0-9_-]{24,}/.test(content), false, `Potential leaked sk- API key in file: ${rel}`);
    assert.equal(/AIzaSy[A-Za-z0-9_-]{30,}/.test(content), false, `Potential leaked Gemini API key in file: ${rel}`);

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
  console.log(`   ✔ Privacy & secret gate passed across ${files.length} public repo files.`);
}

// ==================== 2/4 SnapCore + SnapAI + Curriculum Unit Tests ====================
function runUnitTests() {
  console.log('2/4 Running SnapCore, SnapAI & Unit 6 Wordlist 1–10 unit tests...');

  const st0 = SnapCore.freshState(Curriculum);

  // --- Unit 6 Official 24-Item Wordlist & Mandatory 1–10 Dictation Verification ---
  const u6Words = st0.items.filter(it => it.unit === 6 && it.sourceScope === 'textbook_wordlist');
  const u6Core = u6Words.filter(it => it.textbookCore);
  const u6Star = u6Words.filter(it => !it.textbookCore);
  assert.equal(u6Words.length, 24, 'Unit 6 official wordlist must contain exact 24 items');
  assert.equal(u6Core.length, 19, 'Unit 6 must contain exact 19 unstarred core items');
  assert.equal(u6Star.length, 5, 'Unit 6 must contain exact 5 starred items');

  // Verify default selected pack is tomorrow's Unit 6 Wordlist 1–10!
  assert.equal(st0.selectedPackId, 'pack-u6-wl-1-10');
  const packU6_1_10 = st0.packs.find(p => p.id === 'pack-u6-wl-1-10');
  assert.ok(packU6_1_10, 'pack-u6-wl-1-10 must exist');
  const expectedU6Top10 = [
    'get along with', 'between', 'wall', 'neighbour', 'heavy',
    'drink', 'some', "on one's way back", 'next to', 'space'
  ];
  assert.deepEqual(
    packU6_1_10.itemIds.map(id => st0.items.find(x => x.id === id)?.en),
    expectedU6Top10,
    'Unit 6 1–10 pack must strictly match textbook p.111 order'
  );

  // Both starred (*get along with, *neighbour) and unstarred items MUST be scheduled for dictation!
  const allocU6 = SnapCore.planPackAllocation(st0, packU6_1_10.id, packU6_1_10.itemIds, {
    totalPaperCap: 10,
    dueIds: [],
    forceDictationAll: true
  });
  assert.equal(allocU6.paperNowIds.length, 10, 'All 10 items (including starred) must be in active dictation queue');
  assert.equal(allocU6.oralOnlyIds.length, 0, 'Zero items in U6 1–10 should be skipped as oral-only');

  const packU6_1_5 = st0.packs.find(p => p.id === 'pack-u6-wl-1-5');
  const packU6_6_10 = st0.packs.find(p => p.id === 'pack-u6-wl-6-10');
  assert.equal(packU6_1_5.itemIds.length, 5);
  assert.equal(packU6_6_10.itemIds.length, 5);

  // --- v0.3.0 Character-Level Spelling Diagnostic & Auto Error Tagging ---
  const itHeavy = st0.items.find(x => x.id === 'u6_heavy');
  const diagHeavy = SnapCore.diagnoseSpellingAttempt(itHeavy, 'hevy');
  assert.equal(diagHeavy.ok, false);
  assert.ok(diagHeavy.diffTokens.some(t => t.type === 'missing' && t.char === 'a'), 'Must pinpoint missing letter a in hevy');

  const itNextTo = st0.items.find(x => x.id === 'u6_next_to');
  const diagSpace = SnapCore.diagnoseSpellingAttempt(itNextTo, 'nextto');
  assert.equal(diagSpace.kind, 'space_missing');
  assert.ok(diagSpace.errorTags.includes('space_missing'));

  const itWayBack = st0.items.find(x => x.id === 'u6_way_back');
  const diagPunct = SnapCore.diagnoseSpellingAttempt(itWayBack, 'on ones way back');
  assert.equal(diagPunct.kind, 'boundary_punct');
  assert.ok(diagPunct.errorTags.includes('boundary_punct'));

  const itSat = st0.items.find(x => x.id === 'u5_saturday');
  const diagCase = SnapCore.diagnoseSpellingAttempt(itSat, 'saturday');
  assert.equal(diagCase.kind, 'case_missing');
  assert.ok(diagCase.errorTags.includes('case_missing'));

  // --- SnapAI Default Provider/Model & Validator Gate ---
  const aiDef = SnapAI.getActiveProfile(SnapAI.loadConfig());
  assert.equal(aiDef.providerId, 'openai', 'Default AI provider must be OpenAI');
  assert.equal(aiDef.defaultModel, 'gpt-6.2-sol', 'Default OpenAI model must be gpt-6.2-sol');
  assert.equal(aiDef.model, 'gpt-6.2-sol');

  const parsedThink = SnapAI.stripReasoningAndExtractJSON('<think>\nLet me craft a Grade 5 quiz...\n</think>\n```json\n{"ok":true,"items":[1,2]}\n```');
  assert.equal(parsedThink.ok, true);
  assert.deepEqual(parsedThink.items, [1, 2]);

  const validVar = SnapAI.validateGeneratedVariant(itHeavy, {
    expected: 'heavy',
    template: 'This yellow schoolbag is very ______.',
    zh: '这个黄书包非常重。',
    hint: '共5个字母，注意中间发短音的两个元音字母',
    memoryTip: '书包太沉装了 e 和 a',
    distractors: ['hevy', 'haevy', 'hevey']
  });
  assert.ok(validVar, 'Valid Grade-5A variant must pass validator');
  assert.equal(validVar.fromAI, true);

  // Spoiler hint inside AI output must be sanitized back to non-spoiler hint
  const spoilerVar = SnapAI.validateGeneratedVariant(itHeavy, {
    expected: 'heavy',
    template: 'My box is ______.',
    zh: '我的箱子很重。',
    hint: '直接拼写 h-e-a-v-y 即可'
  });
  assert.ok(spoilerVar);
  assert.equal(/h-e-a-v-y/i.test(spoilerVar.hint), false, 'Spoiler hint from AI must be stripped and replaced');

  // Overly long complex sentence (>15 words) must be rejected
  const tooLongVar = SnapAI.validateGeneratedVariant(itHeavy, {
    expected: 'heavy',
    template: 'Although the weather was extremely unpredictable yesterday morning the backpack remained remarkably ______ for all of the exhausted travelers.',
    zh: '超纲长句测试'
  });
  assert.equal(tooLongVar, null, 'Sentences exceeding Grade-5A word ceiling must be rejected');

  // --- Spaced-Repetition D0 -> D+1 -> D+3 -> D+7 & Early Practice Gate ---
  {
    const stSpaced = SnapCore.freshState(Curriculum);
    const pass = (d, ts) => SnapCore.recordEvent(stSpaced, {
      actor: 'student', itemId: 'u6_between', taskType: 'paper_check', outcome: 'paper_independent', dateStr: d, timestamp: ts
    });
    pass('2026-11-23', 1795430000000);
    assert.equal(stSpaced.mastery['u6_between'].badge, 'silver');
    assert.equal(stSpaced.mastery['u6_between'].nextDueDate, '2026-11-24');
    pass('2026-11-24', 1795516400000);
    assert.equal(stSpaced.mastery['u6_between'].badge, 'gold');
    assert.equal(stSpaced.mastery['u6_between'].nextDueDate, '2026-11-26');
    pass('2026-11-25', 1795602800000); // Early extra practice
    assert.equal(stSpaced.mastery['u6_between'].nextDueDate, '2026-11-26', 'Early practice must not skip D+3');
    pass('2026-11-26', 1795689200000);
    assert.equal(stSpaced.mastery['u6_between'].nextDueDate, '2026-11-30');
    pass('2026-11-30', 1796034800000);
    assert.equal(stSpaced.mastery['u6_between'].stabilized, true);
  }

  // --- Anti-Spoiler Cloze Gate across ALL built-in Curriculum Items ---
  for (const it of st0.items) {
    if (!it.cloze) continue;
    const hint = String(it.cloze.hint || '');
    const blank = String(it.cloze.blank || '').trim();
    assert.equal(/[A-Za-z]-[A-Za-z]/.test(hint), false, `Cloze hint must not spell out letters in ${it.id}: ${hint}`);
    assert.equal(/[A-Za-z]{2,}/.test(hint), false, `Cloze hint must not leak English words in ${it.id}: ${hint}`);
    if (blank.length >= 2) {
      assert.equal(hint.toLowerCase().includes(blank.toLowerCase()), false, `Cloze hint must not contain answer in ${it.id}`);
    }
  }

  console.log('   ✔ SnapCore, SnapAI & Unit 6 1–10 unit tests passed.');
}

// ==================== 3/4 Paperless & Multi-LLM Chromium E2E Tests ====================
async function runBrowserE2E() {
  const pw = loadPlaywright();
  if (!pw?.chromium) {
    console.log('3/4 Playwright not in PATH (skipping browser E2E).');
    return;
  }
  const { chromium } = pw;
  console.log('3/4 Running paperless & multi-LLM Chromium E2E tests (v0.3.0) & updating screenshots...');
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const fileUrl = pathToFileURL(DIST_HTML).href;
  const extraArgs = process.env.SNAPWORD_CHROME_ARGS ? process.env.SNAPWORD_CHROME_ARGS.split(/\s+/).filter(Boolean) : [];
  const browser = await chromium.launch({ executablePath: CHROME_EXE, headless: true, args: extraArgs });

  try {
    // --- Scenario 1: Lobby Default Unit 6 1–10 + Micro-Games (Match + Snap + Blind Cloze + Bug + Board) ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 860 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);
      await page.locator('#lesson-heading').waitFor();

      // Default selected pack is Unit 6 Wordlist 1–10
      const heroTitle = await page.locator('#lesson-heading').innerText();
      assert.ok(heroTitle.includes('Unit 6 词表 1–10'), `Expected default pack Unit 6 1–10, got: ${heroTitle}`);
      assert.ok((await page.locator('.ai-status-pill').innerText()).includes('gpt-6.2-sol'));
      await page.screenshot({ path: path.join(MEDIA_DIR, 'home-lobby.png') });

      // Pick first half (1–5) in Normal mode and play Match micro-game
      await page.locator('[data-select-pack="pack-u6-wl-1-5"]').click();
      await page.locator('[data-set-diff="normal"]').click();
      await page.locator('[data-start-mode="standard"]').click();

      await page.locator('#match-game-card').waitFor();
      const pairs = ['u6_get_along_with', 'u6_between', 'u6_wall', 'u6_neighbour', 'u6_heavy'];
      for (const pid of pairs) {
        await page.locator(`[data-match-left="${pid}"]`).click();
        await page.locator(`[data-match-right="${pid}"]`).click();
      }
      await page.locator('[data-complete-step="match"]').last().click();

      // Snap Magnetic Blocks + Zero-Leak Blind Cloze check
      await page.locator('#snap-forge-card').waitFor();
      await page.locator('.magnet-tile[data-tile-text="was"]').click();
      await page.locator('.bounce-bubble').waitFor();
      await page.screenshot({ path: path.join(MEDIA_DIR, 'snap-magnet-blocks.png') });

      for (const piece of ['get', '␣', 'along', '␣', 'with']) {
        await page.locator(`.magnet-tile[data-tile-text="${piece}"]:not([disabled])`).first().click();
      }
      await page.locator('[data-act="enter-cloze"]').click();
      await page.locator('#blind-cloze-card').waitFor();
      assert.equal(await page.locator('.snap-tray').count(), 0, 'Snap tray must be hidden during blind cloze');
      const clozeBody = await page.locator('#blind-cloze-card').innerText();
      assert.equal(clozeBody.includes('along with'), false, 'Blind cloze must not leak target blank');
      await page.locator('#cloze-input').fill('along with');
      await page.locator('#cloze-form button[type="submit"]').click();

      // Check Bug Hunter & Slot Blackboard screenshots
      await page.locator('[data-jump-step="bug"]').click();
      await page.locator('.bug-token', { hasText: 'nieghbour' }).click();
      await page.screenshot({ path: path.join(MEDIA_DIR, 'bug-hunter.png') });

      await page.locator('[data-jump-step="board"]').click();
      await page.locator('#board-live-sentence').waitFor();
      await page.screenshot({ path: path.join(MEDIA_DIR, 'slot-blackboard.png') });
      await ctx.close();
    }

    // --- Scenario 2: Challenge Mode Pure Paperless Dictation + Char Diff + Blind Repair + D+1 Gold Upgrade ---
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await ctx.addInitScript(() => {
        const origNow = Date.now.bind(Date);
        window.__setSimClock = iso => sessionStorage.setItem('__sim_clock', String(Date.parse(iso)));
        Date.now = () => {
          const v = sessionStorage.getItem('__sim_clock');
          return v ? Number(v) : origNow();
        };
      });
      const page = await ctx.newPage();
      await page.goto(fileUrl);
      await page.evaluate(() => window.__setSimClock('2026-11-23T19:30:00+08:00'));

      // Select Unit 6 1–5 and Challenge Mode -> jumps straight to #web-arena-card (zero warmup detours!)
      await page.locator('[data-select-pack="pack-u6-wl-1-5"]').click();
      await page.locator('[data-set-diff="challenge"]').click();
      await page.locator('[data-start-mode="standard"]').click();
      await page.locator('#web-arena-card').waitFor();

      // 1–4: First-try independent passes (including starred *get along with & *neighbour!)
      for (const word of ['get along with', 'between', 'wall', 'neighbour']) {
        await page.locator('#arena-input').fill(word);
        await page.locator('#arena-form button[type="submit"]').click();
        await page.locator('#btn-arena-next').click();
      }

      // 5 (heavy): Deliberately type 'hevy' -> verify Char Diff -> Blind Retype -> Pass!
      await page.locator('#arena-input').fill('hevy');
      await page.locator('#arena-form button[type="submit"]').click();
      await page.locator('#arena-diff-card').waitFor();
      assert.ok((await page.locator('#arena-diff-card').innerText()).includes('heavy'));
      await page.screenshot({ path: path.join(MEDIA_DIR, 'red-pen-blind-check.png') });

      await page.locator('#btn-start-blind-retype').click();
      assert.equal(await page.locator('#arena-diff-card').count(), 0, 'Answer must be hidden during blind retype');
      await page.locator('#arena-input').fill('heavy');
      await page.locator('#arena-retype-form button[type="submit"]').click();
      await page.locator('#btn-arena-next').click();

      // Summary screen auto-settled: 4 / 5 independent, 4 Silver medals, 1 Bronze (heavy)
      await page.locator('#sum-ratio').waitFor();
      assert.equal((await page.locator('#sum-ratio').innerText()).trim(), '4 / 5');
      await page.locator('[data-act="close-summary"]').click();

      const medalNums = await page.locator('.badge-strip .stat-num').allInnerTexts();
      assert.equal(medalNums[0].trim(), '0'); // Gold
      assert.equal(medalNums[1].trim(), '4'); // Silver (*get along with, between, wall, *neighbour)
      assert.equal(medalNums[2].trim(), '1'); // Bronze (heavy)

      // Advance clock to D+1 (2026-11-24) -> verify web due review upgrades Silver -> Gold!
      await page.evaluate(() => window.__setSimClock('2026-11-24T19:30:00+08:00'));
      await page.reload();
      await page.locator('[data-start-mode="due_only"]').click();
      await page.locator('#web-arena-card').waitFor();

      // Answer all due items cleanly
      while (await page.locator('#arena-form').count()) {
        const promptZh = await page.locator('.arena-zh-prompt').innerText();
        const map = {
          '重的，沉的': 'heavy',
          '与……和睦相处': 'get along with',
          '在……中间，介于……之间': 'between',
          '围墙；墙，壁': 'wall',
          '邻居，邻人': 'neighbour'
        };
        const ans = Object.entries(map).find(([zh]) => promptZh.includes(zh))?.[1];
        assert.ok(ans, `Unexpected due prompt: ${promptZh}`);
        await page.locator('#arena-input').fill(ans);
        await page.locator('#arena-form button[type="submit"]').click();
        await page.locator('#btn-arena-next').click();
      }

      await page.locator('#sum-ratio').waitFor();
      await page.locator('[data-act="close-summary"]').click();
      const nextDayMedals = await page.locator('.badge-strip .stat-num').allInnerTexts();
      assert.ok(Number(nextDayMedals[0]) >= 4, `Expected >=4 Gold medals on D+1, got ${nextDayMedals[0]}`);
      await ctx.close();
    }

    // --- Scenario 3: Easy Mode Scaffolding & Bronze Cap ---
    {
      const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 860 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);

      await page.locator('[data-select-pack="pack-u6-wl-1-5"]').click(); // 5 words
      await page.locator('[data-set-diff="easy"]').click();
      await page.locator('[data-start-mode="standard"]').click();

      // Skip warmup straight to web arena
      await page.locator('[data-jump-step="paper"]').click();
      await page.locator('#web-arena-card').waitFor();
      assert.ok((await page.locator('#web-arena-card').innerText()).includes('初学骨架引导'));

      for (const w of ['get along with', 'between', 'wall', 'neighbour', 'heavy']) {
        await page.locator('#arena-input').fill(w);
        await page.locator('#arena-form button[type="submit"]').click();
        await page.locator('#btn-arena-next').click();
      }
      await page.locator('[data-act="close-summary"]').click();
      const easyMedals = await page.locator('.badge-strip .stat-num').allInnerTexts();
      assert.equal(easyMedals[1].trim(), '0', 'Easy mode with skeleton scaffold must award Bronze, not unassisted Silver');
      assert.equal(easyMedals[2].trim(), '5', 'Easy mode must award 5 Bronze medals');
      await ctx.close();
    }

    // --- Scenario 4: Multi-Model AI Hub (OpenAI Default gpt-6.2-sol + Fetch Models List + Select/Default/Manual + Secret Isolation) ---
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const page = await ctx.newPage();

      // Mock OpenAI /v1/models and /v1/chat/completions
      await page.route('https://api.openai.com/v1/models', async route => {
        const auth = route.request().headers()['authorization'] || '';
        assert.equal(auth, 'Bearer test-key-demo-only');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            object: 'list',
            data: [
              { id: 'gpt-6.2-sol' },
              { id: 'gpt-6.2-mini' },
              { id: 'gpt-4.1' },
              { id: 'o4-mini' }
            ]
          })
        });
      });

      await page.route('https://api.openai.com/v1/chat/completions', async route => {
        const reqBody = JSON.parse(route.request().postData() || '{}');
        const userText = reqBody.messages?.[1]?.content || '';
        if (userText.includes('鼓励')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [{ message: { content: '{"ok":true,"greeting":"五年级加油，单词一敲就会！"}' } }]
            })
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      id: 'u6_get_along_with',
                      memoryTip: '三个词手拉手，with 收尾和睦走',
                      template: 'Su Hai and Yang Ling ______ each other.',
                      zh: '苏海和杨玲彼此和睦相处。',
                      hint: '填入表示和睦相处的三个词短语',
                      distractors: ['get along was', 'getalongwith', 'get with']
                    },
                    {
                      id: 'u6_between',
                      memoryTip: 'be 加上双胞胎 ee 夹在中间',
                      template: 'Bobby sits ______ Sam and Billy.',
                      zh: '波比坐在山姆和比利中间。',
                      hint: '填入7个字母介词，留心双写元音',
                      distractors: ['bitween', 'betwen', 'betwean']
                    }
                  ]
                })
              }
            }]
          })
        });
      });

      await page.goto(fileUrl);
      await page.locator('[data-nav="prep"]').click();
      await page.locator('#ai-settings-card').waitFor();

      // Verify OpenAI + gpt-6.2-sol defaults
      assert.equal(await page.locator('#ai-provider-select').inputValue(), 'openai');
      assert.equal(await page.locator('#ai-model-input').inputValue(), 'gpt-6.2-sol');

      // Enter key and fetch models list
      await page.locator('#ai-api-key').fill('test-key-demo-only');
      await page.locator('#btn-ai-fetch-models').click();
      await page.locator('#ai-status-banner').waitFor();
      assert.ok((await page.locator('#ai-status-banner').innerText()).includes('成功读取 4 个模型'));

      // Pick from dropdown -> updates input; Reset -> restores gpt-6.2-sol; Manual type -> works too!
      await page.locator('#ai-model-select').selectOption('gpt-6.2-mini');
      assert.equal(await page.locator('#ai-model-input').inputValue(), 'gpt-6.2-mini');

      await page.locator('#btn-ai-reset-model').click();
      assert.equal(await page.locator('#ai-model-input').inputValue(), 'gpt-6.2-sol');

      await page.locator('#ai-model-input').fill('gpt-6.2-sol-pro');
      await page.locator('#btn-ai-save').click();
      assert.equal(await page.locator('#ai-model-input').inputValue(), 'gpt-6.2-sol-pro');

      // Test connection & AI question generation
      await page.locator('#btn-ai-reset-model').click();
      await page.locator('#btn-ai-test').click();
      assert.ok((await page.locator('#ai-status-banner').innerText()).includes('连通成功'));

      await page.locator('#btn-ai-prefetch-now').click();
      assert.ok((await page.locator('#ai-status-banner').innerText()).includes('生成 2 道'));

      // Verify AI generated sentence appears inside Arena's AI Sentence mode!
      await page.locator('[data-nav="learn"]').click();
      await page.locator('[data-set-diff="challenge"]').click();
      await page.locator('[data-start-mode="standard"]').click();
      await page.locator('#arena-prompt-mode').selectOption('ai_sentence');
      const tplText = await page.locator('.arena-sentence-template').innerText();
      assert.equal(tplText, 'Su Hai and Yang Ling ______ each other.');

      // Verify API key is strictly isolated from main IndexedDB / exported backup state!
      const idbDump = await page.evaluate(async () => {
        const req = indexedDB.open('snapword_workbench_v1', 1);
        const db = await new Promise(res => { req.onsuccess = () => res(req.result); });
        const tx = db.transaction('kv', 'readonly');
        const main = await new Promise(res => {
          const g = tx.objectStore('kv').get('main');
          g.onsuccess = () => res(g.result);
        });
        return JSON.stringify(main);
      });
      assert.equal(idbDump.includes('test-key-demo-only'), false, 'API key MUST NEVER exist inside student state or backup JSON');
      await ctx.close();
    }

    console.log('   ✔ Paperless & multi-LLM Chromium E2E tests & screenshots passed.');
  } finally {
    await browser.close();
  }
}

(async () => {
  runPrivacyGate();
  runUnitTests();
  await runBrowserE2E();
  console.log('4/4 All SnapWord v0.3.0 verifications succeeded!');
})().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
