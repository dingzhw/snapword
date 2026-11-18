/* 词哒 · SnapWord Main Interactive Workbench Controller (v0.1.6)
 * Closes F01–F07, R01–R08, N01–N05, Q01–Q02, and Blind-Cloze Zero-Leak Separation.
 */
'use strict';

(() => {
  const DB_NAME = 'snapword_workbench_v1';
  const FALLBACK_KEY = 'snapword_workbench_fallback_v1';

  let state = null;
  let db = null;
  let storageKind = 'memory';
  let lastSaveOk = true;
  let currentTab = 'learn';
  let activeSession = null;
  let roleSwitchModalOpen = null; // null | { targetActor: 'student'|'parent_demo' }
  let dueNavGate = null; // { kind: 'step'|'tab', target: string }
  let pendingImportPreview = null;
  let importConflictPolicy = 'prefer_incoming';
  let importDraftPolicy = 'restore_incoming';
  let pendingVerifyDrafts = {}; // { [eventId]: { outcome, tags } }
  let highlightUnjudged = false;
  let submitLock = false;
  let saveChain = Promise.resolve({ ok: true });

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
    toast._t = setTimeout(() => { el.hidden = true; }, 4500);
  }

  function setSaveIndicator(text, warn = false) {
    const el = $('#save-indicator');
    if (!el) return;
    el.textContent = text;
    el.style.color = warn ? '#d97706' : '#059669';
  }

  // ==================== Storage & Explicit 3-State Draft Lifecycle (R01) ====================
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
        state = SnapCore.restoreLocalState(SNAPWORD_CURRICULUM, saved);
      } else {
        const raw = localStorage.getItem(FALLBACK_KEY);
        state = raw
          ? SnapCore.restoreLocalState(SNAPWORD_CURRICULUM, JSON.parse(raw))
          : SnapCore.freshState(SNAPWORD_CURRICULUM);
      }
      lastSaveOk = true;
    } catch {
      if (db) { try { db.close(); } catch {} db = null; }
      try {
        const raw = localStorage.getItem(FALLBACK_KEY);
        state = raw
          ? SnapCore.restoreLocalState(SNAPWORD_CURRICULUM, JSON.parse(raw))
          : SnapCore.freshState(SNAPWORD_CURRICULUM);
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
        storageKind = 'local';
        lastSaveOk = true;
      } catch {
        state = SnapCore.freshState(SNAPWORD_CURRICULUM);
        storageKind = 'memory';
        lastSaveOk = false;
      }
    }

    // R01: Auto-resume ONLY 'in_progress' drafts on accidental reload;
    // keep 'suspended' drafts intact on Lobby so user can resume at any time!
    if (state.activeDraft && state.activeDraft.lockedActor === state.actorMode) {
      if (state.activeDraft.draftStatus === 'in_progress') {
        activeSession = SnapCore.clone(state.activeDraft);
        currentTab = 'learn';
      }
    }
  }

  function setActorDraft(actor, draftObj) {
    if (!state) return;
    state.drafts = state.drafts || { student: null, parent_demo: null };
    const clean = draftObj ? SnapCore.clone(draftObj) : null;
    state.drafts[actor] = clean;
    if (actor === state.actorMode) {
      state.activeDraft = clean;
    }
  }

  function syncActiveDraftFromActor() {
    if (!state) return;
    state.drafts = state.drafts || { student: null, parent_demo: null };
    state.activeDraft = state.drafts[state.actorMode] ? SnapCore.clone(state.drafts[state.actorMode]) : null;
  }

  function persistInProgressDraft() {
    if (!state || !activeSession) return;
    if (activeSession.paperPhase === 'summary' || activeSession.oralPhase === 'summary') return;
    const snap = SnapCore.clone(activeSession);
    snap.draftStatus = 'in_progress';
    snap.savedAt = Date.now();
    setActorDraft(snap.lockedActor || state.actorMode, snap);
  }

  // R01: saveState NEVER implicitly wipes state.activeDraft or state.drafts!
  function saveState() {
    if (activeSession && activeSession.paperPhase !== 'summary' && activeSession.oralPhase !== 'summary') {
      persistInProgressDraft();
    }
    const snapshot = SnapCore.clone(state);
    saveChain = saveChain.catch(() => ({ ok: false })).then(async () => {
      const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      try {
        if (typeof window !== 'undefined' && window.__SNAPWORD_FORCE_STORAGE_FAIL) {
          throw new Error('Simulated storage failure');
        }
        if (storageKind === 'idb' && db) {
          await new Promise((resolve, reject) => {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(snapshot, 'main');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
          lastSaveOk = true;
          setSaveIndicator(`● 本机已保存 · ${timeStr}`);
          return { ok: true, backend: 'idb' };
        }
        if (storageKind === 'local') {
          localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
          lastSaveOk = true;
          setSaveIndicator(`● 浏览器已保存 · ${timeStr}`);
          return { ok: true, backend: 'local' };
        }
        lastSaveOk = false;
        setSaveIndicator('⚠ 临时内存模式（关闭前请导出备份）', true);
        return { ok: false, backend: 'memory' };
      } catch (err) {
        lastSaveOk = false;
        setSaveIndicator('⚠ 存储受阻 · 请立即导出备份', true);
        return { ok: false, backend: 'error', error: String(err?.message || err) };
      }
    });
    return saveChain;
  }

  async function suspendSessionToDraft() {
    if (!activeSession) return;
    SnapAudio.stop();
    const suspended = SnapCore.clone(activeSession);
    suspended.draftStatus = 'suspended';
    suspended.savedAt = Date.now();
    const actor = suspended.lockedActor || state.actorMode;
    activeSession = null;
    setActorDraft(actor, suspended);
    const res = await saveState();
    render();
    if (res.ok) {
      toast('进度已暂存为草稿，刷新或重开后均可随时继续');
    } else {
      toast('⚠ 本机存储受阻，草稿仅暂留当前内存，请及时导出 JSON 备份');
    }
  }

  function itemById(id) {
    return state.items.find(x => x.id === id);
  }

  function selectedPack() {
    return state.packs.find(p => p.id === state.selectedPackId) || state.packs[0];
  }

  function effectiveSessionActor() {
    return activeSession?.lockedActor || state.actorMode || 'student';
  }

  function syncTopBar() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === currentTab);
    });
    const actorBtn = $('#actor-toggle');
    const banner = $('#demo-banner');
    const currentActor = effectiveSessionActor();
    const isDemo = currentActor === 'parent_demo';
    if (actorBtn) {
      actorBtn.className = 'actor-pill ' + (isDemo ? 'demo' : 'student');
      const lockMark = activeSession ? ' 🔒' : '';
      actorBtn.textContent = (isDemo ? '🛠️ 家长演练试用中' : '🎒 学生正式学习') + lockMark;
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

  function badgeLabel(mOrBadge) {
    const m = typeof mOrBadge === 'object' && mOrBadge ? mOrBadge : { badge: mOrBadge || 'none' };
    const badge = m.badge || 'none';
    const slip = m.recentSlip ? ' <span style="color:#dc2626;font-weight:800">⚠️最近失手·需复测</span>' : '';
    const stab = m.stabilized && !m.needsReview ? ' · 暂稳定' : '';
    if (badge === 'gold') return `<span class="pill" style="background:#fef08a;color:#854d0e">🥇 金章${stab}</span>${slip}`;
    if (badge === 'silver') return `<span class="pill" style="background:#e2e8f0;color:#334155">🥈 银章·纸写首通</span>${slip}`;
    if (badge === 'bronze') return `<span class="pill" style="background:#ffedd5;color:#9a3412">🥉 铜章·已练习</span>${slip}`;
    return '<span class="pill">⚪ 待点亮</span>';
  }

  // ==================== Per-Item Administration Snapshot (R07) ====================
  function ensureItemContext(s, itemId, opts = {}) {
    s.itemContexts = s.itemContexts || {};
    const existing = s.itemContexts[itemId];
    if (existing && (existing.locked || opts.preserveExisting)) {
      return existing;
    }

    const it = itemById(itemId);
    if (!it) return null;

    const mode = opts.promptMode ?? existing?.promptMode ?? s.promptMode ?? 'audio_plus_zh';
    const variantKey = opts.variantKey !== undefined ? opts.variantKey : (existing?.variantKey ?? null);
    const resolved = SnapCore.getTargetAnswers(it, {
      promptMode: mode,
      variantKey,
      allowAmericanSpelling: state.classSettings?.allowAmericanSpelling
    });

    // R07: Keep original administration date if item already had a context in a cross-day resumed draft!
    const now = Date.now();
    const testedAt = existing?.testedAt ?? now;
    const testedDateStr = existing?.testedDateStr ?? SnapCore.todayISO(testedAt);

    const ctx = {
      itemId,
      testedAt,
      testedDateStr,
      promptMode: resolved.promptMode,
      variantKey: resolved.variantKey,
      promptZh: resolved.promptZh,
      sentenceTemplate: resolved.sentenceTemplate,
      primary: resolved.primary,
      accepted: resolved.accepted,
      spokenText: resolved.spokenText,
      displayChunks: resolved.displayChunks,
      locked: Boolean(opts.lock || existing?.locked)
    };
    s.itemContexts[itemId] = ctx;
    return ctx;
  }

  function refreshUnlockedContexts(s, targetIds) {
    for (const id of targetIds) {
      if (!s.itemContexts?.[id]?.locked) {
        // Update promptMode while preserving original testedDateStr if already initialized
        const prev = s.itemContexts?.[id];
        const it = itemById(id);
        if (!it) continue;
        const resolved = SnapCore.getTargetAnswers(it, {
          promptMode: s.promptMode,
          variantKey: prev?.variantKey ?? null,
          allowAmericanSpelling: state.classSettings?.allowAmericanSpelling
        });
        const now = Date.now();
        s.itemContexts[id] = {
          itemId: id,
          testedAt: prev?.testedAt ?? now,
          testedDateStr: prev?.testedDateStr ?? SnapCore.todayISO(now),
          promptMode: resolved.promptMode,
          variantKey: resolved.variantKey,
          promptZh: resolved.promptZh,
          sentenceTemplate: resolved.sentenceTemplate,
          primary: resolved.primary,
          accepted: resolved.accepted,
          spokenText: resolved.spokenText,
          displayChunks: resolved.displayChunks,
          locked: false
        };
      }
    }
  }

  function lockItemsContext(s, ids) {
    ids.forEach((id, idx) => {
      const ctx = ensureItemContext(s, id);
      if (ctx) {
        ctx.locked = true;
        // Also initialize default paperRef anchored to ctx.testedDateStr if not set
        const qNo = s.paperIds.indexOf(id) >= 0 ? s.paperIds.indexOf(id) + 1 : idx + 1;
        if (!s.paperGrades[id]) {
          s.paperGrades[id] = {
            outcome: 'unjudged',
            tags: [],
            paperRef: `${ctx.testedDateStr} #${qNo}`,
            testedDateStr: ctx.testedDateStr,
            testedAt: ctx.testedAt
          };
        }
      }
    });
  }

  // ==================== Session Creation & Lifecycle (R02, R05, R07, N02) ====================
  async function startSession(mode = 'standard', explicitDueIds = null, sessionOpts = {}) {
    SnapAudio.stop();
    highlightUnjudged = false;
    dueNavGate = null;
    const lockedActor = state.actorMode;
    const sessionId = SnapCore.uid('sess');
    const pack = selectedPack();
    const exposedSet = new Set(sessionOpts.exposedIds || []);

    if (mode === 'due_only') {
      const duePick = explicitDueIds && explicitDueIds.length
        ? explicitDueIds
        : SnapCore.getDueQueue(state, SnapCore.todayISO(), 3).todayPick.map(d => d.item.id);
      if (!duePick.length) {
        toast('当前没有到期抽查词');
        return;
      }
      const hintedOnPaper = {};
      const lockedHint = {};
      const exposureSources = {};
      for (const id of duePick) {
        if (exposedSet.has(id)) {
          hintedOnPaper[id] = true;
          lockedHint[id] = true;
          exposureSources[id] = 'retest_after_answer_revealed';
        }
      }
      activeSession = {
        sessionId,
        lockedActor,
        mode: 'due_only',
        packId: pack.id,
        packTitle: sessionOpts.packTitle || '课前到期独立复测',
        startedAt: Date.now(),
        step: 'paper',
        stepsDone: {},
        dueIds: [...duePick],
        duePrewritten: false,
        focusIds: [],
        oralOnlyIds: [],
        deferredIds: [],
        paperIds: [...duePick],
        promptMode: 'audio_plus_zh',
        itemContexts: {},
        hintedOnPaper,
        showChunkHint: {},
        answerRevealed: {},
        lockedHint,
        exposureSources,
        paperPhase: 'dictate',
        oralPhase: 'active',
        oralChecked: {},
        blindChecks: { cap: false, space: false, chunk: false },
        maskedAnswers: {},
        paperGrades: {},
        archivedSiblings: sessionOpts.archivedSiblings || null,
        summary: null
      };
      duePick.forEach(id => ensureItemContext(activeSession, id));
      currentTab = 'learn';
      render();
      await saveState();
      return;
    }

    if (mode === 'baseline' || pack.modeHint === 'baseline') {
      const basePack = state.packs.find(p => p.id === 'pack-baseline') || pack;
      activeSession = {
        sessionId,
        lockedActor,
        mode: 'baseline',
        packId: basePack.id,
        packTitle: basePack.title,
        startedAt: Date.now(),
        step: 'paper',
        stepsDone: {},
        dueIds: [],
        duePrewritten: true,
        focusIds: [],
        oralOnlyIds: [],
        deferredIds: [],
        paperIds: [...basePack.itemIds],
        extraSentence: basePack.extraSentence || null,
        altCheckWords: basePack.altCheckWords || [],
        promptMode: 'audio_plus_zh',
        itemContexts: {},
        hintedOnPaper: {},
        showChunkHint: {},
        answerRevealed: {},
        lockedHint: {},
        exposureSources: {},
        paperPhase: 'dictate',
        oralPhase: 'active',
        oralChecked: {},
        blindChecks: { cap: false, space: false, chunk: false },
        maskedAnswers: {},
        paperGrades: {},
        sentenceNote: '',
        summary: null
      };
      basePack.itemIds.forEach(id => ensureItemContext(activeSession, id));
      currentTab = 'learn';
      render();
      await saveState();
      return;
    }

    // Standard / Quick8: R02 strict adherence to allocation preview (NO fallback to slice(0,3)!)
    const dueLimit = 2;
    const dueIds = SnapCore.getDueQueue(state, SnapCore.todayISO(), dueLimit).todayPick.map(d => d.item.id);
    const baseCap = (pack.paperCap || 5) + (pack.preserveFullPack ? dueIds.length : 0);
    const totalPaperCap = mode === 'quick8' ? Math.min(baseCap, 3 + (pack.preserveFullPack ? dueIds.length : 0)) : baseCap;
    const alloc = SnapCore.planPackAllocation(state, pack.id, pack.itemIds, { totalPaperCap, dueIds });

    if (pack.slotDeckId) {
      const deckIdx = SNAPWORD_CURRICULUM.SLOT_DECKS.findIndex(d => d.id === pack.slotDeckId);
      if (deckIdx >= 0) {
        slotUI.deckIndex = deckIdx;
        slotUI.subj = 0; slotUI.adv = 0; slotUI.act = 0; slotUI.customEn = '';
      }
    }

    if (!alloc.hasAnyActiveTask && !pack.preread) {
      toast('当前课程包全部词条均被设为「下轮候选」，请先在预览中至少选 1 项为「本轮纸写」或「仅听读认义」再开课！');
      return;
    }

    const focusIds = [...alloc.paperNowIds, ...alloc.oralOnlyIds];
    const paperIds = [...alloc.combinedPaperIds]; // R02: May legitimately be [] for pure oral/preread lessons!
    const bugCard = SNAPWORD_CURRICULUM.BUG_CARDS.find(b => b.id === pack.bugId) || SNAPWORD_CURRICULUM.BUG_CARDS[0];

    let initialStep = 'board';
    if (dueIds.length > 0) {
      initialStep = 'due_precheck';
    } else if (mode === 'quick8') {
      initialStep = focusIds.length ? 'snap' : (paperIds.length ? 'paper' : 'oral_wrapup');
    }

    activeSession = {
      sessionId,
      lockedActor,
      mode,
      packId: pack.id,
      packTitle: pack.title,
      preread: pack.preread || null,
      prereadDone: false,
      prereadNote: '',
      startedAt: Date.now(),
      step: initialStep, // 'due_precheck' | 'board' | 'snap' | 'bug' | 'paper' | 'oral_wrapup'
      stepsDone: {},
      dueIds,
      duePrewritten: dueIds.length === 0,
      paperNowIds: alloc.paperNowIds,
      oralOnlyIds: alloc.oralOnlyIds,
      deferredIds: alloc.deferredIds,
      focusIds,
      snapIndex: 0,
      snapState: null,
      bugCardId: bugCard.id,
      bugFixed: {},
      bugPickingIdx: null,
      paperIds,
      promptMode: 'audio_plus_zh',
      itemContexts: {},
      hintedOnPaper: {},
      lockedHint: {},
      exposureSources: {},
      paperPhase: 'dictate',
      oralPhase: 'active',
      oralChecked: {},
      blindChecks: { cap: false, space: false, chunk: false },
      maskedAnswers: {},
      paperGrades: {},
      summary: null
    };

    // Initialize context snapshots for due items right away; new paper items initialize when entering paper step
    dueIds.forEach(id => ensureItemContext(activeSession, id));
    initSnapCardState();
    currentTab = 'learn';
    render();
    await saveState();
  }

  function initSnapCardState() {
    if (!activeSession || !activeSession.focusIds?.length) return;
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
      inClozeMode: false,
      clozeDraft: '',
      clozeTries: 0,
      clozeDone: false,
      clozeFeedback: ''
    };
  }

  function elapsedMinutes() {
    if (!activeSession) return 0;
    return Math.floor((Date.now() - activeSession.startedAt) / 60000);
  }

  function hasMeaningfulProgress(s) {
    if (!s) return false;
    const graded = Object.values(s.paperGrades || {}).some(g => g?.outcome && g.outcome !== 'unjudged');
    const oralDone = Object.values(s.oralChecked || {}).some(Boolean);
    return graded || oralDone || Boolean(s.duePrewritten && s.dueIds?.length);
  }

  // R05: Mark uncollected due items as exposed to word-form hints when user bypasses due_precheck
  function markUnwrittenDueExposed(s, source = 'pre_answer_navigation') {
    if (!s || s.duePrewritten) return;
    s.hintedOnPaper = s.hintedOnPaper || {};
    s.lockedHint = s.lockedHint || {};
    s.exposureSources = s.exposureSources || {};
    for (const id of (s.dueIds || [])) {
      s.hintedOnPaper[id] = true;
      s.lockedHint[id] = true;
      s.exposureSources[id] = source;
      ensureItemContext(s, id, { lock: true });
    }
    s.duePrewritten = true;
  }

  // ==================== Rendering ====================
  function render() {
    syncTopBar();
    const views = {
      learn: renderLearnTab,
      vault: renderVaultTab,
      ledger: renderLedgerTab,
      prep: renderPrepTab
    };
    const modals = [
      roleSwitchModalOpen ? renderRoleSwitchModal() : '',
      dueNavGate ? renderDueNavGateModal() : ''
    ].join('');
    $('#app-main').innerHTML = (views[currentTab] || renderLearnTab)() + modals;
    bindEvents();
  }

  // N01: Unified actor-switching flow across topbar & ledger (suspends or ends active lesson first)
  async function requestActorSwitch(explicitTarget = null) {
    const curActor = effectiveSessionActor();
    const targetActor = explicitTarget || (curActor === 'student' ? 'parent_demo' : 'student');
    if (curActor === targetActor && (!activeSession || activeSession.lockedActor === targetActor)) {
      return;
    }
    if (activeSession && activeSession.paperPhase !== 'summary' && activeSession.oralPhase !== 'summary') {
      roleSwitchModalOpen = { targetActor };
      render();
      return;
    }
    if (activeSession) {
      setActorDraft(activeSession.lockedActor || state.actorMode, null);
      activeSession = null;
    }
    state.actorMode = targetActor;
    syncActiveDraftFromActor();
    pendingVerifyDrafts = {};
    render();
    await saveState();
    toast(targetActor === 'parent_demo' ? '已切至「家长演练模式」' : '已切回「学生正式学习模式」');
  }

  function renderRoleSwitchModal() {
    const curLabel = effectiveSessionActor() === 'parent_demo' ? '🛠️ 家长演练试用' : '🎒 学生正式学习';
    const targetActor = roleSwitchModalOpen?.targetActor || (effectiveSessionActor() === 'parent_demo' ? 'student' : 'parent_demo');
    const nextLabel = targetActor === 'parent_demo' ? '🛠️ 家长演练试用' : '🎒 学生正式学习';
    return `
      <div class="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="切换身份确认">
        <div class="modal-card">
          <h3 style="margin-top:0">🔒 当前课程已锁定身份：${curLabel}</h3>
          <p class="muted">为保证页面演练标识、当前会话与正式账本完全一致，切换至<strong>「${nextLabel}」</strong>前，请先选择如何处理当前未完结的课：</p>
          <div style="display:grid;gap:10px;margin-top:16px">
            <button type="button" class="btn btn-mint btn-sm" data-role-modal="suspend_switch">⏸️ 暂存当前课草稿，并切换至「${nextLabel}」</button>
            <button type="button" class="btn btn-primary btn-sm" data-role-modal="discard_switch">🗑️ 结束放弃当前课，并切换至「${nextLabel}」</button>
            <button type="button" class="btn btn-sm" data-role-modal="cancel">取消（继续当前课）</button>
          </div>
        </div>
      </div>
    `;
  }

  // R05: Explicit protection gate when leaving due_precheck before confirming paper first-attempt
  function renderDueNavGateModal() {
    return `
      <div class="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="课前抽查防泄题确认">
        <div class="modal-card">
          <h3 style="margin-top:0">🔒 课前到期词尚未确认写完纸面首答</h3>
          <p class="muted">直接前往黑板、拆词、抓虫或词库页面会提前展示英文拼写。请确认当前纸面情况：</p>
          <div style="display:grid;gap:10px;margin-top:14px">
            <button type="button" class="btn btn-mint btn-sm" data-due-gate="confirm_written">
              ✅ 孩子已在纸上写完到期词首答，锁存后前往
            </button>
            <button type="button" class="btn btn-amber btn-sm" data-due-gate="mark_exposed">
              💡 尚未写完，将到期词标为「已接触词形提示」再前往（本次不作无提示独立计分）
            </button>
            <button type="button" class="btn btn-sm" data-due-gate="stay">
              ← 取消，留在课前抽查页先写首答
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ==================== Tab 1: Lobby & Allocation Preview ====================
  function renderLearnTab() {
    if (activeSession) return renderActiveSession();

    const summary = SnapCore.getStatsSummary(state, 'student');
    const dueInfo = SnapCore.getDueQueue(state, SnapCore.todayISO(), 3);
    const pack = selectedPack();
    const dueIds = dueInfo.todayPick.slice(0, 2).map(d => d.item.id);
    const previewCap = (pack.paperCap || 5) + (pack.preserveFullPack ? dueIds.length : 0);
    const alloc = SnapCore.planPackAllocation(state, pack.id, pack.itemIds, { totalPaperCap: previewCap, dueIds });
    const hasDraft = Boolean(state.activeDraft && state.activeDraft.lockedActor === state.actorMode);
    const canStartPack = pack.modeHint === 'baseline' || alloc.hasAnyActiveTask || Boolean(pack.preread);

    return `
      <div class="badge-strip">
        <div class="stat-tile">
          <span class="medal-icon medal-gold">🥇</span>
          <div>
            <div class="stat-num">${summary.gold}</div>
            <div class="stat-label">金章（跨日焊牢${summary.goldSlip ? ` · ${summary.goldSlip}失手待测` : ''}）</div>
          </div>
        </div>
        <div class="stat-tile">
          <span class="medal-icon medal-silver">🥈</span>
          <div><div class="stat-num">${summary.silver}</div><div class="stat-label">银章（首次纸写全对）</div></div>
        </div>
        <div class="stat-tile">
          <span class="medal-icon medal-bronze">🥉</span>
          <div><div class="stat-num">${summary.bronze}</div><div class="stat-label">铜章（完成拆拼/订正）</div></div>
        </div>
        <div class="stat-tile">
          <span class="medal-icon medal-due">📅</span>
          <div><div class="stat-num">${dueInfo.totalDue}</div><div class="stat-label">到期与待复测词</div></div>
        </div>
      </div>

      ${hasDraft ? `
        <div class="card" style="background:#fef3c7;border-color:#f59e0b" id="draft-resume-card">
          <div class="row between">
            <div>
              <strong>🔄 发现未完课草稿：</strong>${esc(state.activeDraft.packTitle || '进行中的练习')}
              <span class="muted">（已记录 ${Object.values(state.activeDraft.paperGrades || {}).filter(g => g?.outcome && g.outcome !== 'unjudged').length} 项纸写判分）</span>
            </div>
            <div class="row">
              <button type="button" class="btn btn-sm btn-primary" data-act="resume-draft">继续完成草稿 →</button>
              <button type="button" class="btn btn-sm" data-act="discard-draft">丢弃草稿</button>
            </div>
          </div>
        </div>
      ` : ''}

      ${state.actorMode === 'student' && summary.pendingVerifyCount ? `
        <div class="card" style="background:#eff6ff;border-color:#93c5fd">
          <div class="row between">
            <div><strong>📸 有 ${summary.pendingVerifyCount} 道纸笔默写题等待爸爸看微信照片核验（核验后计入正式统计）</strong></div>
            <button type="button" class="btn btn-sm btn-primary" data-goto-tab="ledger">去核验结果 →</button>
          </div>
        </div>
      ` : ''}

      <section class="card">
        <span class="pill pill-core">嗨，${esc(state.profile.nickname)}！当前身份：${state.actorMode === 'parent_demo' ? '🛠️ 家长演练试用' : '🎒 学生正式学习'}</span>
        <h1 style="margin:8px 0 4px;font-size:27px">今天花 15 分钟，稳稳落纸拿徽章 ✨</h1>
        <p class="muted" style="margin:0">若有到期旧词先独立纸写抽查 → 摇句开口读 → 按需拆词/抓臭虫 → 纸本默写与两遍红笔自查（纯认读课可直接认读收工）。</p>

        <div style="background:var(--surface-soft);padding:16px;border-radius:14px;margin:16px 0">
          <label for="pack-select" style="font-weight:800;display:block;margin-bottom:8px">📚 选择课程包：</label>
          <select id="pack-select" style="width:100%;max-width:580px;font-weight:700">
            ${state.packs.map(p => `<option value="${esc(p.id)}" ${p.id === pack.id ? 'selected' : ''}>${esc(p.title)}（共 ${p.itemIds.length} 项）</option>`).join('')}
          </select>
          <div class="row" style="gap:6px;margin-top:8px">
            <span class="muted" style="font-size:12.5px;font-weight:700">📌 重点句快捷入口：</span>
            <button type="button" class="btn btn-sm ${pack.id === 'pack-u5-sent-all' ? 'btn-primary' : ''}" data-select-pack="pack-u5-sent-all">📝 U5重点句全通关 (01–06)</button>
            <button type="button" class="btn btn-sm ${pack.id === 'pack-u5-sent-a' ? 'btn-primary' : ''}" data-select-pack="pack-u5-sent-a">上半场 (01–03)</button>
            <button type="button" class="btn btn-sm ${pack.id === 'pack-u5-sent-b' ? 'btn-primary' : ''}" data-select-pack="pack-u5-sent-b">下半场 (04–06)</button>
          </div>
          <p class="muted" style="margin:8px 0 0">${esc(pack.subtitle || '')}</p>

          ${pack.modeHint !== 'baseline' ? renderAllocationPreview(pack, alloc, dueInfo.todayPick.slice(0, 2)) : ''}
        </div>

        ${!canStartPack ? `
          <div class="help-callout" style="margin-bottom:14px">
            ⚠️ 当前课程包所有词条均被设为「📥 留作下轮候选」，没有本轮纸写或听读任务。请先在上方预览将至少 1 项调为「✍️ 本轮纸写」或「🗣️ 仅听读认义」再开课。
          </div>
        ` : ''}

        <div class="row">
          ${pack.modeHint === 'baseline' ? `
            <button type="button" class="btn btn-primary" data-start-mode="baseline">📏 开始 10 分钟纸笔基线短测 →</button>
          ` : `
            <button type="button" class="btn btn-primary" data-start-mode="standard" ${canStartPack ? '' : 'disabled'}>🚀 开始今日闯关（标准 15–18 分钟）→</button>
            <button type="button" class="btn btn-amber" data-start-mode="quick8" ${canStartPack ? '' : 'disabled'}>⚡ 作业多·8 分钟保底版</button>
          `}
          ${dueInfo.todayPick.length ? `
            <button type="button" class="btn btn-mint" data-start-mode="due_only">📅 仅抽查到期词（${dueInfo.todayPick.length}项独立纸写）</button>
          ` : ''}
          <button type="button" class="btn" data-quick-baseline="1">📏 首次纸笔基线短测</button>
        </div>
      </section>
    `;
  }

  function renderAllocationPreview(pack, alloc, dueList) {
    const overrides = state.packOverrides?.[pack.id] || {};
    const renderRow = (id, currentBucket) => {
      const it = itemById(id);
      if (!it) return '';
      const eff = SnapCore.defaultActivityForItem(it, overrides[id]);
      const reqLabel = it.classRequirement === 'dictation_verified' ? '必默'
        : it.classRequirement === 'read_meaning_use' ? '先认义' : '家庭试排';
      return `
        <div class="alloc-item">
          <div>
            <strong>${esc(it.zh)}</strong>
            <span class="pill" style="font-size:11px">${reqLabel}${it.textbookCore === false && it.sourceScope === 'textbook_wordlist' ? '·*' : ''}</span>
          </div>
          <select data-pack-item-act="${esc(id)}" style="font-size:12.5px;padding:3px 6px">
            <option value="paper_dictation" ${eff === 'paper_dictation' && currentBucket !== 'deferred' ? 'selected' : ''}>✍️ 本轮纸写</option>
            <option value="oral_only" ${eff === 'oral_only' ? 'selected' : ''}>🗣️ 仅听读认义</option>
            <option value="next_candidate" ${eff === 'next_candidate' || currentBucket === 'deferred' ? 'selected' : ''}>📥 留作下轮候选</option>
          </select>
        </div>
      `;
    };

    return `
      <div style="margin-top:14px">
        <div class="muted" style="font-weight:700">📋 当晚实际出题预览（为防同屏泄题仅显中文；实际出题将严格遵守下表）：</div>
        ${dueList.length ? `
          <div class="bridge-callout" style="margin:8px 0">
            <strong>📅 课前优先独立纸写抽查（${dueList.length} 项）：</strong>
            ${dueList.map(d => `<span style="margin-right:12px"><b>${esc(d.item.zh)}</b>（${esc(d.reason)}）</span>`).join('')}
          </div>
        ` : ''}
        <div class="alloc-grid">
          <div class="alloc-col">
            <div style="font-weight:800;color:#1e40af;margin-bottom:6px">✍️ 本轮新排纸写（${alloc.paperNowIds.length} 项）</div>
            ${alloc.paperNowIds.map(id => renderRow(id, 'paper')).join('') || '<div class="muted">无新增纸写项</div>'}
          </div>
          <div class="alloc-col">
            <div style="font-weight:800;color:#047857;margin-bottom:6px">🗣️ 本轮仅听读认义（${alloc.oralOnlyIds.length} 项）</div>
            ${alloc.oralOnlyIds.map(id => renderRow(id, 'oral')).join('') || '<div class="muted">无单独认读项</div>'}
          </div>
          <div class="alloc-col">
            <div style="font-weight:800;color:#92400e;margin-bottom:6px">📥 超容量·下轮候选（${alloc.deferredIds.length} 项）</div>
            ${alloc.deferredIds.map(id => renderRow(id, 'deferred')).join('') || '<div class="muted">未超当晚容量</div>'}
          </div>
        </div>
      </div>
    `;
  }

  // ==================== Active Session Rendering ====================
  function renderActiveSession() {
    const s = activeSession;
    const mins = elapsedMinutes();
    const overBudget = mins >= (state.profile.budgetMinutes || 18);

    if (s.paperPhase === 'summary' || s.oralPhase === 'summary') {
      return renderSessionSummary(s);
    }

    if (s.mode === 'baseline') {
      return renderBaselineSession(s);
    }

    if (s.mode === 'due_only') {
      const sib = s.archivedSiblings;
      return `
        <div class="session-bar no-print">
          <div><strong>📅 课前到期词独立纸写抽查（共 ${s.paperIds.length} 项）</strong></div>
          <div class="row">
            <button type="button" class="btn btn-sm" data-act="pause-session">⏸️ 暂存草稿回大厅</button>
            <button type="button" class="btn btn-sm" data-act="abandon-session">放弃退出</button>
          </div>
        </div>
        ${sib && (sib.settledJudged?.length || sib.archivedUntested?.length) ? `
          <div class="bridge-callout no-print" id="archived-retest-banner" style="margin-bottom:14px">
            <strong>📌 原课其余题目的归档处理结果（已与本次新测独立分离）：</strong>
            ${sib.settledJudged?.length ? `
              <div style="margin-top:4px">✅ <b>已判题按原施测日与原首答结果原样入账</b>：${sib.settledJudged.map(x => `${esc(x.zh)}（<code>${esc(x.outcome)}</code> · ${esc(x.dateStr)}${x.hadSpellingHint ? ' · 含提示' : ''}）`).join('；')}</div>
            ` : ''}
            ${sib.archivedUntested?.length ? `
              <div style="margin-top:4px">⏭️ <b>其余未判题已明确归档为「未测 (untested)」</b>：${sib.archivedUntested.map(x => `${esc(x.zh)}（${esc(x.dateStr)}）`).join('、')}</div>
            ` : ''}
          </div>
        ` : ''}
        ${renderPaperStep(s)}
      `;
    }

    const hasPaperStep = s.paperIds.length > 0;
    const roleText = {
      due_precheck: '✍️ 主控建议：先遮住答案在纸本写完到期词首答（防后续看黑板泄题）',
      board: '🎙️ 主控建议：爸爸点黑板 / 父子一起摇句子开口读',
      snap: '🖱️ 主控建议：孩子握鼠标玩磁吸块（爸爸语音听读点拨）',
      bug: '🕵️ 主控建议：孩子点鼠标揪出句子里的拼写臭虫',
      paper: '✍️ 主控建议：纸本手写 + 红笔两遍自查 + 家长按纸面核验',
      oral_wrapup: '🗣️ 主控建议：核对今日纯听读认义与预读收工（本轮 0 纸写）'
    }[s.step] || '';

    return `
      <div class="session-bar no-print">
        <div class="step-pills" role="tablist" aria-label="闯关步骤">
          ${s.dueIds.length ? `
            <button type="button" class="step-pill ${s.step === 'due_precheck' ? 'active' : (s.duePrewritten ? 'done' : '')}" data-jump-step="due_precheck">0. 课前抽查 (${s.dueIds.length})</button>
          ` : ''}
          <button type="button" class="step-pill ${s.step === 'board' ? 'active' : (s.stepsDone.board ? 'done' : '')}" data-jump-step="board">1. 摇句与预读</button>
          ${s.focusIds.length ? `
            <button type="button" class="step-pill ${s.step === 'snap' ? 'active' : (s.stepsDone.snap ? 'done' : '')}" data-jump-step="snap">2. 咔嗒拆词 (${s.focusIds.length})</button>
          ` : ''}
          <button type="button" class="step-pill ${s.step === 'bug' ? 'active' : (s.stepsDone.bug ? 'done' : '')}" data-jump-step="bug">3. 抓臭虫</button>
          ${hasPaperStep ? `
            <button type="button" class="step-pill ${s.step === 'paper' ? 'active' : ''}" data-jump-step="paper">4. 纸写核验 (${s.paperIds.length})</button>
          ` : `
            <button type="button" class="step-pill ${s.step === 'oral_wrapup' ? 'active' : ''}" data-jump-step="oral_wrapup">4. 认读收工 (0纸写)</button>
          `}
        </div>
        <div class="row">
          <span class="role-indicator">${roleText}</span>
          <button type="button" class="btn btn-sm" data-act="pause-session">⏸️ 暂存草稿</button>
          <button type="button" class="btn btn-sm" data-act="abandon-session">退出</button>
        </div>
      </div>

      ${overBudget ? `
        <div class="bridge-callout no-print" style="margin-bottom:14px">
          ⏰ <strong>温和提醒：本次已满 ${mins} 分钟啦！</strong>可随时收工并将剩余未写项标为「未测」顺延下次。
        </div>
      ` : ''}

      ${s.step === 'due_precheck' ? renderDuePrecheckStep(s) : ''}
      ${s.step === 'board' ? renderBoardStep(s) : ''}
      ${s.step === 'snap' ? renderSnapStep(s) : ''}
      ${s.step === 'bug' ? renderBugStep(s) : ''}
      ${s.step === 'paper' ? renderPaperStep(s) : ''}
      ${s.step === 'oral_wrapup' ? renderOralWrapupStep(s) : ''}
    `;
  }

  // R02 + N04: Dedicated completion screen when paperIds.length === 0 (Explicit confirmation, starts unchecked!)
  function renderOralWrapupStep(s) {
    const oralItems = (s.oralOnlyIds || []).map(itemById).filter(Boolean);
    const checkedCount = oralItems.filter(it => Boolean(s.oralChecked?.[it.id])).length;
    const allChecked = oralItems.length > 0 && checkedCount === oralItems.length;
    return `
      <section class="card">
        <div class="row between">
          <div>
            <span class="pill pill-star">Step 4 · 纯听读认义收工（与预览一致：本轮纸写默写 0 项）</span>
            <h2 style="margin:8px 0 6px">🗣️ 请按实际表现勾选已听熟认义的词条（已确认 ${checkedCount} / ${oralItems.length} 项）</h2>
          </div>
          ${oralItems.length ? `
            <button type="button" class="btn btn-sm" data-act="check-all-oral">
              ${allChecked ? '取消全部勾选' : `✅ 已确认本组 ${oralItems.length} 项均完成`}
            </button>
          ` : ''}
        </div>
        <p class="muted" style="margin:0 0 14px">起始均保持未确认；请家长听孩子实际跟读与认义后逐项勾选（未确认项将如实保留为未确认，不自动发章）：</p>

        <div class="paper-list">
          ${oralItems.map((it, idx) => {
            const checked = Boolean(s.oralChecked?.[it.id]);
            return `
              <div class="paper-item row between">
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700">
                  <input type="checkbox" data-oral-check="${esc(it.id)}" ${checked ? 'checked' : ''} style="width:20px;height:20px">
                  <span>#${idx + 1} <b class="english">${esc(it.en)}</b> — ${esc(it.zh)}</span>
                </label>
                <button type="button" class="btn btn-sm" data-speak-item="${esc(it.id)}">🔊 再听一遍</button>
              </div>
            `;
          }).join('')}
        </div>

        <div class="row between" style="margin-top:18px">
          <button type="button" class="btn btn-sm" data-jump-step="board">← 返回黑板/预读</button>
          <button type="button" class="btn btn-mint" data-act="finish-oral-session">🎉 完成今日听读收工（已确认 ${checkedCount}/${oralItems.length} 项）→</button>
        </div>
      </section>
    `;
  }

  // Step 0: Blind paper pre-check for due items (R05 + R07)
  function renderDuePrecheckStep(s) {
    const dueItems = s.dueIds.map(itemById).filter(Boolean);
    dueItems.forEach(it => ensureItemContext(s, it.id));

    return `
      <section class="card">
        <div class="row between">
          <div>
            <span class="pill pill-core">Step 0 · 课前到期词无提示纸写抽查（共 ${dueItems.length} 项）</span>
            <h2 style="margin:8px 0 4px">✍️ 先在纸本写下这 ${dueItems.length} 个到期词的首答（黑/蓝笔书写）</h2>
            <p class="muted" style="margin:0">写完点右下角锁存课前首答方式与日期，随后即使课末新词切换其他出题方式，也不会覆盖这里的课前施测记录。</p>
          </div>
          <label class="muted" style="font-weight:700">
            课前抽查提示方式：
            <select id="prompt-mode-select" data-mode-scope="due_precheck">
              <option value="audio_plus_zh" ${s.promptMode === 'audio_plus_zh' ? 'selected' : ''}>🔊 语音 + 中文</option>
              <option value="audio_only" ${s.promptMode === 'audio_only' ? 'selected' : ''}>🎧 纯听写（隐中文）</option>
              <option value="zh_prompt" ${s.promptMode === 'zh_prompt' ? 'selected' : ''}>🇨🇳 纯中文提取</option>
              <option value="sentence_context" ${s.promptMode === 'sentence_context' ? 'selected' : ''}>📝 句中挖空用词</option>
            </select>
          </label>
        </div>

        <div class="paper-list">
          ${dueItems.map((it, idx) => renderDictationPromptRow(s, it, idx, true)).join('')}
        </div>

        <div class="row between" style="margin-top:18px">
          <span class="muted">纸面留痕：黑/蓝笔写首答，稍后统一红笔核对。</span>
          <button type="button" class="btn btn-mint" data-act="finish-due-precheck">
            ✅ 到期词首答已在纸上写完，锁存并进入今日课程 →
          </button>
        </div>
      </section>
    `;
  }

  // R07: Context-aligned prompt row (speaks ctx.spokenText so audio & expected answer match 1-to-1!)
  function renderDictationPromptRow(s, it, idx, isDueBadge) {
    const ctx = ensureItemContext(s, it.id);
    const mode = ctx.promptMode || 'audio_plus_zh';
    const hinted = Boolean(s.hintedOnPaper?.[it.id]);

    let promptHtml = '';
    if (mode === 'audio_only') {
      promptHtml = `<strong>#${idx + 1}　[纯听写 · 请点右侧播音后书写]</strong>`;
    } else if (mode === 'sentence_context' && ctx.sentenceTemplate) {
      promptHtml = `
        <div>
          <strong>#${idx + 1}　句中用词：${esc(ctx.promptZh)}</strong>
          ${it.sentenceVariants?.length > 1 && !ctx.locked ? `
            <select data-context-variant="${esc(it.id)}" style="margin-left:8px;font-size:12.5px;padding:2px 6px">
              ${it.sentenceVariants.map(v => `<option value="${esc(v.key)}" ${v.key === ctx.variantKey ? 'selected' : ''}>${esc(v.label.split(' ')[0])}</option>`).join('')}
            </select>
          ` : ''}
        </div>
        <div class="english" style="font-size:19px;font-weight:800;color:#1e3a8a;margin-top:4px">${esc(ctx.sentenceTemplate)}</div>
      `;
    } else {
      promptHtml = `<strong>#${idx + 1}　${esc(ctx.promptZh || it.zh)}</strong>`;
    }

    return `
      <div class="paper-item">
        <div class="row between">
          <div>
            ${promptHtml}
            ${isDueBadge ? '<span class="pill" style="background:#dbeafe;color:#1e40af;margin-left:8px">📅 到期复测</span>' : ''}
            <span class="muted" style="font-size:12px;margin-left:6px">施测日：${esc(ctx.testedDateStr)}</span>
            ${s.showChunkHint?.[it.id] ? `
              <div class="help-callout" style="margin:6px 0 0;padding:6px 10px">💡 已给拆块提示：<b class="english">${esc(ctx.displayChunks)}</b>（本题已标为“含拼写提示”）</div>
            ` : hinted ? `
              <div class="help-callout" style="margin:6px 0 0;padding:6px 10px">💡 发起新测前已见过本题答案/词形，本次无答案盲写按「含拼写提示/订正」登记（隔日独立盲写全对再升金章）</div>
            ` : ''}
          </div>
          <div class="row">
            ${mode !== 'zh_prompt' ? `<button type="button" class="btn btn-sm" data-speak-context="${esc(it.id)}" data-speak-item="${esc(it.id)}">🔊 听发音</button>` : ''}
            ${!s.showChunkHint?.[it.id] ? `<button type="button" class="btn btn-sm" data-give-paper-hint="${esc(it.id)}">💡 给拆块提示</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function buildSlotSentence() {
    const deck = SNAPWORD_CURRICULUM.SLOT_DECKS[slotUI.deckIndex] || SNAPWORD_CURRICULUM.SLOT_DECKS[0];
    const subj = deck.subjects[slotUI.subj % deck.subjects.length];
    const adv = deck.adverbs[slotUI.adv % deck.adverbs.length];
    const act = deck.actions[slotUI.act % deck.actions.length];
    const verbPhrase = subj.thirdSingular ? act.sForm : act.base;
    const parts = [subj.en, adv.en, verbPhrase].filter(Boolean);
    return { deck, en: parts.join(' '), zh: `${subj.zh}${adv.zh}${act.zh}`, highlight: act.highlight };
  }

  function formatHighlightedSentence(en, highlight) {
    const cleanEn = esc(en);
    const hl = String(highlight ?? '').trim();
    if (!hl) return cleanEn;
    const escapedHl = esc(hl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return cleanEn.replace(new RegExp(`(${escapedHl})`, 'i'), '<span class="board-hl">$1</span>');
  }

  function renderBoardStep(s) {
    const slot = buildSlotSentence();
    const activeEn = slotUI.customEn || slot.en;
    const activeZh = slotUI.customZh || slot.zh;
    const activeHl = slotUI.customEn ? slotUI.customHl : slot.highlight;
    const nextStep = s.focusIds.length ? 'snap' : (s.paperIds.length ? 'bug' : 'oral_wrapup');

    return `
      <section class="blackboard">
        <div class="row between">
          <span class="pill" style="background:#334155;color:#fbbf24">Step 1 · 说一句、读一句（单次仅高亮 1 处难点）</span>
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
          <button type="button" class="btn btn-mint" data-complete-step="board" data-next-step="${nextStep}">🗣️ 开口读顺啦，下一步 →</button>
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
            <input type="text" id="custom-board-en" placeholder="输入英文短句" value="${esc(slotUI.customEn)}" style="flex:2;min-width:220px">
            <input type="text" id="custom-board-zh" placeholder="中文意思（可选）" value="${esc(slotUI.customZh)}" style="flex:1;min-width:140px">
            <input type="text" id="custom-board-hl" placeholder="高亮1个词" value="${esc(slotUI.customHl)}" style="width:130px">
            <button type="button" class="btn btn-sm btn-amber" data-act="push-board">推上黑板</button>
            ${slotUI.customEn ? '<button type="button" class="btn btn-sm" data-act="clear-board">切回摇奖机</button>' : ''}
          </div>
        </details>
      </section>

      ${s.preread ? `
        <section class="card">
          <span class="pill pill-core">📖 1 分钟课文情境微听读 · ${esc(s.preread.source)}</span>
          <div style="margin:10px 0;padding:12px 16px;background:var(--surface-soft);border-radius:12px">
            ${s.preread.lines.map(line => `
              <div class="row between" style="margin:6px 0">
                <span class="english" style="font-size:19px;font-weight:800">${esc(line)}</span>
                <button type="button" class="btn btn-sm" data-speak-raw="${esc(line.replace(/^[A-Za-z]+:\s*/, ''))}">🔊 听读</button>
              </div>
            `).join('')}
          </div>
          <p style="margin:6px 0;font-weight:700">🤔 理解小问答：${esc(s.preread.question)}</p>
          <div class="row">
            <input type="text" id="preread-note-input" placeholder="可简记孩子的口头回答（可选）" value="${esc(s.prereadNote || '')}" style="flex:1">
            <button type="button" class="btn btn-sm ${s.prereadDone ? 'btn-mint' : 'btn-primary'}" data-act="mark-preread-done">
              ${s.prereadDone ? '✅ 已记录理解回应' : '记录孩子已读懂回应'}
            </button>
          </div>
        </section>
      ` : ''}
    `;
  }

  function renderSnapStep(s) {
    const id = s.focusIds[s.snapIndex];
    const item = itemById(id);
    const endTarget = s.paperIds.length ? 'paper' : 'oral_wrapup';
    if (!item) return `<div class="card"><p>本组词已完成。</p><button type="button" class="btn btn-primary" data-jump-step="${endTarget}">下一步 →</button></div>`;
    const st = s.snapState;
    const pieces = item.snap?.pieces || [item.en];
    const audioInfo = SnapAudio.resolveSourceInfo(state, item);
    const isOralOnly = s.oralOnlyIds?.includes(item.id);
    const isSentence = item.type === 'sentence';
    const hasCloze = Boolean(item.cloze && !isOralOnly);

    // Stage 2B: Dedicated Blind Cloze View — ALL magnetic blocks, model answers & spelling notes are hidden!
    if (st.inClozeMode && hasCloze) {
      return `
        <section class="card" id="blind-cloze-card">
          <div class="row between" style="margin-bottom:10px">
            <div>
              <span class="pill pill-core">Step 2 · 🎯 遮盖盲填挖空挑战（第 ${s.snapIndex + 1} / ${s.focusIds.length} 项 · 磁吸答案已全部收起）</span>
              ${badgeLabel(state.mastery[item.id])}
            </div>
            ${!st.clozeDone ? `
              <button type="button" class="btn btn-sm" data-act="exit-cloze-peek">👀 想不起，退回磁吸看一眼</button>
            ` : ''}
          </div>

          <div class="word-hero">
            <div class="muted">凭刚才的记忆与发音补全空缺（原词与磁吸块已全部隐藏，杜绝照抄）</div>
            <div class="word-zh-big">${esc(item.zh)}</div>
            <div style="margin-top:8px">
              <button type="button" class="btn btn-primary" data-speak-item="${esc(item.id)}">🔊 ${isSentence ? '再听整句朗读' : '再听完整发音'}</button>
              <span class="audio-tag">${esc(audioInfo.label)}</span>
            </div>
          </div>

          <div style="background:var(--surface-soft);padding:18px;border-radius:14px;margin-top:12px;text-align:center">
            <div class="muted" style="font-weight:700;margin-bottom:6px">💡 思考线索：${esc(item.cloze.hint)}</div>
            <form id="cloze-form" class="cloze-box english">
              <span>${esc(item.cloze.prefix)}</span>
              <input type="text" id="cloze-input" class="cloze-input english" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="凭记忆盲填" value="${esc(st.clozeDone ? item.cloze.blank : (st.clozeDraft || ''))}" ${st.clozeDone ? 'readonly' : ''}>
              <span>${esc(item.cloze.suffix)}</span>
              ${!st.clozeDone ? `<button type="submit" class="btn btn-primary btn-sm">核对</button>` : `<span style="color:#059669;font-weight:800">✅ 凭记忆盲填精准过关！</span>`}
            </form>
            ${st.clozeFeedback ? `<div class="muted" style="color:#b45309;font-weight:700;margin-top:8px" id="cloze-feedback">${esc(st.clozeFeedback)}</div>` : ''}
          </div>

          <div class="row between" style="margin-top:16px">
            <div class="row">
              ${s.snapIndex > 0 ? `<button type="button" class="btn btn-sm" data-act="prev-word">← 上一项</button>` : ''}
            </div>
            <button type="button" class="btn ${st.clozeDone ? 'btn-mint' : 'btn-primary'}" data-act="next-word">
              ${s.snapIndex + 1 < s.focusIds.length ? '下一项 →' : '本组完成，下一步 →'}
            </button>
          </div>
        </section>
      `;
    }

    // Stage 2A: Magnetic Block Assembly View (Cloze input is NEVER rendered while model/tiles are visible!)
    return `
      <section class="card">
        <div class="row between" style="margin-bottom:10px">
          <div>
            <span class="pill pill-core">Step 2 · ${isSentence ? '咔嗒语块拼句' : '咔嗒磁吸拆词'}（第 ${s.snapIndex + 1} / ${s.focusIds.length} 项）</span>
            ${isOralOnly ? '<span class="pill pill-star">🗣️ 本轮仅听读认义（不进纸写默写）</span>' : `<span class="pill pill-core">✍️ ${isSentence ? '本轮整句默写目标' : '本轮纸写目标词'}</span>`}
            ${badgeLabel(state.mastery[item.id])}
          </div>
          <button type="button" class="btn btn-sm btn-mint" data-act="skip-to-next-word">
            ⚡ ${isOralOnly ? '已听熟认清意思，下一项 →' : (isSentence ? '这句我会写，跳过直接留到纸上验 →' : '这词我会写，跳过直接留到纸上验 →')}
          </button>
        </div>

        <div class="word-hero">
          <div class="muted">${isOralOnly ? '听准发音、记住中文意思与句中用法即可' : (isSentence ? '先听整句朗读、看清三单与标点得分点，再按语块顺序咔嗒拼成整句' : '先听整词发音、看清难写处，再动手吸合磁吸片')}</div>
          <div class="word-zh-big">${esc(item.zh)}</div>
          ${st.hideModel ? `
            <div class="chunk-display" style="color:#64748b;border-style:dashed">🙈 ${isSentence ? '原句与拆解锦囊已全部遮住，按语块顺序凭记忆盲拼吧！' : '原词与拆词锦囊已全部遮住，凭记忆盲拼吧！'}</div>
          ` : `
            <div class="chunk-display english" style="${isSentence ? 'font-size:21px' : ''}">${esc(item.displayChunks || item.en)}</div>
          `}
          <div style="margin-top:8px">
            <button type="button" class="btn btn-primary" data-speak-item="${esc(item.id)}">🔊 ${isSentence ? '听整句朗读' : '听完整发音'}</button>
            <button type="button" class="btn btn-sm" data-act="toggle-model-mask">${st.hideModel ? (isSentence ? '👀 看一眼原句' : '👀 看一眼原词') : (isSentence ? '🙈 遮住原句盲拼' : '🙈 遮住原词盲拼')}</button>
            <span class="audio-tag">${esc(audioInfo.label)}</span>
          </div>
        </div>

        ${!st.hideModel ? `
          <div class="help-callout"><strong>💡 ${isSentence ? '拼句与默写锦囊' : '拆词锦囊'}：</strong>${esc(item.helpNote)}</div>
          ${item.bridgeNote ? `<div class="bridge-callout"><strong>🔗 顺手串记（只看 1 处）：</strong>${esc(item.bridgeNote)}</div>` : ''}
        ` : ''}

        <h3 style="margin:12px 0 6px">🧲 咔嗒磁吸槽（按顺序点击下方${isSentence ? '语块' : '磁吸片'}归位）：</h3>
        <div class="snap-tray" aria-label="磁吸拼装槽">
          ${pieces.map((p, idx) => {
            const isFilled = idx < st.filled.length;
            const label = p === '␣' ? '␣ 空格' : p;
            const emptyHint = p === '␣' ? '空格' : (isSentence ? `语块${idx + 1}` : '？');
            return `<span class="snap-slot english ${isFilled ? 'filled' : ''}" ${isFilled && idx === st.filled.length - 1 && !st.completedSnap ? 'data-act="undo-snap" title="点击撤回最后一块"' : ''}>${isFilled ? esc(label) : emptyHint}</span>`;
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
          <div class="bridge-callout" style="text-align:center;font-size:17px;font-weight:800">
            <div>🎉 咔嗒合拢成功！先默记 2 秒完整写法：<span class="english" style="font-size:23px;color:#047857">${esc(item.en)}</span></div>
            ${hasCloze && !st.clozeDone ? `
              <div style="margin-top:12px">
                <button type="button" class="btn btn-amber" data-act="enter-cloze">
                  🙈 收起磁吸答案，进入盲填小挖空挑战 →
                </button>
              </div>
            ` : (st.clozeDone ? `<div style="margin-top:8px;color:#059669">✅ 盲填小挖空也已通过！</div>` : '')}
          </div>
        `}

        <div class="row between" style="margin-top:14px">
          <div class="row">
            ${hasCloze && !st.completedSnap ? `<button type="button" class="btn btn-sm" data-act="open-cloze">🎯 收起答案直接盲填小挖空</button>` : ''}
            ${s.snapIndex > 0 ? `<button type="button" class="btn btn-sm" data-act="prev-word">← 上一项</button>` : ''}
          </div>
          <button type="button" class="btn btn-primary" data-act="next-word">
            ${s.snapIndex + 1 < s.focusIds.length ? '下一项 →' : '拆词完成，下一步 →'}
          </button>
        </div>
      </section>
    `;
  }

  function renderBugStep(s) {
    const card = SNAPWORD_CURRICULUM.BUG_CARDS.find(b => b.id === s.bugCardId) || SNAPWORD_CURRICULUM.BUG_CARDS[0];
    const totalBugs = card.tokens.filter(t => t.isBug).length;
    const squashedCount = Object.keys(s.bugFixed).length;
    const allDone = squashedCount >= totalBugs;
    const pickingToken = s.bugPickingIdx != null ? card.tokens[s.bugPickingIdx] : null;
    const finalStep = s.paperIds.length ? 'paper' : 'oral_wrapup';
    const finalBtnLabel = s.paperIds.length ? `✍️ 进入纸本默写 (${s.paperIds.length}题) →` : '🗣️ 进入认读收工 →';

    return `
      <section class="card">
        <div class="row between">
          <div>
            <span class="pill" style="background:#fef3c7;color:#92400e">Step 3 · 抓拼写臭虫侦探（热身火眼金睛）</span>
            <h2 style="margin:8px 0 4px">${esc(card.title)}</h2>
            <p class="muted" style="margin:0">原句想表达：<strong>${esc(card.zh)}</strong>（已揪出 <b>${squashedCount} / ${totalBugs}</b> 只臭虫）</p>
          </div>
          <button type="button" class="btn btn-sm" data-jump-step="${finalStep}">跳过热身 →</button>
        </div>

        <div class="bug-sentence english">
          ${card.tokens.map((tok, idx) => {
            const fixed = s.bugFixed[idx];
            const isPicking = s.bugPickingIdx === idx;
            return `<button type="button" class="bug-token english ${fixed ? 'squashed' : ''} ${isPicking ? 'picking' : ''}" data-bug-idx="${idx}">${fixed ? `✅ ${esc(tok.fix)}` : esc(tok.text)}</button>`;
          }).join('')}
        </div>

        ${pickingToken ? `
          <div class="bounce-bubble">
            <div>🐛 抓到可疑拼写「<b class="english">${esc(pickingToken.text)}</b>」！哪个才是正确写法？</div>
            <div class="row" style="justify-content:center;margin-top:10px">
              ${pickingToken.choices.map(ch => `<button type="button" class="btn btn-primary english" data-bug-fix="${esc(ch)}">${esc(ch)}</button>`).join('')}
            </div>
          </div>
        ` : ''}

        ${allDone ? `
          <div class="bridge-callout" style="font-size:16.5px;font-weight:800;text-align:center">
            🕵️ 所有拼写臭虫都被你拍扁啦！
          </div>
        ` : ''}

        <div class="row between" style="margin-top:16px">
          <span class="muted">小提示：用鼠标点击黑框里看起来不对劲的英文词！</span>
          <button type="button" class="btn btn-mint" data-complete-step="bug" data-next-step="${finalStep}">
            ${finalBtnLabel}
          </button>
        </div>
      </section>
    `;
  }

  // --- Step 4: Paper Dictation + Two-Pass Red-Pen Self-Check ---
  function renderPaperStep(s) {
    if (!s.paperIds.length) return renderOralWrapupStep(s);

    const items = s.paperIds.map(itemById).filter(Boolean);
    // Initialize contexts only for items not yet locked in Step 0!
    items.forEach(it => ensureItemContext(s, it.id, { preserveExisting: true }));
    const newPaperItems = s.duePrewritten
      ? items.filter(it => !s.dueIds.includes(it.id))
      : items;

    if (s.paperPhase === 'dictate') {
      return `
        <section class="card">
          <div class="row between">
            <div>
              <span class="pill pill-core">纸本独立手写（本轮共核验 ${items.length} 项 · 答案严密隐藏）</span>
              <h2 style="margin:8px 0 4px">✍️ 请在英语默写本上按题号用黑/蓝笔写下首答</h2>
            </div>
            ${newPaperItems.length ? `
              <label class="muted" style="font-weight:700">
                本段新题提示方式：
                <select id="prompt-mode-select" data-mode-scope="paper_new">
                  <option value="audio_plus_zh" ${s.promptMode === 'audio_plus_zh' ? 'selected' : ''}>🔊 语音 + 中文</option>
                  <option value="audio_only" ${s.promptMode === 'audio_only' ? 'selected' : ''}>🎧 纯听写（隐中文）</option>
                  <option value="zh_prompt" ${s.promptMode === 'zh_prompt' ? 'selected' : ''}>🇨🇳 纯中文提取</option>
                  <option value="sentence_context" ${s.promptMode === 'sentence_context' ? 'selected' : ''}>📝 句中挖空用词</option>
                </select>
              </label>
            ` : ''}
          </div>
          <p class="muted" style="margin:4px 0 14px">纸面留痕规则：首答用黑/蓝笔写；下一步红笔盲查和订正时保留原字不涂黑，方便家长看照片区分首答与订正。</p>

          ${s.duePrewritten && s.dueIds.length ? `
            <div class="bridge-callout" style="margin-bottom:12px">
              ✅ 课前 ${s.dueIds.length} 道到期复测题已锁存其课前出题方式与施测日期，请接着写出剩余 ${newPaperItems.length} 道题：
            </div>
          ` : ''}

          <div class="paper-list">
            ${items.map((it, idx) => {
              const isDue = s.dueIds.includes(it.id);
              const ctx = ensureItemContext(s, it.id, { preserveExisting: true });
              if (s.duePrewritten && isDue) {
                const expNote = s.lockedHint?.[it.id] ? ' · 💡已接触词形提示' : '';
                return `
                  <div class="paper-item row between" style="background:var(--surface-soft)">
                    <div>
                      <strong>#${idx + 1}　${ctx.promptMode === 'audio_only' ? '[课前纯听写项]' : esc(ctx.promptZh)}</strong>
                      <span class="pill" style="background:#d1fae5;color:#065f46;margin-left:8px">📅 到期复测 · 课前方式：${esc(ctx.promptMode)} (${esc(ctx.testedDateStr)})${expNote}</span>
                    </div>
                  </div>
                `;
              }
              return renderDictationPromptRow(s, it, idx, isDue);
            }).join('')}
          </div>

          <div class="row between" style="margin-top:18px">
            <button type="button" class="btn btn-sm" onclick="window.print()">🖨️ 打印题单（可选）</button>
            <button type="button" class="btn btn-primary" data-paper-phase="blind_check">
              🖊️ 本子上首答全部写完，锁存题面并拿起红笔做第 1 遍盲查 →
            </button>
          </div>
        </section>
      `;
    }

    if (s.paperPhase === 'blind_check') {
      const allChecked = s.blindChecks.cap && s.blindChecks.space && s.blindChecks.chunk;
      return `
        <section class="card">
          <span class="pill" style="background:#ffe4e6;color:#9f1239">第一遍红笔盲查（约 1 分钟 · 答案与拆块全程隐藏！）</span>
          <h2 style="margin:8px 0 4px">🔴 先别亮答案！拿红笔指着自己的纸面查这 3 件事：</h2>
          <p class="muted" style="margin:0">提醒：这里打勾仅作自查提示；若发现漏改，请用红笔在原词旁改出并标 ★（独立正确与否以稍后家长核验纸面为准）。</p>

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
              <span>③ 查腰与尾：三单尾巴 (-s/-es/tries)、双写字母 (swimming)、易漏字母块和句末标点写上了吗？</span>
            </label>
          </div>

          <div class="row between" style="margin-top:16px">
            <button type="button" class="btn btn-sm" data-paper-phase="dictate">← 返回题面</button>
            <button type="button" class="btn ${allChecked ? 'btn-mint' : 'btn-primary'}" data-paper-phase="reveal_grade">
              👀 红笔盲查完毕，亮出标准答案逐题核验 →
            </button>
          </div>
        </section>
      `;
    }

    markSessionAnswersRevealed(s, items);
    const unjudgedCount = items.filter(it => !s.paperGrades[it.id]?.outcome || s.paperGrades[it.id].outcome === 'unjudged').length;
    const allMasked = items.every(it => Boolean(s.maskedAnswers[it.id]));

    return `
      <section class="card">
        <div class="row between">
          <div>
            <span class="pill pill-core">第二遍亮答案核漏 + 家长逐题确认（未确认：${unjudgedCount} / ${items.length}）</span>
            <h2 style="margin:8px 0 4px">✅ 据纸面黑/红笔痕迹逐题判定（看完答案后的遮盖重写属于当场订正）</h2>
          </div>
          <div class="row">
            <button type="button" class="btn btn-sm" data-act="toggle-mask-all">
              ${allMasked ? '👀 全部展开答案' : '🙈 全部遮住答案重写'}
            </button>
            ${unjudgedCount > 0 ? `
              <button type="button" class="btn btn-sm" data-batch-rest="pending_verify">📸 剩余未判题标为「待核验」</button>
              <button type="button" class="btn btn-sm" data-batch-rest="untested">⏭️ 剩余未判题标为「未测」</button>
            ` : ''}
          </div>
        </div>
        <p class="muted" style="margin:4px 0 14px">说明：跨日继续草稿时保留每题原施测日期与纸本参考，避免提交日篡改复测起点。</p>

        <div class="paper-list">
          ${items.map((it, idx) => renderPaperGradeCard(s, it, idx)).join('')}
        </div>

        <div class="row between" style="margin-top:20px">
          <button type="button" class="btn btn-sm" data-paper-phase="blind_check">← 返回盲查页</button>
          <button type="button" class="btn btn-mint" data-act="finish-paper-session">
            🎉 确认无误，写入账本并查看结算 (${items.length - unjudgedCount}/${items.length} 已选) →
          </button>
        </div>
      </section>
    `;
  }

  function markSessionAnswersRevealed(s, items) {
    if (!s || !state) return;
    const today = SnapCore.todayISO();
    s.answerRevealed = s.answerRevealed || {};
    state.lastAnswerSeenDate = state.lastAnswerSeenDate || {};
    for (const it of items) {
      if (!s.maskedAnswers?.[it.id]) {
        s.answerRevealed[it.id] = true;
        if (effectiveSessionActor() === 'student') {
          state.lastAnswerSeenDate[it.id] = today;
        }
      }
    }
  }

  function renderPaperGradeCard(s, it, idx) {
    const ctx = ensureItemContext(s, it.id, { preserveExisting: true });
    const defaultRef = `${ctx.testedDateStr} #${idx + 1}`;
    const g = s.paperGrades[it.id] || { outcome: 'unjudged', tags: [], paperRef: defaultRef, testedDateStr: ctx.testedDateStr, testedAt: ctx.testedAt };
    const masked = Boolean(s.maskedAnswers[it.id]);
    const hinted = Boolean(s.hintedOnPaper?.[it.id]);
    const hintLocked = Boolean(s.lockedHint?.[it.id]);
    const isDue = s.dueIds.includes(it.id);
    const isUnjudged = !g.outcome || g.outcome === 'unjudged';
    const curDateStr = g.testedDateStr || ctx.testedDateStr;
    const todayStr = SnapCore.todayISO();
    const isCrossDay = curDateStr !== todayStr;

    return `
      <div class="paper-item ${highlightUnjudged && isUnjudged ? 'unjudged-highlight' : ''}" data-grade-card="${esc(it.id)}">
        <div class="row between">
          <div>
            <strong>#${idx + 1}　${esc(ctx.promptZh || it.zh)}</strong>
            ${isDue ? '<span class="pill" style="background:#dbeafe;color:#1e40af;margin-left:6px">📅 到期复测</span>' : ''}
            <span class="pill" style="margin-left:4px">${esc(ctx.promptMode)} · 施测日 ${esc(curDateStr)}</span>
            ${isCrossDay && isUnjudged ? `
              <button type="button" class="btn btn-sm" style="padding:2px 8px;font-size:12px;margin-left:4px" data-fresh-retest="${esc(it.id)}" data-retest-today="${esc(it.id)}" title="归档当前未判卡（保留已见答案状态）并进入今日无答案盲写题面">
                🔄 归档原题并发起今日新测 (${esc(todayStr)})
              </button>
            ` : ''}
            ${isUnjudged ? '<span class="pill" style="background:#fef3c7;color:#92400e;margin-left:6px">⚠️ 未判定</span>' : ''}
            ${!masked ? `<span class="muted" style="margin-left:8px">拆块提示：${esc(ctx.displayChunks)}</span>` : ''}
          </div>
          <div class="row">
            <button type="button" class="btn btn-sm" data-speak-context="${esc(it.id)}" data-speak-item="${esc(it.id)}">🔊 发音</button>
            <button type="button" class="btn btn-sm" data-mask-ans="${esc(it.id)}">
              ${masked ? '👀 展开答案' : '🙈 遮住答案重写'}
            </button>
          </div>
        </div>

        ${masked ? `
          <div class="four-line-answer" style="color:#64748b">🙈 整词、拆块与变体已全部遮严！请在纸本空白处凭记忆订正默写一遍（计为当场订正）</div>
        ` : `
          <div class="four-line-answer english">${esc(ctx.primary)}</div>
          ${ctx.accepted.length > 1 ? `<span class="muted">（本班设置同时接受：${esc(ctx.accepted.slice(1).join(' / '))}）</span>` : ''}
          ${it.context?.en ? `<div class="muted english" style="font-size:13.5px">例句参考：${esc(it.context.en)}（${esc(it.context.origin || '')}）</div>` : ''}
        `}

        <div style="margin-top:8px" class="row">
          <label class="muted" style="font-size:13px;display:inline-flex;align-items:center;gap:5px;cursor:pointer">
            <input type="checkbox" data-toggle-hinted="${esc(it.id)}" ${hinted ? 'checked' : ''} ${hintLocked ? 'disabled title="交首答前已接触词形或已亮过答案，系统已锁定提示状态"' : ''}>
            💡 交首答前给过/接触过词形提示${hintLocked ? '（已自动锁定）' : ''}
          </label>
          <label class="muted" style="font-size:13px">
            补登原纸面日期：
            <input type="date" data-backfill-date="${esc(it.id)}" value="${esc(curDateStr)}" style="padding:2px 6px;font-size:12.5px">
          </label>
          <label class="muted" style="font-size:13px">
            纸本题号备注：
            <input type="text" data-paper-ref="${esc(it.id)}" value="${esc(g.paperRef || defaultRef)}" style="width:145px;padding:3px 7px;font-size:13px">
          </label>
        </div>

        <div class="outcome-group" role="group" aria-label="本题纸写判定">
          <button type="button" class="outcome-btn ${g.outcome === 'paper_independent' ? 'selected-good' : ''}" data-grade-item="${esc(it.id)}" data-outcome="paper_independent">
            ${hinted ? '💡 提示后写对' : '🌟 首答独立全对'}
          </button>
          <button type="button" class="outcome-btn ${g.outcome === 'blind_self_fixed' ? 'selected-fix' : ''}" data-grade-item="${esc(it.id)}" data-outcome="blind_self_fixed">🔍 盲查自改正确</button>
          <button type="button" class="outcome-btn ${g.outcome === 'answer_corrected' ? 'selected-fix' : ''}" data-grade-item="${esc(it.id)}" data-outcome="answer_corrected">✏️ 见答案订正</button>
          <button type="button" class="outcome-btn ${g.outcome === 'answered_wrong' ? 'selected-bad' : ''}" data-grade-item="${esc(it.id)}" data-outcome="answered_wrong">❌ 已作答仍错</button>
          <button type="button" class="outcome-btn ${g.outcome === 'blank' ? 'selected-bad' : ''}" data-grade-item="${esc(it.id)}" data-outcome="blank">⬜ 已测但空白</button>
          <button type="button" class="outcome-btn ${g.outcome === 'pending_verify' ? 'selected-pending' : ''}" data-grade-item="${esc(it.id)}" data-outcome="pending_verify">⏳ 待核验</button>
          <button type="button" class="outcome-btn ${g.outcome === 'untested' ? 'selected-pending' : ''}" data-grade-item="${esc(it.id)}" data-outcome="untested">⏭️ 未测</button>
        </div>

        ${['blind_self_fixed', 'answer_corrected', 'answered_wrong'].includes(g.outcome) ? `
          <div style="margin-top:10px">
            <span class="muted">记录可见错误类型：</span>
            <div class="row" style="gap:6px;margin-top:6px">
              ${SNAPWORD_CURRICULUM.ERROR_TAGS.map(tag => {
                const active = (g.tags || []).includes(tag.id);
                return `<button type="button" class="tag-chip ${active ? 'active' : ''}" data-toggle-err="${esc(it.id)}" data-tag="${esc(tag.id)}">${esc(tag.label)}</button>`;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderBaselineSession(s) {
    const items = s.paperIds.map(itemById).filter(Boolean);
    items.forEach(it => ensureItemContext(s, it.id, { preserveExisting: true }));
    const altItems = (s.altCheckWords || []).map(itemById).filter(Boolean);
    const unjudgedCount = items.filter(it => !s.paperGrades[it.id]?.outcome || s.paperGrades[it.id].outcome === 'unjudged').length;

    if (s.paperPhase === 'dictate') {
      return `
        <section class="card">
          <span class="pill pill-core">首次 10–12 分钟纸笔基线短测（可分批测，未测项如实标“未测”）</span>
          <h2 style="margin:8px 0 4px">📏 请在纸上写出基线样本词（黑/蓝笔书写，允许统一重听 1 次）</h2>
          <p class="muted" style="margin:0 0 14px">收齐全部纸面首答前不展示答案。若今天只测其中部分词，剩余项在下一页标为「未测」即可。</p>
          <div class="paper-list">
            ${items.map((it, i) => renderDictationPromptRow(s, it, i, false)).join('')}
            ${s.extraSentence ? `
              <div class="paper-item">
                <strong>#7（附加观察句）　${esc(s.extraSentence.zh)}</strong>
                <div class="muted">观察点：${esc(s.extraSentence.focus)}</div>
              </div>
            ` : ''}
          </div>
          <div class="row between" style="margin-top:16px">
            <div class="row">
              <button type="button" class="btn btn-sm" data-act="pause-session">⏸️ 暂存草稿</button>
              <button type="button" class="btn btn-sm" data-act="abandon-session">取消退出</button>
            </div>
            <button type="button" class="btn btn-primary" data-paper-phase="reveal_grade">✍️ 首答已收齐，锁存并展开判定页 →</button>
          </div>
        </section>
      `;
    }

    markSessionAnswersRevealed(s, items);
    return `
      <section class="card">
        <div class="row between">
          <div>
            <span class="pill pill-core">基线首答客观判定（未确认：${unjudgedCount} / ${items.length}）</span>
            <h2 style="margin:8px 0 6px">📋 据纸面首答逐题勾选（起始均为未判定）</h2>
          </div>
          <div class="row">
            <button type="button" class="btn btn-sm" data-act="pause-session">⏸️ 暂存草稿</button>
            ${unjudgedCount > 0 ? `
              <button type="button" class="btn btn-sm" data-batch-rest="pending_verify">📸 剩余标为「待核验」</button>
              <button type="button" class="btn btn-sm" data-batch-rest="untested">⏭️ 剩余标为「未测」</button>
            ` : ''}
          </div>
        </div>

        <div class="paper-list">
          ${items.map((it, idx) => renderPaperGradeCard(s, it, idx)).join('')}
        </div>

        <div class="help-callout" style="margin-top:14px">
          <strong>🔍 异组口头排查参考（仅家长看，避免刚看答案就测同词）：</strong>
          <details style="margin-top:4px">
            <summary style="cursor:pointer;font-weight:700">点此展开异组排查词（${altItems.length} 项）</summary>
            <div style="margin-top:6px">${altItems.map(a => `<b class="english" style="margin-right:14px">${esc(a.en)}（${esc(a.zh)}）</b>`).join('')}</div>
          </details>
        </div>

        <div style="margin-top:12px">
          <label style="font-weight:700;display:block;margin-bottom:6px">附加短句（with 选用）与纸面观察备注：</label>
          <input type="text" id="baseline-note" style="width:100%" placeholder="例：句子中 with 写对，football 漏字母..." value="${esc(s.sentenceNote || '')}">
        </div>

        <div class="row between" style="margin-top:18px">
          <button type="button" class="btn btn-sm" data-paper-phase="dictate">← 返回题面</button>
          <button type="button" class="btn btn-mint" data-act="finish-paper-session">✅ 保存基线记录 (${items.length - unjudgedCount}/${items.length} 已选)</button>
        </div>
      </section>
    `;
  }

  function renderSessionSummary(s) {
    const isOralSummary = s.oralPhase === 'summary';
    const tally = s.summary?.tally || { independent: 0, denominator: 0, ratioText: '0 / 0', blindSelfFixed: 0, answerCorrected: 0, answeredWrong: 0, hintedCorrect: 0, blank: 0, untested: 0, pendingVerify: 0 };
    const needReviewIds = s.summary?.needReviewIds || [];
    const oralDoneCount = s.summary?.oralDoneCount || 0;
    const oralUnconfirmedIds = s.summary?.oralUnconfirmedIds || [];
    const isDemo = s.lockedActor === 'parent_demo';

    return `
      <section class="card" style="text-align:center;padding:30px 24px">
        <div style="font-size:44px">${lastSaveOk ? '🏅' : '⚠️'}</div>
        <h1 style="margin:8px 0">${isOralSummary ? '本轮听读预读收工！' : '本轮结算单'}</h1>
        ${isDemo ? `
          <p style="color:#92400e;font-weight:800">🛠️ 本节课锁定为「家长演练试用」，未改动孩子的正式章数、正确率或复测日期。</p>
        ` : lastSaveOk ? `
          <p class="muted">用时约 ${Math.max(1, elapsedMinutes())} 分钟 · ● 记录已安全写入本机存储</p>
        ` : `
          <div class="help-callout" style="border-color:#dc2626;background:#fee2e2;color:#991b1b;text-align:left">
            <strong>⚠️ 本机持久化存储受阻！</strong>当前记录仅保存在临时内存中，关闭页面前请立即点击下方【导出 JSON 备份】保存！
            <div style="margin-top:8px"><button type="button" class="btn btn-sm btn-primary" data-act="export-json">⬇️ 立即导出本轮 JSON 备份</button></div>
          </div>
        `}

        ${isOralSummary ? `
          <div class="bridge-callout" style="text-align:left;margin:18px 0" id="oral-summary-box">
            <div>🗣️ 已确认完成 <b id="oral-done-count">${oralDoneCount} 项</b> 听读认义记录 · 未确认 <b id="oral-unconfirmed-count">${oralUnconfirmedIds.length} 项</b>（纸写默写 <b>0 项</b>，与课前预览完全一致）。</div>
            ${oralUnconfirmedIds.length ? `
              <div class="muted" style="margin-top:6px">
                ⏭️ 本次未勾选确认项（未自动发章，留待下次继续听读）：<b>${oralUnconfirmedIds.map(id => esc(itemById(id)?.zh || id)).join('、')}</b>
              </div>
            ` : ''}
          </div>
        ` : `
          <div class="grid-4" style="margin:20px 0;text-align:left">
            <div class="stat-tile">
              <span class="medal-icon medal-gold">🌟</span>
              <div>
                <div class="stat-num" id="sum-ratio">${esc(tally.ratioText)}</div>
                <div class="stat-label">首答独立正确 / 已测已核验</div>
              </div>
            </div>
            <div class="stat-tile">
              <span class="medal-icon medal-bronze">✏️</span>
              <div>
                <div class="stat-num">${tally.blindSelfFixed + tally.answerCorrected + tally.answeredWrong + tally.hintedCorrect}</div>
                <div class="stat-label">自改(${tally.blindSelfFixed})·订正(${tally.answerCorrected})·仍错(${tally.answeredWrong})·提示(${tally.hintedCorrect})</div>
              </div>
            </div>
            <div class="stat-tile">
              <span class="medal-icon medal-silver">⬜</span>
              <div>
                <div class="stat-num" id="sum-blank-untested">空白 ${tally.blank} · 未测 ${tally.untested}</div>
                <div class="stat-label">空白已计入分母，未测单列</div>
              </div>
            </div>
            <div class="stat-tile">
              <span class="medal-icon medal-due">⏳</span>
              <div>
                <div class="stat-num" id="sum-pending">${tally.pendingVerify} 项</div>
                <div class="stat-label">待爸爸核验（确认后计入）</div>
              </div>
            </div>
          </div>
        `}

        ${needReviewIds.length ? `
          <div class="help-callout" style="text-align:left">
            <strong>📌 已排入下次课优先复测（${needReviewIds.length} 项）：</strong>
            ${needReviewIds.map(id => `<span style="font-weight:800;margin-right:12px">${esc(itemById(id)?.zh)}</span>`).join('')}
          </div>
        ` : ''}

        <div class="row" style="justify-content:center;margin-top:22px">
          <button type="button" class="btn btn-primary" data-act="close-summary">返回今日大厅</button>
          <button type="button" class="btn" data-goto-tab="ledger">查看复测与账本 📒</button>
        </div>
      </section>
    `;
  }

  // ==================== Tab 2: Vault ====================
  let vaultFilter = 'all';
  function renderVaultTab() {
    const u6Official = state.items.filter(it => it.unit === 6 && it.sourceScope === 'textbook_wordlist');
    const u6CoreCount = u6Official.filter(it => it.textbookCore).length;
    const u6StarCount = u6Official.filter(it => !it.textbookCore).length;
    const keySentences = state.items.filter(it => it.sourceScope === 'textbook_sentence' || it.type === 'sentence');

    const items = state.items.filter(it => {
      if (vaultFilter === 'u6') return it.unit === 6 && it.sourceScope === 'textbook_wordlist';
      if (vaultFilter === 'u5') return it.unit === 5 && it.sourceScope === 'textbook_wordlist';
      if (vaultFilter === 'sentences') return it.sourceScope === 'textbook_sentence' || it.type === 'sentence';
      if (vaultFilter === 'bridge') return it.sourceScope === 'foundation_bridge' || it.sourceScope === 'custom';
      if (vaultFilter === 'medals') return (state.mastery[it.id]?.badge || 'none') !== 'none';
      return true;
    });

    return `
      <section class="card">
        <div class="row between">
          <div>
            <h2 style="margin:0 0 4px">🏅 金银铜徽章图鉴 & 词句分层管理</h2>
            <p class="muted" style="margin:0">Unit 6 官方单元词表已核准为 <b>${u6Official.length} 项（核心词 ${u6CoreCount} 项 · 带 * 非核心词 ${u6StarCount} 项）</b>；重点默写句（${keySentences.length} 句）与补基础词独立分层。</p>
          </div>
          <div class="row">
            <button type="button" class="btn btn-sm ${vaultFilter === 'all' ? 'btn-primary' : ''}" data-vault-filter="all">全部 (${state.items.length})</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'sentences' ? 'btn-primary' : ''}" data-vault-filter="sentences">重点句子 (${keySentences.length})</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'u6' ? 'btn-primary' : ''}" data-vault-filter="u6">U6教材词表 (${u6Official.length})</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'u5' ? 'btn-primary' : ''}" data-vault-filter="u5">U5教材词表</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'bridge' ? 'btn-primary' : ''}" data-vault-filter="bridge">扩展补基础区</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'medals' ? 'btn-primary' : ''}" data-vault-filter="medals">已获徽章</button>
          </div>
        </div>
      </section>

      <div class="grid-2">
        ${items.map(it => {
          const m = state.mastery[it.id] || {};
          const audioInfo = SnapAudio.resolveSourceInfo(state, it);
          const scopeBadge = it.sourceScope === 'textbook_wordlist'
            ? `<span class="pill ${it.textbookCore ? 'pill-core' : 'pill-star'}">${it.textbookCore ? '教材核心词' : '带 * 非核心词'}</span>`
            : (it.sourceScope === 'textbook_sentence' ? `<span class="pill pill-core">教材重点句</span>` : `<span class="pill">扩展/家庭补基础</span>`);

          return `
            <article class="card" style="margin-bottom:0" data-vault-item="${esc(it.id)}">
              <div class="row between">
                <div>
                  <span class="english" style="font-size:23px;font-weight:900">${esc(it.en)}</span>
                  ${it.bookPage ? `<span class="pill">p.${it.bookPage}</span>` : ''}
                  ${scopeBadge}
                </div>
                ${badgeLabel(m)}
              </div>
              <p style="margin:6px 0;font-weight:700">${esc(it.zh)} <span class="muted">｜ ${esc(it.displayChunks || '')}</span></p>
              <p class="muted" style="margin:4px 0 10px">${esc(it.helpNote)}</p>
              <div class="row between">
                <button type="button" class="btn btn-sm" data-speak-item="${esc(it.id)}">🔊 听发音</button>
                <label class="muted" style="font-size:13px">
                  本班要求：
                  <select data-class-req="${esc(it.id)}" style="padding:4px 8px;font-size:13px">
                    <option value="dictation_verified" ${it.classRequirement === 'dictation_verified' ? 'selected' : ''}>老师要求必默</option>
                    <option value="read_meaning_use" ${it.classRequirement === 'read_meaning_use' ? 'selected' : ''}>先听读认义（不排默写）</option>
                    <option value="unverified_family" ${it.classRequirement === 'unverified_family' ? 'selected' : ''}>本班未核实·家庭练习选项</option>
                  </select>
                </label>
              </div>
              <div class="muted" style="font-size:12px;margin-top:8px">
                ${esc(audioInfo.label)}
                ${m.anchorD0 ? ` · 当前周期 D0=${m.anchorD0}` : ''}
                ${m.nextDueDate ? ` · 下次抽查：${m.nextDueDate}` : (m.stabilized ? ' · 已通过 D+7 归入低频抽样池' : '')}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  // ==================== Tab 3: Ledger (N01 Unified Actor + N03 Per-Event Correction + N05 Draft Preview) ====================
  function renderLedgerTab() {
    const targetActor = effectiveSessionActor();
    const isDemo = targetActor === 'parent_demo';
    const dueInfo = SnapCore.getDueQueue(state, SnapCore.todayISO(), 3);
    const studentSummary = SnapCore.getStatsSummary(state, 'student');
    const activeSummary = SnapCore.getStatsSummary(state, targetActor);

    const activePendingEvents = state.events.filter(e =>
      e.actor === targetActor && e.taskType === 'paper_check' && e.verificationStatus === 'pending'
    );
    const lockedStudentPendingCount = isDemo ? studentSummary.pendingVerifyCount : 0;

    // N03: Per-event uncorrected wrong query (each answered_wrong stays visible until its own linkedEventId is logged!)
    const unCorrectedWrongEvents = SnapCore.getUncorrectedWrongEvents(state, targetActor);
    const linkedCorrMap = new Map(
      state.events
        .filter(c => c.actor === targetActor && c.taskType === 'red_pen_correction' && c.linkedEventId)
        .map(c => [c.linkedEventId, c])
    );

    const recentEvents = state.events.filter(e => e.actor === targetActor).slice().reverse().slice(0, 40);

    return `
      ${isDemo ? `
        <section class="card" style="background:#fef3c7;border-color:#f59e0b">
          <div class="row between">
            <div>
              <strong>🛠️ 当前查看的是「家长演练账本」</strong>：此处一切核验点击仅作用于演练数据，学生正式成绩、章数与复测日期已被严格锁定隔离（当前学生正式正确率：<b>${esc(studentSummary.paperRatioText)}</b>${lockedStudentPendingCount ? `，另有 ${lockedStudentPendingCount} 条学生正式待核验项已锁定保护` : ''}）。
            </div>
            <button type="button" class="btn btn-sm btn-primary" data-act="switch-to-student-ledger">切回学生正式模式核验 →</button>
          </div>
        </section>
      ` : ''}

      ${activePendingEvents.length ? `
        <section class="card" style="border-color:#60a5fa;background:#eff6ff">
          <h2 style="margin-top:0">📸 待照片核验（${isDemo ? '演练数据' : '学生正式记录'} · 共 ${activePendingEvents.length} 项）</h2>
          <p class="muted" style="margin-top:0">共用主判分台完整五类结论（含“已作答仍错”与具体错误标签），选好后点右侧「确认入账」：</p>
          <div class="paper-list">
            ${activePendingEvents.map(ev => {
              const it = itemById(ev.itemId);
              const draft = pendingVerifyDrafts[ev.id] || { outcome: 'unjudged', tags: [] };
              return `
                <div class="paper-item" data-pending-row="${esc(ev.id)}">
                  <div class="row between">
                    <div>
                      <strong>${esc(it?.zh || ev.itemId)}</strong>
                      <span class="muted">（目标答案：<b class="english">${esc(ev.expectedAnswer || it?.en || '')}</b> · 施测日：${esc(ev.dateStr)} · 纸本：${esc(ev.paperRef || '')}${ev.hadSpellingHint ? ' · 💡含提示' : ''}）</span>
                    </div>
                    <button type="button" class="btn btn-sm btn-mint" data-confirm-verify="${esc(ev.id)}" ${draft.outcome === 'unjudged' ? 'disabled' : ''}>
                      ✅ 确认核验入账
                    </button>
                  </div>
                  <div class="outcome-group">
                    <button type="button" class="outcome-btn ${draft.outcome === 'paper_independent' ? 'selected-good' : ''}" data-pv-pick="${esc(ev.id)}" data-outcome="paper_independent">
                      ${ev.hadSpellingHint ? '💡 提示后写对' : '🌟 首答独立全对'}
                    </button>
                    <button type="button" class="outcome-btn ${draft.outcome === 'blind_self_fixed' ? 'selected-fix' : ''}" data-pv-pick="${esc(ev.id)}" data-outcome="blind_self_fixed">🔍 盲查自改正确</button>
                    <button type="button" class="outcome-btn ${draft.outcome === 'answer_corrected' ? 'selected-fix' : ''}" data-pv-pick="${esc(ev.id)}" data-outcome="answer_corrected">✏️ 见答案已订正</button>
                    <button type="button" class="outcome-btn ${draft.outcome === 'answered_wrong' ? 'selected-bad' : ''}" data-pv-pick="${esc(ev.id)}" data-outcome="answered_wrong">❌ 已作答仍错（未订正）</button>
                    <button type="button" class="outcome-btn ${draft.outcome === 'blank' ? 'selected-bad' : ''}" data-pv-pick="${esc(ev.id)}" data-outcome="blank">⬜ 已测但空白</button>
                  </div>
                  ${['blind_self_fixed', 'answer_corrected', 'answered_wrong'].includes(draft.outcome) ? `
                    <div class="row" style="gap:6px;margin-top:8px">
                      ${SNAPWORD_CURRICULUM.ERROR_TAGS.map(tag => {
                        const active = (draft.tags || []).includes(tag.id);
                        return `<button type="button" class="tag-chip ${active ? 'active' : ''}" data-pv-tag="${esc(ev.id)}" data-tag="${esc(tag.id)}">${esc(tag.label)}</button>`;
                      }).join('')}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </section>
      ` : ''}

      ${unCorrectedWrongEvents.length ? `
        <section class="card" style="border-color:#fca5a5;background:#fff1f2">
          <h3 style="margin-top:0">✏️ 已作答仍错 · 待补红笔订正追踪（${unCorrectedWrongEvents.length} 项）</h3>
          <p class="muted" style="margin-top:0">孩子在纸本补完红笔订正后，可点右侧追加订正记录（原首答“已作答仍错”永久保留可追溯，该词继续留在下次独立复测队列）：</p>
          <div class="paper-list">
            ${unCorrectedWrongEvents.map(ev => {
              const it = itemById(ev.itemId);
              return `
                <div class="paper-item row between">
                  <div>
                    <strong>${esc(it?.zh || ev.itemId)}</strong>
                    <span class="muted">（原施测：${esc(ev.paperRef || ev.dateStr)} · 错误标签：${esc((ev.errorTags || []).join(', ') || '无')}）</span>
                  </div>
                  <button type="button" class="btn btn-sm btn-primary" data-followup-corr="${esc(ev.id)}">✏️ 登记已完成红笔订正</button>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      ` : ''}

      <section class="card">
        <div class="row between">
          <div>
            <h2 style="margin:0 0 4px">📅 学生正式到期复测队列（共 ${dueInfo.totalDue} 项到期 · 暂稳定低频池 ${dueInfo.lowFreqPool.length} 项）</h2>
            <p class="muted" style="margin:0">按首次独立写对当天 D0 排定 <b>D0+1、D0+3、D0+7</b>（提前练习照常记录但不提前跳过未到期的延迟检查点）。</p>
          </div>
          <button type="button" class="btn btn-primary" data-act="start-due-review" ${dueInfo.todayPick.length ? '' : 'disabled'}>
            ✍️ 立即独立纸写抽查前 ${dueInfo.todayPick.length} 项
          </button>
        </div>

        ${dueInfo.todayPick.length ? `
          <div class="grid-3" style="margin-top:14px">
            ${dueInfo.todayPick.map((d, i) => `
              <div class="paper-item">
                <div class="row between"><strong>#${i + 1} ${esc(d.item.zh)}</strong>${badgeLabel(d.m)}</div>
                <div class="muted" style="font-size:12.5px;margin-top:4px">${esc(d.reason)} · 应测日：${esc(d.m.nextDueDate || '下次课优先')}</div>
              </div>
            `).join('')}
          </div>
          <details style="margin-top:10px">
            <summary class="muted" style="cursor:pointer;font-weight:700">👁️ 家长背屏核对到期英文词单（孩子看屏幕时请勿展开）</summary>
            <div class="muted english" style="margin-top:6px">
              ${dueInfo.allDue.map(d => `<span style="margin-right:14px"><b>${esc(d.item.en)}</b> (${esc(d.item.zh)} · ${esc(d.m.nextDueDate || '优先')})</span>`).join('')}
            </div>
          </details>
        ` : `<p class="muted" style="margin-top:12px">🎉 当前没有到期必抽项！</p>`}
      </section>

      <section class="card">
        <h2 style="margin:0 0 8px">📊 ${isDemo ? '演练统计预览' : '学生正式纸笔统计'}</h2>
        <p style="margin:0 0 10px;font-weight:700">
          首答独立正确 / 已出题且已核验：<span id="ledger-ratio" class="english" style="font-size:20px;color:var(--primary-dark)">${esc(activeSummary.paperRatioText)}</span>
          <span class="muted" style="font-weight:400;margin-left:12px">
            （已答仍错：<b>${activeSummary.answeredWrongCount}</b> · 已测空白：<b>${activeSummary.blankCount}</b> 计入分母 ｜ 另单列未测：<b>${activeSummary.untestedCount}</b> · 待核验：<b>${activeSummary.pendingVerifyCount}</b>）
          </span>
        </p>
        <div class="row">
          ${SNAPWORD_CURRICULUM.ERROR_TAGS.map(t => {
            const count = activeSummary.errorTotals[t.id] || 0;
            return `<span class="pill" style="padding:7px 13px;font-size:13.5px;${count ? 'background:#fee2e2;color:#991b1b' : ''}">${esc(t.label)}：<b>${count}</b></span>`;
          }).join('')}
        </div>
      </section>

      <section class="card">
        <h2 style="margin:0 0 8px">💾 备份导出与差异预览恢复（严格遵守冲突保留策略）</h2>
        <div class="row">
          <button type="button" class="btn btn-primary" data-act="export-json">⬇️ 导出完整 JSON 备份</button>
          <button type="button" class="btn" data-act="trigger-import">📂 选择 JSON 备份预览差异</button>
          <input type="file" id="import-file-input" accept=".json,application/json" hidden>
        </div>
        ${pendingImportPreview ? renderImportPreviewCard(pendingImportPreview) : ''}
      </section>

      <section class="card">
        <h3 style="margin-top:0">🕒 ${isDemo ? '演练流水' : '学生正式记录明细'}</h3>
        ${recentEvents.length ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13.5px">
              <thead>
                <tr style="border-bottom:2px solid var(--border);text-align:left">
                  <th style="padding:7px">施测日</th>
                  <th style="padding:7px">题号/词条</th>
                  <th style="padding:7px">出题方式与标准答案</th>
                  <th style="padding:7px">结果</th>
                  <th style="padding:7px">核验状态</th>
                  <th style="padding:7px">可见表现/备注</th>
                </tr>
              </thead>
              <tbody>
                ${recentEvents.map(e => {
                  const it = itemById(e.itemId);
                  let corrTrace = '';
                  if (e.outcome === 'answered_wrong') {
                    corrTrace = linkedCorrMap.has(e.id) ? ' · ✅已关联红笔订正' : ' · ⏳待补红笔订正';
                  } else if (e.taskType === 'red_pen_correction' && e.linkedEventId) {
                    corrTrace = ` · 🔗关联原题(${e.linkedEventId})`;
                  }
                  return `<tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:7px">${esc(e.dateStr)}</td>
                    <td style="padding:7px"><b>${esc(it?.zh || e.itemId)}</b> <span class="muted">(${esc(e.paperRef || '')})</span></td>
                    <td style="padding:7px">${esc(e.promptMode || '—')} · <span class="english">${esc(e.expectedAnswer || '')}</span>${e.hadSpellingHint ? ' · <span style="color:#b45309;font-weight:700">含提示</span>' : ''}</td>
                    <td style="padding:7px">${esc(e.outcome)}${esc(corrTrace)}</td>
                    <td style="padding:7px">${esc(e.verificationStatus)} (${esc(e.verifiedBy || '—')})</td>
                    <td style="padding:7px" class="muted">${esc((e.errorTags || []).join(', ') || e.note || '—')}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="muted">暂无记录。</p>`}
      </section>
    `;
  }

  function formatDraftBrief(d) {
    if (!d) return '无草稿';
    const timeLabel = d.savedAt ? new Date(d.savedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间';
    const modeStr = d.modes?.length ? ` · 出题:${d.modes.join('/')}` : '';
    const hintStr = d.hintedCount ? ` · 提示:${d.hintedCount}项` : ' · 无提示';
    const dateStr = d.dates?.length ? ` · 施测日:${d.dates.join('/')}` : '';
    return `${d.packTitle}（已判 ${d.gradedCount}/${d.paperCount} 项${modeStr}${hintStr}${dateStr} · 保存于 ${timeLabel}）`;
  }

  // R06 + N05: Explicit itemized upgrade, conflict & two-slot draft preview
  function renderImportPreviewCard(preview) {
    if (preview.kind === 'snapword') {
      const stuSlot = preview.draftSlots?.student;
      const demoSlot = preview.draftSlots?.parent_demo;
      const keepDraftValue = preview.hasDraftConflicts ? 'keep_local' : 'skip_incoming';
      return `
        <div class="help-callout" style="margin-top:14px">
          <strong>🔍 备份四分类差异预览（导入后保持本机角色「${effectiveSessionActor() === 'parent_demo' ? '家长演练' : '学生正式'}」不变）：</strong>
          <ul style="margin:6px 0;padding-left:20px">
            <li>新增正式记录：<b>${preview.added}</b> 条</li>
            <li>完全相同跳过：<b>${preview.identical}</b> 条</li>
            <li>待核验升级为已核验：<b>${preview.verifiedUpgrades}</b> 条</li>
            <li>已核验内容冲突：<b>${preview.conflicts}</b> 条（另忽略备份演练记录 ${preview.demoEventCount} 条）</li>
          </ul>
          ${preview.upgradeDetails?.length ? `
            <div class="muted" style="margin:6px 0">
              <strong>将自动升级的待核验条目：</strong>
              ${preview.upgradeDetails.map(u => `[${esc(u.dateStr)} ${esc(u.label)} ➔ ${esc(u.toOutcome)}]`).join('；')}
            </div>
          ` : ''}
          ${preview.conflictDetails?.length ? `
            <div style="margin:8px 0;padding:10px;background:#fff;border-radius:10px;border:1px solid #f59e0b">
              <div style="font-weight:800;margin-bottom:6px">⚠️ 检测到已核验记录冲突（无论版本号高低，均严格按您下方选择的策略执行）：</div>
              <div style="margin-bottom:8px">
                <label style="margin-right:14px;cursor:pointer"><input type="radio" name="conflict-pol" value="prefer_incoming" ${importConflictPolicy === 'prefer_incoming' ? 'checked' : ''}> 采用导入备份版本</label>
                <label style="cursor:pointer"><input type="radio" name="conflict-pol" value="keep_local" ${importConflictPolicy === 'keep_local' ? 'checked' : ''}> 保留本机现有版本</label>
              </div>
              <ul class="muted" style="margin:0;padding-left:18px;font-size:13px">
                ${preview.conflictDetails.map(c => `
                  <li>
                    <b>${esc(c.dateStr)} · ${esc(c.label)}</b>：本机为 <code>${esc(c.localOutcome)} (rev ${c.localRev})</code> vs 备份为 <code>${esc(c.incomingOutcome)} (rev ${c.incomingRev})</code>
                    ➔ <b>将采用：${importConflictPolicy === 'keep_local' ? '本机现有版本' : '导入备份版本'}</b>
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}

          <div style="margin:8px 0;padding:10px;background:#fff;border-radius:10px;border:1px solid ${preview.hasDraftConflicts ? '#f59e0b' : '#93c5fd'}" id="import-draft-preview">
            <div style="font-weight:800;margin-bottom:6px">
              ${preview.hasDraftConflicts ? '⚠️ 检测到未完课草稿槽差异冲突（含题面方式、提示标记或施测日期差异）：' : '📝 未完课草稿槽预览（双身份槽核对）：'}
            </div>
            <ul class="muted" style="margin:0 0 8px;padding-left:18px;font-size:13px">
              <li><b>🎒 学生正式草稿槽</b>：本机「${esc(formatDraftBrief(stuSlot?.local))}」 ｜ 备份「${esc(formatDraftBrief(stuSlot?.incoming))}」</li>
              <li><b>🛠️ 家长演练草稿槽</b>：本机「${esc(formatDraftBrief(demoSlot?.local))}」 ｜ 备份「${esc(formatDraftBrief(demoSlot?.incoming))}」</li>
            </ul>
            ${preview.hasIncomingDrafts ? `
              <div>
                <label style="margin-right:14px;cursor:pointer">
                  <input type="radio" name="draft-pol" value="restore_incoming" ${importDraftPolicy === 'restore_incoming' ? 'checked' : ''}>
                  ${preview.hasDraftConflicts ? '采用备份草稿覆盖本机同槽草稿' : '恢复备份中的挂起草稿（含题面快照、判分与纸本备注）'}
                </label>
                <label style="cursor:pointer">
                  <input type="radio" name="draft-pol" value="${keepDraftValue}" ${importDraftPolicy !== 'restore_incoming' ? 'checked' : ''}>
                  保留本机现有草稿状态（不导入备份草稿）
                </label>
              </div>
            ` : `<div class="muted" style="font-size:12.5px">备份中不含未完课草稿，本机现有草稿将原样保留。</div>`}
          </div>

          <div class="row" style="margin-top:10px">
            <button type="button" class="btn btn-sm btn-mint" data-act="confirm-import-snapword">确认执行合并</button>
            <button type="button" class="btn btn-sm" data-act="cancel-import">取消</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="help-callout" style="margin-top:14px">
        <strong>⚠️ 旧版《词汇撤离》备份预览：</strong>
        <p style="margin:6px 0">${esc(preview.warning)}</p>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn-sm btn-primary" data-act="confirm-import-legacy-words">提取词条（${preview.wordCount} 项）并隔离归档打字日志（${preview.typingEventCount} 条）</button>
          <button type="button" class="btn btn-sm" data-act="cancel-import">取消</button>
        </div>
      </div>
    `;
  }

  // ==================== Tab 4: Coach Prep & F07 Audio Check ====================
  function renderPrepTab() {
    const attributionEntries = typeof SNAPWORD_AUDIO_CLIPS !== 'undefined' ? Object.entries(SNAPWORD_AUDIO_CLIPS) : [];
    const chk = state.audioCheckLog;

    return `
      <section class="card">
        <h2 style="margin-top:0">⚙️ 学习者设置与本班拼写判分口径</h2>
        <form id="profile-form" class="row">
          <label>学习者昵称：
            <input type="text" id="prof-nickname" maxlength="24" value="${esc(state.profile.nickname)}">
          </label>
          <label>单次温和提醒时长（分钟）：
            <input type="number" id="prof-budget" min="8" max="35" value="${Number(state.profile.budgetMinutes || 18)}" style="width:85px">
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="prof-allow-us" ${state.classSettings?.allowAmericanSpelling ? 'checked' : ''}>
            本班允许美式拼写变体（如接受 favorite / neighbor）
          </label>
          <button type="submit" class="btn btn-primary btn-sm">保存设置</button>
        </form>
      </section>

      <section class="card">
        <h2 style="margin-top:0">⚡ 快速粘贴建包（自动关联词库本班标签，支持三栏分配预览）</h2>
        <p class="muted">每行按 <code>英文 | 中文</code> 粘贴，生成后将在大厅预览中按本班要求清晰分流纸写、认读与候选。</p>
        <form id="quick-pack-form">
          <div class="row" style="margin-bottom:10px">
            <label style="flex:1;min-width:240px">新课程包标题：
              <input type="text" id="qp-title" placeholder="例：11月24日 · U6 默写与预读清单" required style="width:100%">
            </label>
          </div>
          <textarea id="qp-lines" placeholder="Saturday | 星期六&#10;Sunday | 星期日&#10;classmate | 同班同学&#10;problem | 问题" required></textarea>
          <div class="row" style="margin-top:10px">
            <button type="submit" class="btn btn-primary">✨ 生成课程包并打开当晚出题预览 →</button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2 style="margin-top:0">🎧 目标电脑 1 分钟实机试听核验卡（F07 实机检查）</h2>
        <p class="muted">正式带教前，请在孩子的实际电脑浏览器上同时接通向日葵与手机微信视频，依次试听以下三类音源样本：</p>
        <div class="row" style="margin:10px 0">
          <button type="button" class="btn btn-sm" data-speak-item="u6_wall">① 试听内置真人词 (wall)</button>
          <button type="button" class="btn btn-sm" data-speak-item="u6_do_homework">② 试听系统合成短语 (do your homework)</button>
          <button type="button" class="btn btn-sm" data-speak-raw="I usually play football on Saturday.">③ 试听完整英文句子</button>
        </div>
        <form id="audio-check-form" class="row">
          <input type="text" id="ac-note" placeholder="记录孩子电脑实机听感" value="${esc(chk?.note || '')}" style="flex:1;min-width:260px">
          <button type="submit" class="btn btn-sm btn-mint">记录实机试听完成</button>
        </form>
        ${chk ? `<div class="muted" style="margin-top:6px">✅ 上次实机核验时间：${esc(chk.dateStr)} · 备注：${esc(chk.note)}</div>` : ''}
      </section>

      <section class="card">
        <h2 style="margin-top:0">🎙️ 为词条绑定自带真人录音（可选）</h2>
        <form id="custom-audio-form" class="row">
          <select id="ca-item" style="max-width:340px">
            ${state.items.map(it => `<option value="${esc(it.id)}">${esc(it.en)}（${esc(it.zh)}）</option>`).join('')}
          </select>
          <input type="file" id="ca-file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" required>
          <button type="submit" class="btn btn-sm btn-primary">绑定保存</button>
        </form>

        <details style="margin-top:16px">
          <summary style="cursor:pointer;font-weight:700" class="muted">📜 查看内置公开授权真人录音来源与 CC 署名（${attributionEntries.length} 项）</summary>
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

  // ==================== Event Handlers ====================
  function bindEvents() {
    // R05: Intercept tab navigation if due_precheck has uncollected due items!
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.onclick = () => {
        const targetTab = btn.dataset.nav;
        if (targetTab !== 'learn' && activeSession && activeSession.dueIds?.length && !activeSession.duePrewritten && activeSession.paperPhase !== 'summary') {
          dueNavGate = { kind: 'tab', target: targetTab };
          render();
          return;
        }
        SnapAudio.stop();
        currentTab = targetTab;
        render();
      };
    });

    document.querySelectorAll('[data-goto-tab]').forEach(btn => {
      btn.onclick = async () => {
        SnapAudio.stop();
        if (activeSession?.paperPhase === 'summary' || activeSession?.oralPhase === 'summary') {
          const doneActor = activeSession.lockedActor || state.actorMode;
          activeSession = null;
          setActorDraft(doneActor, null);
        }
        currentTab = btn.dataset.gotoTab;
        render();
        await saveState();
      };
    });

    const actorBtn = $('#actor-toggle');
    if (actorBtn) {
      actorBtn.onclick = () => requestActorSwitch();
    }

    document.querySelector('[data-act="switch-to-student-ledger"]')?.addEventListener('click', () => {
      requestActorSwitch('student');
    });

    document.querySelectorAll('[data-role-modal]').forEach(btn => {
      btn.onclick = async () => {
        const act = btn.dataset.roleModal;
        const targetActor = roleSwitchModalOpen?.targetActor || (effectiveSessionActor() === 'student' ? 'parent_demo' : 'student');
        roleSwitchModalOpen = null;
        if (act === 'suspend_switch') {
          SnapAudio.stop();
          const prevActor = activeSession?.lockedActor || state.actorMode;
          if (activeSession) {
            const suspended = SnapCore.clone(activeSession);
            suspended.draftStatus = 'suspended';
            suspended.savedAt = Date.now();
            setActorDraft(prevActor, suspended);
            activeSession = null;
          }
          state.actorMode = targetActor;
          syncActiveDraftFromActor();
          pendingVerifyDrafts = {};
          render();
          await saveState();
          toast('已暂存原课草稿并完成身份切换');
        } else if (act === 'discard_switch') {
          SnapAudio.stop();
          const prevActor = activeSession?.lockedActor || state.actorMode;
          activeSession = null;
          setActorDraft(prevActor, null);
          state.actorMode = targetActor;
          syncActiveDraftFromActor();
          pendingVerifyDrafts = {};
          render();
          await saveState();
          toast('已结束原课并切换至新身份');
        } else {
          render();
        }
      };
    });

    // R05: Due Pre-check Navigation Gate handlers
    document.querySelectorAll('[data-due-gate]').forEach(btn => {
      btn.onclick = async () => {
        const action = btn.dataset.dueGate;
        const gate = dueNavGate;
        dueNavGate = null;
        if (!activeSession || !gate || action === 'stay') {
          render();
          return;
        }
        if (action === 'confirm_written') {
          lockItemsContext(activeSession, activeSession.dueIds);
          activeSession.duePrewritten = true;
        } else if (action === 'mark_exposed') {
          markUnwrittenDueExposed(activeSession, 'pre_answer_navigation');
        }
        SnapAudio.stop();
        if (gate.kind === 'step') {
          activeSession.step = gate.target;
          if (activeSession.step === 'snap' && !activeSession.snapState) initSnapCardState();
        } else if (gate.kind === 'tab') {
          currentTab = gate.target;
        }
        render();
        await saveState();
      };
    });

    $('#pack-select')?.addEventListener('change', async e => {
      state.selectedPackId = e.target.value;
      render();
      await saveState();
    });

    document.querySelectorAll('[data-select-pack]').forEach(btn => {
      btn.onclick = async () => {
        const pid = btn.dataset.selectPack;
        if (state.packs.some(p => p.id === pid)) {
          state.selectedPackId = pid;
          render();
          await saveState();
        }
      };
    });

    document.querySelectorAll('[data-pack-item-act]').forEach(sel => {
      sel.onchange = async () => {
        const pack = selectedPack();
        state.packOverrides = state.packOverrides || {};
        state.packOverrides[pack.id] = state.packOverrides[pack.id] || {};
        state.packOverrides[pack.id][sel.dataset.packItemAct] = sel.value;
        render();
        await saveState();
      };
    });

    document.querySelectorAll('[data-start-mode]').forEach(btn => {
      btn.onclick = () => startSession(btn.dataset.startMode);
    });

    document.querySelector('[data-quick-baseline]')?.addEventListener('click', () => {
      startSession('baseline');
    });

    // R01: Resume & Discard Suspended Drafts
    document.querySelector('[data-act="resume-draft"]')?.addEventListener('click', async () => {
      if (state.activeDraft && state.activeDraft.lockedActor === state.actorMode) {
        activeSession = SnapCore.clone(state.activeDraft);
        activeSession.draftStatus = 'in_progress';
        setActorDraft(state.actorMode, activeSession);
        render();
        await saveState();
      }
    });

    document.querySelector('[data-act="discard-draft"]')?.addEventListener('click', async () => {
      setActorDraft(state.actorMode, null);
      activeSession = null;
      render();
      await saveState();
      toast('已清除未完课草稿');
    });

    document.querySelector('[data-act="pause-session"]')?.addEventListener('click', () => {
      suspendSessionToDraft();
    });

    document.querySelector('[data-act="abandon-session"]')?.addEventListener('click', async () => {
      if (!activeSession) return;
      if (hasMeaningfulProgress(activeSession)) {
        await suspendSessionToDraft();
        return;
      }
      SnapAudio.stop();
      const curActor = activeSession.lockedActor || state.actorMode;
      activeSession = null;
      setActorDraft(curActor, null);
      render();
      await saveState();
    });

    document.querySelector('[data-act="close-summary"]')?.addEventListener('click', async () => {
      const curActor = activeSession?.lockedActor || state.actorMode;
      activeSession = null;
      setActorDraft(curActor, null);
      render();
      await saveState();
    });

    // R05: Step navigation checks due_precheck gate first!
    document.querySelectorAll('[data-jump-step]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        const targetStep = btn.dataset.jumpStep;
        if (targetStep !== 'due_precheck' && activeSession.dueIds?.length && !activeSession.duePrewritten) {
          dueNavGate = { kind: 'step', target: targetStep };
          render();
          return;
        }
        SnapAudio.stop();
        activeSession.step = targetStep;
        if (activeSession.step === 'snap' && !activeSession.snapState) initSnapCardState();
        render();
        await saveState();
      };
    });

    document.querySelectorAll('[data-complete-step]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        activeSession.stepsDone[btn.dataset.completeStep] = true;
        activeSession.step = btn.dataset.nextStep;
        if (activeSession.step === 'snap' && !activeSession.snapState) initSnapCardState();
        render();
        await saveState();
      };
    });

    // R07: Lock Step 0 pre-check contexts before advancing so later promptMode changes don't overwrite them!
    document.querySelector('[data-act="finish-due-precheck"]')?.addEventListener('click', async () => {
      if (!activeSession) return;
      lockItemsContext(activeSession, activeSession.dueIds);
      activeSession.duePrewritten = true;
      activeSession.step = activeSession.mode === 'quick8'
        ? (activeSession.focusIds.length ? 'snap' : (activeSession.paperIds.length ? 'paper' : 'oral_wrapup'))
        : 'board';
      render();
      await saveState();
    });

    // R07: Scoped promptMode change ONLY updates unlocked items in current scope (leaving locked Step 0 due items untouched!)
    $('#prompt-mode-select')?.addEventListener('change', async e => {
      if (!activeSession) return;
      activeSession.promptMode = e.target.value;
      const scope = e.target.dataset.modeScope;
      if (scope === 'due_precheck') {
        refreshUnlockedContexts(activeSession, activeSession.dueIds);
      } else {
        const unlockedIds = activeSession.paperIds.filter(id => !activeSession.itemContexts?.[id]?.locked);
        refreshUnlockedContexts(activeSession, unlockedIds);
      }
      render();
      await saveState();
    });

    document.querySelectorAll('[data-context-variant]').forEach(sel => {
      sel.onchange = async () => {
        if (!activeSession) return;
        const id = sel.dataset.contextVariant;
        const prev = activeSession.itemContexts?.[id];
        ensureItemContext(activeSession, id, {
          promptMode: prev?.promptMode || activeSession.promptMode,
          variantKey: sel.value
        });
        render();
        await saveState();
      };
    });

    document.querySelectorAll('[data-give-paper-hint]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        const id = btn.dataset.givePaperHint;
        activeSession.showChunkHint = activeSession.showChunkHint || {};
        activeSession.hintedOnPaper = activeSession.hintedOnPaper || {};
        activeSession.lockedHint = activeSession.lockedHint || {};
        activeSession.showChunkHint[id] = true;
        activeSession.hintedOnPaper[id] = true;
        activeSession.lockedHint[id] = true;
        render();
        await saveState();
      };
    });

    // R07: Context-aligned audio playback (speaks ctx.spokenText when different from item.en!)
    document.querySelectorAll('[data-speak-context]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        const id = btn.dataset.speakContext;
        const it = itemById(id);
        const ctx = ensureItemContext(activeSession, id, { preserveExisting: true });
        if (!it || !ctx) return;
        if (SnapCore.normText(ctx.spokenText).toLowerCase() === SnapCore.normText(it.en).toLowerCase()) {
          SnapAudio.play(state, it, toast);
        } else {
          SnapAudio.play(state, ctx.spokenText, toast);
        }
      };
    });

    document.querySelectorAll('[data-speak-item]').forEach(btn => {
      if (btn.hasAttribute('data-speak-context')) return;
      btn.onclick = () => {
        const it = itemById(btn.dataset.speakItem);
        if (it) SnapAudio.play(state, it, toast);
      };
    });

    document.querySelectorAll('[data-speak-raw]').forEach(btn => {
      btn.onclick = () => SnapAudio.play(state, btn.dataset.speakRaw, toast);
    });

    // Blackboard & Pre-read
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
      SnapAudio.play(state, buildSlotSentence().en, toast);
    });

    document.querySelector('[data-act="push-board"]')?.addEventListener('click', async () => {
      const en = $('#custom-board-en')?.value.trim() || '';
      if (!en) { toast('请先输入一句英文短句'); return; }
      slotUI.customEn = en;
      slotUI.customZh = $('#custom-board-zh')?.value.trim() || '视频口语真话';
      slotUI.customHl = $('#custom-board-hl')?.value.trim() || '';
      state.boardNotes.unshift({ id: SnapCore.uid('bn'), en: slotUI.customEn, zh: slotUI.customZh, highlight: slotUI.customHl, at: Date.now() });
      state.boardNotes = state.boardNotes.slice(0, 30);
      render();
      await saveState();
    });

    document.querySelector('[data-act="clear-board"]')?.addEventListener('click', () => {
      slotUI.customEn = ''; slotUI.customZh = ''; slotUI.customHl = '';
      render();
    });

    $('#preread-note-input')?.addEventListener('input', e => {
      if (activeSession) activeSession.prereadNote = e.target.value;
    });

    document.querySelector('[data-act="mark-preread-done"]')?.addEventListener('click', async () => {
      if (!activeSession) return;
      activeSession.prereadDone = true;
      const refItem = activeSession.oralOnlyIds?.[0] || activeSession.focusIds?.[0];
      if (refItem) {
        SnapCore.recordEvent(state, {
          sessionId: activeSession.sessionId,
          actor: activeSession.lockedActor,
          itemId: refItem,
          taskType: 'oral_comprehension',
          outcome: 'done',
          note: activeSession.prereadNote || '完成课文情境听读理解回应'
        });
      }
      render();
      await saveState();
      toast('已记录课文预读与理解回应');
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
            SnapCore.recordEvent(state, {
              sessionId: activeSession.sessionId,
              actor: activeSession.lockedActor,
              itemId: item.id,
              taskType: 'scaffold_snap',
              outcome: 'done'
            });
            SnapAudio.play(state, item, toast);
          }
          render();
          await saveState();
        } else {
          st.wobbleKey = tile.key;
          st.bounceTip = tile.tip || `🤔 这一块不对哦，先听整词发音再看第 ${st.filled.length + 1} 块！`;
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

    const enterBlindCloze = () => {
      if (!activeSession?.snapState) return;
      activeSession.snapState.inClozeMode = true;
      activeSession.snapState.clozeFeedback = '';
      render();
      $('#cloze-input')?.focus();
    };

    document.querySelector('[data-act="open-cloze"]')?.addEventListener('click', enterBlindCloze);
    document.querySelector('[data-act="enter-cloze"]')?.addEventListener('click', enterBlindCloze);

    document.querySelector('[data-act="exit-cloze-peek"]')?.addEventListener('click', () => {
      if (!activeSession?.snapState) return;
      activeSession.snapState.inClozeMode = false;
      activeSession.snapState.clozeDraft = '';
      activeSession.snapState.clozeFeedback = '';
      render();
    });

    $('#cloze-input')?.addEventListener('input', e => {
      if (activeSession?.snapState) {
        activeSession.snapState.clozeDraft = e.target.value;
      }
    });

    $('#cloze-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const st = activeSession?.snapState;
      if (!st) return;
      const item = itemById(st.itemId);
      const rawVal = $('#cloze-input')?.value ?? '';
      st.clozeDraft = rawVal;
      const val = SnapCore.normText(rawVal);
      const ans = SnapCore.normText(item.cloze.blank);
      if (val === ans || (!/[A-Z]/.test(ans) && val.toLowerCase() === ans.toLowerCase())) {
        st.clozeDone = true;
        st.clozeFeedback = '';
        SnapCore.recordEvent(state, {
          sessionId: activeSession.sessionId,
          actor: activeSession.lockedActor,
          itemId: item.id,
          taskType: 'scaffold_cloze',
          outcome: 'done'
        });
        render();
        await saveState();
      } else {
        st.clozeTries = (st.clozeTries || 0) + 1;
        const wordCount = ans.split(' ').filter(Boolean).length;
        if (val && val.toLowerCase() === ans.toLowerCase()) {
          st.clozeFeedback = '🎩 字母拼写全对啦！再检查一下大小写是否正确？';
        } else if (ans.includes(' ') && val.toLowerCase().replace(/\s+/g, '') === ans.toLowerCase().replace(/\s+/g, '')) {
          st.clozeFeedback = '✂️ 单词拼对啦！词与词之间记得敲空格分开哦！';
        } else {
          st.clozeFeedback = `🤔 还差一点点（这一空共 ${wordCount > 1 ? `${wordCount} 个单词` : `${ans.length} 个字母`}），可点上方 🔊 听发音再想想！`;
        }
        render();
        $('#cloze-input')?.focus();
      }
    });

    const advanceSnapWord = async () => {
      if (!activeSession) return;
      if (activeSession.snapIndex + 1 < activeSession.focusIds.length) {
        activeSession.snapIndex++;
        initSnapCardState();
      } else {
        activeSession.stepsDone.snap = true;
        activeSession.step = activeSession.mode === 'quick8'
          ? (activeSession.paperIds.length ? 'paper' : 'oral_wrapup')
          : 'bug';
      }
      render();
      await saveState();
    };

    document.querySelector('[data-act="next-word"]')?.addEventListener('click', advanceSnapWord);
    document.querySelector('[data-act="skip-to-next-word"]')?.addEventListener('click', advanceSnapWord);
    document.querySelector('[data-act="prev-word"]')?.addEventListener('click', async () => {
      if (activeSession?.snapIndex > 0) {
        activeSession.snapIndex--;
        initSnapCardState();
        render();
        await saveState();
      }
    });

    // Bug Hunter
    document.querySelectorAll('[data-bug-idx]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        const idx = Number(btn.dataset.bugIdx);
        const card = SNAPWORD_CURRICULUM.BUG_CARDS.find(b => b.id === activeSession.bugCardId) || SNAPWORD_CURRICULUM.BUG_CARDS[0];
        const tok = card.tokens[idx];
        if (!tok || activeSession.bugFixed[idx]) return;
        if (!tok.isBug) {
          toast(`「${tok.text}」拼写正确，没有藏臭虫哦！`);
          return;
        }
        activeSession.bugPickingIdx = idx;
        render();
      };
    });

    document.querySelectorAll('[data-bug-fix]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession || activeSession.bugPickingIdx == null) return;
        const idx = activeSession.bugPickingIdx;
        const card = SNAPWORD_CURRICULUM.BUG_CARDS.find(b => b.id === activeSession.bugCardId) || SNAPWORD_CURRICULUM.BUG_CARDS[0];
        const tok = card.tokens[idx];
        if (btn.dataset.bugFix === tok.fix) {
          activeSession.bugFixed[idx] = true;
          activeSession.bugPickingIdx = null;
          toast('🐛💥 啪！臭虫拍扁啦：' + tok.tip);
          render();
          await saveState();
        } else {
          toast('🧐 这个还是原来的错词哦，选另一个正确的！');
        }
      };
    });

    // R02 + N04: Pure Oral Wrap-up explicit confirmation handlers
    document.querySelector('[data-act="check-all-oral"]')?.addEventListener('click', async () => {
      if (!activeSession) return;
      activeSession.oralChecked = activeSession.oralChecked || {};
      const ids = activeSession.oralOnlyIds || [];
      const allChecked = ids.length > 0 && ids.every(id => Boolean(activeSession.oralChecked[id]));
      ids.forEach(id => { activeSession.oralChecked[id] = !allChecked; });
      render();
      await saveState();
    });

    document.querySelectorAll('[data-oral-check]').forEach(chk => {
      chk.onchange = async () => {
        if (!activeSession) return;
        activeSession.oralChecked = activeSession.oralChecked || {};
        activeSession.oralChecked[chk.dataset.oralCheck] = chk.checked;
        render();
        await saveState();
      };
    });

    document.querySelector('[data-act="finish-oral-session"]')?.addEventListener('click', async () => {
      if (!activeSession || submitLock) return;
      submitLock = true;
      try {
        let oralDoneCount = 0;
        const oralUnconfirmedIds = [];
        for (const id of (activeSession.oralOnlyIds || [])) {
          if (Boolean(activeSession.oralChecked?.[id])) {
            oralDoneCount++;
            SnapCore.recordEvent(state, {
              id: `oral_${activeSession.sessionId}_${id}`,
              sessionId: activeSession.sessionId,
              actor: activeSession.lockedActor,
              recordedBy: 'parent',
              itemId: id,
              taskType: 'read_aloud',
              outcome: 'done',
              note: '家长确认已完成本轮听读认义'
            });
          } else {
            oralUnconfirmedIds.push(id);
          }
        }
        activeSession.summary = { oralDoneCount, oralUnconfirmedIds, needReviewIds: [] };
        activeSession.oralPhase = 'summary';
        setActorDraft(activeSession.lockedActor || state.actorMode, null);
        await saveState();
        render();
      } finally {
        submitLock = false;
      }
    });

    // Paper Station handlers
    document.querySelectorAll('[data-paper-phase]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        highlightUnjudged = false;
        if (btn.dataset.paperPhase !== 'dictate') {
          lockItemsContext(activeSession, activeSession.paperIds);
        }
        activeSession.paperPhase = btn.dataset.paperPhase;
        render();
        await saveState();
      };
    });

    document.querySelectorAll('[data-blind-box]').forEach(box => {
      box.onchange = async () => {
        if (!activeSession) return;
        activeSession.blindChecks[box.dataset.blindBox] = box.checked;
        render();
        await saveState();
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

    document.querySelector('[data-act="toggle-mask-all"]')?.addEventListener('click', () => {
      if (!activeSession) return;
      const items = activeSession.paperIds;
      const allMasked = items.every(id => Boolean(activeSession.maskedAnswers[id]));
      items.forEach(id => { activeSession.maskedAnswers[id] = !allMasked; });
      render();
    });

    document.querySelectorAll('[data-toggle-hinted]').forEach(chk => {
      chk.onchange = async () => {
        if (!activeSession) return;
        const id = chk.dataset.toggleHinted;
        if (activeSession.lockedHint?.[id]) return;
        activeSession.hintedOnPaper = activeSession.hintedOnPaper || {};
        activeSession.hintedOnPaper[id] = chk.checked;
        render();
        await saveState();
      };
    });

    document.querySelectorAll('[data-paper-ref]').forEach(inp => {
      inp.onchange = async () => {
        if (!activeSession) return;
        const id = inp.dataset.paperRef;
        const ctx = ensureItemContext(activeSession, id, { preserveExisting: true });
        const prev = activeSession.paperGrades[id] || {
          outcome: 'unjudged',
          tags: [],
          testedDateStr: ctx.testedDateStr,
          testedAt: ctx.testedAt
        };
        activeSession.paperGrades[id] = { ...prev, paperRef: inp.value.trim() };
        await saveState();
      };
    });

    // N02: Backfilling original paper date vs archiving & launching a fresh blind retest!
    document.querySelectorAll('[data-backfill-date]').forEach(inp => {
      inp.onchange = async () => {
        if (!activeSession || !inp.value) return;
        const id = inp.dataset.backfillDate;
        const newDate = inp.value;
        const qNo = activeSession.paperIds.indexOf(id) + 1;
        const ctx = ensureItemContext(activeSession, id, { preserveExisting: true });
        const origDate = ctx.testedDateStr;
        const [y, m, d] = newDate.split('-').map(Number);
        const backfillTs = Date.UTC(y, m - 1, d, 12, 0, 0);
        const prev = activeSession.paperGrades[id] || { outcome: 'unjudged', tags: [] };

        // N02 Guard: Advancing date on an already answer-revealed card MUST lock spelling-hint evidence!
        if (newDate > origDate && activeSession.answerRevealed?.[id]) {
          activeSession.hintedOnPaper = activeSession.hintedOnPaper || {};
          activeSession.lockedHint = activeSession.lockedHint || {};
          activeSession.exposureSources = activeSession.exposureSources || {};
          activeSession.hintedOnPaper[id] = true;
          activeSession.lockedHint[id] = true;
          activeSession.exposureSources[id] = 'date_advanced_after_answer_reveal';
        }

        activeSession.paperGrades[id] = {
          ...prev,
          testedDateStr: newDate,
          testedAt: backfillTs,
          paperRef: `${newDate} #${qNo}`
        };
        render();
        await saveState();
      };
    });

    document.querySelectorAll('[data-retest-today]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        const id = btn.dataset.retestToday;
        const s = activeSession;
        const submittedAt = Date.now();
        const today = SnapCore.todayISO(submittedAt);
        const wasExposed = Boolean(
          s.answerRevealed?.[id] ||
          s.hintedOnPaper?.[id] ||
          (effectiveSessionActor() === 'student' && state.lastAnswerSeenDate?.[id] === today)
        );

        // Q01: Preserve each sibling item's TRUE pre-attempt hint state (s.hintedOnPaper[pid]) WITHOUT
        // polluting already-judged items with grading-phase answerRevealed!
        const settledJudged = [];
        const archivedUntested = [];

        s.paperIds.forEach((pid, idx) => {
          const pCtx = ensureItemContext(s, pid, { preserveExisting: true, lock: true });
          const pg = s.paperGrades[pid];
          const pDate = pg?.testedDateStr || pCtx.testedDateStr;
          const pAt = pg?.testedAt || pCtx.testedAt;
          const isJudgedSibling = pid !== id && pg?.outcome && pg.outcome !== 'unjudged';
          const pOut = isJudgedSibling ? pg.outcome : 'untested';
          const preAttemptHinted = Boolean(s.hintedOnPaper?.[pid]);

          const evt = SnapCore.recordEvent(state, {
            sessionId: s.sessionId,
            stageTag: pid === id ? 'archived_before_retest' : 'paper',
            actor: s.lockedActor,
            recordedBy: 'parent',
            itemId: pid,
            questionNo: idx + 1,
            testedAt: pAt,
            submittedAt,
            dateStr: pDate,
            paperRef: pg?.paperRef || `${pDate} #${idx + 1}`,
            promptMode: pCtx.promptMode,
            variantKey: pCtx.variantKey,
            expectedAnswer: pCtx.primary,
            spokenText: pCtx.spokenText,
            hadSpellingHint: preAttemptHinted,
            answerRevealedDuringGrading: Boolean(s.answerRevealed?.[pid]),
            exposureSource: preAttemptHinted ? (s.exposureSources?.[pid] || null) : null,
            taskType: 'paper_check',
            outcome: pOut,
            errorTags: pg?.tags || [],
            note: pid === id
              ? '原题未完结归档（已保留原施测日与亮答案状态），另起新测'
              : (isJudgedSibling ? (s.sentenceNote || '') : '同课单题发起新测时未判定，明确归档为未测')
          });

          if (pid !== id && evt) {
            const zh = itemById(pid)?.zh || pid;
            if (isJudgedSibling) {
              settledJudged.push({ id: pid, zh, outcome: evt.outcome, dateStr: pDate, hadSpellingHint: evt.hadSpellingHint });
            } else {
              archivedUntested.push({ id: pid, zh, dateStr: pDate });
            }
          }
        });

        setActorDraft(s.lockedActor || state.actorMode, null);
        await startSession('due_only', [id], {
          exposedIds: wasExposed ? [id] : [],
          packTitle: '今日无答案新测',
          archivedSiblings: { settledJudged, archivedUntested }
        });
        toast(wasExposed
          ? '已归档原题并开启无答案新测（因先前已亮过答案，本次再写按含提示练习登记，隔日独立盲写升金章）'
          : '已归档原题并开启今日无答案盲写新测');
      };
    });

    document.querySelectorAll('[data-grade-item]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        const id = btn.dataset.gradeItem;
        const ctx = ensureItemContext(activeSession, id, { preserveExisting: true, lock: true });
        const prev = activeSession.paperGrades[id] || {
          tags: [],
          paperRef: `${ctx.testedDateStr} #${activeSession.paperIds.indexOf(id) + 1}`,
          testedDateStr: ctx.testedDateStr,
          testedAt: ctx.testedAt
        };
        activeSession.paperGrades[id] = {
          ...prev,
          outcome: btn.dataset.outcome,
          testedDateStr: prev.testedDateStr || ctx.testedDateStr,
          testedAt: prev.testedAt || ctx.testedAt
        };
        highlightUnjudged = false;
        render();
        await saveState();
      };
    });

    document.querySelectorAll('[data-batch-rest]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        const targetOutcome = btn.dataset.batchRest;
        activeSession.paperIds.forEach((id, idx) => {
          const cur = activeSession.paperGrades[id];
          if (!cur?.outcome || cur.outcome === 'unjudged') {
            const ctx = ensureItemContext(activeSession, id, { preserveExisting: true, lock: true });
            activeSession.paperGrades[id] = {
              outcome: targetOutcome,
              tags: [],
              paperRef: `${ctx.testedDateStr} #${idx + 1}`,
              testedDateStr: ctx.testedDateStr,
              testedAt: ctx.testedAt
            };
          }
        });
        highlightUnjudged = false;
        render();
        await saveState();
      };
    });

    document.querySelectorAll('[data-toggle-err]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        const id = btn.dataset.toggleErr;
        const tag = btn.dataset.tag;
        const ctx = ensureItemContext(activeSession, id, { preserveExisting: true });
        const g = activeSession.paperGrades[id] || {
          outcome: 'answer_corrected',
          tags: [],
          testedDateStr: ctx.testedDateStr,
          testedAt: ctx.testedAt
        };
        g.tags = (g.tags || []).includes(tag) ? g.tags.filter(t => t !== tag) : [...(g.tags || []), tag];
        activeSession.paperGrades[id] = g;
        render();
        await saveState();
      };
    });

    $('#baseline-note')?.addEventListener('input', e => {
      if (activeSession) activeSession.sentenceNote = e.target.value;
    });

    // F01 + R07: Submit preserving each item's exact testedDateStr, promptMode, expectedAnswer & spokenText!
    document.querySelector('[data-act="finish-paper-session"]')?.addEventListener('click', async () => {
      if (!activeSession || submitLock) return;
      const unjudgedIds = activeSession.paperIds.filter(id => {
        const out = activeSession.paperGrades[id]?.outcome;
        return !out || out === 'unjudged';
      });
      if (unjudgedIds.length > 0) {
        highlightUnjudged = true;
        render();
        toast(`还有 ${unjudgedIds.length} 题处于「未判定」！请据纸面逐题选择结果，或点右上角标为「待核验 / 未测」。`);
        return;
      }

      submitLock = true;
      try {
        const submittedAt = Date.now();
        const recordedEvents = [];
        const needReviewIds = [];

        activeSession.paperIds.forEach((id, idx) => {
          const ctx = ensureItemContext(activeSession, id, { preserveExisting: true, lock: true });
          const g = activeSession.paperGrades[id];
          const testedDateStr = g.testedDateStr || ctx.testedDateStr;
          const testedAt = g.testedAt || ctx.testedAt;

          const evt = SnapCore.recordEvent(state, {
            sessionId: activeSession.sessionId,
            stageTag: 'paper',
            actor: activeSession.lockedActor,
            recordedBy: 'parent',
            itemId: id,
            questionNo: idx + 1,
            testedAt,
            submittedAt,
            dateStr: testedDateStr,
            paperRef: g.paperRef || `${testedDateStr} #${idx + 1}`,
            promptMode: ctx.promptMode,
            variantKey: ctx.variantKey,
            expectedAnswer: ctx.primary,
            spokenText: ctx.spokenText,
            hadSpellingHint: Boolean(activeSession.hintedOnPaper?.[id]),
            exposureSource: activeSession.exposureSources?.[id] || null,
            taskType: 'paper_check',
            outcome: g.outcome,
            errorTags: g.tags || [],
            note: activeSession.sentenceNote || ''
          });

          if (evt) {
            recordedEvents.push(evt);
            if (['blind_self_fixed', 'answer_corrected', 'answered_wrong', 'blank', 'hinted_correct'].includes(evt.outcome)) {
              needReviewIds.push(id);
            }
          }
        });

        activeSession.summary = {
          tally: SnapCore.summarizePaperEvents(recordedEvents),
          needReviewIds
        };
        activeSession.paperPhase = 'summary';
        setActorDraft(activeSession.lockedActor || state.actorMode, null);
        await saveState();
        render();
      } finally {
        submitLock = false;
      }
    });

    // Vault & Class Requirement toggles
    document.querySelectorAll('[data-vault-filter]').forEach(btn => {
      btn.onclick = () => { vaultFilter = btn.dataset.vaultFilter; render(); };
    });

    document.querySelectorAll('[data-class-req]').forEach(sel => {
      sel.onchange = async () => {
        const updated = SnapCore.updateCurriculumItem(state, sel.dataset.classReq, { classRequirement: sel.value });
        if (updated) {
          render();
          await saveState();
          toast(`已更新「${updated.en}」本班要求，出题将实时联动`);
        }
      };
    });

    // R03 + R08: Pending-Verify Staged Picker & Actor-Guarded Commit + Follow-up Correction
    document.querySelectorAll('[data-pv-pick]').forEach(btn => {
      btn.onclick = () => {
        const evId = btn.dataset.pvPick;
        const prev = pendingVerifyDrafts[evId] || { tags: [] };
        pendingVerifyDrafts[evId] = { outcome: btn.dataset.outcome, tags: prev.tags || [] };
        render();
      };
    });

    document.querySelectorAll('[data-pv-tag]').forEach(btn => {
      btn.onclick = () => {
        const evId = btn.dataset.pvTag;
        const tag = btn.dataset.tag;
        const prev = pendingVerifyDrafts[evId] || { outcome: 'answered_wrong', tags: [] };
        prev.tags = prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag];
        pendingVerifyDrafts[evId] = prev;
        render();
      };
    });

    document.querySelectorAll('[data-confirm-verify]').forEach(btn => {
      btn.onclick = async () => {
        const evId = btn.dataset.confirmVerify;
        const draft = pendingVerifyDrafts[evId];
        if (!draft || !draft.outcome || draft.outcome === 'unjudged') return;

        const res = SnapCore.resolvePendingVerify(
          state,
          evId,
          draft.outcome,
          draft.tags || [],
          '',
          { actorMode: effectiveSessionActor() }
        );

        if (res?.blocked) {
          toast('🔒 演练模式下禁止修改学生正式记录！请先切回学生正式学习模式。');
          return;
        }

        delete pendingVerifyDrafts[evId];
        render();
        await saveState();
        toast('核验已入账，统计与复测状态已更新！');
      };
    });

    document.querySelectorAll('[data-followup-corr]').forEach(btn => {
      btn.onclick = async () => {
        const origId = btn.dataset.followupCorr;
        const res = SnapCore.recordFollowUpCorrection(state, origId, '', { actorMode: effectiveSessionActor() });
        if (res?.blocked) {
          toast('🔒 演练模式下禁止修改学生正式记录！');
          return;
        }
        render();
        await saveState();
        toast('已追加红笔订正记录（原首答错记录仍完整保留，继续参与下次独立复测）');
      };
    });

    document.querySelector('[data-act="start-due-review"]')?.addEventListener('click', () => {
      const ids = SnapCore.getDueQueue(state, SnapCore.todayISO(), 3).todayPick.map(d => d.item.id);
      if (ids.length) startSession('due_only', ids);
    });

    document.querySelectorAll('[data-act="export-json"]').forEach(btn => {
      btn.onclick = () => {
        const dataStr = JSON.stringify(state, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SnapWord-词哒备份-${SnapCore.todayISO()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('JSON 备份已触发下载');
      };
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
        importDraftPolicy = 'restore_incoming';
        pendingImportPreview = SnapCore.inspectBackupJSON(parsed, state);
        render();
      } catch (err) {
        toast('无法解析备份：' + err.message);
      } finally {
        e.target.value = '';
      }
    });

    document.querySelectorAll('input[name="conflict-pol"]').forEach(r => {
      r.onchange = () => {
        importConflictPolicy = r.value;
        render(); // Refresh preview table's "将采用" indicator immediately!
      };
    });

    document.querySelectorAll('input[name="draft-pol"]').forEach(r => {
      r.onchange = () => {
        importDraftPolicy = r.value;
        render();
      };
    });

    document.querySelector('[data-act="confirm-import-snapword"]')?.addEventListener('click', async () => {
      if (!pendingImportPreview) return;
      const curActor = effectiveSessionActor();
      const replacesActiveDraft = Boolean(
        activeSession &&
        importDraftPolicy === 'restore_incoming' &&
        pendingImportPreview.draftSlots?.[curActor]?.incoming
      );
      if (replacesActiveDraft) {
        SnapAudio.stop();
        activeSession = null;
      }
      state = SnapCore.mergeSnapwordBackup(state, pendingImportPreview.payload, {
        includeDemo: false,
        conflictPolicy: importConflictPolicy,
        draftPolicy: importDraftPolicy
      });
      syncActiveDraftFromActor();
      pendingImportPreview = null;
      render();
      await saveState();
      toast('备份已按所选策略执行合并！');
    });

    document.querySelector('[data-act="confirm-import-legacy-words"]')?.addEventListener('click', async () => {
      if (!pendingImportPreview) return;
      state = SnapCore.importLegacyWordsOnly(state, pendingImportPreview.payload);
      pendingImportPreview = null;
      render();
      await saveState();
      toast('已安全提取旧版词条，打字记录已独立归档隔离！');
    });

    document.querySelector('[data-act="cancel-import"]')?.addEventListener('click', () => {
      pendingImportPreview = null;
      render();
    });

    // Coach Prep
    $('#profile-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      state.profile.nickname = $('#prof-nickname')?.value.trim() || '小探索家';
      state.profile.budgetMinutes = Math.min(35, Math.max(8, Number($('#prof-budget')?.value) || 18));
      state.classSettings = state.classSettings || {};
      state.classSettings.allowAmericanSpelling = Boolean($('#prof-allow-us')?.checked);
      render();
      await saveState();
      toast('本机与判分口径设置已保存');
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
          subtitle: `快速建包 · 共 ${ids.length} 项（按本班要求自动分流纸写/认读/下轮候选）`,
          modeHint: 'standard',
          itemIds: ids
        };
        state.packs.unshift(newPack);
        state.selectedPackId = newPack.id;
        currentTab = 'learn';
        render();
        await saveState();
        toast(`已生成「${title}」，请在大厅核对当晚出题预览后开始`);
      } catch (err) {
        toast(err.message);
      }
    });

    $('#audio-check-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      state.audioCheckLog = {
        dateStr: SnapCore.todayISO(),
        note: $('#ac-note')?.value.trim() || '已在目标电脑完成真人词、合成短语及长句试听'
      };
      render();
      await saveState();
      toast('实机试听记录已保存');
    });

    $('#custom-audio-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const itemId = $('#ca-item')?.value;
        const file = $('#ca-file')?.files?.[0];
        const dataUri = await SnapAudio.validateAndEncodeAudioFile(file);
        const nextRecs = { ...state.recordings, [itemId]: dataUri };
        const totalSize = Object.values(nextRecs).reduce((acc, s) => acc + s.length, 0);
        if (totalSize > 4 * 1024 * 1024) throw new Error('自定义内嵌录音总容量已达 4MB 上限');
        state.recordings = nextRecs;
        render();
        await saveState();
        toast('自定义录音绑定成功！');
      } catch (err) {
        toast(err.message);
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) SnapAudio.stop();
  });

  (async () => {
    await initStorage();
    await saveState();
    render();
  })();
})();
