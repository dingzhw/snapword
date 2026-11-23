/* 词哒 · SnapWord Main Paperless & AI-Assisted Interactive Workbench Controller (v0.3.0)
 * - 100% Paperless Web Memorization & Dictation Arena (zero notebook/red-pen/photo detours)
 * - 3-Tier Parent-Controlled Difficulty: 🌱 初学·简单 / ⚡ 温习·普通 / 🔥 考核·挑战 (+ 🧭 智能自适应)
 * - Multi-Provider AI Coaching & Dynamic Quiz Engine (OpenAI default gpt-6.2-sol, Gemini, DeepSeek, LM Studio, Custom)
 * - Preserves full spaced-repetition ledger (D0 -> D+1 -> D+3 -> D+7), Bronze/Silver/Gold medals & actor isolation.
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
  let roleSwitchModalOpen = null;
  let dueNavGate = null;
  let pendingImportPreview = null;
  let importConflictPolicy = 'prefer_incoming';
  let importDraftPolicy = 'restore_incoming';
  let pendingVerifyDrafts = {};
  let submitLock = false;
  let saveChain = Promise.resolve({ ok: true });
  let parentTuneOpen = false;
  let packGroup = null;
  let packQuery = '';
  let lessonDetailsOpen = false;

  // AI UI transient states (never stored in exported student backup)
  const aiUI = {
    showKey: false,
    fetchingModels: false,
    testingConn: false,
    prefetching: false,
    altMnemonicLoading: false,
    storyLoading: false,
    arcadeLoading: false,
    enrichOnQuickPack: true,
    statusMsg: '',
    statusIsErr: false
  };

  const slotUI = { deckIndex: 0, subj: 0, adv: 0, act: 0, customEn: '', customZh: '', customHl: '', boardMode: 'story', storyCloze: false, storyRevealed: {} };

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

  // ==================== Storage & 3-State Draft Lifecycle ====================
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

    if (state.activeDraft && state.activeDraft.lockedActor === state.actorMode) {
      if (state.activeDraft.draftStatus === 'in_progress') {
        activeSession = resumeLesson(state.activeDraft);
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
    toast(res.ok ? '进度已暂存，随时可点「继续完成」接着闯关' : '⚠ 本机存储受阻，请及时导出 JSON 备份');
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
    const slip = m.recentSlip ? ' <span style="color:#dc2626;font-weight:800">⚠️需复测</span>' : '';
    const stab = m.stabilized && !m.needsReview ? ' · 暂稳定' : '';
    if (badge === 'gold') return `<span class="pill" style="background:#fef08a;color:#854d0e">🥇 金章${stab}</span>${slip}`;
    if (badge === 'silver') return `<span class="pill" style="background:#e2e8f0;color:#334155">🥈 银章·首通</span>${slip}`;
    if (badge === 'bronze') return `<span class="pill" style="background:#ffedd5;color:#9a3412">🥉 铜章·已练</span>${slip}`;
    return '<span class="pill">⚪ 待点亮</span>';
  }

  function difficultyMeta(diff) {
    const map = {
      easy: { id: 'easy', icon: '🌱', title: '初学·简单', desc: '音义配对 + 拆词拼装 + 骨架提示（拿铜章）' },
      normal: { id: 'normal', icon: '⚡', title: '温习·普通', desc: '闪电热身 + 词位盲打 & AI 变式句（冲银/金章）' },
      challenge: { id: 'challenge', icon: '🔥', title: '考核·挑战', desc: '零支架直入听写卷 + AI 新句盲填（模拟满分）' },
      adaptive: { id: 'adaptive', icon: '🧭', title: '智能自适应', desc: '按每词熟练度自动匹配简单/普通/挑战' }
    };
    return map[diff] || map.normal;
  }

  function resolveItemDifficulty(s, itemId, stage = 'arena') {
    const d = s?.difficulty || state?.difficultyMode || 'normal';
    if (d !== 'adaptive') return d;
    if (s?.dueIds?.includes(itemId)) return 'challenge';
    const badge = state?.mastery?.[itemId]?.badge || 'none';
    if (badge === 'gold' || badge === 'silver') return 'challenge';
    if (badge === 'bronze') return 'normal';
    return stage === 'snap' ? 'easy' : 'normal';
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

  // ==================== Per-Item Context & Dynamic AI Prompt Resolver ====================
  function ensureItemContext(s, itemId, opts = {}) {
    s.itemContexts = s.itemContexts || {};
    const existing = s.itemContexts[itemId];
    if (existing && (existing.locked || opts.preserveExisting)) {
      return existing;
    }
    const it = itemById(itemId);
    if (!it) return null;

    const requestedMode = opts.promptMode ?? existing?.promptMode ?? s.promptMode ?? 'audio_plus_zh';
    const effDiff = resolveItemDifficulty(s, itemId, 'arena');
    // Surface 4: AI Smart Mixed Mode rotates fresh AI sentences & listening dictation per item!
    let mode = requestedMode;
    if (requestedMode === 'ai_mixed') {
      const qIdx = Math.max(0, (s.arenaQueue || []).indexOf(itemId));
      if (effDiff === 'challenge') {
        mode = qIdx % 3 === 0 ? 'ai_sentence' : (qIdx % 3 === 1 ? 'audio_plus_zh' : 'zh_prompt');
      } else {
        mode = qIdx % 2 === 0 ? 'ai_sentence' : 'audio_plus_zh';
      }
    }
    const now = Date.now();
    const testedAt = existing?.testedAt ?? now;
    const testedDateStr = existing?.testedDateStr ?? SnapCore.todayISO(testedAt);

    if (mode === 'ai_sentence') {
      const aiVar = opts.forceNewVariant || !existing?.aiVariant
        ? SnapAI.pickQuizVariant(it, effDiff, true)
        : existing.aiVariant;
      const primary = SnapCore.normText(aiVar.expected || it.en);
      const accepted = [primary, ...(it.acceptedVariants || []).map(SnapCore.normText)];
      if (state.classSettings?.allowAmericanSpelling && it.usVariant && primary === SnapCore.normText(it.en)) {
        accepted.push(SnapCore.normText(it.usVariant));
      }
      const ctx = {
        itemId,
        testedAt,
        testedDateStr,
        promptMode: 'ai_sentence',
        variantKey: null,
        promptZh: aiVar.zh || it.zh,
        sentenceTemplate: aiVar.template,
        hintText: aiVar.hint || it.cloze?.hint || '根据句意与读音拼写',
        distractors: aiVar.distractors || SnapAI.synthesizeDistractors(it, primary),
        fromAI: Boolean(aiVar.fromAI),
        aiVariant: aiVar,
        primary,
        accepted: [...new Set(accepted)],
        spokenText: primary,
        displayChunks: it.displayChunks || primary,
        locked: Boolean(opts.lock || existing?.locked)
      };
      s.itemContexts[itemId] = ctx;
      return ctx;
    }

    const mappedMode = mode === 'sentence_context' ? 'sentence_context' : mode;
    const resolved = SnapCore.getTargetAnswers(it, {
      promptMode: mappedMode,
      variantKey: opts.variantKey !== undefined ? opts.variantKey : (existing?.variantKey ?? null),
      allowAmericanSpelling: state.classSettings?.allowAmericanSpelling
    });

    const ctx = {
      itemId,
      testedAt,
      testedDateStr,
      promptMode: resolved.promptMode,
      variantKey: resolved.variantKey,
      promptZh: resolved.promptZh,
      sentenceTemplate: resolved.sentenceTemplate,
      hintText: it.cloze?.hint || '根据读音与词义拼出完整英文',
      distractors: SnapAI.synthesizeDistractors(it, resolved.primary),
      fromAI: false,
      primary: resolved.primary,
      accepted: resolved.accepted,
      spokenText: resolved.spokenText,
      displayChunks: resolved.displayChunks,
      locked: Boolean(opts.lock || existing?.locked)
    };
    s.itemContexts[itemId] = ctx;
    return ctx;
  }

  // ==================== Match Micro-Game, Snap Stage & Web Dictation Arena Initializers ====================
  function initMatchGameState(s) {
    const poolIds = (s.focusIds || []).slice(0, 6);
    const items = poolIds.map(itemById).filter(Boolean);
    s.matchState = {
      leftCards: shuffleArray(items.map(it => ({ id: it.id, text: it.en }))),
      rightCards: shuffleArray(items.map(it => ({ id: it.id, text: itemMeaning(it) }))),
      pickedLeft: null,
      pickedRight: null,
      wrongLeft: null,
      wrongRight: null,
      matchedIds: [],
      combo: 0,
      done: items.length < 2
    };
  }

  function initSnapCardState(s = activeSession) {
    if (!s || !s.focusIds?.length) return;
    const id = s.focusIds[s.snapIndex];
    const item = itemById(id);
    if (!item) return;
    const pieces = item.snap?.pieces || [item.en];
    const decoys = item.snap?.decoys || [];
    const pool = shuffleArray([
      ...pieces.map((text, idx) => ({ key: 'p_' + idx, text, isDecoy: false })),
      ...decoys.map((d, idx) => ({ key: 'd_' + idx, text: d.text, isDecoy: true, tip: d.tip }))
    ]);
    const distractors = SnapAI.synthesizeDistractors(item, item.en);
    const quizChoices = shuffleArray([item.en, ...distractors.slice(0, 3)]);
    s.snapState = {
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
      clozeFeedback: '',
      quizChoices
    };
  }

  function initArenaCardState(s, queueKey = 'arena') {
    const list = queueKey === 'due' ? s.dueIds : s.arenaQueue;
    const idx = queueKey === 'due' ? (s.dueIndex || 0) : (s.arenaIndex || 0);
    const id = list?.[idx];
    if (!id) return;
    const it = itemById(id);
    if (!it) return;
    const ctx = ensureItemContext(s, id, { preserveExisting: true });
    const choices = shuffleArray([ctx.primary, ...(ctx.distractors || SnapAI.synthesizeDistractors(it, ctx.primary)).slice(0, 3)]);
    const cardState = {
      itemId: id,
      queueKey,
      subPhase: 'typing', // 'typing' | 'passed' | 'diff_review' | 'blind_retype'
      draft: '',
      retypeDraft: '',
      tries: 0,
      usedHint: Boolean(s.hintedOnPaper?.[id]),
      showChoiceAid: false,
      choices,
      lastDiag: null,
      aiMistakeTip: ''
    };
    if (queueKey === 'due') s.dueCard = cardState;
    else s.arenaCard = cardState;
  }

  function firstMainStep(s) {
    if (s.dueIds?.length && !s.duePrewritten) return 'due_precheck';
    if (!s.focusIds?.length) {
      if (s.arenaQueue?.length) return 'paper';
      return s.preread ? 'board' : 'oral_wrapup';
    }
    if (s.difficulty === 'challenge') {
      return s.arenaQueue?.length ? 'paper' : 'oral_wrapup';
    }
    if (s.focusIds.length >= 2 && !s.stepsDone?.match) return 'match';
    return 'snap';
  }

  function resumeLesson(draft) {
    const lesson = SnapCore.clone(draft);
    lesson.difficulty = lesson.difficulty || state?.difficultyMode || 'normal';
    lesson.arenaQueue = Array.isArray(lesson.arenaQueue)
      ? lesson.arenaQueue
      : (lesson.paperNowIds?.length ? [...lesson.paperNowIds] : [...(lesson.paperIds || [])]);
    lesson.arenaResults = lesson.arenaResults || {};
    lesson.arenaIndex = Number(lesson.arenaIndex || 0);
    lesson.dueIndex = Number(lesson.dueIndex || 0);
    lesson.streak = Number(lesson.streak || 0);
    if (!lesson.matchState) initMatchGameState(lesson);
    if (!lesson.snapState && lesson.focusIds?.length) initSnapCardState(lesson);
    if (lesson.step === 'due_precheck' && !lesson.dueCard) initArenaCardState(lesson, 'due');
    if (lesson.step === 'paper' && !lesson.arenaCard) initArenaCardState(lesson, 'arena');
    return lesson;
  }

  // Silent non-blocking AI prefetch: never interrupts active typing!
  function triggerBackgroundAIPrefetch(s) {
    if (!s || !SnapAI.isReady()) return;
    const targetIds = [...new Set([...(s.focusIds || []), ...(s.arenaQueue || []), ...(s.dueIds || [])])];
    const items = targetIds.map(itemById).filter(Boolean);
    if (!items.length) return;
    const summary = SnapCore.getStatsSummary(state, 'student');
    SnapAI.prefetchPackQuestions(items, s.difficulty || 'normal', summary.errorTotals).then(res => {
      if (!activeSession || activeSession.sessionId !== s.sessionId) return;
      if (res?.ok && res.acceptedCount > 0) {
        activeSession.aiPrefetchedCount = (activeSession.aiPrefetchedCount || 0) + res.acceptedCount;
        const badgeEl = $('#session-ai-badge');
        if (badgeEl) {
          badgeEl.textContent = `✨ AI 已就绪 (${res.acceptedCount} 题)`;
          badgeEl.classList.add('ready');
        }
      }
    }).catch(() => {});
  }

  // ==================== Start Paperless Session ====================
  async function startSession(mode = 'standard', explicitIds = null, sessionOpts = {}) {
    SnapAudio.stop();
    dueNavGate = null;
    const lockedActor = state.actorMode;
    const sessionId = SnapCore.uid('sess');
    const pack = selectedPack();
    const chosenDiff = sessionOpts.difficulty || state.difficultyMode || 'normal';
    const exposedSet = new Set(sessionOpts.exposedIds || []);

    if (mode === 'due_only') {
      const duePick = explicitIds?.length
        ? explicitIds
        : SnapCore.getDueQueue(state, SnapCore.todayISO(), 5).todayPick.map(d => d.item.id);
      if (!duePick.length) {
        toast('🎉 当前没有到期需要复习的词条！');
        return;
      }
      const hintedOnPaper = {};
      const lockedHint = {};
      for (const id of duePick) {
        if (exposedSet.has(id)) {
          hintedOnPaper[id] = true;
          lockedHint[id] = true;
        }
      }
      activeSession = {
        sessionId,
        lockedActor,
        mode: 'due_only',
        difficulty: sessionOpts.difficulty || 'challenge',
        packId: pack.id,
        packTitle: sessionOpts.packTitle || '📅 到期词闪电盲打复测',
        startedAt: Date.now(),
        step: 'paper',
        stepsDone: {},
        dueIds: [...duePick],
        duePrewritten: true,
        focusIds: [],
        oralOnlyIds: [],
        deferredIds: [],
        paperIds: [...duePick],
        arenaQueue: [...duePick],
        arenaIndex: 0,
        arenaResults: {},
        streak: 0,
        maxStreak: 0,
        promptMode: 'audio_plus_zh',
        itemContexts: {},
        hintedOnPaper,
        lockedHint,
        exposureSources: {},
        paperGrades: {},
        paperPhase: 'arena',
        oralPhase: 'active',
        oralChecked: {},
        archivedSiblings: sessionOpts.archivedSiblings || null,
        summary: null
      };
      duePick.forEach(id => ensureItemContext(activeSession, id));
      initArenaCardState(activeSession, 'arena');
      triggerBackgroundAIPrefetch(activeSession);
      currentTab = 'learn';
      render();
      focusActiveInput();
      await saveState();
      return;
    }

    if (mode === 'baseline' || pack.modeHint === 'baseline') {
      const basePack = state.packs.find(p => p.id === 'pack-baseline') || pack;
      activeSession = {
        sessionId,
        lockedActor,
        mode: 'baseline',
        difficulty: 'challenge',
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
        arenaQueue: [...basePack.itemIds],
        arenaIndex: 0,
        arenaResults: {},
        streak: 0,
        maxStreak: 0,
        promptMode: 'audio_plus_zh',
        itemContexts: {},
        hintedOnPaper: {},
        lockedHint: {},
        exposureSources: {},
        paperGrades: {},
        paperPhase: 'arena',
        oralPhase: 'active',
        oralChecked: {},
        summary: null
      };
      basePack.itemIds.forEach(id => ensureItemContext(activeSession, id));
      initArenaCardState(activeSession, 'arena');
      currentTab = 'learn';
      render();
      focusActiveInput();
      await saveState();
      return;
    }

    // Standard / Quick8 Paperless Flow
    const dueLimit = mode === 'quick8' ? 1 : 2;
    const dueIds = SnapCore.getDueQueue(state, SnapCore.todayISO(), dueLimit).todayPick.map(d => d.item.id);
    const alloc = planLesson(pack, dueIds, mode);

    if (pack.slotDeckId) {
      const deckIdx = SNAPWORD_CURRICULUM.SLOT_DECKS.findIndex(d => d.id === pack.slotDeckId);
      if (deckIdx >= 0) {
        slotUI.deckIndex = deckIdx;
        slotUI.subj = 0; slotUI.adv = 0; slotUI.act = 0; slotUI.customEn = '';
      }
    } else if (pack.id.includes('u6')) {
      slotUI.deckIndex = 0; // slot_u6_1_10
      slotUI.subj = 0; slotUI.adv = 0; slotUI.act = 0; slotUI.customEn = '';
    }
    slotUI.boardMode = 'story';
    slotUI.storyCloze = false;
    slotUI.storyRevealed = {};

    if (!alloc.hasAnyActiveTask && !pack.preread) {
      toast('当前词单全部被设为「下次再练」，请先在家长微调中至少开启 1 个词条！');
      return;
    }

    const focusIds = [...alloc.paperNowIds, ...alloc.oralOnlyIds];
    const paperIds = [...alloc.combinedPaperIds];
    const arenaQueue = [...alloc.paperNowIds];

    activeSession = {
      sessionId,
      lockedActor,
      mode,
      difficulty: chosenDiff,
      packId: pack.id,
      packTitle: pack.title,
      practiceFirst: true,
      preread: pack.preread || null,
      prereadDone: false,
      prereadNote: '',
      startedAt: Date.now(),
      step: 'snap',
      stepsDone: {},
      dueIds,
      dueIndex: 0,
      duePrewritten: dueIds.length === 0,
      paperNowIds: alloc.paperNowIds,
      oralOnlyIds: alloc.oralOnlyIds,
      deferredIds: alloc.deferredIds,
      focusIds,
      snapIndex: 0,
      snapState: null,
      matchState: null,
      arcadeState: null,
      paperIds,
      arenaQueue,
      arenaIndex: 0,
      arenaResults: {},
      streak: 0,
      maxStreak: 0,
      promptMode: SnapAI.isReady() ? 'ai_mixed' : 'audio_plus_zh',
      itemContexts: {},
      hintedOnPaper: {},
      lockedHint: {},
      exposureSources: {},
      paperPhase: 'arena',
      oralPhase: 'active',
      oralChecked: {},
      paperGrades: {},
      aiDebrief: null,
      summary: null
    };

    dueIds.forEach(id => ensureItemContext(activeSession, id));
    arenaQueue.forEach(id => ensureItemContext(activeSession, id));
    initMatchGameState(activeSession);
    initSnapCardState(activeSession);
    activeSession.step = firstMainStep(activeSession);
    if (activeSession.step === 'due_precheck') initArenaCardState(activeSession, 'due');
    if (activeSession.step === 'paper') initArenaCardState(activeSession, 'arena');

    triggerBackgroundAIPrefetch(activeSession);
    currentTab = 'learn';
    render();
    focusActiveInput();
    // Auto-speak first item when entering direct test/due step
    if (activeSession.step === 'due_precheck' && dueIds[0]) {
      SnapAudio.play(state, itemById(dueIds[0]), null);
    } else if (activeSession.step === 'paper' && arenaQueue[0]) {
      SnapAudio.play(state, itemById(arenaQueue[0]), null);
    }
    await saveState();
  }

  function focusActiveInput() {
    setTimeout(() => {
      const inp = $('#arena-input') || $('#cloze-input');
      if (inp && !inp.readOnly) inp.focus();
    }, 30);
  }

  function elapsedMinutes() {
    if (!activeSession) return 0;
    return Math.floor((Date.now() - activeSession.startedAt) / 60000);
  }

  function hasMeaningfulProgress(s) {
    if (!s) return false;
    const arenaDone = Object.values(s.arenaResults || {}).some(r => r?.done);
    const snapDone = Boolean(s.stepsDone?.snap || s.snapIndex > 0);
    const oralDone = Object.values(s.oralChecked || {}).some(Boolean);
    return arenaDone || snapDone || oralDone || Boolean(s.duePrewritten && s.dueIds?.length);
  }

  function markUnwrittenDueExposed(s, source = 'pre_answer_navigation') {
    if (!s || s.duePrewritten) return;
    s.hintedOnPaper = s.hintedOnPaper || {};
    s.lockedHint = s.lockedHint || {};
    s.exposureSources = s.exposureSources || {};
    for (const id of (s.dueIds || [])) {
      if (!s.arenaResults?.[id]?.done) {
        s.hintedOnPaper[id] = true;
        s.lockedHint[id] = true;
        s.exposureSources[id] = source;
        ensureItemContext(s, id, { lock: true });
      }
    }
    s.duePrewritten = true;
    // Move unfinished due items into arenaQueue so they still get practiced cleanly at the end!
    for (const id of (s.dueIds || [])) {
      if (!s.arenaResults?.[id]?.done && !s.arenaQueue.includes(id)) {
        s.arenaQueue.unshift(id);
      }
    }
  }

  // ==================== Settle Web Session Automatically into SnapCore Ledger ====================
  async function finalizeArenaSession(s = activeSession) {
    if (!s || submitLock) return;
    submitLock = true;
    try {
      const submittedAt = Date.now();
      const recordedEvents = [];
      const needReviewIds = [];
      const allTargetIds = [...new Set([...(s.dueIds || []), ...(s.arenaQueue || [])])];

      allTargetIds.forEach((id, idx) => {
        const ctx = ensureItemContext(s, id, { preserveExisting: true, lock: true });
        const res = s.arenaResults?.[id];
        const itemDiff = resolveItemDifficulty(s, id, 'arena');

        // Easy mode awards Bronze via scaffold_cloze without inflating unassisted recall Silver/Gold
        if (res?.done && itemDiff === 'easy' && !s.dueIds?.includes(id) && s.mode !== 'due_only' && s.mode !== 'baseline') {
          SnapCore.recordEvent(state, {
            id: `easy_${s.sessionId}_${id}`,
            sessionId: s.sessionId,
            actor: s.lockedActor,
            recordedBy: 'web_auto',
            itemId: id,
            testedAt: res.testedAt || ctx.testedAt,
            submittedAt,
            dateStr: ctx.testedDateStr,
            taskType: 'scaffold_cloze',
            outcome: 'done',
            note: '网页初学简单模式通关（点亮铜章）'
          });
          return;
        }

        const outcome = res?.done ? res.outcome : 'untested';
        const evt = SnapCore.recordEvent(state, {
          sessionId: s.sessionId,
          stageTag: 'web_arena',
          actor: s.lockedActor,
          recordedBy: 'web_auto',
          verifiedBy: s.lockedActor === 'parent_demo' ? 'demo' : 'web_auto',
          itemId: id,
          questionNo: idx + 1,
          testedAt: res?.testedAt || ctx.testedAt,
          submittedAt,
          dateStr: ctx.testedDateStr,
          paperRef: `网页闯关 ${ctx.testedDateStr} #${idx + 1}`,
          promptMode: ctx.promptMode,
          variantKey: ctx.variantKey,
          expectedAnswer: ctx.primary,
          spokenText: ctx.spokenText,
          hadSpellingHint: Boolean(res?.usedHint || s.hintedOnPaper?.[id]),
          exposureSource: s.exposureSources?.[id] || null,
          taskType: 'paper_check',
          outcome,
          errorTags: res?.errorTags || [],
          note: `网页${difficultyMeta(itemDiff).title}自动判分`
        });

        if (evt) {
          recordedEvents.push(evt);
          if (['answer_corrected', 'answered_wrong', 'blank', 'hinted_correct'].includes(evt.outcome)) {
            needReviewIds.push(id);
          }
        }
      });

      // Also mark oralOnlyIds practiced during snap/match as bronze read_aloud
      for (const oid of (s.oralOnlyIds || [])) {
        SnapCore.recordEvent(state, {
          id: `oral_${s.sessionId}_${oid}`,
          sessionId: s.sessionId,
          actor: s.lockedActor,
          recordedBy: 'web_auto',
          itemId: oid,
          submittedAt,
          taskType: 'read_aloud',
          outcome: 'done',
          note: '网页互动认读完成'
        });
      }

      const easyCount = allTargetIds.filter(id => {
        const r = s.arenaResults?.[id];
        return r?.done && resolveItemDifficulty(s, id, 'arena') === 'easy' && !s.dueIds?.includes(id) && s.mode !== 'due_only' && s.mode !== 'baseline';
      }).length;

      s.summary = {
        tally: SnapCore.summarizePaperEvents(recordedEvents),
        easyCount,
        maxStreak: s.maxStreak || 0,
        needReviewIds
      };
      s.paperPhase = 'summary';
      setActorDraft(s.lockedActor || state.actorMode, null);
      render();
      await saveState();
      render();

      // Surface 6: Non-blocking AI Coach Post-Session Debrief
      if (SnapAI.isReady() && allTargetIds.length) {
        const passedWords = allTargetIds.filter(id => s.arenaResults?.[id]?.outcome === 'paper_independent').map(id => itemById(id)?.en).filter(Boolean);
        const missedDetails = needReviewIds.map(id => ({
          en: itemById(id)?.en,
          zh: itemById(id)?.zh,
          tags: s.arenaResults?.[id]?.errorTags || []
        }));
        SnapAI.generateSessionCoachReport({
          packTitle: s.packTitle,
          difficulty: s.difficulty,
          ratio: s.summary.tally.ratioText,
          maxStreak: s.maxStreak || 0,
          passedWords,
          missedDetails
        }).then(report => {
          if (!activeSession || activeSession.sessionId !== s.sessionId || !report) return;
          activeSession.aiDebrief = report;
          if (activeSession.paperPhase === 'summary') render();
        }).catch(() => {});
      }
    } finally {
      submitLock = false;
    }
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

  async function requestActorSwitch(explicitTarget = null) {
    const curActor = effectiveSessionActor();
    const targetActor = explicitTarget || (curActor === 'student' ? 'parent_demo' : 'student');
    if (curActor === targetActor && (!activeSession || activeSession.lockedActor === targetActor)) return;
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
          <h3 style="margin-top:0">🔒 当前闯关已锁定身份：${curLabel}</h3>
          <p class="muted">切换至<strong>「${nextLabel}」</strong>前，请选择如何处理当前未完结的进度：</p>
          <div style="display:grid;gap:10px;margin-top:16px">
            <button type="button" class="btn btn-mint btn-sm" data-role-modal="suspend_switch">⏸️ 暂存当前进度草稿，并切换至「${nextLabel}」</button>
            <button type="button" class="btn btn-primary btn-sm" data-role-modal="discard_switch">🗑️ 结束放弃本轮，并切换至「${nextLabel}」</button>
            <button type="button" class="btn btn-sm" data-role-modal="cancel">取消（继续闯关）</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderDueNavGateModal() {
    return `
      <div class="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="课前复习防泄题确认">
        <div class="modal-card">
          <h3 style="margin-top:0">⚡ 还有到期复习词未完成盲打</h3>
          <p class="muted">直接跳到拆词或词库页面会提前看到英文原词。请选择：</p>
          <div style="display:grid;gap:10px;margin-top:14px">
            <button type="button" class="btn btn-primary btn-sm" data-due-gate="stay">← 留在这里，花 20 秒先盲打完复习词（推荐）</button>
            <button type="button" class="btn btn-amber btn-sm" data-due-gate="mark_exposed">💡 跳过前置抽查（本次归入含提示巩固练习）</button>
          </div>
        </div>
      </div>
    `;
  }

  // ==================== Tab 1: Paperless & AI-Ready Lobby ====================
  function planLesson(pack, dueIds, mode = 'standard') {
    const extraSlots = pack.preserveFullPack ? dueIds.length : 0;
    const baseCap = (pack.paperCap || 5) + extraSlots;
    const totalPaperCap = mode === 'quick8' ? Math.min(baseCap, 4 + extraSlots) : baseCap;
    return SnapCore.planPackAllocation(state, pack.id, pack.itemIds, {
      totalPaperCap,
      dueIds,
      forceDictationAll: Boolean(pack.forceDictationAll)
    });
  }

  function renderLearnTab() {
    if (activeSession) return renderActiveSession();

    const summary = SnapCore.getStatsSummary(state, 'student');
    const dueInfo = SnapCore.getDueQueue(state, SnapCore.todayISO(), 3);
    const pack = selectedPack();
    const isBaseline = pack.modeHint === 'baseline';
    const dueList = isBaseline ? [] : dueInfo.todayPick.slice(0, 2);
    const dueIds = dueList.map(d => d.item.id);
    const alloc = planLesson(pack, dueIds);
    const quick = planLesson(pack, dueIds, 'quick8');
    const hasDraft = Boolean(state.activeDraft && state.activeDraft.lockedActor === state.actorMode);
    const canStartPack = isBaseline || alloc.hasAnyActiveTask || Boolean(pack.preread);
    const learned = pack.itemIds.filter(id => ['silver', 'gold'].includes(state.mastery?.[id]?.badge)).length;
    const curDiff = state.difficultyMode || 'normal';
    const aiProf = SnapAI.getActiveProfile();
    const aiReady = SnapAI.isReady();

    const planText = [
      alloc.paperNowIds.length ? `网页默写闯关 ${alloc.paperNowIds.length} 项` : '',
      alloc.oralOnlyIds.length ? `听读认义 ${alloc.oralOnlyIds.length} 项` : '',
      pack.preread ? '含情境短读' : ''
    ].filter(Boolean).join(' · ');

    const teaserIds = isBaseline ? pack.itemIds : [...alloc.paperNowIds, ...alloc.oralOnlyIds];
    const teaser = teaserIds.slice(0, 4).map(itemById).filter(Boolean).map(itemMeaning).join(' · ');

    return `
      ${hasDraft ? `
        <div class="card" style="background:#fef3c7;border-color:#f59e0b" id="draft-resume-card">
          <div class="row between">
            <div>
              <strong>🔄 发现未完成的闯关进度：</strong>${esc(state.activeDraft.packTitle || '进行中的练习')}
            </div>
            <div class="row">
              <button type="button" class="btn btn-sm btn-primary" data-act="resume-draft">继续闯关 →</button>
              <button type="button" class="btn btn-sm" data-act="discard-draft">清除草稿</button>
            </div>
          </div>
        </div>
      ` : ''}

      <div class="urgent-dictation-bar no-print" id="u6-urgent-banner">
        <div>
          <div class="urgent-dictation-title">📌 明日必默：五上 Unit 6 词汇表 1–10（带星号与不带星号全部必默）</div>
          <div class="muted" style="font-size:13px">对准课本 p.111 整栏 10 个词（*get along with 到 space），全程网页盲打无需纸笔！</div>
        </div>
        <div class="row" style="gap:8px">
          <button type="button" class="btn btn-sm ${pack.id === 'pack-u6-wl-1-10' ? 'btn-primary' : ''}" data-select-pack="pack-u6-wl-1-10">🔥 全 10 词连闯</button>
          <button type="button" class="btn btn-sm ${pack.id === 'pack-u6-wl-1-5' ? 'btn-primary' : ''}" data-select-pack="pack-u6-wl-1-5">前半场 (1–5)</button>
          <button type="button" class="btn btn-sm ${pack.id === 'pack-u6-wl-6-10' ? 'btn-primary' : ''}" data-select-pack="pack-u6-wl-6-10">后半场 (6–10)</button>
        </div>
      </div>

      <div class="lobby-layout">
        <section class="kid-hero ${isBaseline ? 'is-baseline' : ''}" aria-labelledby="lesson-heading">
          <div class="kid-hero-top">
            <div class="row" style="gap:8px">
              <span class="kid-stage">当前背记任务</span>
              <span class="kid-meta">${esc(packLabel(pack) || PACK_GROUPS.find(g => g.id === groupOfPack(pack))?.label || '')}</span>
            </div>
            <button type="button" class="ai-status-pill ${aiReady ? 'ready' : ''}" data-goto-tab="prep" title="点击配置 OpenAI / Gemini / DeepSeek / 本地 LM Studio 模型">
              ${aiReady ? `🤖 AI 已就绪 · ${esc(aiProf.model)}` : `⚙️ 配置 AI 智能出题（默认 ${esc(aiProf.defaultModel)}）`}
            </button>
          </div>

          <h1 class="kid-title" id="lesson-heading" tabindex="-1">${esc(pack.kidTitle || pack.title)}</h1>
          <p class="kid-note">${isBaseline ? '直接在网页上盲打小测，摸清哪些已经稳了。' : esc(planText)}</p>
          ${teaser ? `<p class="kid-words">${esc(teaser)}${teaserIds.length > 4 ? ` 等共 ${teaserIds.length} 项` : ''}</p>` : ''}
          ${learned ? `<p class="kid-progress-text">🏅 这组已点亮银/金牌 ${learned} / ${pack.itemIds.length} 项</p>` : ''}
          ${dueList.length ? `<p class="kid-due-tip">⚡ 开局先花 30 秒闪电复习 ${dueList.length} 个到期词</p>` : ''}

          ${!isBaseline ? `
            <div class="diff-selector" role="group" aria-label="选择背记与考核难度">
              <div class="diff-selector-label">
                <span>🎛️ 闯关难度档位（家长可按熟练度切换）：</span>
                <span style="color:var(--primary-dark)">当前：${difficultyMeta(curDiff).icon} ${difficultyMeta(curDiff).title}</span>
              </div>
              <div class="diff-grid">
                ${['easy', 'normal', 'challenge', 'adaptive'].map(d => {
                  const m = difficultyMeta(d);
                  const active = curDiff === d;
                  return `
                    <button type="button" class="diff-btn ${active ? 'active-' + d : ''}" data-set-diff="${d}" aria-pressed="${active}">
                      <b>${m.icon} ${m.title}</b>
                      <span>${m.desc}</span>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

          <div class="kid-actions">
            <button type="button" class="btn btn-primary kid-start" data-start-mode="${isBaseline ? 'baseline' : 'standard'}" ${canStartPack ? '' : 'disabled'}>
              ${isBaseline ? '▶ 开始网页摸底小测' : `▶ 开始网页闯关（${difficultyMeta(curDiff).title}）`}
            </button>
            <a class="btn kid-browse-link" href="#pack-library">🔄 换一组</a>
            ${!isBaseline ? `<button type="button" class="btn" data-start-mode="quick8" ${canStartPack ? '' : 'disabled'}>⚡ 8 分钟快练</button>` : ''}
            ${dueInfo.todayPick.length ? `<button type="button" class="btn" data-start-mode="due_only">📅 只测复习词（${dueInfo.todayPick.length} 项）</button>` : ''}
          </div>

          ${!canStartPack ? '<p class="kid-warn">这组词全部设为下次再练了，请选另一组或在下方家长设置中开启。</p>' : ''}
          ${renderLessonDetails(pack, alloc, quick, dueList, isBaseline)}
        </section>
        ${renderPackLibrary(pack)}
      </div>

      <details class="parent-tune" data-parent-tune ${parentTuneOpen ? 'open' : ''}>
        <summary>🧰 家长微调 · 全部课程包下拉与单题任务开关</summary>
        <div class="parent-tune-body">
          <label for="pack-select" class="parent-label">📚 全部课程包（含 Unit 6 词表 1–10、U5 重点句与周末作业）</label>
          <select id="pack-select" style="width:100%;max-width:640px;font-weight:700">
            ${state.packs.map(p => `<option value="${esc(p.id)}" ${p.id === pack.id ? 'selected' : ''}>${esc(p.title)}（共 ${p.itemIds.length} 项）</option>`).join('')}
          </select>
          <p class="muted" style="margin:8px 0 0">${esc(pack.subtitle || '')}</p>
          ${pack.modeHint !== 'baseline' ? renderAllocationPreview(pack, alloc, dueList) : ''}
        </div>
      </details>

      <div class="badge-strip compact">
        <div class="stat-tile">
          <span class="medal-icon medal-gold">🥇</span>
          <div>
            <div class="stat-num">${summary.gold}</div>
            <div class="stat-label">金牌 · 隔日盲打稳过${summary.goldSlip ? `（${summary.goldSlip} 个需补测）` : ''}</div>
          </div>
        </div>
        <div class="stat-tile">
          <span class="medal-icon medal-silver">🥈</span>
          <div><div class="stat-num">${summary.silver}</div><div class="stat-label">银牌 · 首答盲打全对</div></div>
        </div>
        <div class="stat-tile">
          <span class="medal-icon medal-bronze">🥉</span>
          <div><div class="stat-num">${summary.bronze}</div><div class="stat-label">铜牌 · 已初学巩固</div></div>
        </div>
        <div class="stat-tile">
          <span class="medal-icon medal-due">📅</span>
          <div><div class="stat-num">${dueInfo.totalDue}</div><div class="stat-label">今日待复习</div></div>
        </div>
      </div>
    `;
  }

  const PACK_GROUPS = [
    { id: 'u6', label: '第 6 单元' },
    { id: 'homework', label: '必默与作业' },
    { id: 'sentences', label: '课本重点句' },
    { id: 'words', label: '第 5 单元与基础' },
    { id: 'mine', label: '我的词单' },
    { id: 'start', label: '摸底小测' }
  ];

  function groupOfPack(pack) {
    if (pack.id === 'pack-baseline') return 'start';
    if (pack.id.startsWith('pack-u6-wl-1-') || pack.id.startsWith('pack-u6-wl-6-') || pack.id.startsWith('pack-hw-')) return 'homework';
    if (pack.id.startsWith('pack-u5-sent-')) return 'sentences';
    if (/^pack-autumn-[45]$/.test(pack.id) || pack.id.startsWith('pack-u6-')) return 'u6';
    if (/^pack-autumn-[1-3]$/.test(pack.id)) return 'words';
    return 'mine';
  }

  function itemMeaning(item) {
    return String(item.zh || '').replace(/；/g, ' / ');
  }

  function packLabel(pack) {
    if (pack.id.startsWith('pack-u6-wl-1-10')) return '📌 明日必默 · p.111 全 10 词';
    if (pack.id === 'pack-u6-wl-1-5') return '📌 明日必默 · 前 5 词';
    if (pack.id === 'pack-u6-wl-6-10') return '📌 明日必默 · 后 5 词';
    if (pack.id === 'pack-u6-wl-11-24') return 'p.112 · 后 14 词';
    if (pack.homeworkLabel) return pack.homeworkLabel;
    if (pack.id === 'pack-u5-sent-all') return 'p.60–61 · 全部 6 句';
    if (pack.id === 'pack-u5-sent-a') return 'p.60 · 前 3 句';
    if (pack.id === 'pack-u5-sent-b') return 'p.61 · 后 3 句';
    if (pack.id === 'pack-u6-p75') return '第 75 页';
    if (pack.id === 'pack-u6-p78') return '第 78–79 页';
    return '';
  }

  function packSizeLabel(pack) {
    const items = pack.itemIds.map(itemById).filter(Boolean);
    const sentences = items.filter(it => it.type === 'sentence').length;
    const words = items.length - sentences;
    return [words ? `${words} 个词/短语` : '', sentences ? `${sentences} 句` : ''].filter(Boolean).join('，') || '0 项';
  }

  function renderPackResults(group, query = '') {
    const chosen = selectedPack();
    const normalizeSearch = value => SnapCore.normText(value).toLowerCase().replace(/\s/g, '');
    const term = normalizeSearch(query);
    const packs = state.packs.filter(pack => {
      if (!term) {
        if (group === 'u6' && pack.id.startsWith('pack-u6-')) return true;
        return groupOfPack(pack) === group;
      }
      const fields = [pack.kidTitle, pack.title, packLabel(pack), pack.subtitle, PACK_GROUPS.find(g => g.id === groupOfPack(pack))?.label];
      for (const id of pack.itemIds) {
        const item = itemById(id);
        if (item) fields.push(item.zh, item.en);
      }
      return fields.some(field => normalizeSearch(field).includes(term));
    });
    return `
      <p class="pack-results-count" role="status">${term ? `找到 ${packs.length} 组` : `${packs.length} 组可选`}</p>
      ${packs.length ? `<div class="pack-cards">
        ${packs.map(pack => {
          const label = packLabel(pack);
          const active = pack.id === chosen.id;
          const preview = pack.itemIds.slice(0, 3).map(itemById).filter(Boolean).map(itemMeaning).join(' · ');
          return `<button type="button" class="pack-card ${active ? 'active' : ''}" aria-pressed="${active}" data-pick-pack="${esc(pack.id)}">
            <span class="pack-card-top"><span>${esc(label || packSizeLabel(pack))}</span>${active ? '<b>当前选中</b>' : ''}</span>
            <span class="pack-card-title">${esc(pack.kidTitle || pack.title)}</span>
            <span class="pack-card-words">${esc(preview)}</span>
          </button>`;
        }).join('')}
      </div>` : `<p class="muted">${term ? '试试搜课本页码或中文词义。' : '在家长与AI设置页新建的词单会显示在这里。'}</p>`}
    `;
  }

  function renderPackLibrary(pack) {
    const group = packGroup || groupOfPack(pack);
    return `
      <section class="pack-library" aria-labelledby="pack-library-heading" id="pack-library">
        <h2 id="pack-library-heading" tabindex="-1">选一组词单</h2>
        <div class="pack-filters" aria-label="按分类筛选">
          ${PACK_GROUPS.map(g => `<button type="button" aria-pressed="${!packQuery && g.id === group}" data-pack-group="${g.id}">${g.label}</button>`).join('')}
        </div>
        <label class="pack-search" for="pack-query">
          <span>快速搜索</span>
          <input id="pack-query" type="search" placeholder="搜中文词义、英文或页码（如：邻居、heavy、75）" value="${esc(packQuery)}" autocomplete="off">
        </label>
        <div id="pack-results">${renderPackResults(group, packQuery)}</div>
      </section>
    `;
  }

  function renderLessonDetails(pack, alloc, quick, dueList, isBaseline) {
    const lessonItems = isBaseline ? pack.itemIds : alloc.paperNowIds;
    const list = (label, ids) => {
      const items = ids.map(itemById).filter(Boolean);
      return items.length ? `<div class="lesson-list"><h3>${label} · ${items.length} 项</h3>
        <ul>${items.map(it => `<li>${esc(itemMeaning(it))}${it.textbookCore === false && it.sourceScope === 'textbook_wordlist' ? ' <span class="pill pill-star" style="font-size:11px">*课本星号词</span>' : ''}</li>`).join('')}</ul></div>` : '';
    };
    return `<details class="lesson-details" data-lesson-details ${lessonDetailsOpen ? 'open' : ''}>
      <summary>展开查看本组中文词单明细（共 ${lessonItems.length} 项）</summary>
      ${list('课前闪电复习', dueList.map(entry => entry.item.id))}
      ${list(isBaseline ? '摸底词条' : '本轮网页必默', lessonItems)}
      ${!isBaseline ? list('仅听读认义', alloc.oralOnlyIds) : ''}
      ${!isBaseline ? list('留到下次再练', alloc.deferredIds) : ''}
    </details>`;
  }

  function renderAllocationPreview(pack, alloc, dueList) {
    const overrides = state.packOverrides?.[pack.id] || {};
    const renderRow = (id, currentBucket) => {
      const it = itemById(id);
      if (!it) return '';
      const eff = overrides[id] || (pack.forceDictationAll ? 'paper_dictation' : SnapCore.defaultActivityForItem(it, overrides[id]));
      return `
        <div class="alloc-item">
          <div>
            <strong>${esc(it.zh)}</strong>
            ${it.textbookCore === false && it.sourceScope === 'textbook_wordlist' ? '<span class="pill pill-star" style="font-size:11px">*星号词</span>' : ''}
          </div>
          <select data-pack-item-act="${esc(id)}" style="font-size:12.5px;padding:3px 6px">
            <option value="paper_dictation" ${eff === 'paper_dictation' && currentBucket !== 'deferred' ? 'selected' : ''}>⌨️ 本轮网页默写</option>
            <option value="oral_only" ${eff === 'oral_only' ? 'selected' : ''}>🗣️ 仅听读认义</option>
            <option value="next_candidate" ${eff === 'next_candidate' || currentBucket === 'deferred' ? 'selected' : ''}>📥 留作下次再练</option>
          </select>
        </div>
      `;
    };

    return `
      <div style="margin-top:14px">
        <div class="muted" style="font-weight:700">📋 本轮任务分流预览（为防提前泄题仅显示中文）：</div>
        <div class="alloc-grid">
          <div class="alloc-col">
            <div style="font-weight:800;color:#1e40af;margin-bottom:6px">⌨️ 本轮网页默写（${alloc.paperNowIds.length} 项）</div>
            ${alloc.paperNowIds.map(id => renderRow(id, 'paper')).join('') || '<div class="muted">无默写项</div>'}
          </div>
          <div class="alloc-col">
            <div style="font-weight:800;color:#047857;margin-bottom:6px">🗣️ 仅听读认义（${alloc.oralOnlyIds.length} 项）</div>
            ${alloc.oralOnlyIds.map(id => renderRow(id, 'oral')).join('') || '<div class="muted">无单独认读项</div>'}
          </div>
          <div class="alloc-col">
            <div style="font-weight:800;color:#92400e;margin-bottom:6px">📥 下次再练（${alloc.deferredIds.length} 项）</div>
            ${alloc.deferredIds.map(id => renderRow(id, 'deferred')).join('') || '<div class="muted">全部已排入本轮</div>'}
          </div>
        </div>
      </div>
    `;
  }

  // ==================== Active Paperless Session Rendering ====================
  function renderActiveSession() {
    const s = activeSession;
    const mins = elapsedMinutes();
    const overBudget = mins >= (state.profile.budgetMinutes || 18);

    if (s.paperPhase === 'summary' || s.oralPhase === 'summary') {
      return renderSessionSummary(s);
    }

    const lesson = state.packs.find(pack => pack.id === s.packId);
    const hasArena = (s.arenaQueue?.length || 0) > 0;
    const diffInfo = difficultyMeta(s.difficulty || 'normal');
    const aiReady = SnapAI.isReady();

    return `
      <div class="session-bar no-print">
        <div class="row between" style="width:100%">
          <strong class="session-lesson-title" style="width:auto">${esc(lesson?.kidTitle || s.packTitle)}</strong>
          <div class="row" style="gap:8px">
            <span class="pill pill-core">${diffInfo.icon} ${diffInfo.title}</span>
            <span id="session-ai-badge" class="ai-status-pill ${aiReady ? 'ready' : ''}" style="cursor:default">
              ${s.aiPrefetchedCount ? `✨ AI 已出新题 (${s.aiPrefetchedCount})` : (aiReady ? `🤖 ${esc(SnapAI.getActiveProfile().model)}` : '📘 内置五上题库')}
            </span>
            ${s.streak >= 2 ? `<span class="streak-pill">🔥 ${s.streak} 连击</span>` : ''}
          </div>
        </div>

        <div class="step-pills" role="tablist" aria-label="闯关步骤">
          ${s.dueIds?.length && s.mode !== 'due_only' ? `
            <button type="button" class="step-pill ${s.step === 'due_precheck' ? 'active' : (s.duePrewritten ? 'done' : '')}" data-jump-step="due_precheck">⚡ 课前复习 (${s.dueIds.length})</button>
          ` : ''}
          ${s.focusIds?.length >= 2 && s.difficulty !== 'challenge' ? `
            <button type="button" class="step-pill ${s.step === 'match' ? 'active' : (s.stepsDone?.match ? 'done' : '')}" data-jump-step="match">🎮 音义消消乐</button>
          ` : ''}
          ${s.focusIds?.length && s.difficulty !== 'challenge' ? `
            <button type="button" class="step-pill ${s.step === 'snap' ? 'active' : (s.stepsDone?.snap ? 'done' : '')}" data-jump-step="snap">🧲 拆词速记 (${s.focusIds.length})</button>
          ` : ''}
          ${hasArena ? `
            <button type="button" class="step-pill ${s.step === 'paper' ? 'active' : ''}" data-jump-step="paper">⌨️ 网页默写闯关 (${s.arenaQueue.length})</button>
          ` : `
            <button type="button" class="step-pill ${s.step === 'oral_wrapup' ? 'active' : ''}" data-jump-step="oral_wrapup">🗣️ 认读收工</button>
          `}
          <button type="button" class="step-pill ${s.step === 'bug' ? 'active' : ''}" data-jump-step="bug">🎮 趣玩闯关</button>
          <button type="button" class="step-pill ${s.step === 'board' ? 'active' : ''}" data-jump-step="board">📖 故事与摇句黑板</button>
        </div>

        <div class="row">
          <button type="button" class="btn btn-sm" data-act="pause-session">⏸️ 暂存进度</button>
          <button type="button" class="btn btn-sm" data-act="abandon-session">退出</button>
        </div>
      </div>

      ${overBudget ? `
        <div class="bridge-callout no-print" style="margin-bottom:14px">
          ⏰ <strong>已专注练习 ${mins} 分钟啦！</strong>可随时点「提前结算已做题」，未做完的词会留到下次，不扣正确率。
        </div>
      ` : ''}

      ${s.step === 'due_precheck' ? renderArenaStage(s, 'due') : ''}
      ${s.step === 'match' ? renderMatchStep(s) : ''}
      ${s.step === 'snap' ? renderSnapStep(s) : ''}
      ${s.step === 'paper' ? renderArenaStage(s, 'arena') : ''}
      ${s.step === 'bug' ? renderBugStep(s) : ''}
      ${s.step === 'board' ? renderBoardStep(s) : ''}
      ${s.step === 'oral_wrapup' ? renderOralWrapupStep(s) : ''}
    `;
  }

  // ==================== Micro-Game 1: Sound & Meaning Match (30s Icebreaker) ====================
  function renderMatchStep(s) {
    if (!s.matchState) initMatchGameState(s);
    const ms = s.matchState;
    const total = ms.leftCards.length;
    const matchedCount = ms.matchedIds.length;
    const allCleared = matchedCount >= total;

    return `
      <section class="card" id="match-game-card">
        <div class="row between">
          <div>
            <span class="pill pill-core">热身微游戏 · ⚡ 音义闪电消消乐（已配对 ${matchedCount} / ${total}）</span>
            <h2 style="margin:8px 0 4px">点左边的英文（自动播发音），再点右边对应的中文意思！</h2>
          </div>
          <div class="row">
            ${ms.combo >= 2 ? `<span class="streak-pill">🔥 连消 ×${ms.combo}</span>` : ''}
            <button type="button" class="btn btn-sm" data-complete-step="match" data-next-step="snap">跳过热身 →</button>
          </div>
        </div>

        <div class="match-board">
          <div class="match-col">
            ${ms.leftCards.map(c => {
              const isMatched = ms.matchedIds.includes(c.id);
              const isSelected = ms.pickedLeft === c.id;
              const isWrong = ms.wrongLeft === c.id;
              return `
                <button type="button" class="match-card english ${isMatched ? 'matched' : ''} ${isSelected ? 'selected' : ''} ${isWrong ? 'wrong' : ''}"
                  data-match-left="${esc(c.id)}" ${isMatched ? 'disabled' : ''}>
                  <span>🔊 ${esc(c.text)}</span>
                  <span style="font-size:13px;opacity:0.65">${isMatched ? '✅' : '点我听音'}</span>
                </button>
              `;
            }).join('')}
          </div>
          <div class="match-col">
            ${ms.rightCards.map(c => {
              const isMatched = ms.matchedIds.includes(c.id);
              const isSelected = ms.pickedRight === c.id;
              const isWrong = ms.wrongRight === c.id;
              return `
                <button type="button" class="match-card ${isMatched ? 'matched' : ''} ${isSelected ? 'selected' : ''} ${isWrong ? 'wrong' : ''}"
                  data-match-right="${esc(c.id)}" ${isMatched ? 'disabled' : ''}>
                  <span>${esc(c.text)}</span>
                  <span style="font-size:13px;opacity:0.65">${isMatched ? '✅' : '配对'}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        ${allCleared ? `
          <div class="bridge-callout" style="text-align:center;font-size:17px;font-weight:900">
            🎉 太快啦！${total} 组音义全部闪电配对成功！
            <div style="margin-top:10px">
              <button type="button" class="btn btn-mint" data-complete-step="match" data-next-step="snap">进入拆词巧记 →</button>
            </div>
          </div>
        ` : ''}
      </section>
    `;
  }

  // ==================== Micro-Game 2: Magnetic Snap + Zero-Leak Blind Cloze ====================
  function renderSnapStep(s) {
    const id = s.focusIds[s.snapIndex];
    const item = itemById(id);
    const endTarget = s.arenaQueue?.length ? 'paper' : 'oral_wrapup';
    if (!item) {
      return `<div class="card"><p>本组拆词已完成！</p><button type="button" class="btn btn-primary" data-jump-step="${endTarget}">进入网页默写闯关 →</button></div>`;
    }
    if (!s.snapState || s.snapState.itemId !== item.id) initSnapCardState(s);
    const st = s.snapState;
    const pieces = item.snap?.pieces || [item.en];
    const audioInfo = SnapAudio.resolveSourceInfo(state, item);
    const isOralOnly = s.oralOnlyIds?.includes(item.id);
    const isSentence = item.type === 'sentence';
    const hasCloze = Boolean(item.cloze && !isOralOnly);
    const itemDiff = resolveItemDifficulty(s, item.id, 'snap');
    const coachTip = SnapAI.getMemoryCoachTip(item);

    // Stage 2B: Strict Zero-Leak Blind Cloze / Easy Choice Verification
    if (st.inClozeMode && hasCloze) {
      return `
        <section class="card" id="blind-cloze-card">
          <div class="row between" style="margin-bottom:10px">
            <div>
              <span class="pill pill-core">🎯 遮盖盲填小挑战（第 ${s.snapIndex + 1} / ${s.focusIds.length} 项 · 原词已隐藏）</span>
              ${badgeLabel(state.mastery[item.id])}
            </div>
            ${!st.clozeDone ? `
              <button type="button" class="btn btn-sm" data-act="exit-cloze-peek">👀 退回看一眼磁吸块</button>
            ` : ''}
          </div>

          <div class="word-hero">
            <div class="muted">凭刚才的记忆补全空缺（原词与磁吸块已全部收起，杜绝照抄）</div>
            <div class="word-zh-big">${esc(item.zh)}</div>
            <div style="margin-top:8px">
              <button type="button" class="btn btn-primary" data-speak-item="${esc(item.id)}">🔊 ${isSentence ? '再听整句朗读' : '再听真人发音'}</button>
              <span class="audio-tag">${esc(audioInfo.label)}</span>
            </div>
          </div>

          <div style="background:var(--surface-soft);padding:18px;border-radius:14px;margin-top:12px;text-align:center">
            <div class="muted" style="font-weight:700;margin-bottom:6px">💡 思考线索：${esc(item.cloze.hint)}</div>
            <form id="cloze-form" class="cloze-box english">
              <span>${esc(item.cloze.prefix)}</span>
              <input type="text" id="cloze-input" class="cloze-input english" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="凭记忆输入" value="${esc(st.clozeDone ? item.cloze.blank : (st.clozeDraft || ''))}" ${st.clozeDone ? 'readonly' : ''}>
              <span>${esc(item.cloze.suffix)}</span>
              ${!st.clozeDone ? `<button type="submit" class="btn btn-primary btn-sm">核对 (Enter)</button>` : `<span style="color:#059669;font-weight:800">✅ 盲填精准过关！按 Enter 下一词</span>`}
            </form>
            ${st.clozeFeedback ? `<div class="muted" style="color:#b45309;font-weight:700;margin-top:8px" id="cloze-feedback">${esc(st.clozeFeedback)}</div>` : ''}

            ${itemDiff === 'easy' && !st.clozeDone ? `
              <div style="margin-top:14px">
                <div class="muted" style="font-size:12.5px;margin-bottom:6px">🌱 初学辅助：也可以直接从下方近形词中选出全词正确拼写：</div>
                <div class="choice-grid">
                  ${(st.quizChoices || []).map(ch => `
                    <button type="button" class="choice-btn english" data-easy-snap-choice="${esc(ch)}">${esc(ch)}</button>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <div class="row between" style="margin-top:16px">
            <div>
              ${s.snapIndex > 0 ? `<button type="button" class="btn btn-sm" data-act="prev-word">← 上一项</button>` : ''}
            </div>
            <button type="button" class="btn ${st.clozeDone ? 'btn-mint' : 'btn-primary'}" data-act="next-word">
              ${s.snapIndex + 1 < s.focusIds.length ? '下一项 →' : '拆词完成，进入默写闯关 →'}
            </button>
          </div>
        </section>
      `;
    }

    // Stage 2A: Magnetic Chunk Forging + AI Memory Hook
    return `
      <section class="card" id="snap-forge-card">
        <div class="row between" style="margin-bottom:10px">
          <div>
            <span class="pill pill-core">🧲 拆词速记（第 ${s.snapIndex + 1} / ${s.focusIds.length} 项${item.wordlistOrder ? ` · U6词表 #${String(item.wordlistOrder).padStart(2, '0')}` : ''}）</span>
            ${item.textbookCore === false && item.sourceScope === 'textbook_wordlist' ? '<span class="pill pill-star">*星号必默词</span>' : ''}
            ${badgeLabel(state.mastery[item.id])}
          </div>
          <div class="row">
            <button type="button" class="btn btn-sm" data-act="toggle-model-mask">${st.hideModel ? '👀 显示原词示范' : '🙈 遮住原词盲拼'}</button>
            <button type="button" class="btn btn-sm" data-act="skip-to-next-word">已熟，跳过 →</button>
          </div>
        </div>

        <div class="word-hero">
          <div class="word-zh-big">${esc(item.zh)}</div>
          ${!st.hideModel ? `
            <div class="study-target english">${esc(item.en)}</div>
            <div class="chunk-display english">${esc(item.displayChunks || item.en)}</div>
          ` : `
            <div class="muted" style="padding:10px 0;font-weight:800;color:#1e40af">🙈 原词与巧记提示已遮盖，请听发音咔嗒拼出！</div>
          `}
          <div style="margin-top:8px">
            <button type="button" class="btn btn-primary btn-sm" data-speak-item="${esc(item.id)}">🔊 听发音</button>
            <span class="audio-tag">${esc(audioInfo.label)}</span>
          </div>
        </div>

        ${!st.hideModel ? `
          <div class="help-callout">
            <div class="row between" style="gap:8px">
              <div><strong>💡 巧记锦囊：</strong>${esc(coachTip)}</div>
              <button type="button" class="btn btn-sm" style="min-height:30px;padding:3px 10px;font-size:12.5px" data-act="alt-ai-mnemonic" ${aiUI.altMnemonicLoading ? 'disabled' : ''}>
                ${aiUI.altMnemonicLoading ? '⏳ AI 构思中...' : '✨ 换个 AI 趣味记法'}
              </button>
            </div>
          </div>
          ${item.bridgeNote ? `<div class="bridge-callout"><strong>🔗 关联串记：</strong>${esc(item.bridgeNote)}</div>` : ''}
        ` : ''}

        <div class="snap-tray english" aria-label="磁吸拼装槽">
          ${pieces.map((_, idx) => {
            const val = st.filled[idx];
            return val !== undefined
              ? `<span class="snap-slot filled" data-act="undo-snap" title="点击撤回最后一块">${esc(val === '␣' ? '␣ 空格' : val)}</span>`
              : `<span class="snap-slot">#${idx + 1}</span>`;
          }).join('')}
        </div>

        ${st.bounceTip ? `<div class="bounce-bubble">${esc(st.bounceTip)}</div>` : ''}

        ${!st.completedSnap ? `
          <div class="snap-pool">
            ${st.pool.map(tile => {
              const used = st.usedKeys.includes(tile.key);
              const wob = st.wobbleKey === tile.key;
              const isSp = tile.text === '␣';
              return `
                <button type="button" class="magnet-tile english ${isSp ? 'space-tile' : ''} ${used ? 'used' : ''} ${wob ? 'wobble' : ''}"
                  data-snap-key="${esc(tile.key)}" data-tile-text="${esc(tile.text)}" ${used ? 'disabled' : ''}>
                  ${esc(isSp ? '␣ 空格' : tile.text)}
                </button>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="bridge-callout" style="text-align:center;font-size:17px;font-weight:800">
            🎉 咔嗒合拢成功！<span class="english">${esc(item.en)}</span>
            <div style="margin-top:10px">
              ${hasCloze ? `
                <button type="button" class="btn btn-mint" data-act="enter-cloze">🙈 收起磁吸答案，进入盲填小挖空挑战 →</button>
              ` : `
                <button type="button" class="btn btn-mint" data-act="next-word">${s.snapIndex + 1 < s.focusIds.length ? '下一项 →' : '进入网页默写闯关 →'}</button>
              `}
            </div>
          </div>
        `}

        <div class="row between" style="margin-top:14px">
          <div class="row">
            ${hasCloze && !st.completedSnap ? `<button type="button" class="btn btn-sm" data-act="open-cloze">🎯 收起答案直接盲填</button>` : ''}
            ${s.snapIndex > 0 ? `<button type="button" class="btn btn-sm" data-act="prev-word">← 上一项</button>` : ''}
          </div>
          <button type="button" class="btn btn-primary" data-act="next-word">
            ${s.snapIndex + 1 < s.focusIds.length ? '下一项 →' : '拆词完成，进入网页默写 →'}
          </button>
        </div>
      </section>
    `;
  }

  // ==================== Core Paperless Web Dictation & AI Quiz Arena ====================
  function buildSkeletonMask(text) {
    return String(text || '').split(' ').map(word => {
      if (word.length <= 2) return word[0] + ' _';
      return word[0] + ' ' + '_ '.repeat(word.length - 2).trim() + ' ' + word[word.length - 1];
    }).join('   ␣   ');
  }

  function buildSlotRhythm(text) {
    const words = String(text || '').split(' ').filter(Boolean);
    return words.map(w => {
      return w.split('').map(ch => (ch === "'" || ch === '.' || ch === '?') ? ch : '_').join(' ');
    });
  }

  function renderDiffTokensHtml(tokens) {
    if (!tokens?.length) return '';
    return `<div class="diff-tokens english">` + tokens.map(t => {
      const disp = t.char === ' ' ? '␣' : esc(t.char);
      if (t.type === 'same') return `<span class="diff-tok-same">${disp}</span>`;
      if (t.type === 'case') return `<span class="diff-tok-case" title="大小写需调整">${disp}</span>`;
      if (t.type === 'missing') return `<span class="diff-tok-missing" title="漏掉了 ${disp}">${disp}</span>`;
      return `<span class="diff-tok-extra" title="多敲了 ${disp}">${disp}</span>`;
    }).join('') + `</div>`;
  }

  function renderArenaStage(s, queueKey = 'arena') {
    const isDueStage = queueKey === 'due';
    const list = isDueStage ? s.dueIds : s.arenaQueue;
    const idx = isDueStage ? (s.dueIndex || 0) : (s.arenaIndex || 0);
    if (!list?.length) return renderOralWrapupStep(s);

    const id = list[idx];
    const it = itemById(id);
    if (!it) return '';

    let card = isDueStage ? s.dueCard : s.arenaCard;
    if (!card || card.itemId !== id) {
      initArenaCardState(s, queueKey);
      card = isDueStage ? s.dueCard : s.arenaCard;
    }

    const ctx = ensureItemContext(s, id, { preserveExisting: true });
    const itemDiff = isDueStage ? 'challenge' : resolveItemDifficulty(s, id, 'arena');
    const diffInfo = difficultyMeta(itemDiff);
    const pct = Math.round(((idx + (card.subPhase === 'passed' ? 1 : 0)) / list.length) * 100);
    const audioInfo = SnapAudio.resolveSourceInfo(state, it);
    const needsApostrophe = ctx.primary.includes("'");
    const doneCount = Object.values(s.arenaResults || {}).filter(r => r?.done).length;

    let promptBody = '';
    if (ctx.promptMode === 'audio_only') {
      promptBody = `
        <div class="muted" style="font-weight:800">🎧 纯听音盲打模式（中文已隐藏，请仔细听发音写出英文）</div>
        <div style="margin:12px 0">
          <button type="button" class="btn btn-primary" data-speak-arena="${esc(id)}">🔊 播放发音 (Tab)</button>
        </div>
      `;
    } else if (ctx.promptMode === 'ai_sentence' && ctx.sentenceTemplate) {
      promptBody = `
        <div class="row" style="justify-content:center;gap:8px">
          <span class="pill ${ctx.fromAI ? 'pill-core' : ''}">${ctx.fromAI ? '🤖 AI 五上专属新句' : '📘 五上语境活学句'}</span>
          ${card.subPhase === 'typing' ? `<button type="button" class="btn btn-sm" style="min-height:28px;padding:2px 9px;font-size:12px" data-act="swap-ai-sentence">🎲 换一句新题</button>` : ''}
        </div>
        <div class="arena-sentence-template english">${esc(ctx.sentenceTemplate)}</div>
        <div class="arena-zh-prompt" style="font-size:21px">${esc(ctx.promptZh)}</div>
        <div style="margin-top:8px">
          <button type="button" class="btn btn-sm btn-primary" data-speak-arena="${esc(id)}">🔊 听目标词发音</button>
          <span class="audio-tag">${esc(audioInfo.label)}</span>
        </div>
      `;
    } else if (ctx.promptMode === 'zh_prompt') {
      promptBody = `
        <div class="muted">🇨🇳 看中文默写模式（不播语音，纯靠记忆提取拼写）</div>
        <div class="arena-zh-prompt">${esc(ctx.promptZh || it.zh)}</div>
      `;
    } else {
      promptBody = `
        <div class="arena-zh-prompt">${esc(ctx.promptZh || it.zh)}</div>
        <div style="margin-top:8px">
          <button type="button" class="btn btn-primary" data-speak-arena="${esc(id)}">🔊 再听发音 (Tab)</button>
          <span class="audio-tag">${esc(audioInfo.label)}</span>
        </div>
      `;
    }

    // Difficulty-specific non-spoiler visual guides (ONLY while typing / blind_retype, NEVER showing full answer!)
    let scaffoldHtml = '';
    if (card.subPhase === 'typing') {
      if (itemDiff === 'easy') {
        scaffoldHtml = `
          <div class="help-callout" style="text-align:center;max-width:560px;margin:10px auto">
            <div>🌱 <b>初学骨架引导</b>：<span class="english" style="font-weight:900;font-size:20px;color:#1e40af;margin-left:6px">${esc(buildSkeletonMask(ctx.primary))}</span></div>
            <div class="muted" style="font-size:12.5px;margin-top:3px">💡 提示：${esc(ctx.hintText)}</div>
          </div>
        `;
      } else if (itemDiff === 'normal') {
        const groups = buildSlotRhythm(ctx.primary);
        scaffoldHtml = `
          <div class="slot-rhythm-guide" aria-label="词数与字母位数提示">
            ${groups.map(g => `<span class="slot-word-group">${esc(g)}</span>`).join('<span style="font-size:14px;color:#64748b">␣空格</span>')}
          </div>
          <div class="muted" style="text-align:center;font-size:13px">
            共 ${groups.length > 1 ? `${groups.length} 个词（词间记得敲空格）` : `${ctx.primary.length} 个字母`}
            ${card.usedHint ? ` · 💡 拆块结构提示：<b class="english">${esc(ctx.hintText)}</b>` : ''}
          </div>
        `;
      } else {
        scaffoldHtml = `
          <div class="muted" style="text-align:center;font-size:13px">
            🔥 挑战考核模式：零提示空白默写（注意检查大小写、词间空格与撇号）
          </div>
        `;
      }
    }

    return `
      <section class="arena-shell" id="web-arena-card">
        <div class="row between">
          <div>
            <span class="pill pill-core">
              ${isDueStage ? `⚡ 课前闪电复习 (${idx + 1} / ${list.length})` : `⌨️ 网页无纸化默写 (${idx + 1} / ${list.length})`}
            </span>
            <span class="pill" style="margin-left:6px">${diffInfo.icon} ${diffInfo.title}</span>
            ${badgeLabel(state.mastery[id])}
          </div>

          <div class="row" style="gap:8px">
            <label class="muted" style="font-size:13px;font-weight:700">
              出题方式：
              <select id="arena-prompt-mode" style="padding:4px 8px;font-size:13px;font-weight:700" ${card.subPhase !== 'typing' ? 'disabled' : ''}>
                <option value="ai_mixed" ${s.promptMode === 'ai_mixed' ? 'selected' : ''}>🤖 AI 智能混合出题（推荐）</option>
                <option value="audio_plus_zh" ${s.promptMode === 'audio_plus_zh' ? 'selected' : ''}>🔊 听音 + 中文</option>
                <option value="ai_sentence" ${s.promptMode === 'ai_sentence' ? 'selected' : ''}>📝 纯 AI 五上新句挖空</option>
                <option value="audio_only" ${s.promptMode === 'audio_only' ? 'selected' : ''}>🎧 纯听音盲打</option>
                <option value="zh_prompt" ${s.promptMode === 'zh_prompt' ? 'selected' : ''}>🇨🇳 纯中文默写</option>
              </select>
            </label>
            ${!isDueStage && doneCount > 0 ? `
              <button type="button" class="btn btn-sm" data-act="finish-arena-early" title="将已完成题目结算入账，未做题标为未测留待下次">提前交卷 (${doneCount}/${list.length})</button>
            ` : ''}
          </div>
        </div>

        <div class="arena-progress-track" aria-hidden="true">
          <div class="arena-progress-fill" style="width:${pct}%"></div>
        </div>

        <div class="arena-prompt-box">
          ${promptBody}
        </div>

        ${scaffoldHtml}

        ${card.subPhase === 'typing' ? `
          <form id="arena-form" class="arena-input-wrap">
            <input type="text" id="arena-input" class="arena-main-input english"
              autocomplete="off" autocapitalize="off" spellcheck="false"
              placeholder="${itemDiff === 'challenge' ? '直接敲出英文答案，按 Enter 提交' : '在此输入英文，按 Enter 核对'}"
              value="${esc(card.draft)}">

            <div class="row" style="justify-content:center;gap:8px">
              ${needsApostrophe ? `<button type="button" class="btn btn-sm" data-insert-char="'">插入撇号 '</button>` : ''}
              ${itemDiff === 'normal' && !card.usedHint ? `
                <button type="button" class="btn btn-sm" data-act="arena-use-hint">💡 给个思考提示</button>
              ` : ''}
              ${itemDiff === 'easy' ? `
                <button type="button" class="btn btn-sm" data-act="toggle-easy-choices">${card.showChoiceAid ? '⌨️ 切回自己敲键盘' : '🛡️ 展开四选一辅助'}</button>
              ` : ''}
              <button type="submit" class="btn btn-primary">✅ 提交核对 (Enter)</button>
            </div>

            <div class="kbd-hint-bar">
              <span>快捷键：<span class="kbd-chip">Enter</span> 提交/下一题</span>
              <span>· <span class="kbd-chip">Tab</span> 重播语音</span>
            </div>
          </form>

          ${itemDiff === 'easy' && card.showChoiceAid ? `
            <div class="choice-grid">
              ${card.choices.map(ch => `
                <button type="button" class="choice-btn english" data-arena-choice="${esc(ch)}">${esc(ch)}</button>
              `).join('')}
            </div>
          ` : ''}
        ` : ''}

        ${card.subPhase === 'diff_review' && card.lastDiag ? `
          <div class="diff-box" id="arena-diff-card">
            <div style="font-weight:900;color:#92400e;font-size:16px">🔍 差一点点！看看绿色高亮处漏了或换了哪一块：</div>
            <div class="muted" style="margin-top:4px">你刚才输入：<code class="english" style="font-size:17px;color:#b91c1c">${esc(card.draft || '（未输入）')}</code></div>
            ${renderDiffTokensHtml(card.lastDiag.diffTokens)}
            <div style="font-size:15px;font-weight:800;color:#065f46;margin:4px 0">
              正确写法：<span class="english" style="font-size:22px">${esc(ctx.primary)}</span>
              <span class="muted">（${esc(it.displayChunks || ctx.primary)}）</span>
            </div>
            <div class="muted" style="font-weight:700;margin-top:4px">${esc(card.lastDiag.feedback)}</div>
            <div id="ai-mistake-coach" style="margin-top:6px;color:#1e40af;font-weight:800;font-size:14px">
              ${card.aiMistakeTip ? `🤖 AI 巧记点拨：${esc(card.aiMistakeTip)}` : `💡 记忆法：${esc(SnapAI.getMemoryCoachTip(it))}`}
            </div>
            <div style="margin-top:14px">
              <button type="button" class="btn btn-amber" id="btn-start-blind-retype" data-act="start-blind-retype">
                🙈 记牢啦！收起答案当场盲打订正 1 遍 (Enter) →
              </button>
            </div>
          </div>
        ` : ''}

        ${card.subPhase === 'blind_retype' ? `
          <form id="arena-retype-form" class="arena-input-wrap">
            <div class="muted" style="font-weight:800;color:#b45309">🙈 标准答案已收起！请凭刚才的记忆独立敲对 1 遍完成当场订正：</div>
            <input type="text" id="arena-input" class="arena-main-input is-repair english"
              autocomplete="off" autocapitalize="off" spellcheck="false"
              placeholder="凭记忆盲打正确拼写，按 Enter 过关"
              value="${esc(card.retypeDraft)}">
            ${card.retypeError ? `<div style="color:#dc2626;font-weight:800;font-size:14px">${esc(card.retypeError)}</div>` : ''}
            <div class="row" style="justify-content:center">
              ${needsApostrophe ? `<button type="button" class="btn btn-sm" data-insert-char="'">插入撇号 '</button>` : ''}
              <button type="button" class="btn btn-sm" data-act="peek-diff-again">👀 忘了，再看一眼对比</button>
              <button type="submit" class="btn btn-mint">✅ 完成订正 (Enter)</button>
            </div>
          </form>
        ` : ''}

        ${card.subPhase === 'passed' ? `
          <div class="arena-input-wrap">
            <input type="text" id="arena-input" class="arena-main-input is-correct english" value="${esc(ctx.primary)}" readonly>
            <div style="color:#059669;font-weight:900;font-size:18px">
              ${card.tries === 0 && !card.usedHint
                ? (itemDiff === 'easy' ? '🌱 漂亮！初学拼写一次过关！' : '🌟 首答独立全对！好样的！')
                : '✅ 当场盲打订正成功！'}
            </div>
            <button type="button" class="btn btn-mint" id="btn-arena-next" data-act="arena-next">
              ${idx + 1 < list.length ? '下一题 (Enter) →' : (isDueStage ? '复习完成，进入今日新词 (Enter) →' : '🎉 全部完成，查看勋章成绩单 (Enter) →')}
            </button>
          </div>
        ` : ''}
      </section>
    `;
  }

  // ==================== Multi-Round Anti-Mash Arcade (Replaces Single-Card Bug Hunter) ====================
  function getSessionPackItems(s) {
    const ids = [...new Set([...(s?.focusIds || []), ...(s?.arenaQueue || []), ...(s?.dueIds || [])])];
    if (ids.length) return ids.map(itemById).filter(Boolean);
    return (selectedPack()?.itemIds || []).map(itemById).filter(Boolean);
  }

  function buildScrambleRound(item) {
    const en = SnapCore.normText(item.en);
    const isMultiWord = en.includes(' ');
    let targets = [];
    let traps = [];

    if (isMultiWord) {
      targets = en.split(' ').filter(Boolean);
      const trapPool = ['was', 'too', 'in', 'a', 'at', 'ones', 'the', 'do', 'for', 'on', 'with', 'to']
        .filter(w => !targets.some(t => t.toLowerCase() === w.toLowerCase()));
      const customDecoys = (item.snap?.decoys || []).map(d => d.text).filter(t => !targets.includes(t));
      traps = [...new Set([...customDecoys, ...shuffleArray(trapPool)])].slice(0, 2);
    } else {
      targets = en.split('');
      const freqChars = ['a', 'e', 'i', 'o', 'u', 'r', 's', 'n', 'l', 't', 'c', 'h']
        .filter(ch => !en.toLowerCase().includes(ch));
      traps = shuffleArray(freqChars).slice(0, 2);
    }

    const pool = shuffleArray([
      ...targets.map((text, idx) => ({ key: 't_' + idx, text, isTrap: false })),
      ...traps.map((text, idx) => ({ key: 'x_' + idx, text, isTrap: true }))
    ]);
    return {
      itemId: item.id,
      en,
      zh: item.zh,
      isMultiWord,
      targets,
      pool,
      filled: [],
      usedKeys: [],
      wobbleKey: null,
      hearts: 3,
      tip: '',
      revealedReset: false
    };
  }

  function initArcadeState(s, gameType = 'scramble', customRadarRounds = null) {
    const items = getSessionPackItems(s);
    const order = shuffleArray(items);
    const scrambleRounds = order.map(buildScrambleRound);
    const radarRounds = customRadarRounds || SnapAI.buildLocalRadarArcadeSet(items, s.difficulty || 'normal');
    s.arcadeState = {
      gameType, // 'scramble' | 'radar'
      score: 0,
      combo: 0,
      maxCombo: 0,
      // Scramble Rush state
      scrambleIdx: 0,
      scrambleRounds,
      scrambleDone: scrambleRounds.length === 0,
      // Radar True/False & Defuse state
      radarIdx: 0,
      radarRounds,
      radarHearts: 3,
      radarPhase: 'decide', // 'decide' | 'defuse' | 'feedback' | 'done' | 'gameover'
      radarDraft: '',
      radarLastOk: true,
      radarMsg: ''
    };
  }

  function renderBugStep(s) {
    if (!s.arcadeState) initArcadeState(s, 'scramble');
    const arc = s.arcadeState;
    const finalStep = s.arenaQueue?.length ? 'paper' : 'oral_wrapup';

    return `
      <section class="card" id="arcade-card">
        <div class="row between" style="margin-bottom:12px">
          <div>
            <span class="pill pill-core">🎮 趣玩闯关台 · 100% 紧扣本组词单 · 3 颗心防乱点</span>
            <h2 style="margin:6px 0 2px">${arc.gameType === 'scramble' ? '🚀 字母/词块冲刺拼装（多关连闯）' : '⚖️ 真假拼写鉴别官（多轮判真假 + 手打拆弹）'}</h2>
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-jump-step="${finalStep}">去网页默写考满分 →</button>
        </div>

        <div class="arcade-tabs">
          <button type="button" class="btn btn-sm ${arc.gameType === 'scramble' ? 'btn-primary' : ''}" data-arcade-mode="scramble">
            🚀 字母/词块冲刺拼装 (${arc.scrambleRounds.length} 关)
          </button>
          <button type="button" class="btn btn-sm ${arc.gameType === 'radar' ? 'btn-primary' : ''}" data-arcade-mode="radar">
            ⚖️ 真假拼写鉴别官 (${arc.radarRounds.length} 关)
          </button>
          ${arc.gameType === 'radar' ? `
            <button type="button" class="btn btn-sm btn-amber" data-act="ai-gen-radar" ${aiUI.arcadeLoading ? 'disabled' : ''}>
              ${aiUI.arcadeLoading ? '⏳ AI 正在设计新关卡...' : '🤖 让 AI 现出一组全新五上陷阱关卡'}
            </button>
          ` : `
            <button type="button" class="btn btn-sm" data-act="restart-arcade">🔄 打乱顺序重来一局</button>
          `}
        </div>

        ${arc.gameType === 'scramble' ? renderScrambleArcade(s, arc, finalStep) : renderRadarArcade(s, arc, finalStep)}
      </section>
    `;
  }

  function renderScrambleArcade(s, arc, finalStep) {
    if (arc.scrambleDone || !arc.scrambleRounds.length) {
      return `
        <div class="bridge-callout" style="text-align:center;padding:24px" id="arcade-clear-card">
          <div style="font-size:42px">🏆</div>
          <h2 style="margin:8px 0">全部 ${arc.scrambleRounds.length} 关拼装冲刺通关！</h2>
          <p style="font-size:17px;font-weight:800">总分：<span style="color:var(--primary-dark)">${arc.score}</span> 分 · 最高连击：🔥 <b>${arc.maxCombo}</b></p>
          <div class="row" style="justify-content:center;margin-top:16px">
            <button type="button" class="btn btn-amber" data-act="restart-arcade">🔄 换随机顺序再刷高分</button>
            <button type="button" class="btn btn-primary" data-arcade-mode="radar">⚖️ 挑战「真假拼写鉴别官」→</button>
            <button type="button" class="btn btn-mint" data-jump-step="${finalStep}">⌨️ 去网页默写考满分 →</button>
          </div>
        </div>
      `;
    }

    const r = arc.scrambleRounds[arc.scrambleIdx];
    const heartsStr = '❤️'.repeat(Math.max(0, r.hearts)) + '🖤'.repeat(Math.max(0, 3 - r.hearts));

    return `
      <div class="arcade-hud">
        <span>🚩 第 ${arc.scrambleIdx + 1} / ${arc.scrambleRounds.length} 关</span>
        <span class="hearts-bar" title="点错会扣心，3颗心用完需重拼本词，杜绝乱点！">${heartsStr}</span>
        <span>⭐ ${arc.score} 分 ${arc.combo >= 2 ? `· 🔥 ×${arc.combo}` : ''}</span>
      </div>

      <div class="word-hero">
        <div class="muted">${r.isMultiWord ? '按正确词序组装短语（混入了 2 个伪装陷阱词，支持直接点选）' : '按正确顺序组装单词（混入了 2 个伪装字母，支持直接敲键盘或鼠标点选！）'}</div>
        <div class="word-zh-big">${esc(r.zh)}</div>
        <button type="button" class="btn btn-primary btn-sm" style="margin-top:6px" data-speak-item="${esc(r.itemId)}">🔊 听真人发音</button>
      </div>

      ${r.revealedReset ? `
        <div class="diff-box">
          <div style="font-weight:900;color:#b91c1c">💥 3 颗防护心用完啦！记住正确拼写再重新组装一遍：</div>
          <div class="english" style="font-size:30px;font-weight:900;color:#065f46;margin:8px 0">${esc(r.en)}</div>
          <button type="button" class="btn btn-amber btn-sm" data-act="retry-scramble-round">🙈 记住啦，重新拼这一关 →</button>
        </div>
      ` : `
        <div class="snap-tray english">
          ${r.targets.map((_, idx) => {
            const val = r.filled[idx];
            return val !== undefined
              ? `<span class="scramble-slot filled">${esc(val)}</span>`
              : `<span class="scramble-slot">${idx + 1}</span>`;
          }).join('')}
        </div>

        ${r.tip ? `<div class="bounce-bubble">${esc(r.tip)}</div>` : ''}

        <div class="snap-pool">
          ${r.pool.map(tile => {
            const used = r.usedKeys.includes(tile.key);
            const wob = r.wobbleKey === tile.key;
            return `
              <button type="button" class="magnet-tile english ${used ? 'used' : ''} ${wob ? 'wobble' : ''}"
                data-scramble-key="${esc(tile.key)}" ${used ? 'disabled' : ''}>
                ${esc(tile.text)}
              </button>
            `;
          }).join('')}
        </div>
      `}
    `;
  }

  function renderRadarArcade(s, arc, finalStep) {
    if (arc.radarPhase === 'done' || arc.radarPhase === 'gameover' || !arc.radarRounds.length) {
      const won = arc.radarPhase === 'done';
      return `
        <div class="${won ? 'bridge-callout' : 'help-callout'}" style="text-align:center;padding:24px" id="radar-finish-card">
          <div style="font-size:42px">${won ? '🕵️🏅' : '💥'}</div>
          <h2 style="margin:8px 0">${won ? `鉴别官全 ${arc.radarRounds.length} 关完美通关！` : '3 颗心耗尽！总结陷阱再来一局！'}</h2>
          <p style="font-size:17px;font-weight:800">本局得分：<span style="color:var(--primary-dark)">${arc.score}</span> 分 · 最高连击：🔥 <b>${arc.maxCombo}</b></p>
          <div class="row" style="justify-content:center;margin-top:16px">
            <button type="button" class="btn btn-amber" data-act="ai-gen-radar" ${aiUI.arcadeLoading ? 'disabled' : ''}>🤖 让 AI 再出一组全新关卡</button>
            <button type="button" class="btn btn-primary" data-act="restart-radar-local">🔄 再玩一轮新随机关卡</button>
            <button type="button" class="btn btn-mint" data-jump-step="${finalStep}">⌨️ 去网页默写考满分 →</button>
          </div>
        </div>
      `;
    }

    const r = arc.radarRounds[arc.radarIdx];
    const heartsStr = '❤️'.repeat(Math.max(0, arc.radarHearts)) + '🖤'.repeat(Math.max(0, 3 - arc.radarHearts));

    return `
      <div class="arcade-hud">
        <span>⚖️ 第 ${arc.radarIdx + 1} / ${arc.radarRounds.length} 关 ${r.fromAI ? '· 🤖 AI 关卡' : ''}</span>
        <span class="hearts-bar" title="判断错误会扣除 1 颗心">${heartsStr}</span>
        <span>⭐ ${arc.score} 分 ${arc.combo >= 2 ? `· 🔥 ×${arc.combo}` : ''}</span>
      </div>

      <div class="radar-sentence-box">
        <div class="muted" style="color:#94a3b8;margin-bottom:8px">仔细检查黄色高亮词的拼写、空格与撇号——它写对了吗？</div>
        <div class="radar-sentence english">
          ${esc(r.before)}<span class="radar-spotlight">${esc(r.shownWord)}</span>${esc(r.after)}
        </div>
        <div style="color:#cbd5e1;font-size:17px;font-weight:700">${esc(r.zh)}</div>
        <div style="margin-top:10px">
          <button type="button" class="btn btn-sm" data-speak-item="${esc(r.itemId)}">🔊 听目标词正确读音</button>
        </div>
      </div>

      ${arc.radarPhase === 'decide' ? `
        <div class="row" style="justify-content:center;gap:14px;margin-top:14px">
          <button type="button" class="btn btn-mint" style="min-width:210px;font-size:18px" data-radar-judge="ok">✅ 拼写完全正确</button>
          <button type="button" class="btn btn-amber" style="min-width:210px;font-size:18px" data-radar-judge="trap">🐛 抓到拼写陷阱！</button>
        </div>
      ` : ''}

      ${arc.radarPhase === 'defuse' ? `
        <form id="radar-defuse-form" class="arena-input-wrap" style="margin-top:14px">
          <div style="font-weight:900;color:#047857;font-size:16px">🎯 火眼金睛！确实藏着陷阱！请亲手敲出正确的英文拼写拆弹：</div>
          <input type="text" id="radar-defuse-input" class="arena-main-input english" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="敲出正确拼写，按 Enter 拆弹" value="${esc(arc.radarDraft)}">
          ${arc.radarMsg ? `<div style="color:#dc2626;font-weight:800">${esc(arc.radarMsg)}</div>` : ''}
          <div class="row" style="justify-content:center">
            ${r.correctWord.includes("'") ? `<button type="button" class="btn btn-sm" data-radar-insert="'">插入撇号 '</button>` : ''}
            <button type="submit" class="btn btn-primary">💥 确认拆弹 (Enter)</button>
          </div>
        </form>
      ` : ''}

      ${arc.radarPhase === 'feedback' ? `
        <div class="${arc.radarLastOk ? 'bridge-callout' : 'help-callout'}" style="text-align:center;margin-top:14px">
          <div style="font-size:17px;font-weight:900">${esc(arc.radarMsg)}</div>
          <div class="muted" style="margin-top:4px">💡 解析：${esc(r.reason)}（正确写法：<b class="english">${esc(r.correctWord)}</b>）</div>
          <button type="button" class="btn btn-primary btn-sm" style="margin-top:12px" id="btn-radar-next" data-act="radar-next">
            ${arc.radarIdx + 1 < arc.radarRounds.length ? '下一关 (Enter) →' : '🎉 查看通关成绩 →'}
          </button>
        </div>
      ` : ''}
    `;
  }

  // ==================== Current-Pack Context Story Blackboard & Unit-Matched Slot Machine ====================
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

  function formatStoryLineHtml(sent, idx) {
    let html = esc(sent.en);
    const targets = (sent.targets || []).slice().sort((a, b) => b.length - a.length);
    targets.forEach((t, ti) => {
      if (!t) return;
      const key = `${idx}_${ti}`;
      const escT = esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(`(${escT})`, 'i');
      if (slotUI.storyCloze && !slotUI.storyRevealed[key]) {
        html = html.replace(reg, `<button type="button" class="story-blank-pill" data-reveal-story="${key}" data-speak-raw="${esc(t)}">______ (点看)</button>`);
      } else {
        html = html.replace(reg, '<span class="board-hl">$1</span>');
      }
    });
    return html;
  }

  function renderBoardStep(s) {
    const backStep = s.arenaQueue?.length ? 'paper' : 'oral_wrapup';
    const packItems = getSessionPackItems(s);
    const story = SnapAI.getMiniStory(s.packId, packItems);
    const slot = buildSlotSentence();
    const activeEn = slotUI.customEn || slot.en;
    const activeZh = slotUI.customZh || slot.zh;
    const activeHl = slotUI.customEn ? slotUI.customHl : slot.highlight;

    return `
      <section class="blackboard" id="context-blackboard">
        <div class="row between" style="margin-bottom:14px">
          <div class="row" style="gap:8px">
            <button type="button" class="btn btn-sm ${slotUI.boardMode === 'story' ? 'btn-amber' : ''}" data-board-mode="story">
              📖 本组串词小故事（${packItems.length} 词）
            </button>
            <button type="button" class="btn btn-sm ${slotUI.boardMode === 'slot' ? 'btn-amber' : ''}" data-board-mode="slot">
              🎰 句型摇奖黑板
            </button>
          </div>
          <button type="button" class="btn btn-sm btn-mint" data-jump-step="${backStep}">返回默写闯关 →</button>
        </div>

        ${slotUI.boardMode === 'story' ? `
          <div class="row between" style="margin-bottom:10px">
            <div>
              <span class="pill" style="background:#334155;color:#fbbf24">${story.fromAI ? '🤖 AI 现编五上串词微故事' : '📘 本组专属语境串联'}</span>
              <h2 style="margin:8px 0 0;color:#fff;font-size:21px">${esc(story.title)}</h2>
            </div>
            <div class="row">
              <button type="button" class="btn btn-sm" data-act="toggle-story-cloze">
                ${slotUI.storyCloze ? '👀 显示全部高亮词' : '🙈 隐藏目标词做完形挑战'}
              </button>
              <button type="button" class="btn btn-sm btn-amber" data-act="gen-ai-story" ${aiUI.storyLoading ? 'disabled' : ''}>
                ${aiUI.storyLoading ? '⏳ AI 正在创编故事...' : '🤖 让 AI 用本组词现编一篇新故事'}
              </button>
            </div>
          </div>

          <div style="margin-top:12px">
            ${story.sentences.map((sent, idx) => `
              <div class="story-line-card">
                <div>
                  <div class="story-en english">${formatStoryLineHtml(sent, idx)}</div>
                  <div style="color:#cbd5e1;font-size:15px;margin-top:3px">${esc(sent.zh)}</div>
                </div>
                <button type="button" class="btn btn-sm" style="flex-shrink:0" data-speak-raw="${esc(sent.en)}">🔊 听读</button>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="row between">
            <span class="pill" style="background:#334155;color:#fbbf24">🎰 本单元句型造句摇奖机（已自动匹配当前单元）</span>
            <select id="slot-deck-select" class="reel-select" style="width:auto">
              ${SNAPWORD_CURRICULUM.SLOT_DECKS.map((d, idx) => `<option value="${idx}" ${idx === slotUI.deckIndex ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
            </select>
          </div>

          <div class="board-sentence english" id="board-live-sentence">${formatHighlightedSentence(activeEn, activeHl)}</div>
          <p class="board-zh">${esc(activeZh)}</p>

          <div class="row" style="margin-bottom:18px">
            <button type="button" class="btn btn-amber" data-act="spin-slot">🎰 咔嗒摇一句新组合！</button>
            <button type="button" class="btn" data-speak-raw="${esc(activeEn)}">🔊 听整句朗读</button>
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
              <div class="reel-label">③ 动作（覆盖当前单元重点词）</div>
              <select class="reel-select" data-reel="act">
                ${slot.deck.actions.map((x, i) => `<option value="${i}" ${i === slotUI.act % slot.deck.actions.length ? 'selected' : ''}>${esc(x.base)}</option>`).join('')}
              </select>
            </div>
          </div>
        `}
      </section>

      ${s.preread ? `
        <section class="card">
          <span class="pill pill-core">📖 课本情境微听读 · ${esc(s.preread.source)}</span>
          <div style="margin:10px 0;padding:12px 16px;background:var(--surface-soft);border-radius:12px">
            ${s.preread.lines.map(line => `
              <div class="row between" style="margin:6px 0">
                <span class="english" style="font-size:19px;font-weight:800">${esc(line)}</span>
                <button type="button" class="btn btn-sm" data-speak-raw="${esc(line.replace(/^[A-Za-z]+:\s*/, ''))}">🔊 听读</button>
              </div>
            `).join('')}
          </div>
          <p style="margin:6px 0;font-weight:700">🤔 小问答：${esc(s.preread.question)}</p>
        </section>
      ` : ''}
    `;
  }

  function renderOralWrapupStep(s) {
    const oralItems = (s.oralOnlyIds || []).map(itemById).filter(Boolean);
    const checkedCount = oralItems.filter(it => Boolean(s.oralChecked?.[it.id])).length;
    const allChecked = oralItems.length > 0 && checkedCount === oralItems.length;
    return `
      <section class="card">
        <div class="row between">
          <div>
            <span class="pill pill-star">🗣️ 听读认义收工（已确认 ${checkedCount} / ${oralItems.length} 项）</span>
            <h2 style="margin:8px 0 6px">勾选已读准认熟的词条点亮铜章</h2>
          </div>
          ${oralItems.length ? `
            <button type="button" class="btn btn-sm" data-act="check-all-oral">
              ${allChecked ? '取消全选' : `✅ 全选确认 (${oralItems.length} 项)`}
            </button>
          ` : ''}
        </div>
        <div class="paper-list">
          ${oralItems.map((it, idx) => `
            <div class="paper-item row between">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700">
                <input type="checkbox" data-oral-check="${esc(it.id)}" ${s.oralChecked?.[it.id] ? 'checked' : ''} style="width:20px;height:20px">
                <span>#${idx + 1} <b class="english">${esc(it.en)}</b> — ${esc(it.zh)}</span>
              </label>
              <button type="button" class="btn btn-sm" data-speak-item="${esc(it.id)}">🔊 听发音</button>
            </div>
          `).join('')}
        </div>
        <div class="row between" style="margin-top:18px">
          <span></span>
          <button type="button" class="btn btn-mint" data-act="finish-oral-session">🎉 完成今日听读收工 →</button>
        </div>
      </section>
    `;
  }

  function renderSessionSummary(s) {
    const isOralSummary = s.oralPhase === 'summary';
    const tally = s.summary?.tally || { independent: 0, denominator: 0, ratioText: '0 / 0', answerCorrected: 0, hintedCorrect: 0, untested: 0 };
    const easyCount = s.summary?.easyCount || 0;
    const maxStreak = s.summary?.maxStreak || 0;
    const needReviewIds = s.summary?.needReviewIds || [];
    const oralDoneCount = s.summary?.oralDoneCount || 0;
    const isDemo = s.lockedActor === 'parent_demo';

    return `
      <section class="card" style="text-align:center;padding:30px 24px">
        <div style="font-size:46px">${lastSaveOk ? '🏆' : '⚠️'}</div>
        <h1 style="margin:8px 0">${isOralSummary ? '今日听读收工！' : '网页无纸化闯关成绩单'}</h1>
        ${isDemo ? `
          <p style="color:#92400e;font-weight:800">🛠️ 本轮为「家长演练模式」，未改动学生正式勋章与复习日历。</p>
        ` : lastSaveOk ? `
          <p class="muted">用时约 ${Math.max(1, elapsedMinutes())} 分钟 · ● 勋章与复习日历已自动入账保存</p>
        ` : `
          <div class="help-callout" style="border-color:#dc2626;background:#fee2e2;color:#991b1b;text-align:left">
            <strong>⚠️ 浏览器存储受阻！</strong>请立即点击下方导出 JSON 备份保存成绩：
            <div style="margin-top:8px"><button type="button" class="btn btn-sm btn-primary" data-act="export-json">⬇️ 导出 JSON 备份</button></div>
          </div>
        `}

        ${isOralSummary ? `
          <div class="bridge-callout" style="text-align:left;margin:18px 0" id="oral-summary-box">
            🗣️ 已确认听读认义 <b id="oral-done-count">${oralDoneCount} 项</b>，对应铜章已点亮！
          </div>
        ` : `
          <div class="grid-4" style="margin:20px 0;text-align:left">
            <div class="stat-tile">
              <span class="medal-icon medal-gold">🌟</span>
              <div>
                <div class="stat-num" id="sum-ratio">${esc(tally.ratioText)}</div>
                <div class="stat-label">首答盲打全对 / 已测总数</div>
              </div>
            </div>
            <div class="stat-tile">
              <span class="medal-icon medal-bronze">🔧</span>
              <div>
                <div class="stat-num">${tally.answerCorrected + tally.hintedCorrect}</div>
                <div class="stat-label">当场盲打订正(${tally.answerCorrected}) · 含提示(${tally.hintedCorrect})</div>
              </div>
            </div>
            <div class="stat-tile">
              <span class="medal-icon medal-silver">🔥</span>
              <div>
                <div class="stat-num">${maxStreak} 连击</div>
                <div class="stat-label">${easyCount ? `初学点亮铜章 ${easyCount} 项` : `未测顺延 ${tally.untested} 项`}</div>
              </div>
            </div>
            <div class="stat-tile">
              <span class="medal-icon medal-due">📅</span>
              <div>
                <div class="stat-num">${needReviewIds.length} 项</div>
                <div class="stat-label">排入明日巩固复习</div>
              </div>
            </div>
          </div>
        `}

        ${needReviewIds.length ? `
          <div class="help-callout" style="text-align:left">
            <div class="row between">
              <div>
                <strong>🔁 趁热打铁清零建议（刚才用过提示或订正过的 ${needReviewIds.length} 个词）：</strong>
                <div style="margin-top:4px">${needReviewIds.map(id => `<span class="pill" style="margin-right:6px;font-size:13.5px;color:#92400e;background:#fef3c7">${esc(itemById(id)?.zh)}</span>`).join('')}</div>
              </div>
              <button type="button" class="btn btn-amber btn-sm" data-act="retry-missed-now">🔥 立即盲打加赛这 ${needReviewIds.length} 个词 →</button>
            </div>
          </div>
        ` : (!isOralSummary && tally.denominator > 0 ? `
          <div class="bridge-callout" style="font-weight:800;font-size:16px">
            🎉 太牛啦！本轮全部一次盲打满分通关！明天课堂默写稳稳拿下！
          </div>
        ` : '')}

        ${s.aiDebrief ? `
          <div class="ai-debrief-card" id="ai-debrief-card">
            <div style="font-weight:900;color:#1e3a8a;margin-bottom:6px">🤖 AI 五上教练本轮复盘点评（${esc(SnapAI.getActiveProfile().model)}）</div>
            <div style="margin:4px 0">👏 <b>本轮亮点：</b>${esc(s.aiDebrief.praise)}</div>
            ${s.aiDebrief.focusTip ? `<div style="margin:4px 0">🎯 <b>明日默写避坑：</b>${esc(s.aiDebrief.focusTip)}</div>` : ''}
            ${s.aiDebrief.tomorrowDrill ? `<div style="margin:4px 0">🌙 <b>睡前 30 秒口头抽查：</b>${esc(s.aiDebrief.tomorrowDrill)}</div>` : ''}
          </div>
        ` : ''}

        <div class="row" style="justify-content:center;margin-top:22px">
          ${s.difficulty === 'easy' ? `
            <button type="button" class="btn btn-mint" data-act="upgrade-to-normal">⚡ 趁热升到「温习·普通模式」冲银牌 →</button>
          ` : (s.difficulty === 'normal' ? `
            <button type="button" class="btn btn-amber" data-act="upgrade-to-challenge">🔥 升到「考核·挑战模式」模拟明天真考 →</button>
          ` : '')}
          <button type="button" class="btn btn-primary" data-act="close-summary">返回今日大厅</button>
          <button type="button" class="btn" data-goto-tab="ledger">查看勋章与复习日历 📒</button>
        </div>
      </section>
    `;
  }

  // ==================== Tab 2: Vault ====================
  let vaultFilter = 'u6';
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
            <h2 style="margin:0 0 4px">🏅 金银铜徽章图鉴 & 词句库</h2>
            <p class="muted" style="margin:0">Unit 6 官方词表共 <b>${u6Official.length} 项（核心 ${u6CoreCount} 项 · 带 * 词 ${u6StarCount} 项，前 1–10 项已全部设为必默）</b>。</p>
          </div>
          <div class="row">
            <button type="button" class="btn btn-sm ${vaultFilter === 'u6' ? 'btn-primary' : ''}" data-vault-filter="u6">U6教材词表 (${u6Official.length})</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'all' ? 'btn-primary' : ''}" data-vault-filter="all">全部 (${state.items.length})</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'sentences' ? 'btn-primary' : ''}" data-vault-filter="sentences">重点句与作业 (${keySentences.length})</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'u5' ? 'btn-primary' : ''}" data-vault-filter="u5">U5教材词表</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'bridge' ? 'btn-primary' : ''}" data-vault-filter="bridge">自建与补基础</button>
            <button type="button" class="btn btn-sm ${vaultFilter === 'medals' ? 'btn-primary' : ''}" data-vault-filter="medals">已点亮徽章</button>
          </div>
        </div>
      </section>

      <div class="grid-2">
        ${items.map(it => {
          const m = state.mastery[it.id] || {};
          const audioInfo = SnapAudio.resolveSourceInfo(state, it);
          const orderTag = it.wordlistOrder ? `<span class="pill pill-core">U6 #${String(it.wordlistOrder).padStart(2, '0')}</span>` : '';
          const scopeBadge = it.sourceScope === 'textbook_wordlist'
            ? `<span class="pill ${it.textbookCore ? 'pill-core' : 'pill-star'}">${it.textbookCore ? '教材核心词' : '带 * 词'}</span>`
            : (it.sourceScope === 'textbook_sentence' ? `<span class="pill pill-core">教材重点句</span>` : `<span class="pill">扩展词句</span>`);

          return `
            <article class="card" style="margin-bottom:0" data-vault-item="${esc(it.id)}">
              <div class="row between">
                <div>
                  ${orderTag}
                  <span class="english" style="font-size:23px;font-weight:900">${esc(it.en)}</span>
                  ${it.bookPage ? `<span class="pill">p.${it.bookPage}</span>` : ''}
                  ${scopeBadge}
                </div>
                ${badgeLabel(m)}
              </div>
              <p style="margin:6px 0;font-weight:700">${esc(it.zh)} <span class="muted">｜ ${esc(it.displayChunks || '')}</span></p>
              <p class="muted" style="margin:4px 0 10px">${esc(SnapAI.getMemoryCoachTip(it))}</p>
              <div class="row between">
                <button type="button" class="btn btn-sm" data-speak-item="${esc(it.id)}">🔊 听发音</button>
                <label class="muted" style="font-size:13px">
                  要求：
                  <select data-class-req="${esc(it.id)}" style="padding:4px 8px;font-size:13px">
                    <option value="dictation_verified" ${it.classRequirement === 'dictation_verified' ? 'selected' : ''}>必默拼写</option>
                    <option value="read_meaning_use" ${it.classRequirement === 'read_meaning_use' ? 'selected' : ''}>仅听读认义</option>
                    <option value="unverified_family" ${it.classRequirement === 'unverified_family' ? 'selected' : ''}>家庭选练</option>
                  </select>
                </label>
              </div>
              <div class="muted" style="font-size:12px;margin-top:8px">
                ${esc(audioInfo.label)}
                ${m.anchorD0 ? ` · D0=${m.anchorD0}` : ''}
                ${m.nextDueDate ? ` · 下次复习：${m.nextDueDate}` : (m.stabilized ? ' · 已通过 D+7 稳固' : '')}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  // ==================== Tab 3: Spaced-Repetition Ledger & Backup ====================
  function renderLedgerTab() {
    const targetActor = effectiveSessionActor();
    const isDemo = targetActor === 'parent_demo';
    const dueInfo = SnapCore.getDueQueue(state, SnapCore.todayISO(), 5);
    const studentSummary = SnapCore.getStatsSummary(state, 'student');
    const activeSummary = SnapCore.getStatsSummary(state, targetActor);
    const recentEvents = state.events.filter(e => e.actor === targetActor).slice().reverse().slice(0, 40);

    return `
      ${isDemo ? `
        <section class="card" style="background:#fef3c7;border-color:#f59e0b">
          <div class="row between">
            <div>
              <strong>🛠️ 当前查看的是「家长演练账本」</strong>：学生正式成绩与复习日历已严格隔离保护（学生正式首答正确率：<b>${esc(studentSummary.paperRatioText)}</b>）。
            </div>
            <button type="button" class="btn btn-sm btn-primary" data-act="switch-to-student-ledger">切回学生正式模式 →</button>
          </div>
        </section>
      ` : ''}

      <section class="card">
        <div class="row between">
          <div>
            <h2 style="margin:0 0 4px">📅 到期复习队列（待复习 ${dueInfo.totalDue} 项 · 已稳固 ${dueInfo.lowFreqPool.length} 项）</h2>
            <p class="muted" style="margin:0">首次盲打全对当天记为 D0，系统按 <b>D0+1、D0+3、D0+7</b> 自动安排隔日抽查，通过后升级金章。</p>
          </div>
          <button type="button" class="btn btn-primary" data-act="start-due-review" ${dueInfo.todayPick.length ? '' : 'disabled'}>
            ⚡ 立即网页盲打抽查 (${dueInfo.todayPick.length} 项)
          </button>
        </div>

        ${dueInfo.todayPick.length ? `
          <div class="grid-3" style="margin-top:14px">
            ${dueInfo.todayPick.map((d, i) => `
              <div class="paper-item">
                <div class="row between"><strong>#${i + 1} ${esc(d.item.zh)}</strong>${badgeLabel(d.m)}</div>
                <div class="muted" style="font-size:12.5px;margin-top:4px">${esc(d.reason)}</div>
              </div>
            `).join('')}
          </div>
        ` : `<p class="muted" style="margin-top:12px">🎉 今天没有积压的到期复习词！</p>`}
      </section>

      <section class="card">
        <h2 style="margin:0 0 8px">📊 ${isDemo ? '演练统计' : '正式盲打掌握统计'} & 薄弱点画像</h2>
        <p style="margin:0 0 10px;font-weight:700">
          首答无提示盲打全对 / 已测总次数：<span id="ledger-ratio" class="english" style="font-size:20px;color:var(--primary-dark)">${esc(activeSummary.paperRatioText)}</span>
        </p>
        <div class="row">
          ${SNAPWORD_CURRICULUM.ERROR_TAGS.map(t => {
            const count = activeSummary.errorTotals[t.id] || 0;
            return `<span class="pill" style="padding:7px 13px;font-size:13.5px;${count ? 'background:#fee2e2;color:#991b1b' : ''}">${esc(t.label)}：<b>${count}</b></span>`;
          }).join('')}
        </div>
      </section>

      <section class="card">
        <h2 style="margin:0 0 8px">💾 学习进度 JSON 备份导出与恢复（不含任何 AI API 密钥，安全放心）</h2>
        <div class="row">
          <button type="button" class="btn btn-primary" data-act="export-json">⬇️ 导出学习备份 JSON</button>
          <button type="button" class="btn" data-act="trigger-import">📂 导入 JSON 备份预览差异</button>
          <input type="file" id="import-file-input" accept=".json,application/json" hidden>
        </div>
        ${pendingImportPreview ? renderImportPreviewCard(pendingImportPreview) : ''}
      </section>

      <section class="card">
        <h3 style="margin:0 0 10px">📜 最近 40 条闯关流水记录</h3>
        ${recentEvents.length ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13.5px;text-align:left">
              <thead>
                <tr style="border-bottom:2px solid var(--border)">
                  <th style="padding:7px">日期</th>
                  <th style="padding:7px">词条</th>
                  <th style="padding:7px">出题方式</th>
                  <th style="padding:7px">结果</th>
                  <th style="padding:7px">错因/备注</th>
                </tr>
              </thead>
              <tbody>
                ${recentEvents.map(e => {
                  const it = itemById(e.itemId);
                  return `<tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:7px">${esc(e.dateStr)}</td>
                    <td style="padding:7px"><b>${esc(it?.zh || e.itemId)}</b></td>
                    <td style="padding:7px">${esc(e.promptMode || e.taskType || '—')}${e.hadSpellingHint ? ' · <span style="color:#b45309">含提示</span>' : ''}</td>
                    <td style="padding:7px">${esc(e.outcome)}</td>
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
    return `${d.packTitle}（已完成 ${d.gradedCount}/${d.paperCount} 项 · ${timeLabel}）`;
  }

  function renderImportPreviewCard(preview) {
    if (preview.kind === 'snapword') {
      const stuSlot = preview.draftSlots?.student;
      const keepDraftValue = preview.hasDraftConflicts ? 'keep_local' : 'skip_incoming';
      return `
        <div class="help-callout" style="margin-top:14px">
          <strong>🔍 备份差异预览：</strong>新增 <b>${preview.added}</b> 条 · 相同跳过 <b>${preview.identical}</b> 条 · 冲突 <b>${preview.conflicts}</b> 条
          ${preview.conflictDetails?.length ? `
            <div style="margin:8px 0">
              <label style="margin-right:14px"><input type="radio" name="conflict-pol" value="prefer_incoming" ${importConflictPolicy === 'prefer_incoming' ? 'checked' : ''}> 采用导入版本</label>
              <label><input type="radio" name="conflict-pol" value="keep_local" ${importConflictPolicy === 'keep_local' ? 'checked' : ''}> 保留本机版本</label>
            </div>
          ` : ''}
          ${preview.hasIncomingDrafts ? `
            <div style="margin:8px 0" id="import-draft-preview">
              <div class="muted">本机草稿：${esc(formatDraftBrief(stuSlot?.local))} ｜ 备份草稿：${esc(formatDraftBrief(stuSlot?.incoming))}</div>
              <label style="margin-right:14px"><input type="radio" name="draft-pol" value="restore_incoming" ${importDraftPolicy === 'restore_incoming' ? 'checked' : ''}> 恢复备份草稿</label>
              <label><input type="radio" name="draft-pol" value="${keepDraftValue}" ${importDraftPolicy !== 'restore_incoming' ? 'checked' : ''}> 保留本机草稿</label>
            </div>
          ` : ''}
          <div class="row" style="margin-top:10px">
            <button type="button" class="btn btn-sm btn-mint" data-act="confirm-import-snapword">确认合并</button>
            <button type="button" class="btn btn-sm" data-act="cancel-import">取消</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="help-callout" style="margin-top:14px">
        <p style="margin:6px 0">${esc(preview.warning)}</p>
        <div class="row">
          <button type="button" class="btn btn-sm btn-primary" data-act="confirm-import-legacy-words">导入词条 (${preview.wordCount} 项)</button>
          <button type="button" class="btn btn-sm" data-act="cancel-import">取消</button>
        </div>
      </div>
    `;
  }

  // ==================== Tab 4: Multi-Model AI Hub & Parent Prep ====================
  function renderPrepTab() {
    const cfg = SnapAI.loadConfig();
    const prof = SnapAI.getActiveProfile(cfg);
    const pMeta = SnapAI.PROVIDERS[prof.providerId] || SnapAI.PROVIDERS.openai;
    const modelOptions = [...new Set([prof.defaultModel, ...(prof.fetchedModels || []), prof.model].filter(Boolean))];
    const attributionEntries = typeof SNAPWORD_AUDIO_CLIPS !== 'undefined' ? Object.entries(SNAPWORD_AUDIO_CLIPS) : [];

    return `
      <section class="card ai-config-card" id="ai-settings-card">
        <div class="row between">
          <div>
            <span class="pill pill-core">v0.3.1 六大 AI 场景 · 本地密钥物理隔离保存</span>
            <h2 style="margin:6px 0 2px">🤖 多模型 AI 智能伴学接口设置</h2>
            <p class="muted" style="margin:0">主力默认已配置为 <b>OpenAI (${esc(SnapAI.PROVIDERS.openai.defaultModel)})</b>；同时支持 Gemini、DeepSeek、本地 LM Studio 等。填入密钥后可一键读取模型列表自由点选，也可保持默认或手动输入。</p>
            <div class="row" style="gap:6px;margin-top:8px">
              <span class="pill">① 拆词一键换 AI 趣味记法</span>
              <span class="pill">② 趣玩台 AI 多轮陷阱关卡</span>
              <span class="pill">③ 本组词 AI 串词五上故事</span>
              <span class="pill">④ 默写台 AI 智能混合新题</span>
              <span class="pill">⑤ 错拼 1 对 1 靶向纠错</span>
              <span class="pill">⑥ 课后 AI 教练复盘点评</span>
            </div>
          </div>
          <label style="display:inline-flex;align-items:center;gap:8px;font-weight:900;cursor:pointer;background:#fff;padding:8px 14px;border-radius:12px;border:2px solid var(--border)">
            <input type="checkbox" id="ai-enabled-toggle" ${prof.enabled ? 'checked' : ''} style="width:20px;height:20px">
            <span>启用 AI 智能辅助出题</span>
          </label>
        </div>

        <div class="ai-form-grid">
          <div class="ai-field">
            <label for="ai-provider-select">① 选择 AI 服务商</label>
            <select id="ai-provider-select" style="font-weight:800">
              ${Object.values(SnapAI.PROVIDERS).map(p => `
                <option value="${esc(p.id)}" ${p.id === prof.providerId ? 'selected' : ''}>${esc(p.label)}</option>
              `).join('')}
            </select>
          </div>

          <div class="ai-field">
            <label for="ai-base-url">② API 接口地址 (Base URL)</label>
            <input type="text" id="ai-base-url" class="english" value="${esc(prof.baseUrl)}" placeholder="${esc(pMeta.defaultBaseUrl)}">
          </div>

          <div class="ai-field">
            <label for="ai-api-key">③ API 密钥 (API Key · 仅存本机浏览器)</label>
            <div style="display:flex;gap:6px">
              <input type="${aiUI.showKey ? 'text' : 'password'}" id="ai-api-key" class="english"
                value="${esc(prof.apiKey)}" placeholder="${esc(pMeta.keyPlaceholder)}" autocomplete="off" style="flex:1">
              <button type="button" class="btn btn-sm" id="btn-toggle-key-vis" title="显示或隐藏密钥">${aiUI.showKey ? '🙈' : '👁️'}</button>
            </div>
          </div>
        </div>

        <div class="ai-form-grid" style="margin-top:14px">
          <div class="ai-field">
            <label for="ai-model-select">
              ④ 选择模型（已读取 ${(prof.fetchedModels || []).length} 个可用模型）
            </label>
            <div style="display:flex;gap:8px">
              <select id="ai-model-select" class="english" style="flex:1;font-weight:700">
                ${modelOptions.map(m => `
                  <option value="${esc(m)}" ${m === prof.model ? 'selected' : ''}>
                    ${esc(m)}${m === prof.defaultModel ? ' （默认推荐）' : ''}
                  </option>
                `).join('')}
              </select>
              <button type="button" class="btn btn-sm btn-primary" id="btn-ai-fetch-models" ${aiUI.fetchingModels ? 'disabled' : ''}>
                ${aiUI.fetchingModels ? '⏳ 读取中...' : '🔄 读取模型列表'}
              </button>
            </div>
          </div>

          <div class="ai-field">
            <label for="ai-model-input">⑤ 当前生效模型名称（可保持默认、上方点选或手动填写）</label>
            <div style="display:flex;gap:8px">
              <input type="text" id="ai-model-input" class="english" value="${esc(prof.model)}" placeholder="${esc(prof.defaultModel)}" style="flex:1;font-weight:800">
              <button type="button" class="btn btn-sm" id="btn-ai-reset-model" title="恢复当前服务商默认模型 (${esc(prof.defaultModel)})">↺ 恢复默认</button>
            </div>
          </div>
        </div>

        <p class="muted" style="margin:10px 0 0;font-size:13px">💡 ${esc(pMeta.helpText)}</p>

        <div class="row" style="margin-top:14px">
          <button type="button" class="btn btn-primary btn-sm" id="btn-ai-save">💾 保存 AI 设置</button>
          <button type="button" class="btn btn-mint btn-sm" id="btn-ai-test" ${aiUI.testingConn ? 'disabled' : ''}>
            ${aiUI.testingConn ? '⏳ 正在测试...' : '⚡ 测试连接'}
          </button>
          <button type="button" class="btn btn-amber btn-sm" id="btn-ai-prefetch-now" ${aiUI.prefetching ? 'disabled' : ''}>
            ${aiUI.prefetching ? '⏳ 正在为当前词包出题...' : `✨ 立即用 AI 为「${esc(selectedPack().kidTitle || selectedPack().title)}」生成五上新题`}
          </button>
        </div>

        ${aiUI.statusMsg ? `
          <div class="${aiUI.statusIsErr ? 'help-callout' : 'bridge-callout'}" id="ai-status-banner" style="margin-top:12px;font-weight:700">
            ${esc(aiUI.statusMsg)}
          </div>
        ` : ''}
      </section>

      <section class="card">
        <h2 style="margin-top:0">⚙️ 学习者偏好与拼写判分设置</h2>
        <form id="profile-form" class="row">
          <label>学习者昵称：
            <input type="text" id="prof-nickname" maxlength="24" value="${esc(state.profile.nickname)}">
          </label>
          <label>单次温和提醒时长（分钟）：
            <input type="number" id="prof-budget" min="8" max="35" value="${Number(state.profile.budgetMinutes || 18)}" style="width:85px">
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="prof-allow-us" ${state.classSettings?.allowAmericanSpelling ? 'checked' : ''}>
            同时接受美式拼写变体（如 neighbor / favorite）
          </label>
          <button type="submit" class="btn btn-primary btn-sm">保存设置</button>
        </form>
      </section>

      <section class="card">
        <h2 style="margin-top:0">⚡ 快速粘贴自建词单（支持 AI 自动拆块与生成五上例句）</h2>
        <p class="muted">每行按 <code>英文 | 中文</code> 粘贴老师明天要默写的新词或重点句，一键生成专属闯关包：</p>
        <form id="quick-pack-form">
          <div class="row" style="margin-bottom:10px">
            <label style="flex:1;min-width:240px">新词单标题：
              <input type="text" id="qp-title" placeholder="例：Unit 6 词表 11–20 明日默写" required style="width:100%">
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;font-weight:700;cursor:pointer;margin-top:18px">
              <input type="checkbox" id="qp-ai-enrich" ${aiUI.enrichOnQuickPack ? 'checked' : ''}>
              🤖 若 AI 已启用，自动补全音节拆块、干扰项与五上例句
            </label>
          </div>
          <textarea id="qp-lines" placeholder="their | 他们的&#10;too | 太，过于&#10;close to | 接近&#10;friendly | 友好的" required></textarea>
          <div class="row" style="margin-top:10px">
            <button type="submit" class="btn btn-primary">✨ 生成闯关词单并前往练习 →</button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2 style="margin-top:0">🎧 发音试听 & 绑定自定义真人录音（内置 ${attributionEntries.length} 个公开授权真人单词音）</h2>
        <div class="row" style="margin:10px 0">
          <button type="button" class="btn btn-sm" data-speak-item="u6_neighbour">① 试听真人单词 (neighbour)</button>
          <button type="button" class="btn btn-sm" data-speak-item="u6_get_along_with">② 试听短语 (get along with)</button>
          <button type="button" class="btn btn-sm" data-speak-raw="My bag is so heavy.">③ 试听完整英文短句</button>
        </div>
        <form id="custom-audio-form" class="row" style="margin-top:12px">
          <select id="ca-item" style="max-width:340px">
            ${state.items.map(it => `<option value="${esc(it.id)}">${esc(it.en)}（${esc(it.zh)}）</option>`).join('')}
          </select>
          <input type="file" id="ca-file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" required>
          <button type="submit" class="btn btn-sm btn-primary">绑定保存录音</button>
        </form>
      </section>
    `;
  }

  // ==================== Event Binding & Keyboard Smoothness ====================
  function readAIFormInputs() {
    const providerId = $('#ai-provider-select')?.value || SnapAI.loadConfig().activeProvider;
    const baseUrl = $('#ai-base-url')?.value?.trim() || SnapAI.PROVIDERS[providerId]?.defaultBaseUrl || '';
    const apiKey = $('#ai-api-key')?.value?.trim() || '';
    const model = $('#ai-model-input')?.value?.trim() || SnapAI.PROVIDERS[providerId]?.defaultModel || '';
    const enabled = $('#ai-enabled-toggle') ? Boolean($('#ai-enabled-toggle').checked) : SnapAI.loadConfig().enabled;
    return { providerId, baseUrl, apiKey, model, enabled };
  }

  async function advanceArenaItem(s = activeSession, queueKey = 'arena') {
    if (!s) return;
    if (queueKey === 'due') {
      if ((s.dueIndex || 0) + 1 < s.dueIds.length) {
        s.dueIndex = (s.dueIndex || 0) + 1;
        initArenaCardState(s, 'due');
        render();
        focusActiveInput();
        const nextIt = itemById(s.dueIds[s.dueIndex]);
        if (nextIt) SnapAudio.play(state, nextIt, null);
        await saveState();
      } else {
        s.duePrewritten = true;
        s.step = firstMainStep(s);
        if (s.step === 'paper') initArenaCardState(s, 'arena');
        render();
        focusActiveInput();
        if (s.step === 'paper' && s.arenaQueue[s.arenaIndex]) {
          SnapAudio.play(state, itemById(s.arenaQueue[s.arenaIndex]), null);
        }
        await saveState();
      }
      return;
    }

    if ((s.arenaIndex || 0) + 1 < s.arenaQueue.length) {
      s.arenaIndex = (s.arenaIndex || 0) + 1;
      initArenaCardState(s, 'arena');
      render();
      focusActiveInput();
      const nextId = s.arenaQueue[s.arenaIndex];
      const nextCtx = ensureItemContext(s, nextId, { preserveExisting: true });
      if (nextCtx?.promptMode !== 'zh_prompt') {
        SnapAudio.play(state, itemById(nextId), null);
      }
      await saveState();
    } else {
      await finalizeArenaSession(s);
    }
  }

  async function submitArenaAttempt(rawVal, queueKey = 'arena') {
    const s = activeSession;
    if (!s) return;
    const card = queueKey === 'due' ? s.dueCard : s.arenaCard;
    if (!card || card.subPhase !== 'typing') return;
    const id = card.itemId;
    const it = itemById(id);
    const ctx = ensureItemContext(s, id, { preserveExisting: true, lock: true });
    card.draft = rawVal;

    const diag = SnapCore.diagnoseSpellingAttempt(it, rawVal, {
      promptMode: ctx.promptMode === 'ai_sentence' ? 'audio_plus_zh' : ctx.promptMode,
      variantKey: ctx.variantKey,
      allowAmericanSpelling: state.classSettings?.allowAmericanSpelling
    });
    // Also check exact match against ctx.accepted directly (covers AI sentence variants)
    const normIn = SnapCore.normText(rawVal);
    const strictCase = ctx.accepted.some(x => /[A-Z]/.test(x));
    const directOk = normIn && ctx.accepted.some(acc => normIn === acc || (!strictCase && normIn.toLowerCase() === acc.toLowerCase()));

    if (diag.ok || directOk) {
      card.subPhase = 'passed';
      const cleanFirstPass = card.tries === 0 && !card.usedHint;
      if (cleanFirstPass) {
        s.streak = (s.streak || 0) + 1;
        s.maxStreak = Math.max(s.maxStreak || 0, s.streak);
      } else {
        s.streak = 0;
      }
      s.arenaResults[id] = {
        done: true,
        outcome: cleanFirstPass ? 'paper_independent' : (card.tries === 0 ? 'hinted_correct' : 'answer_corrected'),
        usedHint: Boolean(card.usedHint),
        errorTags: card.accumTags || [],
        testedAt: Date.now()
      };
      SnapAudio.play(state, it, null);
      render();
      $('#btn-arena-next')?.focus();
      await saveState();
      return;
    }

    // Mismatch -> Immediate In-Flow Diff Review & Audio!
    card.tries = (card.tries || 0) + 1;
    s.streak = 0;
    card.lastDiag = diag;
    card.accumTags = [...new Set([...(card.accumTags || []), ...(diag.errorTags || [])])];
    card.subPhase = 'diff_review';
    SnapAudio.play(state, it, null);
    render();
    $('#btn-start-blind-retype')?.focus();

    // Non-blocking AI mistake coach tip
    if (SnapAI.isReady() && normIn) {
      SnapAI.diagnoseMistake(it, normIn).then(tip => {
        if (!activeSession || card.itemId !== id) return;
        if (tip) {
          card.aiMistakeTip = tip;
          const tipEl = $('#ai-mistake-coach');
          if (tipEl) tipEl.textContent = `🤖 AI 巧记点拨：${tip}`;
        }
      }).catch(() => {});
    }
    await saveState();
  }

  function bindEvents() {
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

    $('#actor-toggle')?.addEventListener('click', () => requestActorSwitch());
    document.querySelector('[data-act="switch-to-student-ledger"]')?.addEventListener('click', () => requestActorSwitch('student'));

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
          render();
          await saveState();
        } else if (act === 'discard_switch') {
          SnapAudio.stop();
          const prevActor = activeSession?.lockedActor || state.actorMode;
          activeSession = null;
          setActorDraft(prevActor, null);
          state.actorMode = targetActor;
          syncActiveDraftFromActor();
          render();
          await saveState();
        } else {
          render();
        }
      };
    });

    document.querySelectorAll('[data-due-gate]').forEach(btn => {
      btn.onclick = async () => {
        const action = btn.dataset.dueGate;
        const gate = dueNavGate;
        dueNavGate = null;
        if (!activeSession || !gate || action === 'stay') {
          render();
          focusActiveInput();
          return;
        }
        if (action === 'mark_exposed') {
          markUnwrittenDueExposed(activeSession, 'pre_answer_navigation');
        }
        SnapAudio.stop();
        if (gate.kind === 'step') {
          activeSession.step = gate.target;
          if (activeSession.step === 'paper') initArenaCardState(activeSession, 'arena');
        } else if (gate.kind === 'tab') {
          currentTab = gate.target;
        }
        render();
        focusActiveInput();
        await saveState();
      };
    });

    // Difficulty gear buttons
    document.querySelectorAll('[data-set-diff]').forEach(btn => {
      btn.onclick = async () => {
        state.difficultyMode = btn.dataset.setDiff;
        render();
        await saveState();
      };
    });

    async function selectLessonPack(id, focusLesson = false) {
      const pack = state.packs.find(entry => entry.id === id);
      if (!pack) return;
      state.selectedPackId = id;
      packGroup = groupOfPack(pack);
      packQuery = '';
      lessonDetailsOpen = false;
      render();
      if (focusLesson) {
        $('#lesson-heading')?.focus({ preventScroll: true });
        $('#lesson-heading')?.scrollIntoView({ block: 'nearest' });
      }
      await saveState();
    }

    $('#pack-select')?.addEventListener('change', e => selectLessonPack(e.target.value));
    document.querySelectorAll('[data-select-pack]').forEach(btn => {
      btn.onclick = () => selectLessonPack(btn.dataset.selectPack, true);
    });

    document.querySelector('[data-lesson-details]')?.addEventListener('toggle', e => { lessonDetailsOpen = e.target.open; });
    document.querySelector('[data-parent-tune]')?.addEventListener('toggle', e => { parentTuneOpen = e.target.open; });

    $('.kid-browse-link')?.addEventListener('click', e => {
      e.preventDefault();
      $('#pack-library-heading')?.focus();
      $('#pack-library')?.scrollIntoView({ block: 'nearest' });
    });

    const packResults = $('#pack-results');
    const packSearch = $('#pack-query');
    const packFilters = document.querySelectorAll('[data-pack-group]');
    function updatePackResults() {
      const group = packGroup || groupOfPack(selectedPack());
      if (packResults) packResults.innerHTML = renderPackResults(group, packQuery);
      packFilters.forEach(btn => {
        btn.setAttribute('aria-pressed', String(!packQuery.trim() && btn.dataset.packGroup === group));
      });
    }
    packFilters.forEach(btn => {
      btn.onclick = () => {
        packGroup = btn.dataset.packGroup;
        packQuery = '';
        if (packSearch) packSearch.value = '';
        updatePackResults();
      };
    });
    packSearch?.addEventListener('input', e => { packQuery = e.target.value; updatePackResults(); });
    packResults?.addEventListener('click', e => {
      const card = e.target.closest('[data-pick-pack]');
      if (card) selectLessonPack(card.dataset.pickPack, true);
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

    document.querySelector('[data-act="resume-draft"]')?.addEventListener('click', async () => {
      if (state.activeDraft && state.activeDraft.lockedActor === state.actorMode) {
        activeSession = resumeLesson(state.activeDraft);
        activeSession.draftStatus = 'in_progress';
        setActorDraft(state.actorMode, activeSession);
        render();
        focusActiveInput();
        await saveState();
      }
    });

    document.querySelector('[data-act="discard-draft"]')?.addEventListener('click', async () => {
      setActorDraft(state.actorMode, null);
      activeSession = null;
      render();
      await saveState();
      toast('已清除未完成草稿');
    });

    document.querySelector('[data-act="pause-session"]')?.addEventListener('click', () => suspendSessionToDraft());
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

    document.querySelector('[data-act="retry-missed-now"]')?.addEventListener('click', async () => {
      const missed = activeSession?.summary?.needReviewIds || [];
      const curActor = activeSession?.lockedActor || state.actorMode;
      activeSession = null;
      setActorDraft(curActor, null);
      if (missed.length) {
        await startSession('due_only', missed, {
          difficulty: 'challenge',
          packTitle: `🔁 错词满分清零加赛（${missed.length} 项）`
        });
      }
    });

    document.querySelector('[data-act="upgrade-to-normal"]')?.addEventListener('click', async () => {
      const curActor = activeSession?.lockedActor || state.actorMode;
      activeSession = null;
      setActorDraft(curActor, null);
      state.difficultyMode = 'normal';
      await startSession('standard', null, { difficulty: 'normal' });
    });

    document.querySelector('[data-act="upgrade-to-challenge"]')?.addEventListener('click', async () => {
      const curActor = activeSession?.lockedActor || state.actorMode;
      activeSession = null;
      setActorDraft(curActor, null);
      state.difficultyMode = 'challenge';
      await startSession('standard', null, { difficulty: 'challenge' });
    });

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
        if (targetStep === 'snap' && !activeSession.snapState) initSnapCardState(activeSession);
        if (targetStep === 'paper' && !activeSession.arenaCard) initArenaCardState(activeSession, 'arena');
        render();
        focusActiveInput();
        await saveState();
      };
    });

    document.querySelectorAll('[data-complete-step]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        activeSession.stepsDone[btn.dataset.completeStep] = true;
        activeSession.step = btn.dataset.nextStep;
        if (activeSession.step === 'snap' && !activeSession.snapState) initSnapCardState(activeSession);
        if (activeSession.step === 'paper' && !activeSession.arenaCard) initArenaCardState(activeSession, 'arena');
        render();
        focusActiveInput();
        await saveState();
      };
    });

    // Audio buttons
    document.querySelectorAll('[data-speak-item]').forEach(btn => {
      btn.onclick = () => {
        const it = itemById(btn.dataset.speakItem);
        if (it) SnapAudio.play(state, it, toast);
      };
    });

    document.querySelectorAll('[data-speak-arena]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        const id = btn.dataset.speakArena;
        const it = itemById(id);
        const ctx = ensureItemContext(activeSession, id, { preserveExisting: true });
        if (!it) return;
        if (ctx && SnapCore.normText(ctx.spokenText).toLowerCase() !== SnapCore.normText(it.en).toLowerCase()) {
          SnapAudio.play(state, ctx.spokenText, toast);
        } else {
          SnapAudio.play(state, it, toast);
        }
        focusActiveInput();
      };
    });

    document.querySelectorAll('[data-speak-raw]').forEach(btn => {
      btn.onclick = () => SnapAudio.play(state, btn.dataset.speakRaw, toast);
    });

    // Match Micro-Game handlers
    async function checkMatchSelection() {
      const ms = activeSession?.matchState;
      if (!ms || !ms.pickedLeft || !ms.pickedRight) return;
      if (ms.pickedLeft === ms.pickedRight) {
        ms.matchedIds.push(ms.pickedLeft);
        ms.combo = (ms.combo || 0) + 1;
        ms.pickedLeft = null;
        ms.pickedRight = null;
        ms.wrongLeft = null;
        ms.wrongRight = null;
        if (ms.matchedIds.length >= ms.leftCards.length) {
          activeSession.stepsDone.match = true;
        }
        render();
        await saveState();
      } else {
        ms.combo = 0;
        ms.wrongLeft = ms.pickedLeft;
        ms.wrongRight = ms.pickedRight;
        ms.pickedLeft = null;
        ms.pickedRight = null;
        render();
        setTimeout(() => {
          if (activeSession?.matchState) {
            activeSession.matchState.wrongLeft = null;
            activeSession.matchState.wrongRight = null;
            render();
          }
        }, 420);
      }
    }

    document.querySelectorAll('[data-match-left]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession?.matchState) return;
        const id = btn.dataset.matchLeft;
        activeSession.matchState.pickedLeft = id;
        const it = itemById(id);
        if (it) SnapAudio.play(state, it, null);
        render();
        checkMatchSelection();
      };
    });

    document.querySelectorAll('[data-match-right]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession?.matchState) return;
        activeSession.matchState.pickedRight = btn.dataset.matchRight;
        render();
        checkMatchSelection();
      };
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
              recordedBy: 'web_auto',
              itemId: item.id,
              taskType: 'scaffold_snap',
              outcome: 'done'
            });
            SnapAudio.play(state, item, null);
          }
          render();
          await saveState();
        } else {
          st.wobbleKey = tile.key;
          st.bounceTip = tile.tip || `🤔 这一块顺序不对哦，先听发音再找第 ${st.filled.length + 1} 块！`;
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
      focusActiveInput();
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
      if (activeSession?.snapState) activeSession.snapState.clozeDraft = e.target.value;
    });

    const advanceSnapWord = async () => {
      if (!activeSession) return;
      if (activeSession.snapIndex + 1 < activeSession.focusIds.length) {
        activeSession.snapIndex++;
        initSnapCardState(activeSession);
        render();
        SnapAudio.play(state, itemById(activeSession.focusIds[activeSession.snapIndex]), null);
      } else {
        activeSession.stepsDone.snap = true;
        activeSession.step = activeSession.arenaQueue?.length ? 'paper' : 'oral_wrapup';
        if (activeSession.step === 'paper') {
          initArenaCardState(activeSession, 'arena');
          render();
          focusActiveInput();
          if (activeSession.arenaQueue[activeSession.arenaIndex]) {
            SnapAudio.play(state, itemById(activeSession.arenaQueue[activeSession.arenaIndex]), null);
          }
        } else {
          render();
        }
      }
      await saveState();
    };

    $('#cloze-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const st = activeSession?.snapState;
      if (!st) return;
      if (st.clozeDone) {
        await advanceSnapWord();
        return;
      }
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
          recordedBy: 'web_auto',
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
          st.clozeFeedback = '🎩 字母拼对啦！再检查一下大小写？';
        } else if (ans.includes(' ') && val.toLowerCase().replace(/\s+/g, '') === ans.toLowerCase().replace(/\s+/g, '')) {
          st.clozeFeedback = '✂️ 词与词之间记得敲空格分开哦！';
        } else {
          st.clozeFeedback = `🤔 还差一点点（这一空共 ${wordCount > 1 ? `${wordCount} 个词` : `${ans.length} 个字母`}），再听一遍发音试试！`;
        }
        render();
        focusActiveInput();
      }
    });

    document.querySelectorAll('[data-easy-snap-choice]').forEach(btn => {
      btn.onclick = async () => {
        const st = activeSession?.snapState;
        if (!st) return;
        const item = itemById(st.itemId);
        if (SnapCore.normText(btn.dataset.easySnapChoice) === SnapCore.normText(item.en)) {
          st.clozeDone = true;
          st.clozeDraft = item.cloze.blank;
          st.clozeFeedback = '';
          SnapAudio.play(state, item, null);
          render();
          await saveState();
        } else {
          st.clozeFeedback = '🧐 这个是个伪装干扰词哦，仔细对比一下元音和词尾再选！';
          render();
        }
      };
    });

    document.querySelector('[data-act="next-word"]')?.addEventListener('click', advanceSnapWord);
    document.querySelector('[data-act="skip-to-next-word"]')?.addEventListener('click', advanceSnapWord);
    document.querySelector('[data-act="prev-word"]')?.addEventListener('click', async () => {
      if (activeSession?.snapIndex > 0) {
        activeSession.snapIndex--;
        initSnapCardState(activeSession);
        render();
        await saveState();
      }
    });

    // ==================== Paperless Arena Handlers ====================
    const activeQueueKey = activeSession?.step === 'due_precheck' ? 'due' : 'arena';

    $('#arena-prompt-mode')?.addEventListener('change', async e => {
      if (!activeSession) return;
      const mode = e.target.value;
      activeSession.promptMode = mode;
      const list = activeQueueKey === 'due' ? activeSession.dueIds : activeSession.arenaQueue;
      const curIdx = activeQueueKey === 'due' ? (activeSession.dueIndex || 0) : (activeSession.arenaIndex || 0);
      for (let i = curIdx; i < list.length; i++) {
        if (!activeSession.itemContexts?.[list[i]]?.locked) {
          ensureItemContext(activeSession, list[i], { promptMode: mode });
        }
      }
      initArenaCardState(activeSession, activeQueueKey);
      render();
      focusActiveInput();
      await saveState();
    });

    document.querySelector('[data-act="swap-ai-sentence"]')?.addEventListener('click', async () => {
      if (!activeSession) return;
      const card = activeQueueKey === 'due' ? activeSession.dueCard : activeSession.arenaCard;
      if (!card) return;
      if (activeSession.itemContexts?.[card.itemId]) activeSession.itemContexts[card.itemId].locked = false;
      ensureItemContext(activeSession, card.itemId, { promptMode: 'ai_sentence', forceNewVariant: true });
      initArenaCardState(activeSession, activeQueueKey);
      render();
      focusActiveInput();
      await saveState();
    });

    $('#arena-input')?.addEventListener('input', e => {
      const card = activeQueueKey === 'due' ? activeSession?.dueCard : activeSession?.arenaCard;
      if (!card) return;
      if (card.subPhase === 'typing') card.draft = e.target.value;
      else if (card.subPhase === 'blind_retype') card.retypeDraft = e.target.value;
    });

    $('#arena-input')?.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const card = activeQueueKey === 'due' ? activeSession?.dueCard : activeSession?.arenaCard;
        if (card) {
          const it = itemById(card.itemId);
          if (it) SnapAudio.play(state, it, null);
        }
      }
    });

    document.querySelectorAll('[data-insert-char]').forEach(btn => {
      btn.onclick = () => {
        const inp = $('#arena-input');
        if (!inp || inp.readOnly) return;
        const ch = btn.dataset.insertChar;
        const start = inp.selectionStart ?? inp.value.length;
        const end = inp.selectionEnd ?? inp.value.length;
        inp.value = inp.value.slice(0, start) + ch + inp.value.slice(end);
        inp.dispatchEvent(new Event('input'));
        inp.focus();
        inp.setSelectionRange(start + ch.length, start + ch.length);
      };
    });

    document.querySelector('[data-act="arena-use-hint"]')?.addEventListener('click', async () => {
      const card = activeQueueKey === 'due' ? activeSession?.dueCard : activeSession?.arenaCard;
      if (!card || !activeSession) return;
      card.usedHint = true;
      activeSession.hintedOnPaper = activeSession.hintedOnPaper || {};
      activeSession.hintedOnPaper[card.itemId] = true;
      render();
      focusActiveInput();
      await saveState();
    });

    document.querySelector('[data-act="toggle-easy-choices"]')?.addEventListener('click', () => {
      const card = activeSession?.arenaCard;
      if (!card) return;
      card.showChoiceAid = !card.showChoiceAid;
      card.usedHint = true;
      render();
      if (!card.showChoiceAid) focusActiveInput();
    });

    document.querySelectorAll('[data-arena-choice]').forEach(btn => {
      btn.onclick = () => submitArenaAttempt(btn.dataset.arenaChoice, activeQueueKey);
    });

    $('#arena-form')?.addEventListener('submit', e => {
      e.preventDefault();
      submitArenaAttempt($('#arena-input')?.value ?? '', activeQueueKey);
    });

    document.querySelector('[data-act="start-blind-retype"]')?.addEventListener('click', () => {
      const card = activeQueueKey === 'due' ? activeSession?.dueCard : activeSession?.arenaCard;
      if (!card) return;
      card.subPhase = 'blind_retype';
      card.retypeDraft = '';
      card.retypeError = '';
      render();
      focusActiveInput();
    });

    document.querySelector('[data-act="peek-diff-again"]')?.addEventListener('click', () => {
      const card = activeQueueKey === 'due' ? activeSession?.dueCard : activeSession?.arenaCard;
      if (!card) return;
      card.subPhase = 'diff_review';
      card.retypeDraft = '';
      render();
      $('#btn-start-blind-retype')?.focus();
    });

    $('#arena-retype-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const card = activeQueueKey === 'due' ? activeSession?.dueCard : activeSession?.arenaCard;
      if (!card || !activeSession) return;
      const rawVal = $('#arena-input')?.value ?? '';
      card.retypeDraft = rawVal;
      const ctx = ensureItemContext(activeSession, card.itemId, { preserveExisting: true });
      const normIn = SnapCore.normText(rawVal);
      const strictCase = ctx.accepted.some(x => /[A-Z]/.test(x));
      const ok = normIn && ctx.accepted.some(acc => normIn === acc || (!strictCase && normIn.toLowerCase() === acc.toLowerCase()));

      if (ok) {
        card.subPhase = 'passed';
        card.retypeError = '';
        activeSession.arenaResults[card.itemId] = {
          done: true,
          outcome: 'answer_corrected',
          usedHint: Boolean(card.usedHint),
          errorTags: card.accumTags || [],
          testedAt: Date.now()
        };
        SnapAudio.play(state, itemById(card.itemId), null);
        render();
        $('#btn-arena-next')?.focus();
        await saveState();
      } else {
        card.retypeError = '🤔 还差一点点哦！可点「🔊 再听发音」或「👀 再看一眼对比」确认后再盲打。';
        render();
        focusActiveInput();
      }
    });

    document.querySelector('[data-act="arena-next"]')?.addEventListener('click', () => {
      advanceArenaItem(activeSession, activeQueueKey);
    });

    document.querySelector('[data-act="finish-arena-early"]')?.addEventListener('click', () => {
      finalizeArenaSession(activeSession);
    });

    // Surface 1: On-Demand Alternative AI Mnemonic inside Snap step
    document.querySelector('[data-act="alt-ai-mnemonic"]')?.addEventListener('click', async () => {
      if (!activeSession?.snapState || aiUI.altMnemonicLoading) return;
      const item = itemById(activeSession.snapState.itemId);
      if (!item) return;
      if (!SnapAI.isReady()) {
        toast('💡 请先点顶部「🤖 家长与AI设置」填入 API 密钥并启用 AI！');
        return;
      }
      aiUI.altMnemonicLoading = true;
      render();
      try {
        await SnapAI.generateAltMnemonic(item, SnapAI.getMemoryCoachTip(item));
        toast('✨ AI 已为你换了一种更好记的新口诀！');
      } catch (err) {
        toast('⚠️ ' + err.message);
      } finally {
        aiUI.altMnemonicLoading = false;
        render();
      }
    });

    // ==================== Multi-Round Anti-Mash Arcade Handlers ====================
    function handleScramblePick(tileKey) {
      const arc = activeSession?.arcadeState;
      if (!arc || arc.gameType !== 'scramble' || arc.scrambleDone) return;
      const r = arc.scrambleRounds[arc.scrambleIdx];
      if (!r || r.revealedReset) return;
      const tile = r.pool.find(t => t.key === tileKey);
      if (!tile || r.usedKeys.includes(tile.key)) return;

      const expected = r.targets[r.filled.length];
      if (!tile.isTrap && tile.text === expected) {
        r.filled.push(tile.text);
        r.usedKeys.push(tile.key);
        r.wobbleKey = null;
        r.tip = '';
        if (r.filled.length === r.targets.length) {
          arc.combo = (arc.combo || 0) + 1;
          arc.maxCombo = Math.max(arc.maxCombo || 0, arc.combo);
          arc.score += 100 + Math.min(50, arc.combo * 10);
          SnapAudio.play(state, itemById(r.itemId), null);
          if (arc.scrambleIdx + 1 < arc.scrambleRounds.length) {
            arc.scrambleIdx++;
            toast(`🚀 过关！+${100 + Math.min(50, arc.combo * 10)} 分，进入第 ${arc.scrambleIdx + 1} 关！`);
          } else {
            arc.scrambleDone = true;
          }
        }
        render();
        saveState();
      } else {
        r.wobbleKey = tile.key;
        r.hearts = Math.max(0, r.hearts - 1);
        arc.combo = 0;
        r.tip = tile.isTrap
          ? `⚠️「${tile.text}」是伪装陷阱块！扣除 1 颗心，请仔细听发音再选！`
          : `🤔 顺序不对哦，第 ${r.filled.length + 1} 格不是「${tile.text}」（扣除 1 颗心）！`;
        if (r.hearts <= 0) {
          r.revealedReset = true;
          SnapAudio.play(state, itemById(r.itemId), null);
        }
        render();
      }
    }

    document.querySelectorAll('[data-arcade-mode]').forEach(btn => {
      btn.onclick = () => {
        if (!activeSession) return;
        const targetMode = btn.dataset.arcadeMode;
        if (!activeSession.arcadeState) initArcadeState(activeSession, targetMode);
        else activeSession.arcadeState.gameType = targetMode;
        render();
      };
    });

    document.querySelector('[data-act="restart-arcade"]')?.addEventListener('click', () => {
      if (!activeSession) return;
      initArcadeState(activeSession, 'scramble');
      render();
    });

    document.querySelector('[data-act="restart-radar-local"]')?.addEventListener('click', () => {
      if (!activeSession) return;
      initArcadeState(activeSession, 'radar');
      render();
    });

    document.querySelectorAll('[data-scramble-key]').forEach(btn => {
      btn.onclick = () => handleScramblePick(btn.dataset.scrambleKey);
    });

    document.querySelector('[data-act="retry-scramble-round"]')?.addEventListener('click', () => {
      const arc = activeSession?.arcadeState;
      if (!arc) return;
      const old = arc.scrambleRounds[arc.scrambleIdx];
      const it = itemById(old?.itemId);
      if (it) arc.scrambleRounds[arc.scrambleIdx] = buildScrambleRound(it);
      render();
    });

    // Surface 2: AI Dynamic Multi-Round Radar Traps
    document.querySelector('[data-act="ai-gen-radar"]')?.addEventListener('click', async () => {
      if (!activeSession || aiUI.arcadeLoading) return;
      if (!SnapAI.isReady()) {
        toast('💡 请先点顶部「🤖 家长与AI设置」填入 API 密钥并启用 AI，即可无限生成全新五上关卡！');
        return;
      }
      aiUI.arcadeLoading = true;
      render();
      try {
        const items = getSessionPackItems(activeSession);
        const rounds = await SnapAI.generateRadarArcadeSet(items, activeSession.difficulty || 'normal');
        initArcadeState(activeSession, 'radar', rounds);
        toast(`🤖 AI 已全新设计 ${rounds.length} 关五上真假陷阱关卡！`);
      } catch (err) {
        toast('⚠️ ' + err.message);
      } finally {
        aiUI.arcadeLoading = false;
        render();
      }
    });

    document.querySelectorAll('[data-radar-judge]').forEach(btn => {
      btn.onclick = () => {
        const arc = activeSession?.arcadeState;
        if (!arc || arc.radarPhase !== 'decide') return;
        const r = arc.radarRounds[arc.radarIdx];
        const pickedTrap = btn.dataset.radarJudge === 'trap';
        if (pickedTrap && r.isTrap) {
          arc.radarPhase = 'defuse';
          arc.radarDraft = '';
          arc.radarMsg = '';
          render();
          $('#radar-defuse-input')?.focus();
        } else if (!pickedTrap && !r.isTrap) {
          arc.combo = (arc.combo || 0) + 1;
          arc.maxCombo = Math.max(arc.maxCombo || 0, arc.combo);
          arc.score += 100;
          arc.radarLastOk = true;
          arc.radarMsg = '✅ 判断精准！这个词确实拼写无误！+100 分';
          arc.radarPhase = 'feedback';
          SnapAudio.play(state, itemById(r.itemId), null);
          render();
          $('#btn-radar-next')?.focus();
        } else {
          arc.combo = 0;
          arc.radarHearts = Math.max(0, arc.radarHearts - 1);
          arc.radarLastOk = false;
          arc.radarMsg = r.isTrap
            ? `💔 哎呀中计了！「${r.shownWord}」其实藏着拼写陷阱，扣 1 颗心！`
            : `💔 误伤好人啦！「${r.shownWord}」本来就是完全正确的拼写，扣 1 颗心！`;
          arc.radarPhase = arc.radarHearts <= 0 ? 'gameover' : 'feedback';
          render();
          $('#btn-radar-next')?.focus();
        }
      };
    });

    $('#radar-defuse-input')?.addEventListener('input', e => {
      if (activeSession?.arcadeState) activeSession.arcadeState.radarDraft = e.target.value;
    });

    document.querySelectorAll('[data-radar-insert]').forEach(btn => {
      btn.onclick = () => {
        const inp = $('#radar-defuse-input');
        if (!inp) return;
        const ch = btn.dataset.radarInsert;
        inp.value += ch;
        inp.dispatchEvent(new Event('input'));
        inp.focus();
      };
    });

    $('#radar-defuse-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const arc = activeSession?.arcadeState;
      if (!arc || arc.radarPhase !== 'defuse') return;
      const r = arc.radarRounds[arc.radarIdx];
      const typed = SnapCore.normText($('#radar-defuse-input')?.value ?? '');
      const strictCase = /[A-Z]/.test(r.correctWord);
      const ok = typed && (typed === r.correctWord || (!strictCase && typed.toLowerCase() === r.correctWord.toLowerCase()));
      if (ok) {
        arc.combo = (arc.combo || 0) + 1;
        arc.maxCombo = Math.max(arc.maxCombo || 0, arc.combo);
        arc.score += 150;
        arc.radarLastOk = true;
        arc.radarMsg = '💥 拆弹大成功！拼写修正完全正确！+150 分';
        arc.radarPhase = 'feedback';
        SnapAudio.play(state, itemById(r.itemId), null);
        render();
        $('#btn-radar-next')?.focus();
      } else {
        arc.radarHearts = Math.max(0, arc.radarHearts - 1);
        arc.combo = 0;
        if (arc.radarHearts <= 0) {
          arc.radarPhase = 'gameover';
          render();
        } else {
          arc.radarMsg = `🤔 拼写还有一点偏差（已扣 1 颗心），听发音再仔细拼一次！`;
          render();
          $('#radar-defuse-input')?.focus();
        }
      }
    });

    document.querySelector('[data-act="radar-next"]')?.addEventListener('click', () => {
      const arc = activeSession?.arcadeState;
      if (!arc) return;
      if (arc.radarIdx + 1 < arc.radarRounds.length) {
        arc.radarIdx++;
        arc.radarPhase = 'decide';
        arc.radarDraft = '';
        arc.radarMsg = '';
      } else {
        arc.radarPhase = 'done';
      }
      render();
    });

    // ==================== Surface 3: Current-Pack Story Blackboard & Unit-Matched Slot Machine ====================
    document.querySelectorAll('[data-board-mode]').forEach(btn => {
      btn.onclick = () => {
        slotUI.boardMode = btn.dataset.boardMode;
        render();
      };
    });

    document.querySelector('[data-act="toggle-story-cloze"]')?.addEventListener('click', () => {
      slotUI.storyCloze = !slotUI.storyCloze;
      slotUI.storyRevealed = {};
      render();
    });

    document.querySelectorAll('[data-reveal-story]').forEach(btn => {
      btn.onclick = () => {
        slotUI.storyRevealed[btn.dataset.revealStory] = true;
        if (btn.dataset.speakRaw) SnapAudio.play(state, btn.dataset.speakRaw, null);
        render();
      };
    });

    document.querySelector('[data-act="gen-ai-story"]')?.addEventListener('click', async () => {
      if (!activeSession || aiUI.storyLoading) return;
      if (!SnapAI.isReady()) {
        toast('💡 请先点顶部「🤖 家长与AI设置」填入 API 密钥并启用 AI！');
        return;
      }
      aiUI.storyLoading = true;
      render();
      try {
        const items = getSessionPackItems(activeSession);
        await SnapAI.generateMiniStory(activeSession.packId, items);
        slotUI.storyCloze = false;
        slotUI.storyRevealed = {};
        toast('🤖 AI 已把本组词串联成一篇全新的五上搞笑小故事！');
      } catch (err) {
        toast('⚠️ ' + err.message);
      } finally {
        aiUI.storyLoading = false;
        render();
      }
    });

    $('#slot-deck-select')?.addEventListener('change', e => {
      slotUI.deckIndex = Number(e.target.value) || 0;
      slotUI.subj = 0; slotUI.adv = 0; slotUI.act = 0; slotUI.customEn = '';
      render();
    });
    document.querySelectorAll('[data-reel]').forEach(sel => {
      sel.onchange = () => { slotUI[sel.dataset.reel] = Number(sel.value) || 0; slotUI.customEn = ''; render(); };
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

    // Oral wrapup
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
              outcome: 'done'
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

    // Vault & Ledger
    document.querySelectorAll('[data-vault-filter]').forEach(btn => {
      btn.onclick = () => { vaultFilter = btn.dataset.vaultFilter; render(); };
    });

    document.querySelectorAll('[data-class-req]').forEach(sel => {
      sel.onchange = async () => {
        const updated = SnapCore.updateCurriculumItem(state, sel.dataset.classReq, { classRequirement: sel.value });
        if (updated) { render(); await saveState(); toast(`已更新「${updated.en}」要求`); }
      };
    });

    document.querySelector('[data-act="start-due-review"]')?.addEventListener('click', () => {
      const ids = SnapCore.getDueQueue(state, SnapCore.todayISO(), 5).todayPick.map(d => d.item.id);
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
        toast('学习备份 JSON 已导出（不含任何 API 密钥）');
      };
    });

    document.querySelector('[data-act="trigger-import"]')?.addEventListener('click', () => $('#import-file-input')?.click());

    $('#import-file-input')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20MB');
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

    document.querySelectorAll('input[name="conflict-pol"]').forEach(r => { r.onchange = () => { importConflictPolicy = r.value; render(); }; });
    document.querySelectorAll('input[name="draft-pol"]').forEach(r => { r.onchange = () => { importDraftPolicy = r.value; render(); }; });

    document.querySelector('[data-act="confirm-import-snapword"]')?.addEventListener('click', async () => {
      if (!pendingImportPreview) return;
      state = SnapCore.mergeSnapwordBackup(state, pendingImportPreview.payload, {
        includeDemo: false,
        conflictPolicy: importConflictPolicy,
        draftPolicy: importDraftPolicy
      });
      syncActiveDraftFromActor();
      pendingImportPreview = null;
      render();
      await saveState();
      toast('✅ 备份数据合并完成！');
    });

    document.querySelector('[data-act="confirm-import-legacy-words"]')?.addEventListener('click', async () => {
      if (!pendingImportPreview) return;
      state = SnapCore.importLegacyWordsOnly(state, pendingImportPreview.payload);
      pendingImportPreview = null;
      currentTab = 'learn';
      render();
      await saveState();
      toast('词条已导入！');
    });

    document.querySelector('[data-act="cancel-import"]')?.addEventListener('click', () => {
      pendingImportPreview = null;
      render();
    });

    // ==================== Tab 4: Multi-Model AI Settings & Model List Fetch ====================
    $('#ai-enabled-toggle')?.addEventListener('change', e => {
      SnapAI.saveConfig({ enabled: e.target.checked });
      render();
    });

    $('#ai-provider-select')?.addEventListener('change', e => {
      const pid = e.target.value;
      SnapAI.saveConfig({ activeProvider: pid });
      aiUI.statusMsg = '';
      render();
    });

    $('#btn-toggle-key-vis')?.addEventListener('click', () => {
      const f = readAIFormInputs();
      SnapAI.saveConfig({ providerId: f.providerId, profilePatch: { baseUrl: f.baseUrl, apiKey: f.apiKey, model: f.model } });
      aiUI.showKey = !aiUI.showKey;
      render();
    });

    $('#ai-model-select')?.addEventListener('change', e => {
      const picked = e.target.value;
      const inp = $('#ai-model-input');
      if (inp) inp.value = picked;
      const f = readAIFormInputs();
      SnapAI.saveConfig({ providerId: f.providerId, profilePatch: { baseUrl: f.baseUrl, apiKey: f.apiKey, model: picked } });
    });

    $('#btn-ai-reset-model')?.addEventListener('click', () => {
      const f = readAIFormInputs();
      const defModel = SnapAI.PROVIDERS[f.providerId]?.defaultModel || 'gpt-6.2-sol';
      SnapAI.saveConfig({ providerId: f.providerId, profilePatch: { baseUrl: f.baseUrl, apiKey: f.apiKey, model: defModel } });
      aiUI.statusMsg = `已恢复默认推荐模型：${defModel}`;
      aiUI.statusIsErr = false;
      render();
    });

    $('#btn-ai-fetch-models')?.addEventListener('click', async () => {
      const f = readAIFormInputs();
      SnapAI.saveConfig({ enabled: f.enabled, activeProvider: f.providerId, providerId: f.providerId, profilePatch: { baseUrl: f.baseUrl, apiKey: f.apiKey, model: f.model } });
      aiUI.fetchingModels = true;
      aiUI.statusMsg = '';
      render();
      try {
        const models = await SnapAI.fetchModels({ providerId: f.providerId, baseUrl: f.baseUrl, apiKey: f.apiKey });
        aiUI.statusMsg = `✅ 成功读取 ${models.length} 个模型！您可在上方下拉框中直接选择，也可保留当前「${SnapAI.getActiveProfile().model}」或手动输入。`;
        aiUI.statusIsErr = false;
      } catch (err) {
        aiUI.statusMsg = `⚠️ ${err.message}`;
        aiUI.statusIsErr = true;
      } finally {
        aiUI.fetchingModels = false;
        render();
      }
    });

    $('#btn-ai-save')?.addEventListener('click', () => {
      const f = readAIFormInputs();
      SnapAI.saveConfig({
        enabled: f.enabled,
        activeProvider: f.providerId,
        providerId: f.providerId,
        profilePatch: { baseUrl: f.baseUrl, apiKey: f.apiKey, model: f.model }
      });
      aiUI.statusMsg = `✅ AI 配置已保存（当前服务商：${SnapAI.PROVIDERS[f.providerId]?.label} · 模型：${f.model}）`;
      aiUI.statusIsErr = false;
      render();
      toast('AI 配置已保存在本机');
    });

    $('#btn-ai-test')?.addEventListener('click', async () => {
      const f = readAIFormInputs();
      SnapAI.saveConfig({
        enabled: f.enabled,
        activeProvider: f.providerId,
        providerId: f.providerId,
        profilePatch: { baseUrl: f.baseUrl, apiKey: f.apiKey, model: f.model }
      });
      aiUI.testingConn = true;
      aiUI.statusMsg = '';
      render();
      try {
        const res = await SnapAI.testConnection({ providerId: f.providerId, baseUrl: f.baseUrl, apiKey: f.apiKey, model: f.model });
        aiUI.statusMsg = `🎉 连通成功（模型 ${res.model} · 响应 ${res.latencyMs}ms）：「${res.greeting}」`;
        aiUI.statusIsErr = false;
      } catch (err) {
        aiUI.statusMsg = `❌ 连接测试未通过：${err.message}`;
        aiUI.statusIsErr = true;
      } finally {
        aiUI.testingConn = false;
        render();
      }
    });

    $('#btn-ai-prefetch-now')?.addEventListener('click', async () => {
      const f = readAIFormInputs();
      SnapAI.saveConfig({
        enabled: true,
        activeProvider: f.providerId,
        providerId: f.providerId,
        profilePatch: { baseUrl: f.baseUrl, apiKey: f.apiKey, model: f.model }
      });
      const pack = selectedPack();
      const items = pack.itemIds.map(itemById).filter(Boolean);
      aiUI.prefetching = true;
      aiUI.statusMsg = '';
      render();
      try {
        const summary = SnapCore.getStatsSummary(state, 'student');
        const res = await SnapAI.prefetchPackQuestions(items, state.difficultyMode || 'normal', summary.errorTotals);
        if (!res.ok) throw new Error(res.error || '请先填写有效的 API 密钥');
        aiUI.statusMsg = `✨ 已成功为「${pack.kidTitle || pack.title}」生成 ${res.acceptedCount} 道符合江苏五上水平的全新变式题与巧记口诀！`;
        aiUI.statusIsErr = false;
      } catch (err) {
        aiUI.statusMsg = `⚠️ 生成未完成：${err.message}`;
        aiUI.statusIsErr = true;
      } finally {
        aiUI.prefetching = false;
        render();
      }
    });

    // Profile & Quick Custom Pack forms
    $('#profile-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      state.profile.nickname = $('#prof-nickname').value.trim() || '小探索家';
      state.profile.budgetMinutes = Math.max(8, Math.min(35, Number($('#prof-budget').value) || 18));
      state.classSettings = state.classSettings || {};
      state.classSettings.allowAmericanSpelling = Boolean($('#prof-allow-us')?.checked);
      await saveState();
      toast('学习者设置已保存');
    });

    $('#qp-ai-enrich')?.addEventListener('change', e => {
      aiUI.enrichOnQuickPack = Boolean(e.target.checked);
    });

    $('#quick-pack-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const title = $('#qp-title').value.trim();
        const pairs = SnapCore.parseQuickLessonLines($('#qp-lines').value);
        const wantAI = Boolean($('#qp-ai-enrich')?.checked) && SnapAI.isReady();
        const existingMap = new Map(state.items.map(it => [SnapCore.normText(it.en).toLowerCase(), it]));
        const itemIds = [];
        const newlyCreated = [];

        pairs.forEach((pair, idx) => {
          const found = existingMap.get(pair.en.toLowerCase());
          if (found) {
            itemIds.push(found.id);
          } else {
            const created = SnapCore.suggestItemFromPair(pair.en, pair.zh, idx);
            created.classRequirement = 'dictation_verified';
            state.items.push(created);
            existingMap.set(pair.en.toLowerCase(), created);
            itemIds.push(created.id);
            newlyCreated.push(created);
          }
        });

        const newPack = {
          id: SnapCore.uid('pack_custom'),
          title,
          kidTitle: title,
          subtitle: `共 ${itemIds.length} 项（家长自建必默词单）`,
          modeHint: 'standard',
          paperCap: itemIds.length,
          preserveFullPack: true,
          forceDictationAll: true,
          itemIds
        };
        state.packs.unshift(newPack);
        state.selectedPackId = newPack.id;
        await saveState();

        if (wantAI && newlyCreated.length) {
          toast('正在调用 AI 为新词条补全音节拆块与五上例句...');
          SnapAI.enrichCustomItems(newlyCreated).then(async enriched => {
            for (const row of enriched) {
              const target = state.items.find(x => x.id === row?.id);
              if (!target) continue;
              if (Array.isArray(row.pieces) && row.pieces.join('') === target.en.replace(/\s+/g, '')) {
                target.snap.pieces = row.pieces;
                target.displayChunks = row.pieces.join(' ｜ ');
              }
              if (row.helpNote) target.helpNote = String(row.helpNote).slice(0, 100);
              if (Array.isArray(row.decoys) && row.decoys.length) {
                target.snap.decoys = row.decoys.slice(0, 2).map(d => ({
                  text: String(d.text || '').slice(0, 24),
                  tip: String(d.tip || '再仔细核对一下拼写哦！').slice(0, 80)
                })).filter(d => d.text && d.text.toLowerCase() !== target.en.toLowerCase());
              }
              if (row.template && String(row.template).includes('______')) {
                target.sentencePrompt = {
                  template: String(row.template),
                  zh: String(row.sentenceZh || target.zh),
                  expected: target.en
                };
              }
              if (row.clozeHint && SnapAI.isCleanNonSpoilerHint(row.clozeHint, target.en) && target.cloze) {
                target.cloze.hint = String(row.clozeHint);
              }
            }
            await saveState();
            render();
            toast('✨ AI 已为自建词单补全拆块与五上例句！');
          }).catch(() => {});
        }

        currentTab = 'learn';
        render();
        toast(`已创建词单「${title}」（共 ${itemIds.length} 项）！`);
      } catch (err) {
        toast(err.message);
      }
    });

    $('#custom-audio-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const itemId = $('#ca-item').value;
      const file = $('#ca-file').files?.[0];
      try {
        const dataUrl = await SnapAudio.validateAndEncodeAudioFile(file);
        state.recordings[itemId] = dataUrl;
        $('#ca-file').value = '';
        render();
        await saveState();
        toast('自定义真人发音已绑定保存！');
      } catch (err) {
        toast(err.message);
      }
    });
  }

  // ==================== Global Keyboard Shortcuts (Arena Enter + Scramble Letter Snap) ====================
  document.addEventListener('keydown', e => {
    if (currentTab !== 'learn' || !activeSession) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Direct keyboard letter typing during Scramble Rush single-word rounds!
    if (activeSession.step === 'bug' && activeSession.arcadeState?.gameType === 'scramble' && !activeSession.arcadeState.scrambleDone) {
      const r = activeSession.arcadeState.scrambleRounds[activeSession.arcadeState.scrambleIdx];
      if (r && !r.isMultiWord && !r.revealedReset && /^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const matchTile = r.pool.find(t => !r.usedKeys.includes(t.key) && !t.isTrap && t.text.toLowerCase() === e.key.toLowerCase())
          || r.pool.find(t => !r.usedKeys.includes(t.key) && t.text.toLowerCase() === e.key.toLowerCase());
        if (matchTile) {
          e.preventDefault();
          document.querySelector(`[data-scramble-key="${matchTile.key}"]`)?.click();
        }
        return;
      }
    }

    if (e.key !== 'Enter' || tag === 'BUTTON') return;
    if (activeSession.step === 'paper' || activeSession.step === 'due_precheck') {
      const qk = activeSession.step === 'due_precheck' ? 'due' : 'arena';
      const card = qk === 'due' ? activeSession.dueCard : activeSession.arenaCard;
      if (card?.subPhase === 'passed') {
        e.preventDefault();
        advanceArenaItem(activeSession, qk);
      } else if (card?.subPhase === 'diff_review') {
        e.preventDefault();
        $('#btn-start-blind-retype')?.click();
      }
    } else if (activeSession.step === 'bug' && activeSession.arcadeState?.gameType === 'radar' && activeSession.arcadeState.radarPhase === 'feedback') {
      e.preventDefault();
      $('#btn-radar-next')?.click();
    }
  });

  // ==================== Bootstrap ====================
  initStorage().then(() => render());
})();
