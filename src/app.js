/* 词哒 · SnapWord Main Interactive Workbench Controller (v0.1.0) */
'use strict';

(() => {
  const DB_NAME = 'snapword_workbench_v1';
  const FALLBACK_KEY = 'snapword_workbench_fallback_v1';

  let state = null;
  let db = null;
  let storageKind = 'memory';
  let currentTab = 'learn';
  let activeSession = null;
  let pendingImportPreview = null;
  let saveChain = Promise.resolve();

  // Slot-machine local UI indices
  const slotUI = { deckIndex: 0, subj: 1, adv: 3, act: 0, customEn: '', customZh: '', customHl: '' };

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 4200);
  }

  function setSaveIndicator(text, warn = false) {
    const el = $('#save-indicator');
    if (!el) return;
    el.textContent = text;
    el.style.color = warn ? '#d97706' : '#059669';
  }

  async function initStorage() {
    try {
      db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB blocked'));
      });
      const saved = await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get('main');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      storageKind = 'idb';
      if (saved && saved.app === 'snapword') {
        state = mergeWithLatestCurriculum(saved);
      } else {
        const raw = localStorage.getItem(FALLBACK_KEY);
        state = raw ? mergeWithLatestCurriculum(JSON.parse(raw)) : SnapCore.freshState(SNAPWORD_CURRICULUM);
      }
    } catch {
      if (db) { try { db.close(); } catch {} db = null; }
      try {
        const raw = localStorage.getItem(FALLBACK_KEY);
        state = raw ? mergeWithLatestCurriculum(JSON.parse(raw)) : SnapCore.freshState(SNAPWORD_CURRICULUM);
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
        storageKind = 'local';
      } catch {
        state = SnapCore.freshState(SNAPWORD_CURRICULUM);
        storageKind = 'memory';
      }
    }
  }

  function mergeWithLatestCurriculum(saved) {
    const base = SnapCore.freshState(SNAPWORD_CURRICULUM);
    return SnapCore.mergeSnapwordBackup(base, saved, { includeDemo: true });
  }

  function saveState() {
    const snapshot = SnapCore.clone(state);
    saveChain = saveChain.catch(() => {}).then(async () => {
      const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      try {
        if (storageKind === 'idb' && db) {
          await new Promise((resolve, reject) => {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(snapshot, 'main');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          setSaveIndicator(`● 本机已保存 · ${timeStr}`);
        } else if (storageKind === 'local') {
          localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
          setSaveIndicator(`● 浏览器已保存 · ${timeStr}`);
        } else {
          setSaveIndicator('⚠ 临时内存模式（关闭前请导出备份）', true);
        }
      } catch {
        setSaveIndicator('⚠ 保存受阻，请及时导出 JSON 备份', true);
      }
    });
    return saveChain;
  }

  function itemById(id) {
    return state.items.find(x => x.id === id);
  }

  function selectedPack() {
    return state.packs.find(p => p.id === state.selectedPackId) || state.packs[0];
  }

  function syncTopBar() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === currentTab);
    });
    const actorBtn = $('#actor-toggle');
    const banner = $('#demo-banner');
    const isDemo = state.actorMode === 'parent_demo';
    if (actorBtn) {
      actorBtn.className = 'actor-pill ' + (isDemo ? 'demo' : 'student');
      actorBtn.textContent = isDemo ? '🛠️ 家长演练试用中' : '🎒 学生正式学习';
    }
    if (banner) banner.hidden = !isDemo;
  }

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // ==================== Session Lifecycle ====================
  function startSession(mode = 'standard', customItemIds = null) {
    SnapAudio.stop();
    const pack = selectedPack();
    const due = SnapCore.getDueQueue(state, SnapCore.todayISO(), mode === 'quick8' ? 1 : 2).todayPick.map(d => d.item.id);

    if (mode === 'baseline' || pack.modeHint === 'baseline' && !customItemIds) {
      const basePack = state.packs.find(p => p.id === 'pack-baseline') || pack;
      activeSession = {
        mode: 'baseline',
        startedAt: Date.now(),
        step: 'paper',
        dueIds: [],
        focusIds: [...basePack.itemIds],
        paperIds: [...basePack.itemIds],
        extraSentence: basePack.extraSentence || null,
        altCheckWords: basePack.altCheckWords || [],
        paperPhase: 'dictate', // 'dictate' | 'blind_check' | 'reveal_grade' | 'summary'
        blindChecks: { cap: false, space: false, chunk: false },
        maskedAnswers: {},
        paperGrades: {},
        sentenceNote: ''
      };
      currentTab = 'learn';
      render();
      return;
    }

    const baseFocus = customItemIds || pack.itemIds;
    const focusLimit = mode === 'quick8' ? 2 : 3;
    const focusIds = baseFocus.filter(id => !due.includes(id)).slice(0, focusLimit);
    const combinedPaper = [...new Set([...due, ...focusIds])].slice(0, mode === 'quick8' ? 3 : 5);
    const bugCard = SNAPWORD_CURRICULUM.BUG_CARDS.find(b => b.id === pack.bugId) || SNAPWORD_CURRICULUM.BUG_CARDS[0];

    activeSession = {
      mode,
      packTitle: pack.title,
      startedAt: Date.now(),
      step: mode === 'quick8' ? 'snap' : 'board', // 'board' | 'snap' | 'bug' | 'paper'
      stepsDone: {},
      dueIds: due,
      focusIds: focusIds.length ? focusIds : combinedPaper.slice(0, 2),
      snapIndex: 0,
      snapState: null,
      bugCardId: bugCard.id,
      bugFixed: {},
      bugPickingIdx: null,
      paperIds: combinedPaper,
      paperPhase: 'dictate',
      blindChecks: { cap: false, space: false, chunk: false },
      maskedAnswers: {},
      paperGrades: {},
      summary: null
    };

    initSnapCardState();
    currentTab = 'learn';
    render();
  }

  function initSnapCardState() {
    if (!activeSession) return;
    const id = activeSession.focusIds[activeSession.snapIndex];
    const item = itemById(id);
    if (!item) return;
    const pieces = item.snap?.pieces || [item.en];
    const decoys = item.snap?.decoys || [];
    const pool = shuffleArray([
      ...pieces.map((text, idx) => ({ key: 'p_' + idx, text, isDecoy: false })),
      ...decoys.map((d, idx) => ({ key: 'd_' + idx, text: d.text, isDecoy: true, tip: d.tip }))
    ]);
    activeSession.snapState = {
      itemId: item.id,
      hideModel: false,
      filled: [],
      usedKeys: [],
      pool,
      bounceTip: '',
      wobbleKey: null,
      completedSnap: false,
      showCloze: false,
      clozeDone: false,
      clozeFeedback: ''
    };
  }

  function elapsedMinutes() {
    if (!activeSession) return 0;
    return Math.floor((Date.now() - activeSession.startedAt) / 60000);
  }

  // ==================== Rendering Views ====================
  function render() {
    syncTopBar();
    const views = {
      learn: renderLearnTab,
      vault: renderVaultTab,
      ledger: renderLedgerTab,
      prep: renderPrepTab
    };
    $('#app-main').innerHTML = (views[currentTab] || renderLearnTab)();
    bindEvents();
  }

  function badgeLabel(badge) {
    if (badge === 'gold') return '<span class="pill" style="background:#fef08a;color:#854d0e">🥇 金章·已焊牢</span>';
    if (badge === 'silver') return '<span class="pill" style="background:#e2e8f0;color:#334155">🥈 银章·纸写首通</span>';
    if (badge === 'bronze') return '<span class="pill" style="background:#ffedd5;color:#9a3412">🥉 铜章·已拆拼</span>';
    return '<span class="pill">⚪ 待点亮</span>';
  }

  function renderLearnTab() {
    if (activeSession) return renderActiveSession();

    const summary = SnapCore.getStatsSummary(state);
    const dueInfo = SnapCore.getDueQueue(state, SnapCore.todayISO(), 3);
    const pack = selectedPack();

    return `
      <div class="badge-strip">
        <div class="stat-tile">
          <span class="medal-icon medal-gold">🥇</span>
          <div><div class="stat-num">${summary.gold}</div><div class="stat-label">金章（跨日纸写焊牢）</div></div>
        </div>
        <div class="stat-tile">
          <span class="medal-icon medal-silver">🥈</span>
          <div><div class="stat-num">${summary.silver}</div><div class="stat-label">银章（首次纸写全对）</div></div>
        </div>
        <div class="stat-tile">
          <span class="medal-icon medal-bronze">🥉</span>
          <div><div class="stat-num">${summary.bronze}</div><div class="stat-label">铜章（完成咔嗒拆拼）</div></div>
        </div>
        <div class="stat-tile">
          <span class="medal-icon medal-due">📅</span>
          <div><div class="stat-num">${dueInfo.totalDue}</div><div class="stat-label">今日到期抽查词</div></div>
        </div>
      </div>

      ${summary.pendingVerifyCount ? `
        <div class="card" style="background:#eff6ff;border-color:#93c5fd">
          <div class="row between">
            <div><strong>📸 有 ${summary.pendingVerifyCount} 道纸笔默写题等待爸爸看微信照片核验</strong></div>
            <button type="button" class="btn btn-sm btn-primary" data-goto-tab="ledger">去核验结果 →</button>
          </div>
        </div>
      ` : ''}

      <section class="card">
        <div class="row between" style="margin-bottom:12px">
          <div>
            <span class="pill pill-core">嗨，${esc(state.profile.nickname)}！不扣血 · 不催秒 · 轻松拆词</span>
            <h1 style="margin:8px 0 4px;font-size:28px">今天花 15 分钟，点亮新徽章 ✨</h1>
            <p class="muted" style="margin:0">推荐流程：摇一句搞笑真话开口读 → 咔嗒磁吸拆 2–3 个难词 → 抓臭虫热身 → 纸本写 3–5 题红笔自查。</p>
          </div>
        </div>

        <div style="background:var(--surface-soft);padding:16px;border-radius:14px;margin:16px 0">
          <label for="pack-select" style="font-weight:800;display:block;margin-bottom:8px">📚 选择今晚要玩的课程包：</label>
          <select id="pack-select" style="width:100%;max-width:560px;font-weight:700">
            ${state.packs.map(p => `<option value="${esc(p.id)}" ${p.id === pack.id ? 'selected' : ''}>${esc(p.title)}（${p.itemIds.length}项）</option>`).join('')}
          </select>
          <p class="muted" style="margin:8px 0 0">${esc(pack.subtitle || '')}</p>
        </div>

        ${dueInfo.todayPick.length ? `
          <div class="bridge-callout" style="margin-bottom:16px">
            <strong>🔔 开场自动附带 ${dueInfo.todayPick.length} 个到期小抽查：</strong>
            ${dueInfo.todayPick.map(d => `<span class="english" style="font-weight:800;margin-right:10px">${esc(d.item.zh)}（${esc(d.reason)}）</span>`).join('')}
          </div>
        ` : ''}

        <div class="row">
          ${pack.modeHint === 'baseline' ? `
            <button type="button" class="btn btn-primary" data-start-mode="baseline">📏 开始 10 分钟纸笔基线短测 →</button>
          ` : `
            <button type="button" class="btn btn-primary" data-start-mode="standard">🚀 开始今日闯关（标准 15–18 分钟）→</button>
            <button type="button" class="btn btn-amber" data-start-mode="quick8">⚡ 作业多·8 分钟保底版</button>
          `}
          <button type="button" class="btn" data-quick-baseline="1">📏 首次纸笔基线短测（6词+1句）</button>
        </div>
      </section>

      <div class="grid-2">
        <section class="card">
          <h3 style="margin-top:0">🎮 四大趣味小机关说明</h3>
          <ul class="muted" style="padding-left:20px;margin:0;line-height:1.8">
            <li><strong>老爸整蛊造句机</strong>：摇出搞笑英语真句大声读顺，把口语直接变成看得见的单词。</li>
            <li><strong>咔嗒磁吸拆词</strong>：听整词发音后把碎片吸合归位，已会写的词一键跳过不耽误时间。</li>
            <li><strong>15 秒抓拼写臭虫</strong>：先挑出“马虎特工”写的错别字，练出火眼金睛。</li>
            <li><strong>两遍红笔拿金章</strong>：纸上写 3–5 题 → 先盲查大写和空格 → 再亮答案圈改，隔日再对升<strong>金章 🥇</strong>！</li>
          </ul>
        </section>
        <section class="card">
          <h3 style="margin-top:0">🤝 父子视频 + 向日葵配合贴士</h3>
          <ul class="muted" style="padding-left:20px;margin:0;line-height:1.8">
            <li><strong>防抢鼠标</strong>：黑板阶段由爸爸敲字，磁吸拆词和抓臭虫由孩子握鼠标操作。</li>
            <li><strong>零回声干扰</strong>：全站无吵闹战斗音效，手机微信免提通话清晰不啸叫。</li>
            <li><strong>单图清晰验卷</strong>：纸上全部写完并红笔自查后，手机微信拍 1 张半页照即可放大看清。</li>
          </ul>
        </section>
      </div>
    `;
  }

  function renderActiveSession() {
    const s = activeSession;
    const mins = elapsedMinutes();
    const overBudget = mins >= (state.profile.budgetMinutes || 18);

    if (s.paperPhase === 'summary') {
      return renderSessionSummary(s);
    }

    if (s.mode === 'baseline') {
      return renderBaselineSession(s);
    }

    const roleText = {
      board: '🎙️ 主控建议：爸爸点黑板 / 父子一起摇句子开口读',
      snap: '🖱️ 主控建议：孩子握鼠标玩磁吸块（爸爸语音听读点拨）',
      bug: '🕵️ 主控建议：孩子点鼠标揪出句子里的拼写臭虫',
      paper: '✍️ 主控建议：孩子低头纸本手写 + 红笔两遍自查'
    }[s.step] || '';

    return `
      <div class="session-bar no-print">
        <div class="step-pills" role="tablist" aria-label="闯关步骤（可按需任意跳转）">
          <button type="button" class="step-pill ${s.step === 'board' ? 'active' : (s.stepsDone.board ? 'done' : '')}" data-jump-step="board">1. 摇句黑板</button>
          <button type="button" class="step-pill ${s.step === 'snap' ? 'active' : (s.stepsDone.snap ? 'done' : '')}" data-jump-step="snap">2. 咔嗒拆词 (${s.focusIds.length})</button>
          <button type="button" class="step-pill ${s.step === 'bug' ? 'active' : (s.stepsDone.bug ? 'done' : '')}" data-jump-step="bug">3. 抓臭虫</button>
          <button type="button" class="step-pill ${s.step === 'paper' ? 'active' : ''}" data-jump-step="paper">4. 纸写拿章 (${s.paperIds.length})</button>
        </div>
        <div class="row">
          <span class="role-indicator">${roleText}</span>
          <button type="button" class="btn btn-sm" data-exit-session="1">退出返回大厅</button>
        </div>
      </div>

      ${overBudget ? `
        <div class="bridge-callout no-print" style="margin-bottom:14px">
          ⏰ <strong>温和提醒：本次已满 ${mins} 分钟啦！</strong>保持好胃口最重要，做完眼前这一步就可以直接进纸写收工，没测到的词会自动顺延下次。
        </div>
      ` : ''}

      ${s.step === 'board' ? renderBoardStep(s) : ''}
      ${s.step === 'snap' ? renderSnapStep(s) : ''}
      ${s.step === 'bug' ? renderBugStep(s) : ''}
      ${s.step === 'paper' ? renderPaperStep(s) : ''}
    `;
  }

  // --- Step 1: Slot-Machine Sentence Maker + Live Oral Blackboard ---
  function buildSlotSentence() {
    const deck = SNAPWORD_CURRICULUM.SLOT_DECKS[slotUI.deckIndex] || SNAPWORD_CURRICULUM.SLOT_DECKS[0];
    const subj = deck.subjects[slotUI.subj % deck.subjects.length];
    const adv = deck.adverbs[slotUI.adv % deck.adverbs.length];
    const act = deck.actions[slotUI.act % deck.actions.length];
    const verbPhrase = subj.thirdSingular ? act.sForm : act.base;
    const parts = [subj.en, adv.en, verbPhrase].filter(Boolean);
    const en = parts.join(' ');
    const zh = `${subj.zh}${adv.zh}${act.zh}`;
    return { deck, en, zh, highlight: act.highlight };
  }

  function formatHighlightedSentence(en, highlight) {
    const cleanEn = esc(en);
    const hl = String(highlight ?? '').trim();
    if (!hl) return cleanEn;
    const escapedHl = esc(hl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escapedHl})`, 'i');
    return cleanEn.replace(re, '<span class="board-hl">$1</span>');
  }

  function renderBoardStep() {
    const slot = buildSlotSentence();
    const activeEn = slotUI.customEn || slot.en;
    const activeZh = slotUI.customZh || slot.zh;
    const activeHl = slotUI.customEn ? slotUI.customHl : slot.highlight;

    return `
      <section class="blackboard">
        <div class="row between">
          <span class="pill" style="background:#334155;color:#fbbf24">Step 1 · 说一句、读一句（约 2–3 分钟，仅高亮 1 处重点）</span>
          <select id="slot-deck-select" class="reel-select" style="width:auto">
            ${SNAPWORD_CURRICULUM.SLOT_DECKS.map((d, idx) => `<option value="${idx}" ${idx === slotUI.deckIndex ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
        </div>

        <div class="board-sentence english" id="board-live-sentence">
          ${formatHighlightedSentence(activeEn, activeHl)}
        </div>
        <p class="board-zh">${esc(activeZh)}</p>

        <div class="row" style="margin-bottom:18px">
          <button type="button" class="btn btn-amber" data-act="spin-slot">🎰 咔嗒摇一句新组合！</button>
          <button type="button" class="btn" data-speak-raw="${esc(activeEn)}">🔊 听整句朗读</button>
          <button type="button" class="btn btn-mint" data-complete-step="board" data-next-step="snap">🗣️ 大声读顺啦，去拆词 →</button>
        </div>

        <div class="slot-reels">
          <div class="reel-box">
            <div class="reel-label">① 谁 / 句头</div>
            <select class="reel-select" data-reel="subj">
              ${slot.deck.subjects.map((x, i) => `<option value="${i}" ${i === slotUI.subj % slot.deck.subjects.length ? 'selected' : ''}>${esc(x.en)}（${esc(x.zh)}）</option>`).join('')}
            </select>
          </div>
          ${slot.deck.adverbs[0].en ? `
          <div class="reel-box">
            <div class="reel-label">② 频度</div>
            <select class="reel-select" data-reel="adv">
              ${slot.deck.adverbs.map((x, i) => `<option value="${i}" ${i === slotUI.adv % slot.deck.adverbs.length ? 'selected' : ''}>${esc(x.en)}（${esc(x.zh)}）</option>`).join('')}
            </select>
          </div>` : ''}
          <div class="reel-box">
            <div class="reel-label">③ 干什么（自动匹配动词变化）</div>
            <select class="reel-select" data-reel="act">
              ${slot.deck.actions.map((x, i) => `<option value="${i}" ${i === slotUI.act % slot.deck.actions.length ? 'selected' : ''}>${esc(x.base)}</option>`).join('')}
            </select>
          </div>
        </div>

        <details style="margin-top:12px;color:#cbd5e1">
          <summary style="cursor:pointer;font-weight:700">🖊️ 爸爸自由敲一句刚才视频聊到的真话上黑板</summary>
          <div class="row" style="margin-top:10px">
            <input type="text" id="custom-board-en" placeholder="输入英文短句，如 We play basketball with Uncle Wang." value="${esc(slotUI.customEn)}" style="flex:2;min-width:220px">
            <input type="text" id="custom-board-zh" placeholder="中文意思（可选）" value="${esc(slotUI.customZh)}" style="flex:1;min-width:140px">
            <input type="text" id="custom-board-hl" placeholder="高亮1个词，如 with" value="${esc(slotUI.customHl)}" style="width:140px">
            <button type="button" class="btn btn-sm btn-amber" data-act="push-board">推上黑板</button>
            ${slotUI.customEn ? '<button type="button" class="btn btn-sm" data-act="clear-board">切回摇奖机</button>' : ''}
          </div>
        </details>
      </section>
    `;
  }

  // --- Step 2: Snap-Block Magnetic Word Forging (Optional Scaffold) ---
  function renderSnapStep(s) {
    const id = s.focusIds[s.snapIndex];
    const item = itemById(id);
    if (!item) return `<div class="card"><p>本组词已完成。</p></div>`;
    const st = s.snapState;
    const pieces = item.snap?.pieces || [item.en];
    const audioInfo = SnapAudio.resolveSourceInfo(state, item);

    return `
      <section class="card">
        <div class="row between" style="margin-bottom:10px">
          <div>
            <span class="pill pill-core">Step 2 · 咔嗒磁吸拆词（第 ${s.snapIndex + 1} / ${s.focusIds.length} 项 · 按需辅助）</span>
            ${badgeLabel(state.mastery[item.id]?.badge)}
          </div>
          <button type="button" class="btn btn-sm btn-mint" data-act="skip-to-next-word">
            ⚡ 这词我会写，跳过直接留到纸上验 →
          </button>
        </div>

        <div class="word-hero">
          <div class="muted">先听整词发音、看清难写处，再动手吸合磁吸片</div>
          <div class="word-zh-big">${esc(item.zh)}</div>
          ${st.hideModel ? `
            <div class="chunk-display" style="color:#64748b;border-style:dashed">🙈 原词已遮住，凭记忆拼出来吧！</div>
          ` : `
            <div class="chunk-display english">${esc(item.displayChunks || item.en)}</div>
          `}
          <div style="margin-top:10px">
            <button type="button" class="btn btn-primary" data-speak-item="${esc(item.id)}">🔊 听完整发音</button>
            <button type="button" class="btn btn-sm" data-act="toggle-model-mask">${st.hideModel ? '👀 看一眼原词' : '🙈 遮住原词盲拼'}</button>
            <span class="audio-tag">${esc(audioInfo.label)}</span>
          </div>
        </div>

        <div class="help-callout">
          <strong>💡 拆词锦囊：</strong>${esc(item.helpNote)}
        </div>
        ${item.bridgeNote ? `
          <div class="bridge-callout">
            <strong>🔗 顺手串记（只看 1 处）：</strong>${esc(item.bridgeNote)}
          </div>
        ` : ''}

        <h3 style="margin:16px 0 8px">🧲 咔嗒磁吸槽（按顺序点击下方磁吸片归位）：</h3>
        <div class="snap-tray" aria-label="磁吸拼装槽">
          ${pieces.map((p, idx) => {
            const isFilled = idx < st.filled.length;
            const label = p === '␣' ? '␣ 空格' : p;
            return `<span class="snap-slot english ${isFilled ? 'filled' : ''}" ${isFilled && idx === st.filled.length - 1 && !st.completedSnap ? 'data-act="undo-snap" title="点击撤回最后一块"' : ''}>
              ${isFilled ? esc(label) : (p === '␣' ? '空格' : '？')}
            </span>`;
          }).join('')}
        </div>

        ${st.bounceTip ? `<div class="bounce-bubble">${esc(st.bounceTip)}</div>` : ''}

        ${!st.completedSnap ? `
          <div class="snap-pool">
            ${st.pool.map(tile => {
              const used = st.usedKeys.includes(tile.key);
              const isSpace = tile.text === '␣';
              const wobble = st.wobbleKey === tile.key;
              return `<button type="button" class="magnet-tile english ${isSpace ? 'space-tile' : ''} ${used ? 'used' : ''} ${wobble ? 'wobble' : ''}" data-snap-key="${esc(tile.key)}" data-tile-text="${esc(tile.text)}">${isSpace ? '␣ 空格' : esc(tile.text)}</button>`;
            }).join('')}
          </div>
        ` : `
          <div class="bridge-callout" style="text-align:center;font-size:18px;font-weight:800">
            🎉 咔嗒合拢成功！完整拼写：<span class="english" style="font-size:24px;color:#047857">${esc(item.en)}</span>
          </div>
        `}

        ${item.cloze && (st.completedSnap || st.showCloze) ? `
          <div style="background:var(--surface-soft);padding:16px;border-radius:14px;margin-top:14px;text-align:center">
            <div class="muted" style="font-weight:700">🎯 可选小挖空加固：${esc(item.cloze.hint)}</div>
            <form id="cloze-form" class="cloze-box english">
              <span>${esc(item.cloze.prefix)}</span>
              <input type="text" id="cloze-input" class="cloze-input english" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="补这一截" value="${st.clozeDone ? esc(item.cloze.blank) : ''}" ${st.clozeDone ? 'readonly' : ''}>
              <span>${esc(item.cloze.suffix)}</span>
              ${!st.clozeDone ? `<button type="submit" class="btn btn-primary btn-sm">核对</button>` : `<span style="color:#059669">✅ 补洞精准！</span>`}
            </form>
            ${st.clozeFeedback ? `<div class="muted" style="color:#b45309;font-weight:700">${esc(st.clozeFeedback)}</div>` : ''}
          </div>
        ` : ''}

        <div class="row between" style="margin-top:18px">
          <div class="row">
            ${item.cloze && !st.showCloze && !st.completedSnap ? `<button type="button" class="btn btn-sm" data-act="open-cloze">🎯 只开小挖空试试</button>` : ''}
            ${s.snapIndex > 0 ? `<button type="button" class="btn btn-sm" data-act="prev-word">← 上一词</button>` : ''}
          </div>
          <button type="button" class="btn btn-primary" data-act="next-word">
            ${s.snapIndex + 1 < s.focusIds.length ? '下一词 →' : '拆词完成，去抓臭虫热身 →'}
          </button>
        </div>
      </section>
    `;
  }

  // --- Step 3: 15-Second Bug Hunter Detective ---
  function renderBugStep(s) {
    const card = SNAPWORD_CURRICULUM.BUG_CARDS.find(b => b.id === s.bugCardId) || SNAPWORD_CURRICULUM.BUG_CARDS[0];
    const totalBugs = card.tokens.filter(t => t.isBug).length;
    const squashedCount = Object.keys(s.bugFixed).length;
    const allDone = squashedCount >= totalBugs;
    const pickingToken = s.bugPickingIdx != null ? card.tokens[s.bugPickingIdx] : null;

    return `
      <section class="card">
        <div class="row between">
          <div>
            <span class="pill" style="background:#fef3c7;color:#92400e">Step 3 · 抓拼写臭虫侦探（热身火眼金睛）</span>
            <h2 style="margin:8px 0 4px">${esc(card.title)}</h2>
            <p class="muted" style="margin:0">原句想表达：<strong>${esc(card.zh)}</strong>（已揪出 <b>${squashedCount} / ${totalBugs}</b> 只臭虫）</p>
          </div>
          <button type="button" class="btn btn-sm" data-jump-step="paper">跳过热身，直接去纸上写 →</button>
        </div>

        <div class="bug-sentence english">
          ${card.tokens.map((tok, idx) => {
            const fixed = s.bugFixed[idx];
            const isPicking = s.bugPickingIdx === idx;
            return `<button type="button" class="bug-token english ${fixed ? 'squashed' : ''} ${isPicking ? 'picking' : ''}" data-bug-idx="${idx}">
              ${fixed ? `✅ ${esc(tok.fix)}` : esc(tok.text)}
            </button>`;
          }).join('')}
        </div>

        ${pickingToken ? `
          <div class="bounce-bubble">
            <div>🐛 抓到可疑拼写「<b class="english">${esc(pickingToken.text)}</b>」！哪个才是正确写法？</div>
            <div class="row" style="justify-content:center;margin-top:10px">
              ${pickingToken.choices.map(ch => `
                <button type="button" class="btn btn-primary english" data-bug-fix="${esc(ch)}">${esc(ch)}</button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${allDone ? `
          <div class="bridge-callout" style="font-size:17px;font-weight:800;text-align:center">
            🕵️ 太帅了！所有拼写臭虫都被你拍扁啦！带着这双火眼金睛，去本子上写今天最后 ${s.paperIds.length} 道题吧！
          </div>
        ` : ''}

        <div class="row between" style="margin-top:16px">
          <span class="muted">小提示：直接用鼠标点击上面黑框里看起来不对劲的英文词！</span>
          <button type="button" class="btn btn-mint" data-complete-step="bug" data-next-step="paper">
            ✍️ 准备好了，进纸本默写 (${s.paperIds.length}题) →
          </button>
        </div>
      </section>
    `;
  }

  // --- Step 4: Paper Dictation + Two-Pass Red-Pen Self-Check ---
  function renderPaperStep(s) {
    const items = s.paperIds.map(itemById).filter(Boolean);

    if (s.paperPhase === 'dictate') {
      return `
        <section class="card">
          <span class="pill pill-core">Step 4A · 纸本独立手写（共 ${items.length} 项 · 答案已隐藏）</span>
          <h2 style="margin:8px 0 4px">✍️ 请打开英语默写本，按题号写下英文</h2>
          <p class="muted" style="margin:0 0 14px">规则：每题可点「听发音」重听 1 次（如无语音可由爸爸口头念词）。全部写完前先不看答案、不举本子对镜头。</p>

          <div class="paper-list">
            ${items.map((it, idx) => {
              const isDue = s.dueIds.includes(it.id);
              return `
                <div class="paper-item row between">
                  <div>
                    <strong style="font-size:20px">#${idx + 1}　${esc(it.zh)}</strong>
                    ${isDue ? '<span class="pill" style="background:#dbeafe;color:#1e40af;margin-left:8px">📅 到期复测（全对冲金章！）</span>' : ''}
                    <div class="muted">${it.type === 'phrase' ? '短语（注意词间留空）' : '单词'}</div>
                  </div>
                  <button type="button" class="btn" data-speak-item="${esc(it.id)}">🔊 听发音</button>
                </div>
              `;
            }).join('')}
          </div>

          <div class="row between" style="margin-top:18px">
            <button type="button" class="btn btn-sm" onclick="window.print()">🖨️ 打印今日默写题单（可选）</button>
            <button type="button" class="btn btn-primary" data-paper-phase="blind_check">
              🖊️ 本子上全部写完啦，拿起红笔做第 1 遍盲查 →
            </button>
          </div>
        </section>
      `;
    }

    if (s.paperPhase === 'blind_check') {
      const allChecked = s.blindChecks.cap && s.blindChecks.space && s.blindChecks.chunk;
      return `
        <section class="card">
          <span class="pill" style="background:#ffe4e6;color:#9f1239">Step 4B · 第一遍红笔盲查（约 1 分钟 · 答案仍隐藏！）</span>
          <h2 style="margin:8px 0 4px">🔴 先别看答案！用手指着你自己的纸本查这 3 件事：</h2>
          <p class="muted" style="margin:0">自己先抓出来的错，比看答案抄十遍都管用！每查完一项打一个勾：</p>

          <div class="blind-check-card">
            <label class="blind-check-row">
              <input type="checkbox" data-blind-box="cap" ${s.blindChecks.cap ? 'checked' : ''}>
              <span>① 查头：星期名称和句子开头的第一个字母，戴上大写礼帽了吗？</span>
            </label>
            <label class="blind-check-row">
              <input type="checkbox" data-blind-box="space" ${s.blindChecks.space ? 'checked' : ''}>
              <span>② 查空：短语和句子里，词与词之间留出清楚的一指尖空格了吗？</span>
            </label>
            <label class="blind-check-row">
              <input type="checkbox" data-blind-box="chunk" ${s.blindChecks.chunk ? 'checked' : ''}>
              <span>③ 查腰与尾：今天提醒最容易漏写的那一截字母和句末标点写上了吗？</span>
            </label>
          </div>

          <div class="row between" style="margin-top:16px">
            <button type="button" class="btn btn-sm" data-paper-phase="dictate">← 返回重听题目</button>
            <button type="button" class="btn ${allChecked ? 'btn-mint' : 'btn-primary'}" data-paper-phase="reveal_grade">
              👀 红笔自查完毕，亮出标准答案核对 →
            </button>
          </div>
        </section>
      `;
    }

    // Phase C: reveal_grade
    return `
      <section class="card">
        <span class="pill pill-core">Step 4C · 第二遍亮答案核漏 + 微信拍 1 张照验卷</span>
        <h2 style="margin:8px 0 4px">✅ 对照标红重点：有错就红笔圈出、改写 1 次，再点「遮住重写」默 1 次</h2>
        <p class="muted" style="margin:0 0 14px">核对完后，手机微信对着这半页纸拍 1 张清晰照片发给爸爸放大确认即可。</p>

        <div class="paper-list">
          ${items.map((it, idx) => {
            const g = s.paperGrades[it.id] || { outcome: 'paper_independent', tags: [] };
            const masked = Boolean(s.maskedAnswers[it.id]);
            return `
              <div class="paper-item">
                <div class="row between">
                  <div>
                    <strong>#${idx + 1}　${esc(it.zh)}</strong>
                    <span class="muted" style="margin-left:8px">拆块提示：${esc(it.displayChunks || it.en)}</span>
                  </div>
                  <div class="row">
                    <button type="button" class="btn btn-sm" data-speak-item="${esc(it.id)}">🔊 发音</button>
                    <button type="button" class="btn btn-sm" data-mask-ans="${esc(it.id)}">
                      ${masked ? '👀 展开答案' : '🙈 遮住答案重写'}
                    </button>
                  </div>
                </div>

                ${masked ? `
                  <div class="four-line-answer" style="color:#64748b">🙈 答案已遮住，请在纸本空白处凭记忆默写一遍！</div>
                ` : `
                  <div class="four-line-answer english">${esc(it.en)}</div>
                  ${it.acceptedVariants?.length ? `<span class="muted">（写成 ${esc(it.acceptedVariants.join(' / '))} 也算对）</span>` : ''}
                `}

                <div class="outcome-group" role="group" aria-label="本题纸写结果">
                  <button type="button" class="outcome-btn ${g.outcome === 'paper_independent' ? 'selected-good' : ''}" data-grade-item="${esc(it.id)}" data-outcome="paper_independent">🌟 首答独立全对</button>
                  <button type="button" class="outcome-btn ${g.outcome === 'blind_self_fixed' ? 'selected-fix' : ''}" data-grade-item="${esc(it.id)}" data-outcome="blind_self_fixed">🔍 盲查自己抓出并改对</button>
                  <button type="button" class="outcome-btn ${g.outcome === 'answer_corrected' ? 'selected-fix' : ''}" data-grade-item="${esc(it.id)}" data-outcome="answer_corrected">✏️ 看答案后红笔订正</button>
                  <button type="button" class="outcome-btn ${g.outcome === 'pending_verify' ? 'selected-pending' : ''}" data-grade-item="${esc(it.id)}" data-outcome="pending_verify">⏳ 待爸爸看微信图核验</button>
                  <button type="button" class="outcome-btn ${g.outcome === 'untested' ? 'selected-pending' : ''}" data-grade-item="${esc(it.id)}" data-outcome="untested">⏭️ 超时顺延未测</button>
                </div>

                ${['blind_self_fixed', 'answer_corrected'].includes(g.outcome) ? `
                  <div style="margin-top:10px">
                    <span class="muted">勾选可见小问题（方便下次精准提醒）：</span>
                    <div class="row" style="gap:6px;margin-top:6px">
                      ${SNAPWORD_CURRICULUM.ERROR_TAGS.map(tag => {
                        const active = g.tags.includes(tag.id);
                        return `<button type="button" class="tag-chip ${active ? 'active' : ''}" data-toggle-err="${esc(it.id)}" data-tag="${esc(tag.id)}">${esc(tag.label)}</button>`;
                      }).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <div class="row between" style="margin-top:20px">
          <button type="button" class="btn btn-sm" data-paper-phase="blind_check">← 返回上一页</button>
          <button type="button" class="btn btn-mint" data-act="finish-paper-session">🎉 保存今日成果，点亮徽章 →</button>
        </div>
      </section>
    `;
  }

  // --- Baseline 10-Min Mode ---
  function renderBaselineSession(s) {
    const items = s.paperIds.map(itemById).filter(Boolean);
    const altItems = (s.altCheckWords || []).map(itemById).filter(Boolean);

    if (s.paperPhase === 'dictate') {
      return `
        <section class="card">
          <span class="pill pill-core">首次 10–12 分钟纸笔基线短测（不打分、不排名，只摸底省时间）</span>
          <h2 style="margin:8px 0 4px">📏 请在纸上写出这 6 个词 + 1 个句子（允许统一重听 1 次）</h2>
          <p class="muted" style="margin:0 0 14px">告诉孩子：“我们先看看哪几个词你已经稳了，已经会的以后就直接跳过不用重复练！”收齐全部首答前不提示。</p>
          <div class="paper-list">
            ${items.map((it, i) => `
              <div class="paper-item row between">
                <strong>#${i + 1}　${esc(it.zh)}</strong>
                <button type="button" class="btn btn-sm" data-speak-item="${esc(it.id)}">🔊 播放标准音</button>
              </div>
            `).join('')}
            ${s.extraSentence ? `
              <div class="paper-item">
                <strong>#7（附加短句）　${esc(s.extraSentence.zh)}</strong>
                <div class="muted">重点观察：${esc(s.extraSentence.focus)}</div>
              </div>
            ` : ''}
          </div>
          <div class="row between" style="margin-top:16px">
            <button type="button" class="btn btn-sm" data-exit-session="1">取消返回</button>
            <button type="button" class="btn btn-primary" data-paper-phase="reveal_grade">✍️ 首答已全部收齐，展开记录页 →</button>
          </div>
        </section>
      `;
    }

    return `
      <section class="card">
        <span class="pill pill-core">基线首答客观记录（只记可见错误）</span>
        <h2 style="margin:8px 0 6px">📋 记录首次无提示纸写原貌</h2>
        <div class="paper-list">
          ${items.map((it, idx) => {
            const g = s.paperGrades[it.id] || { outcome: 'paper_independent', tags: [] };
            return `
              <div class="paper-item">
                <div class="row between">
                  <strong>#${idx + 1} ${esc(it.zh)} ➔ <span class="english" style="color:var(--primary-dark)">${esc(it.en)}</span></strong>
                </div>
                <div class="outcome-group">
                  <button type="button" class="outcome-btn ${g.outcome === 'paper_independent' ? 'selected-good' : ''}" data-grade-item="${esc(it.id)}" data-outcome="paper_independent">🌟 首答独立全对</button>
                  <button type="button" class="outcome-btn ${g.outcome === 'answer_corrected' ? 'selected-fix' : ''}" data-grade-item="${esc(it.id)}" data-outcome="answer_corrected">✏️ 有错需练（勾选下方可见表现）</button>
                  <button type="button" class="outcome-btn ${g.outcome === 'blank' ? 'selected-fix' : ''}" data-grade-item="${esc(it.id)}" data-outcome="blank">⬜ 空题未写出</button>
                </div>
                ${g.outcome === 'answer_corrected' ? `
                  <div class="row" style="gap:6px;margin-top:8px">
                    ${SNAPWORD_CURRICULUM.ERROR_TAGS.map(tag => {
                      const active = g.tags.includes(tag.id);
                      return `<button type="button" class="tag-chip ${active ? 'active' : ''}" data-toggle-err="${esc(it.id)}" data-tag="${esc(tag.id)}">${esc(tag.label)}</button>`;
                    }).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <div class="help-callout" style="margin-top:14px">
          <strong>🔍 异组口头排查参考（避免刚看答案就测同词）：</strong>
          请孩子试着独立认读并说出意思：
          ${altItems.map(a => `<b class="english" style="margin:0 8px">${esc(a.en)}</b>`).join('')}
        </div>

        <div style="margin-top:12px">
          <label style="font-weight:700;display:block;margin-bottom:6px">附加短句（with 选用）与观察备注：</label>
          <input type="text" id="baseline-note" style="width:100%" placeholder="例：句子中 with 写对了，但 football 写成了 footbool..." value="${esc(s.sentenceNote || '')}">
        </div>

        <div class="row between" style="margin-top:18px">
          <button type="button" class="btn btn-sm" data-paper-phase="dictate">← 返回</button>
          <button type="button" class="btn btn-mint" data-act="finish-paper-session">✅ 保存基线记录并生成复习起点</button>
        </div>
      </section>
    `;
  }

  function renderSessionSummary(s) {
    const sum = s.summary || { independent: [], selfFixed: [], needReview: [] };
    return `
      <section class="card" style="text-align:center;padding:32px 24px">
        <div style="font-size:46px">🏅</div>
        <h1 style="margin:8px 0">今日闯关圆满收工！</h1>
        <p class="muted">用时约 ${Math.max(1, elapsedMinutes())} 分钟 · ${state.actorMode === 'parent_demo' ? '（家长演练模式，未改动孩子正式账本）' : '记录已安全存入本机'}</p>

        <div class="grid-3" style="margin:20px 0;text-align:left">
          <div class="stat-tile">
            <span class="medal-icon medal-gold">🌟</span>
            <div>
              <div class="stat-num">${sum.independent.length} 项</div>
              <div class="stat-label">纸上首答独立全对</div>
            </div>
          </div>
          <div class="stat-tile">
            <span class="medal-icon medal-bronze">🔍</span>
            <div>
              <div class="stat-num">${sum.selfFixed.length} 项</div>
              <div class="stat-label">红笔盲查自己抓出</div>
            </div>
          </div>
          <div class="stat-tile">
            <span class="medal-icon medal-due">🔄</span>
            <div>
              <div class="stat-num">${sum.needReview.length} 项</div>
              <div class="stat-label">排入下次课前抽查</div>
            </div>
          </div>
        </div>

        ${sum.needReview.length ? `
          <div class="help-callout" style="text-align:left">
            <strong>📌 约定明天开场先抽查这几项（遮住写对就能升银章/金章！）：</strong>
            ${sum.needReview.map(id => `<span class="english" style="font-weight:900;margin-right:12px">${esc(itemById(id)?.en)}（${esc(itemById(id)?.zh)}）</span>`).join('')}
          </div>
        ` : `
          <div class="bridge-callout" style="text-align:left">
            🎉 本组纸写全部一次过关！已按 D+1 / D+3 / D+7 排入隔日巩固计划，快去休息聊聊天吧！
          </div>
        `}

        <div class="row" style="justify-content:center;margin-top:22px">
          <button type="button" class="btn btn-primary" data-exit-session="1">返回今日大厅</button>
          <button type="button" class="btn" data-goto-tab="vault">查看金银铜徽章图鉴 🏅</button>
        </div>
      </section>
    `;
  }

  // ==================== Tab 2: Medal Vault & Textbook Dual-Field Catalog ====================
  let vaultFilter = 'all';
  function renderVaultTab() {
    const items = state.items.filter(it => {
      if (vaultFilter === 'u6') return it.unit === 6;
      if (vaultFilter === 'u5') return it.unit !== 6;
      if (vaultFilter === 'medals') return (state.mastery[it.id]?.badge || 'none') !== 'none';
      return true;
    });

    return `
      <section class="card">
        <div class="row between">
          <div>
            <h2 style="margin:0 0 4px">🏅 金银铜徽章图鉴 & 教材词表分层</h2>
            <p class="muted" style="margin:0">铜章＝已拆拼 ｜ 银章＝首次纸写独立全对 ｜ <strong>金章＝至少在两个不同日期纸上独立写对！</strong></p>
          </div>
          <div class="row">
            <button type="button" class="btn btn-sm ${vaultFilter === 'all' ? 'btn-primary' : ''}" data-vault-filter="all">全部 (${state.items.length})</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'u5' ? 'btn-primary' : ''}" data-vault-filter="u5">U5与基础断层</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'u6' ? 'btn-primary' : ''}" data-vault-filter="u6">U6全量词表</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'medals' ? 'btn-primary' : ''}" data-vault-filter="medals">已点亮徽章</button>
          </div>
        </div>
      </section>

      <div class="grid-2">
        ${items.map(it => {
          const m = state.mastery[it.id] || {};
          const audioInfo = SnapAudio.resolveSourceInfo(state, it);
          return `
            <article class="card" style="margin-bottom:0">
              <div class="row between">
                <div>
                  <span class="english" style="font-size:24px;font-weight:900">${esc(it.en)}</span>
                  ${it.bookPage ? `<span class="pill">p.${it.bookPage}</span>` : ''}
                  <span class="pill ${it.textbookCore ? 'pill-core' : 'pill-star'}">${it.textbookCore ? '教材核心词' : '带 * 非核心词'}</span>
                </div>
                ${badgeLabel(m.badge)}
              </div>
              <p style="margin:6px 0;font-weight:700">${esc(it.zh)} <span class="muted">｜ ${esc(it.displayChunks || '')}</span></p>
              <p class="muted" style="margin:4px 0 10px">${esc(it.helpNote)}</p>
              <div class="row between">
                <button type="button" class="btn btn-sm" data-speak-item="${esc(it.id)}">🔊 听发音</button>
                <label class="muted" style="font-size:13px">
                  本班要求：
                  <select data-class-req="${esc(it.id)}" style="padding:4px 8px;font-size:13px">
                    <option value="dictation" ${it.classRequirement === 'dictation' ? 'selected' : ''}>本班要求纸写必默</option>
                    <option value="read_meaning_use" ${it.classRequirement === 'read_meaning_use' ? 'selected' : ''}>先听读认义（暂缓默写）</option>
                    <option value="unverified" ${it.classRequirement === 'unverified' ? 'selected' : ''}>待向老师核实</option>
                  </select>
                </label>
              </div>
              <div class="muted" style="font-size:12px;margin-top:8px">
                ${esc(audioInfo.label)}
                ${m.independentDates?.length ? ` · 已在 ${m.independentDates.join(', ')} 独立纸写正确` : ''}
                ${m.nextDueDate ? ` · 下次抽查：${m.nextDueDate}` : ''}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  // ==================== Tab 3: Review Queue, Error Ledger & Safe Backup ====================
  function renderLedgerTab() {
    const dueInfo = SnapCore.getDueQueue(state, SnapCore.todayISO(), 10);
    const summary = SnapCore.getStatsSummary(state);
    const pendingEvents = state.events.filter(e => e.actor === 'student' && e.taskType === 'paper_check' && e.outcome === 'pending_verify');
    const recentStudentEvents = state.events.filter(e => e.actor === 'student').slice().reverse().slice(0, 30);

    return `
      ${pendingEvents.length ? `
        <section class="card" style="border-color:#60a5fa;background:#eff6ff">
          <h2 style="margin-top:0">📸 待爸爸看微信照片核验（${pendingEvents.length} 项）</h2>
          <div class="paper-list">
            ${pendingEvents.map(ev => {
              const it = itemById(ev.itemId);
              return `
                <div class="paper-item row between">
                  <div>
                    <strong>${esc(it?.en)}（${esc(it?.zh)}）</strong>
                    <div class="muted">记录日期：${esc(ev.dateStr)}</div>
                  </div>
                  <div class="row">
                    <button type="button" class="btn btn-sm btn-mint" data-verify-ev="${esc(ev.id)}" data-verify-out="paper_independent">✅ 照片首答全对</button>
                    <button type="button" class="btn btn-sm btn-amber" data-verify-ev="${esc(ev.id)}" data-verify-out="answer_corrected">✏️ 照片有错需复测</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      ` : ''}

      <section class="card">
        <div class="row between">
          <div>
            <h2 style="margin:0 0 4px">📅 到期抽查与待巩固队列（共 ${dueInfo.totalDue} 项）</h2>
            <p class="muted" style="margin:0">以首次纸上独立写对当天为 D0，按 D+1、D+3、D+7 抽查；每晚最多抽 2–3 项，未做自动顺延不清零。</p>
          </div>
          <button type="button" class="btn btn-primary" data-act="start-due-review" ${dueInfo.todayPick.length ? '' : 'disabled'}>
            🚀 立即抽查前 ${Math.min(3, dueInfo.todayPick.length)} 项
          </button>
        </div>
        ${dueInfo.todayPick.length ? `
          <div class="grid-3" style="margin-top:14px">
            ${dueInfo.todayPick.map(d => `
              <div class="paper-item">
                <div class="row between"><strong class="english">${esc(d.item.en)}</strong>${badgeLabel(d.m.badge)}</div>
                <div>${esc(d.item.zh)}</div>
                <div class="muted" style="font-size:12.5px;margin-top:4px">${esc(d.reason)}</div>
              </div>
            `).join('')}
          </div>
        ` : `<p class="muted" style="margin-top:12px">🎉 当前没有急需补测的错词或到期词！</p>`}
      </section>

      <section class="card">
        <h2 style="margin:0 0 8px">🔎 可见书写问题累计分布（仅统计学生正式记录）</h2>
        <div class="row">
          ${SNAPWORD_CURRICULUM.ERROR_TAGS.map(t => {
            const count = summary.errorTotals[t.id] || 0;
            return `<span class="pill" style="padding:7px 13px;font-size:14px;${count ? 'background:#fee2e2;color:#991b1b' : ''}">
              ${esc(t.label)}：<b>${count}</b> 次
            </span>`;
          }).join('')}
        </div>
        <p class="muted" style="margin:12px 0 0">
          累计有效纸笔核验：<b>${summary.paperTestedCount}</b> 题次 ｜ 其中无提示首答独立全对：<b>${summary.independentPass}</b> 题次
          （注：空题、未施测、待核验及家长演练试用点击均已严格隔离，不混入统计分母）。
        </p>
      </section>

      <section class="card">
        <h2 style="margin:0 0 8px">💾 备份导出与防污染预览恢复</h2>
        <p class="muted">换电脑或清理浏览器前，可随时导出 JSON 备份。导入时支持预览校验，自动过滤家长演练日志，并兼容提取旧版《词汇撤离》中的自定义词条。</p>
        <div class="row">
          <button type="button" class="btn btn-primary" data-act="export-json">⬇️ 导出完整 JSON 备份</button>
          <button type="button" class="btn" data-act="trigger-import">📂 选择备份文件预览恢复</button>
          <input type="file" id="import-file-input" accept=".json,application/json" hidden>
        </div>

        ${pendingImportPreview ? renderImportPreviewCard(pendingImportPreview) : ''}
      </section>

      <section class="card">
        <h3 style="margin-top:0">🕒 最近学生正式学习流水（最多显示近 30 条）</h3>
        ${recentStudentEvents.length ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <thead>
                <tr style="border-bottom:2px solid var(--border);text-align:left">
                  <th style="padding:8px">日期</th>
                  <th style="padding:8px">词条</th>
                  <th style="padding:8px">环节</th>
                  <th style="padding:8px">结果</th>
                  <th style="padding:8px">可见问题备注</th>
                </tr>
              </thead>
              <tbody>
                ${recentStudentEvents.map(e => {
                  const it = itemById(e.itemId);
                  return `<tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:8px">${esc(e.dateStr)}</td>
                    <td style="padding:8px" class="english"><b>${esc(it?.en || e.itemId)}</b></td>
                    <td style="padding:8px">${esc(e.taskType)}</td>
                    <td style="padding:8px">${esc(e.outcome)}</td>
                    <td style="padding:8px" class="muted">${esc((e.errorTags || []).join(', ') || e.note || '—')}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="muted">暂无正式记录，完成一次今日闯关就会在这里留痕啦。</p>`}
      </section>
    `;
  }

  function renderImportPreviewCard(preview) {
    if (preview.kind === 'snapword') {
      return `
        <div class="help-callout" style="margin-top:14px">
          <strong>🔍 备份预览（词哒 SnapWord 原生备份）：</strong>
          含词条 ${preview.itemCount} 项、课程包 ${preview.packCount} 个、学生正式记录 ${preview.studentEventCount} 条（其中本机尚未收录的新记录 <b>${preview.newStudentEvents}</b> 条；另有家长演练记录 ${preview.demoEventCount} 条默认自动忽略）。
          <div class="row" style="margin-top:10px">
            <button type="button" class="btn btn-sm btn-mint" data-act="confirm-import-snapword">确认无损合入学生记录</button>
            <button type="button" class="btn btn-sm" data-act="cancel-import">取消</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="help-callout" style="margin-top:14px">
        <strong>⚠️ 旧版备份隔离预览（检测到《词汇撤离》JSON）：</strong>
        <p style="margin:6px 0">${esc(preview.warning)}</p>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn-sm btn-primary" data-act="confirm-import-legacy-words">仅安全提取词条（共 ${preview.wordCount} 项，隔离旧测试日志）</button>
          <button type="button" class="btn btn-sm" data-act="cancel-import">取消</button>
        </div>
      </div>
    `;
  }

  // ==================== Tab 4: Coach Prep & Settings ====================
  function renderPrepTab() {
    const attributionEntries = typeof SNAPWORD_AUDIO_CLIPS !== 'undefined' ? Object.entries(SNAPWORD_AUDIO_CLIPS) : [];
    return `
      <section class="card">
        <h2 style="margin-top:0">⚙️ 学习者昵称与温和时长设置（仅保存在本机浏览器）</h2>
        <form id="profile-form" class="row">
          <label>学习者昵称：
            <input type="text" id="prof-nickname" maxlength="24" value="${esc(state.profile.nickname)}">
          </label>
          <label>单次温和提醒时长（分钟）：
            <input type="number" id="prof-budget" min="8" max="35" value="${Number(state.profile.budgetMinutes || 18)}" style="width:90px">
          </label>
          <button type="submit" class="btn btn-primary btn-sm">保存设置</button>
        </form>
      </section>

      <section class="card">
        <h2 style="margin-top:0">⚡ 30 秒快速粘贴排课（支持向日葵跨机粘贴）</h2>
        <p class="muted">每行按 <code>英文 | 中文</code> 粘贴老师今天布置的默写清单（建议每包精选 3–5 项，短语会自动按空格切块，首字母大写词自动生成礼帽提示）。</p>
        <form id="quick-pack-form">
          <div class="row" style="margin-bottom:10px">
            <label style="flex:1;min-width:240px">新课程包标题：
              <input type="text" id="qp-title" placeholder="例：11月24日 · U6 第一组默写" required style="width:100%">
            </label>
          </div>
          <textarea id="qp-lines" placeholder="wall | 围墙&#10;between | 在……中间&#10;do your homework | 做家庭作业" required></textarea>
          <div class="row" style="margin-top:10px">
            <button type="submit" class="btn btn-primary">✨ 生成课程包并设为当前任务</button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2 style="margin-top:0">🎙️ 为词条绑定自带真人录音（可选）</h2>
        <p class="muted">内置未收录真人录音的短语或新词会自动使用系统朗读；你也可以上传 500 KB 以内的 MP3/WAV/OGG 真实教材配套或家长示范录音。</p>
        <form id="custom-audio-form" class="row">
          <select id="ca-item" style="max-width:320px">
            ${state.items.map(it => `<option value="${esc(it.id)}">${esc(it.en)}（${esc(it.zh)}）</option>`).join('')}
          </select>
          <input type="file" id="ca-file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" required>
          <button type="submit" class="btn btn-sm btn-primary">绑定保存</button>
        </form>

        <details style="margin-top:16px">
          <summary style="cursor:pointer;font-weight:700" class="muted">📜 查看内置开源真人录音来源与 CC 授权署名（${attributionEntries.length} 项）</summary>
          <ul class="muted" style="font-size:13px;max-height:220px;overflow-y:auto;margin-top:8px">
            ${attributionEntries.map(([word, info]) => `
              <li>
                <b class="english">${esc(word)}</b> — ${esc(info.author)} ·
                ${info.licenseUrl ? `<a href="${esc(info.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(info.license)}</a>` : esc(info.license)}
                · <a href="${esc(info.page)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>
              </li>
            `).join('')}
          </ul>
        </details>
      </section>
    `;
  }

  // ==================== Event Binding & Actions ====================
  function bindEvents() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.onclick = () => {
        SnapAudio.stop();
        currentTab = btn.dataset.nav;
        render();
      };
    });

    document.querySelectorAll('[data-goto-tab]').forEach(btn => {
      btn.onclick = () => {
        activeSession = null;
        currentTab = btn.dataset.gotoTab;
        render();
      };
    });

    const actorBtn = $('#actor-toggle');
    if (actorBtn) {
      actorBtn.onclick = async () => {
        state.actorMode = state.actorMode === 'student' ? 'parent_demo' : 'student';
        await saveState();
        render();
        toast(state.actorMode === 'parent_demo' ? '已切至「家长演练模式」：点击测试不会计入孩子成绩' : '已切回「学生正式学习模式」');
      };
    }

    $('#pack-select')?.addEventListener('change', async e => {
      state.selectedPackId = e.target.value;
      await saveState();
      render();
    });

    document.querySelectorAll('[data-start-mode]').forEach(btn => {
      btn.onclick = () => startSession(btn.dataset.startMode);
    });

    document.querySelector('[data-quick-baseline]')?.addEventListener('click', () => {
      startSession('baseline');
    });

    document.querySelectorAll('[data-exit-session]').forEach(btn => {
      btn.onclick = () => {
        SnapAudio.stop();
        activeSession = null;
        render();
      };
    });

    document.querySelectorAll('[data-jump-step]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        SnapAudio.stop();
        activeSession.step = btn.dataset.jumpStep;
        if (activeSession.step === 'snap' && !activeSession.snapState) initSnapCardState();
        render();
      };
    });

    document.querySelectorAll('[data-complete-step]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        activeSession.stepsDone[btn.dataset.completeStep] = true;
        activeSession.step = btn.dataset.nextStep;
        if (activeSession.step === 'snap' && !activeSession.snapState) initSnapCardState();
        render();
      };
    });

    document.querySelectorAll('[data-speak-item]').forEach(btn => {
      btn.onclick = () => {
        const it = itemById(btn.dataset.speakItem);
        if (it) SnapAudio.play(state, it, toast);
      };
    });

    document.querySelectorAll('[data-speak-raw]').forEach(btn => {
      btn.onclick = () => SnapAudio.play(state, btn.dataset.speakRaw, toast);
    });

    // Slot Machine & Blackboard controls
    $('#slot-deck-select')?.addEventListener('change', e => {
      slotUI.deckIndex = Number(e.target.value) || 0;
      slotUI.subj = 0; slotUI.adv = 0; slotUI.act = 0;
      slotUI.customEn = '';
      render();
    });

    document.querySelectorAll('[data-reel]').forEach(sel => {
      sel.onchange = () => {
        slotUI[sel.dataset.reel] = Number(sel.value) || 0;
        slotUI.customEn = '';
        render();
      };
    });

    document.querySelector('[data-act="spin-slot"]')?.addEventListener('click', () => {
      const deck = SNAPWORD_CURRICULUM.SLOT_DECKS[slotUI.deckIndex];
      slotUI.subj = Math.floor(Math.random() * deck.subjects.length);
      slotUI.adv = Math.floor(Math.random() * deck.adverbs.length);
      slotUI.act = Math.floor(Math.random() * deck.actions.length);
      slotUI.customEn = '';
      render();
      const built = buildSlotSentence();
      SnapAudio.play(state, built.en, toast);
    });

    document.querySelector('[data-act="push-board"]')?.addEventListener('click', async () => {
      const en = $('#custom-board-en')?.value.trim() || '';
      if (!en) { toast('请先输入一句英文短句'); return; }
      slotUI.customEn = en;
      slotUI.customZh = $('#custom-board-zh')?.value.trim() || '爸爸刚刚聊到的口语真话';
      slotUI.customHl = $('#custom-board-hl')?.value.trim() || '';
      state.boardNotes.unshift({ id: SnapCore.uid('bn'), en: slotUI.customEn, zh: slotUI.customZh, highlight: slotUI.customHl, at: Date.now() });
      state.boardNotes = state.boardNotes.slice(0, 20);
      await saveState();
      render();
    });

    document.querySelector('[data-act="clear-board"]')?.addEventListener('click', () => {
      slotUI.customEn = ''; slotUI.customZh = ''; slotUI.customHl = '';
      render();
    });

    // Snap-Block Magnetic Tile actions
    document.querySelectorAll('[data-snap-key]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession?.snapState) return;
        const st = activeSession.snapState;
        const item = itemById(st.itemId);
        const pieces = item.snap?.pieces || [item.en];
        const tile = st.pool.find(t => t.key === btn.dataset.snapKey);
        if (!tile || st.usedKeys.includes(tile.key)) return;

        const expected = pieces[st.filled.length];
        if (!tile.isDecoy && tile.text === expected) {
          st.filled.push(tile.text);
          st.usedKeys.push(tile.key);
          st.bounceTip = '';
          st.wobbleKey = null;
          if (st.filled.length === pieces.length) {
            st.completedSnap = true;
            SnapCore.recordEvent(state, { itemId: item.id, taskType: 'scaffold_snap', outcome: 'done' });
            await saveState();
            SnapAudio.play(state, item, toast);
          }
          render();
        } else {
          st.wobbleKey = tile.key;
          st.bounceTip = tile.tip || `🤔 这一块好像不对哦，先听听发音或看一眼第 ${st.filled.length + 1} 块是什么！`;
          render();
        }
      };
    });

    document.querySelector('[data-act="undo-snap"]')?.addEventListener('click', () => {
      const st = activeSession?.snapState;
      if (!st || !st.filled.length || st.completedSnap) return;
      st.filled.pop();
      st.usedKeys.pop();
      render();
    });

    document.querySelector('[data-act="toggle-model-mask"]')?.addEventListener('click', () => {
      if (!activeSession?.snapState) return;
      activeSession.snapState.hideModel = !activeSession.snapState.hideModel;
      render();
    });

    document.querySelector('[data-act="open-cloze"]')?.addEventListener('click', () => {
      if (!activeSession?.snapState) return;
      activeSession.snapState.showCloze = true;
      render();
      $('#cloze-input')?.focus();
    });

    $('#cloze-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const st = activeSession?.snapState;
      if (!st) return;
      const item = itemById(st.itemId);
      const val = SnapCore.normText($('#cloze-input')?.value);
      const ans = SnapCore.normText(item.cloze.blank);
      if (val === ans || (!/[A-Z]/.test(ans) && val.toLowerCase() === ans.toLowerCase())) {
        st.clozeDone = true;
        st.clozeFeedback = '';
        SnapCore.recordEvent(state, { itemId: item.id, taskType: 'scaffold_cloze', outcome: 'done' });
        await saveState();
      } else {
        st.clozeFeedback = `差一点点！再核对一下这一截（共 ${ans.length} 个字符）`;
      }
      render();
    });

    const advanceSnapWord = () => {
      if (!activeSession) return;
      if (activeSession.snapIndex + 1 < activeSession.focusIds.length) {
        activeSession.snapIndex++;
        initSnapCardState();
      } else {
        activeSession.stepsDone.snap = true;
        activeSession.step = activeSession.mode === 'quick8' ? 'paper' : 'bug';
      }
      render();
    };

    document.querySelector('[data-act="next-word"]')?.addEventListener('click', advanceSnapWord);
    document.querySelector('[data-act="skip-to-next-word"]')?.addEventListener('click', advanceSnapWord);
    document.querySelector('[data-act="prev-word"]')?.addEventListener('click', () => {
      if (activeSession?.snapIndex > 0) {
        activeSession.snapIndex--;
        initSnapCardState();
        render();
      }
    });

    // Bug Hunter interactions
    document.querySelectorAll('[data-bug-idx]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        const idx = Number(btn.dataset.bugIdx);
        const card = SNAPWORD_CURRICULUM.BUG_CARDS.find(b => b.id === activeSession.bugCardId) || SNAPWORD_CURRICULUM.BUG_CARDS[0];
        const tok = card.tokens[idx];
        if (!tok || activeSession.bugFixed[idx]) return;
        if (!tok.isBug) {
          toast(`「${tok.text}」拼写完全正确，没有藏臭虫哦！再找找别的词～`);
          return;
        }
        activeSession.bugPickingIdx = idx;
        render();
      };
    });

    document.querySelectorAll('[data-bug-fix]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession || activeSession.bugPickingIdx == null) return;
        const idx = activeSession.bugPickingIdx;
        const card = SNAPWORD_CURRICULUM.BUG_CARDS.find(b => b.id === activeSession.bugCardId) || SNAPWORD_CURRICULUM.BUG_CARDS[0];
        const tok = card.tokens[idx];
        if (btn.dataset.bugFix === tok.fix) {
          activeSession.bugFixed[idx] = true;
          activeSession.bugPickingIdx = null;
          toast('🐛💥 啪！臭虫拍扁啦：' + tok.tip);
          render();
        } else {
          toast('🧐 这个还是原来的错词哦，选另一个正确的！');
        }
      };
    });

    // Two-Pass Paper Station interactions
    document.querySelectorAll('[data-paper-phase]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        activeSession.paperPhase = btn.dataset.paperPhase;
        render();
      };
    });

    document.querySelectorAll('[data-blind-box]').forEach(box => {
      box.onchange = () => {
        if (!activeSession) return;
        activeSession.blindChecks[box.dataset.blindBox] = box.checked;
        render();
      };
    });

    document.querySelectorAll('[data-mask-ans]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        const id = btn.dataset.maskAns;
        activeSession.maskedAnswers[id] = !activeSession.maskedAnswers[id];
        render();
      };
    });

    document.querySelectorAll('[data-grade-item]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        const id = btn.dataset.gradeItem;
        const prev = activeSession.paperGrades[id] || { tags: [] };
        activeSession.paperGrades[id] = { outcome: btn.dataset.outcome, tags: prev.tags || [] };
        render();
      };
    });

    document.querySelectorAll('[data-toggle-err]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        const id = btn.dataset.toggleErr;
        const tag = btn.dataset.tag;
        const g = activeSession.paperGrades[id] || { outcome: 'answer_corrected', tags: [] };
        g.tags = g.tags.includes(tag) ? g.tags.filter(t => t !== tag) : [...g.tags, tag];
        activeSession.paperGrades[id] = g;
        render();
      };
    });

    $('#baseline-note')?.addEventListener('input', e => {
      if (activeSession) activeSession.sentenceNote = e.target.value;
    });

    document.querySelector('[data-act="finish-paper-session"]')?.addEventListener('click', async () => {
      if (!activeSession) return;
      const summary = { independent: [], selfFixed: [], needReview: [] };
      for (const id of activeSession.paperIds) {
        const g = activeSession.paperGrades[id] || { outcome: 'paper_independent', tags: [] };
        SnapCore.recordEvent(state, {
          itemId: id,
          taskType: 'paper_check',
          outcome: g.outcome,
          errorTags: g.tags,
          note: activeSession.sentenceNote || ''
        });
        if (g.outcome === 'paper_independent') summary.independent.push(id);
        if (g.outcome === 'blind_self_fixed') summary.selfFixed.push(id);
        if (['blind_self_fixed', 'answer_corrected', 'blank'].includes(g.outcome)) summary.needReview.push(id);
      }
      activeSession.summary = summary;
      activeSession.paperPhase = 'summary';
      await saveState();
      render();
    });

    // Vault & Class Requirement toggles
    document.querySelectorAll('[data-vault-filter]').forEach(btn => {
      btn.onclick = () => { vaultFilter = btn.dataset.vaultFilter; render(); };
    });

    document.querySelectorAll('[data-class-req]').forEach(sel => {
      sel.onchange = async () => {
        const it = itemById(sel.dataset.classReq);
        if (it) {
          it.classRequirement = sel.value;
          await saveState();
          toast(`已更新「${it.en}」本班要求`);
        }
      };
    });

    // Ledger actions
    document.querySelectorAll('[data-verify-ev]').forEach(btn => {
      btn.onclick = async () => {
        SnapCore.resolvePendingVerify(state, btn.dataset.verifyEv, btn.dataset.verifyOut);
        await saveState();
        render();
        toast('照片核验结果已更新至徽章账本！');
      };
    });

    document.querySelector('[data-act="start-due-review"]')?.addEventListener('click', () => {
      const ids = SnapCore.getDueQueue(state, SnapCore.todayISO(), 3).todayPick.map(d => d.item.id);
      if (ids.length) startSession('quick8', ids);
    });

    document.querySelector('[data-act="export-json"]')?.addEventListener('click', () => {
      const dataStr = JSON.stringify(state, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SnapWord-词哒备份-${SnapCore.todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('JSON 备份已下载，请妥善保存');
    });

    document.querySelector('[data-act="trigger-import"]')?.addEventListener('click', () => {
      $('#import-file-input')?.click();
    });

    $('#import-file-input')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20MB 上限');
        const parsed = JSON.parse(await file.text());
        pendingImportPreview = SnapCore.inspectBackupJSON(parsed, state);
        render();
      } catch (err) {
        toast('无法解析备份：' + err.message);
      }
    });

    document.querySelector('[data-act="confirm-import-snapword"]')?.addEventListener('click', async () => {
      if (!pendingImportPreview) return;
      state = SnapCore.mergeSnapwordBackup(state, pendingImportPreview.payload, { includeDemo: false });
      pendingImportPreview = null;
      await saveState();
      render();
      toast('学生学习记录与词库已安全无损合入！');
    });

    document.querySelector('[data-act="confirm-import-legacy-words"]')?.addEventListener('click', async () => {
      if (!pendingImportPreview) return;
      state = SnapCore.importLegacyWordsOnly(state, pendingImportPreview.payload);
      pendingImportPreview = null;
      await saveState();
      render();
      toast('已提取旧版词条并隔离测试打字日志！');
    });

    document.querySelector('[data-act="cancel-import"]')?.addEventListener('click', () => {
      pendingImportPreview = null;
      render();
    });

    // Coach Prep actions
    $('#profile-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const nick = $('#prof-nickname')?.value.trim() || '小探索家';
      const budget = Math.min(35, Math.max(8, Number($('#prof-budget')?.value) || 18));
      state.profile.nickname = nick;
      state.profile.budgetMinutes = budget;
      await saveState();
      render();
      toast('设置已保存');
    });

    $('#quick-pack-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const title = $('#qp-title')?.value.trim();
        if (!title) throw new Error('请填写课程包标题');
        const pairs = SnapCore.parseQuickLessonLines($('#qp-lines')?.value);
        const ids = [];
        pairs.forEach((pair, i) => {
          const existing = state.items.find(it => SnapCore.normText(it.en).toLowerCase() === pair.en.toLowerCase());
          if (existing) {
            ids.push(existing.id);
          } else {
            const created = SnapCore.suggestItemFromPair(pair.en, pair.zh, i);
            state.items.push(created);
            ids.push(created.id);
          }
        });
        const newPack = {
          id: SnapCore.uid('pack'),
          title,
          subtitle: `家长排课 · 共 ${ids.length} 项（${SnapCore.todayISO()}）`,
          modeHint: 'standard',
          itemIds: ids
        };
        state.packs.unshift(newPack);
        state.selectedPackId = newPack.id;
        await saveState();
        currentTab = 'learn';
        render();
        toast(`课程包「${title}」已生成并设为当前任务！`);
      } catch (err) {
        toast(err.message);
      }
    });

    $('#custom-audio-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const itemId = $('#ca-item')?.value;
        const file = $('#ca-file')?.files?.[0];
        const dataUri = await SnapAudio.validateAndEncodeAudioFile(file);
        const nextRecs = { ...state.recordings, [itemId]: dataUri };
        const totalSize = Object.values(nextRecs).reduce((acc, s) => acc + s.length, 0);
        if (totalSize > 4 * 1024 * 1024) throw new Error('自定义浏览器内嵌录音总容量已达上限（4MB），请导出清理旧录音');
        state.recordings = nextRecs;
        await saveState();
        render();
        toast('自定义录音绑定成功！');
      } catch (err) {
        toast(err.message);
      }
    });
  }

  // Boot
  (async () => {
    await initStorage();
    await saveState();
    render();
  })();
})();
