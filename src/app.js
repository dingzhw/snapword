/* 词哒 · SnapWord Main Interactive Workbench Controller (v0.1.1)
 * Closes Party A review items F01–F07 with strict data integrity & zero answer leakage.
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
  let roleSwitchModalOpen = false;
  let pendingImportPreview = null;
  let importConflictPolicy = 'prefer_incoming';
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

    // F06: Auto-resume active in-progress session draft on accidental refresh
    if (state.activeDraft && state.activeDraft.lockedActor === state.actorMode && !state.activeDraft.pausedToLobby) {
      activeSession = SnapCore.clone(state.activeDraft);
      currentTab = 'learn';
    }
  }

  function syncDraftIntoState(pausedToLobby = false) {
    if (!state) return;
    if (activeSession && activeSession.paperPhase !== 'summary') {
      const draft = SnapCore.clone(activeSession);
      draft.pausedToLobby = Boolean(pausedToLobby);
      state.activeDraft = draft;
    } else {
      state.activeDraft = null;
    }
  }

  function saveState() {
    syncDraftIntoState(Boolean(state?.activeDraft?.pausedToLobby && !activeSession));
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

  // ==================== Session Creation & Lifecycle (F02, F03, F05) ====================
  async function startSession(mode = 'standard', explicitDueIds = null) {
    SnapAudio.stop();
    highlightUnjudged = false;
    const lockedActor = state.actorMode; // F03: Hard-lock actor for the entire session!
    const sessionId = SnapCore.uid('sess');
    const pack = selectedPack();

    // Pure Due-Review mode launched from Ledger ("立即抽查到期词")
    if (mode === 'due_only') {
      const duePick = explicitDueIds && explicitDueIds.length
        ? explicitDueIds
        : SnapCore.getDueQueue(state, SnapCore.todayISO(), 3).todayPick.map(d => d.item.id);
      if (!duePick.length) {
        toast('当前没有到期抽查词');
        return;
      }
      activeSession = {
        sessionId,
        lockedActor,
        mode: 'due_only',
        packId: pack.id,
        packTitle: '课前到期独立复测',
        startedAt: Date.now(),
        step: 'paper', // F02: Directly open independent paper dictation! Never show snap blocks first!
        stepsDone: {},
        dueIds: [...duePick],
        focusIds: [],
        oralOnlyIds: [],
        deferredIds: [],
        paperIds: [...duePick],
        promptMode: 'audio_plus_zh',
        hintedOnPaper: {}, // { [itemId]: true }
        paperPhase: 'dictate', // 'dictate' | 'blind_check' | 'reveal_grade' | 'summary'
        blindChecks: { cap: false, space: false, chunk: false },
        maskedAnswers: {},
        paperGrades: {}, // F01: Empty = 'unjudged'!
        prereadDone: false,
        summary: null
      };
      currentTab = 'learn';
      render();
      await saveState();
      return;
    }

    // Baseline 10-min short test
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
        focusIds: [],
        oralOnlyIds: [],
        deferredIds: [],
        paperIds: [...basePack.itemIds],
        extraSentence: basePack.extraSentence || null,
        altCheckWords: basePack.altCheckWords || [],
        promptMode: 'audio_plus_zh',
        hintedOnPaper: {},
        paperPhase: 'dictate',
        blindChecks: { cap: false, space: false, chunk: false },
        maskedAnswers: {},
        paperGrades: {}, // F01: All start 'unjudged'!
        sentenceNote: '',
        summary: null
      };
      currentTab = 'learn';
      render();
      await saveState();
      return;
    }

    // Standard (15–18m) or Quick8 (8–10m) lesson using F05 Allocation Planner
    const dueLimit = mode === 'quick8' ? 2 : 2;
    const totalPaperCap = mode === 'quick8' ? 3 : 5;
    const dueIds = SnapCore.getDueQueue(state, SnapCore.todayISO(), dueLimit).todayPick.map(d => d.item.id);
    const alloc = SnapCore.planPackAllocation(state, pack.id, pack.itemIds, { totalPaperCap, dueIds });

    // Teaching focus includes tonight's paperNowIds + oralOnlyIds (for listening/reading/snap without forcing paper dictation!)
    const focusIds = [...alloc.paperNowIds, ...alloc.oralOnlyIds];
    const bugCard = SNAPWORD_CURRICULUM.BUG_CARDS.find(b => b.id === pack.bugId) || SNAPWORD_CURRICULUM.BUG_CARDS[0];

    // F02: If there are due review items, Step 0 ('due_precheck') runs FIRST on a clean blind paper prompt BEFORE teaching!
    const initialStep = dueIds.length > 0
      ? 'due_precheck'
      : (mode === 'quick8' ? (focusIds.length ? 'snap' : 'paper') : 'board');

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
      step: initialStep, // 'due_precheck' | 'board' | 'snap' | 'bug' | 'paper'
      stepsDone: {},
      dueIds,
      duePrewritten: false,
      paperNowIds: alloc.paperNowIds,
      oralOnlyIds: alloc.oralOnlyIds,
      deferredIds: alloc.deferredIds,
      focusIds,
      snapIndex: 0,
      snapState: null,
      bugCardId: bugCard.id,
      bugFixed: {},
      bugPickingIdx: null,
      paperIds: alloc.combinedPaperIds.length ? alloc.combinedPaperIds : pack.itemIds.slice(0, 3),
      promptMode: 'audio_plus_zh',
      hintedOnPaper: {},
      paperPhase: 'dictate',
      blindChecks: { cap: false, space: false, chunk: false },
      maskedAnswers: {},
      paperGrades: {}, // F01: All start 'unjudged'!
      summary: null
    };

    initSnapCardState();
    currentTab = 'learn';
    await saveState();
    render();
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
      showCloze: false,
      clozeDone: false,
      clozeFeedback: ''
    };
  }

  function elapsedMinutes() {
    if (!activeSession) return 0;
    return Math.floor((Date.now() - activeSession.startedAt) / 60000);
  }

  function hasAnyJudgedGrades(s) {
    if (!s?.paperGrades) return false;
    return Object.values(s.paperGrades).some(g => g?.outcome && g.outcome !== 'unjudged');
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
    $('#app-main').innerHTML = (views[currentTab] || renderLearnTab)() + (roleSwitchModalOpen ? renderRoleSwitchModal() : '');
    bindEvents();
  }

  function renderRoleSwitchModal() {
    const curLabel = effectiveSessionActor() === 'parent_demo' ? '🛠️ 家长演练试用' : '🎒 学生正式学习';
    const nextLabel = effectiveSessionActor() === 'parent_demo' ? '🎒 学生正式学习' : '🛠️ 家长演练试用';
    return `
      <div class="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="切换身份确认">
        <div class="modal-card">
          <h3 style="margin-top:0">🔒 当前课程已锁定身份：${curLabel}</h3>
          <p class="muted">为防止测试记录与孩子的正式账本串号，已开始的课不能半途改写身份。若要切到<strong>「${nextLabel}」</strong>，请先选择如何处理当前这节课：</p>
          <div class="row" style="margin-top:16px">
            <button type="button" class="btn btn-primary btn-sm" data-role-modal="discard_switch">结束放弃当前课，并切换身份</button>
            <button type="button" class="btn btn-sm" data-role-modal="cancel">取消（继续当前课）</button>
          </div>
        </div>
      </div>
    `;
  }

  // ==================== Tab 1: Lobby & Allocation Preview ====================
  function renderLearnTab() {
    if (activeSession) return renderActiveSession();

    const summary = SnapCore.getStatsSummary(state);
    const dueInfo = SnapCore.getDueQueue(state, SnapCore.todayISO(), 3);
    const pack = selectedPack();
    const dueIds = dueInfo.todayPick.slice(0, 2).map(d => d.item.id);
    const alloc = SnapCore.planPackAllocation(state, pack.id, pack.itemIds, { totalPaperCap: 5, dueIds });
    const hasPausedDraft = Boolean(state.activeDraft && state.activeDraft.lockedActor === state.actorMode);

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

      ${hasPausedDraft ? `
        <div class="card" style="background:#fef3c7;border-color:#f59e0b">
          <div class="row between">
            <div>
              <strong>🔄 发现上次暂存的未完课草稿：</strong>${esc(state.activeDraft.packTitle || '进行中的练习')}
            </div>
            <div class="row">
              <button type="button" class="btn btn-sm btn-primary" data-act="resume-draft">继续完成草稿 →</button>
              <button type="button" class="btn btn-sm" data-act="discard-draft">丢弃草稿</button>
            </div>
          </div>
        </div>
      ` : ''}

      ${summary.pendingVerifyCount ? `
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
        <p class="muted" style="margin:0">若有到期旧词先独立纸写抽查 → 摇句开口读 → 按需拆词/抓臭虫 → 纸本默写与两遍红笔自查。</p>

        <div style="background:var(--surface-soft);padding:16px;border-radius:14px;margin:16px 0">
          <label for="pack-select" style="font-weight:800;display:block;margin-bottom:8px">📚 选择课程包：</label>
          <select id="pack-select" style="width:100%;max-width:580px;font-weight:700">
            ${state.packs.map(p => `<option value="${esc(p.id)}" ${p.id === pack.id ? 'selected' : ''}>${esc(p.title)}（共 ${p.itemIds.length} 项）</option>`).join('')}
          </select>
          <p class="muted" style="margin:8px 0 0">${esc(pack.subtitle || '')}</p>

          ${pack.modeHint !== 'baseline' ? renderAllocationPreview(pack, alloc, dueInfo.todayPick.slice(0, 2)) : ''}
        </div>

        <div class="row">
          ${pack.modeHint === 'baseline' ? `
            <button type="button" class="btn btn-primary" data-start-mode="baseline">📏 开始 10 分钟纸笔基线短测 →</button>
          ` : `
            <button type="button" class="btn btn-primary" data-start-mode="standard">🚀 开始今日闯关（标准 15–18 分钟）→</button>
            <button type="button" class="btn btn-amber" data-start-mode="quick8">⚡ 作业多·8 分钟保底版</button>
          `}
          ${dueInfo.todayPick.length ? `
            <button type="button" class="btn btn-mint" data-start-mode="due_only">📅 仅抽查到期词（${dueInfo.todayPick.length}项独立纸写）</button>
          ` : ''}
          <button type="button" class="btn" data-quick-baseline="1">📏 首次纸笔基线短测</button>
        </div>
      </section>
    `;
  }

  // F02 + F05: Transparent 3-column allocation preview (hides due English answers on shared screen!)
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
        <div class="muted" style="font-weight:700">📋 当晚实际出题预览（为防同屏泄题，此处仅显中文；可根据老师要求调整每项安排）：</div>
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

  // ==================== Active Session Flow ====================
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

    if (s.mode === 'due_only') {
      return `
        <div class="session-bar no-print">
          <div><strong>📅 课前到期词独立纸写抽查（共 ${s.paperIds.length} 项）</strong></div>
          <div class="row">
            <button type="button" class="btn btn-sm" data-act="pause-session">⏸️ 暂存草稿回大厅</button>
            <button type="button" class="btn btn-sm" data-act="abandon-session">放弃退出</button>
          </div>
        </div>
        ${renderPaperStep(s)}
      `;
    }

    const roleText = {
      due_precheck: '✍️ 主控建议：先遮住答案在纸本写完到期词首答（防后续拆词泄题）',
      board: '🎙️ 主控建议：爸爸点黑板 / 父子一起摇句子开口读',
      snap: '🖱️ 主控建议：孩子握鼠标玩磁吸块（爸爸语音听读点拨）',
      bug: '🕵️ 主控建议：孩子点鼠标揪出句子里的拼写臭虫',
      paper: '✍️ 主控建议：纸本手写 + 红笔两遍自查 + 家长按纸面核验'
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
          <button type="button" class="step-pill ${s.step === 'paper' ? 'active' : ''}" data-jump-step="paper">4. 纸写核验 (${s.paperIds.length})</button>
        </div>
        <div class="row">
          <span class="role-indicator">${roleText}</span>
          <button type="button" class="btn btn-sm" data-act="pause-session">⏸️ 暂存草稿</button>
          <button type="button" class="btn btn-sm" data-act="abandon-session">退出</button>
        </div>
      </div>

      ${overBudget ? `
        <div class="bridge-callout no-print" style="margin-bottom:14px">
          ⏰ <strong>温和提醒：本次已满 ${mins} 分钟啦！</strong>可随时进入纸写将剩余未写项标为「未测」顺延下次，保持轻松好状态。
        </div>
      ` : ''}

      ${s.step === 'due_precheck' ? renderDuePrecheckStep(s) : ''}
      ${s.step === 'board' ? renderBoardStep(s) : ''}
      ${s.step === 'snap' ? renderSnapStep(s) : ''}
      ${s.step === 'bug' ? renderBugStep(s) : ''}
      ${s.step === 'paper' ? renderPaperStep(s) : ''}
    `;
  }

  // F02: Step 0 — Blind paper pre-check for ALL due items BEFORE any teaching screen can leak answers!
  function renderDuePrecheckStep(s) {
    const dueItems = s.dueIds.map(itemById).filter(Boolean);
    return `
      <section class="card">
        <div class="row between">
          <div>
            <span class="pill pill-core">Step 0 · 课前到期词无提示纸写抽查（共 ${dueItems.length} 项）</span>
            <h2 style="margin:8px 0 4px">✍️ 先在纸本写下这 ${dueItems.length} 个到期词的首答（黑/蓝笔书写）</h2>
            <p class="muted" style="margin:0">为保证复测真实有效，在写完首答前屏幕不展示任何英文拼写或拆块。写完后再开始今天的新课，最后统一用红笔核对。</p>
          </div>
          <label class="muted" style="font-weight:700">
            出题提示方式：
            <select id="prompt-mode-select">
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
          <span class="muted">纸面留痕建议：请用黑/蓝笔写首答，后续红笔批改时不涂黑原字。</span>
          <button type="button" class="btn btn-mint" data-act="finish-due-precheck">
            ✅ 到期词首答已在纸上写完，进入今日课程 →
          </button>
        </div>
      </section>
    `;
  }

  function renderDictationPromptRow(s, it, idx, isDueBadge) {
    const mode = s.promptMode || 'audio_plus_zh';
    const hinted = Boolean(s.hintedOnPaper?.[it.id]);
    let promptHtml = '';
    if (mode === 'audio_only') {
      promptHtml = `<strong>#${idx + 1}　[纯听写 · 请点右侧播音后书写]</strong>`;
    } else if (mode === 'sentence_context' && it.sentencePrompt) {
      promptHtml = `
        <strong>#${idx + 1}　句中用词：${esc(it.sentencePrompt.zh)}</strong>
        <div class="english" style="font-size:19px;font-weight:800;color:#1e3a8a;margin-top:4px">${esc(it.sentencePrompt.template)}</div>
      `;
    } else {
      promptHtml = `<strong>#${idx + 1}　${esc(it.zh)}</strong>`;
    }

    return `
      <div class="paper-item">
        <div class="row between">
          <div>
            ${promptHtml}
            ${isDueBadge ? '<span class="pill" style="background:#dbeafe;color:#1e40af;margin-left:8px">📅 到期复测</span>' : ''}
            ${hinted ? `<div class="help-callout" style="margin:6px 0 0;padding:6px 10px">💡 已给拆块提示：<b class="english">${esc(it.displayChunks)}</b>（本题将记为“含拼写提示”）</div>` : ''}
          </div>
          <div class="row">
            ${mode !== 'zh_prompt' ? `<button type="button" class="btn btn-sm" data-speak-item="${esc(it.id)}">🔊 听发音</button>` : ''}
            ${!hinted ? `<button type="button" class="btn btn-sm" data-give-paper-hint="${esc(it.id)}" title="实在卡住时可给拆块提示，账本会如实记录含提示">💡 给拆块提示</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  // --- Step 1: Slot Machine Blackboard + Textbook Pre-read Comprehension (F05) ---
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
    const nextStep = s.focusIds.length ? 'snap' : 'bug';

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

  // --- Step 2: Snap-Block Magnetic Word Forging ---
  function renderSnapStep(s) {
    const id = s.focusIds[s.snapIndex];
    const item = itemById(id);
    if (!item) return `<div class="card"><p>本组词已完成。</p><button type="button" class="btn btn-primary" data-jump-step="paper">去纸写核验 →</button></div>`;
    const st = s.snapState;
    const pieces = item.snap?.pieces || [item.en];
    const audioInfo = SnapAudio.resolveSourceInfo(state, item);
    const isOralOnly = s.oralOnlyIds?.includes(item.id);

    return `
      <section class="card">
        <div class="row between" style="margin-bottom:10px">
          <div>
            <span class="pill pill-core">Step 2 · 咔嗒磁吸拆词（第 ${s.snapIndex + 1} / ${s.focusIds.length} 项）</span>
            ${isOralOnly ? '<span class="pill pill-star">🗣️ 本轮仅听读认义（不进纸写默写）</span>' : '<span class="pill pill-core">✍️ 本轮纸写目标词</span>'}
            ${badgeLabel(state.mastery[item.id])}
          </div>
          <button type="button" class="btn btn-sm btn-mint" data-act="skip-to-next-word">
            ⚡ ${isOralOnly ? '已听熟认清意思，下一项 →' : '这词我会写，跳过直接留到纸上验 →'}
          </button>
        </div>

        <div class="word-hero">
          <div class="muted">${isOralOnly ? '听准整词发音、记住中文意思与句中用法即可' : '先听整词发音、看清难写处，再动手吸合磁吸片'}</div>
          <div class="word-zh-big">${esc(item.zh)}</div>
          ${st.hideModel ? `
            <div class="chunk-display" style="color:#64748b;border-style:dashed">🙈 原词已遮住，凭记忆拼出来吧！</div>
          ` : `
            <div class="chunk-display english">${esc(item.displayChunks || item.en)}</div>
          `}
          <div style="margin-top:8px">
            <button type="button" class="btn btn-primary" data-speak-item="${esc(item.id)}">🔊 听完整发音</button>
            <button type="button" class="btn btn-sm" data-act="toggle-model-mask">${st.hideModel ? '👀 看一眼原词' : '🙈 遮住原词盲拼'}</button>
            <span class="audio-tag">${esc(audioInfo.label)}</span>
          </div>
        </div>

        <div class="help-callout"><strong>💡 拆词锦囊：</strong>${esc(item.helpNote)}</div>
        ${item.bridgeNote ? `<div class="bridge-callout"><strong>🔗 顺手串记（只看 1 处）：</strong>${esc(item.bridgeNote)}</div>` : ''}

        <h3 style="margin:12px 0 6px">🧲 咔嗒磁吸槽（按顺序点击下方磁吸片归位）：</h3>
        <div class="snap-tray" aria-label="磁吸拼装槽">
          ${pieces.map((p, idx) => {
            const isFilled = idx < st.filled.length;
            const label = p === '␣' ? '␣ 空格' : p;
            return `<span class="snap-slot english ${isFilled ? 'filled' : ''}" ${isFilled && idx === st.filled.length - 1 && !st.completedSnap ? 'data-act="undo-snap" title="点击撤回最后一块"' : ''}>${isFilled ? esc(label) : (p === '␣' ? '空格' : '？')}</span>`;
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
            🎉 咔嗒合拢成功！完整形式：<span class="english" style="font-size:23px;color:#047857">${esc(item.en)}</span>
          </div>
        `}

        ${item.cloze && !isOralOnly && (st.completedSnap || st.showCloze) ? `
          <div style="background:var(--surface-soft);padding:14px;border-radius:14px;margin-top:10px;text-align:center">
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

        <div class="row between" style="margin-top:14px">
          <div class="row">
            ${item.cloze && !isOralOnly && !st.showCloze && !st.completedSnap ? `<button type="button" class="btn btn-sm" data-act="open-cloze">🎯 只开小挖空试试</button>` : ''}
            ${s.snapIndex > 0 ? `<button type="button" class="btn btn-sm" data-act="prev-word">← 上一项</button>` : ''}
          </div>
          <button type="button" class="btn btn-primary" data-act="next-word">
            ${s.snapIndex + 1 < s.focusIds.length ? '下一项 →' : '拆词完成，下一步 →'}
          </button>
        </div>
      </section>
    `;
  }

  // --- Step 3: Bug Hunter Detective ---
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
          <button type="button" class="btn btn-sm" data-jump-step="paper">跳过热身，直接去纸写 →</button>
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
            🕵️ 所有拼写臭虫都被你拍扁啦！带着这双火眼金睛去纸本默写吧！
          </div>
        ` : ''}

        <div class="row between" style="margin-top:16px">
          <span class="muted">小提示：用鼠标点击黑框里看起来不对劲的英文词！</span>
          <button type="button" class="btn btn-mint" data-complete-step="bug" data-next-step="paper">
            ✍️ 进入纸本默写 (${s.paperIds.length}题) →
          </button>
        </div>
      </section>
    `;
  }

  // --- Step 4: Paper Dictation + Two-Pass Red-Pen Self-Check (F01 + F02) ---
  function renderPaperStep(s) {
    const items = s.paperIds.map(itemById).filter(Boolean);
    // In standard lessons where dueIds were ALREADY written in Step 0 (due_precheck), note them clearly!
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
            <label class="muted" style="font-weight:700">
              出题方式：
              <select id="prompt-mode-select">
                <option value="audio_plus_zh" ${s.promptMode === 'audio_plus_zh' ? 'selected' : ''}>🔊 语音 + 中文</option>
                <option value="audio_only" ${s.promptMode === 'audio_only' ? 'selected' : ''}>🎧 纯听写（隐中文）</option>
                <option value="zh_prompt" ${s.promptMode === 'zh_prompt' ? 'selected' : ''}>🇨🇳 纯中文提取</option>
                <option value="sentence_context" ${s.promptMode === 'sentence_context' ? 'selected' : ''}>📝 句中挖空用词</option>
              </select>
            </label>
          </div>
          <p class="muted" style="margin:4px 0 14px">纸面留痕规则：首答用黑/蓝笔写；写完先不亮答案，下一步拿红笔盲查圈改（保留原字不涂黑，方便家长看照片区分首答与订正）。</p>

          ${s.duePrewritten && s.dueIds.length ? `
            <div class="bridge-callout" style="margin-bottom:12px">
              ✅ 课前 ${s.dueIds.length} 道到期复测题已在 Step 0 写完首答，请接着在同一页纸本写出下面 ${newPaperItems.length} 道新题：
            </div>
          ` : ''}

          <div class="paper-list">
            ${items.map((it, idx) => {
              const isDue = s.dueIds.includes(it.id);
              if (s.duePrewritten && isDue) {
                return `
                  <div class="paper-item row between" style="background:var(--surface-soft)">
                    <div>
                      <strong>#${idx + 1}　${s.promptMode === 'audio_only' ? '[课前纯听写项]' : esc(it.zh)}</strong>
                      <span class="pill" style="background:#d1fae5;color:#065f46;margin-left:8px">📅 到期复测 · 已在课前写完首答</span>
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
              🖊️ 本子上首答全部写完，拿起红笔做第 1 遍盲查 →
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
          <p class="muted" style="margin:0">提醒：这里打勾仅用于引导孩子自查；若这遍发现漏改，请直接用红笔在原词旁改出并标个小星号 ★（独立正确与否以稍后家长核验纸面为准）。</p>

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
              <span>③ 查腰与尾：今天提醒容易漏写的那一截字母和句末标点写上了吗？</span>
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

    // Phase C: reveal_grade — F01 (unjudged start) + F02 (complete mask hides chunks, variants & examples!)
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
        <p class="muted" style="margin:4px 0 14px">说明：每题起始均为「未判定」，必须由家长据纸面照片或同屏观察勾选后才记入账本。</p>

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

  function renderPaperGradeCard(s, it, idx) {
    const g = s.paperGrades[it.id] || { outcome: 'unjudged', tags: [], paperRef: `${SnapCore.todayISO()} #${idx + 1}` };
    const masked = Boolean(s.maskedAnswers[it.id]);
    const hinted = Boolean(s.hintedOnPaper?.[it.id]);
    const isDue = s.dueIds.includes(it.id);
    const targetInfo = SnapCore.getTargetAnswers(it, {
      promptMode: s.promptMode,
      allowAmericanSpelling: state.classSettings?.allowAmericanSpelling
    });
    const isUnjudged = !g.outcome || g.outcome === 'unjudged';

    return `
      <div class="paper-item ${highlightUnjudged && isUnjudged ? 'unjudged-highlight' : ''}" data-grade-card="${esc(it.id)}">
        <div class="row between">
          <div>
            <strong>#${idx + 1}　${esc(s.promptMode === 'sentence_context' && it.sentencePrompt ? it.sentencePrompt.zh : it.zh)}</strong>
            ${isDue ? '<span class="pill" style="background:#dbeafe;color:#1e40af;margin-left:6px">📅 到期复测</span>' : ''}
            ${isUnjudged ? '<span class="pill" style="background:#fef3c7;color:#92400e;margin-left:6px">⚠️ 未判定</span>' : ''}
            ${!masked ? `<span class="muted" style="margin-left:8px">拆块提示：${esc(it.displayChunks || it.en)}</span>` : ''}
          </div>
          <div class="row">
            <button type="button" class="btn btn-sm" data-speak-item="${esc(it.id)}">🔊 发音</button>
            <button type="button" class="btn btn-sm" data-mask-ans="${esc(it.id)}">
              ${masked ? '👀 展开答案' : '🙈 遮住答案重写'}
            </button>
          </div>
        </div>

        ${masked ? `
          <div class="four-line-answer" style="color:#64748b">🙈 整词、拆块与变体已全部遮严！请在纸本空白处凭记忆订正默写一遍（计为当场订正）</div>
        ` : `
          <div class="four-line-answer english">${esc(targetInfo.primary)}</div>
          ${targetInfo.accepted.length > 1 ? `<span class="muted">（本班设置同时接受：${esc(targetInfo.accepted.slice(1).join(' / '))}）</span>` : ''}
          ${it.context?.en ? `<div class="muted english" style="font-size:13.5px">例句参考：${esc(it.context.en)}（${esc(it.context.origin || '')}）</div>` : ''}
        `}

        <div style="margin-top:8px" class="row">
          <label class="muted" style="font-size:13px;display:inline-flex;align-items:center;gap:5px;cursor:pointer">
            <input type="checkbox" data-toggle-hinted="${esc(it.id)}" ${hinted ? 'checked' : ''}>
            💡 交首答前给过词形/拆块提示（勾此项时不作无提示首答计分）
          </label>
          <label class="muted" style="font-size:13px">
            纸本题号备注：
            <input type="text" data-paper-ref="${esc(it.id)}" value="${esc(g.paperRef || `${SnapCore.todayISO()} #${idx + 1}`)}" style="width:140px;padding:3px 7px;font-size:13px">
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
            <span class="muted">记录可见错误类型（客观记录纸面现象）：</span>
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

  // --- Baseline 10-Min Session (F01 compliant: all start 'unjudged', supports partial/untested!) ---
  function renderBaselineSession(s) {
    const items = s.paperIds.map(itemById).filter(Boolean);
    const altItems = (s.altCheckWords || []).map(itemById).filter(Boolean);
    const unjudgedCount = items.filter(it => !s.paperGrades[it.id]?.outcome || s.paperGrades[it.id].outcome === 'unjudged').length;

    if (s.paperPhase === 'dictate') {
      return `
        <section class="card">
          <span class="pill pill-core">首次 10–12 分钟纸笔基线短测（可分批测，未测项如实标“未测”）</span>
          <h2 style="margin:8px 0 4px">📏 请在纸上写出基线样本词（黑/蓝笔书写，允许统一重听 1 次）</h2>
          <p class="muted" style="margin:0 0 14px">收齐全部纸面首答前不展示答案。若今天时间只够测其中 3–4 项，剩余项在下一页标为「未测」即可。</p>
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
            <button type="button" class="btn btn-sm" data-act="abandon-session">取消退出</button>
            <button type="button" class="btn btn-primary" data-paper-phase="reveal_grade">✍️ 首答已收齐，展开逐题判定页 →</button>
          </div>
        </section>
      `;
    }

    return `
      <section class="card">
        <div class="row between">
          <div>
            <span class="pill pill-core">基线首答客观判定（未确认：${unjudgedCount} / ${items.length}）</span>
            <h2 style="margin:8px 0 6px">📋 据纸面首答逐题勾选（起始均为未判定）</h2>
          </div>
          ${unjudgedCount > 0 ? `
            <div class="row">
              <button type="button" class="btn btn-sm" data-batch-rest="pending_verify">📸 剩余标为「待核验」</button>
              <button type="button" class="btn btn-sm" data-batch-rest="untested">⏭️ 剩余标为「未测」</button>
            </div>
          ` : ''}
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

  // F01 + F06: Accurate settlement summary (1/4 ratio, separate blank/untested/pending, truthful storage state!)
  function renderSessionSummary(s) {
    const tally = s.summary?.tally || { independent: 0, denominator: 0, ratioText: '0 / 0', blindSelfFixed: 0, answerCorrected: 0, answeredWrong: 0, hintedCorrect: 0, blank: 0, untested: 0, pendingVerify: 0 };
    const needReviewIds = s.summary?.needReviewIds || [];
    const isDemo = s.lockedActor === 'parent_demo';

    return `
      <section class="card" style="text-align:center;padding:30px 24px">
        <div style="font-size:44px">${lastSaveOk ? '🏅' : '⚠️'}</div>
        <h1 style="margin:8px 0">本轮结算单</h1>
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
              <div class="stat-label">自改(${tally.blindSelfFixed})·订正/错(${tally.answerCorrected + tally.answeredWrong})·提示(${tally.hintedCorrect})</div>
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

  // ==================== Tab 2: Vault & Exact Unit 6 (24 Items) Filter ====================
  let vaultFilter = 'all';
  function renderVaultTab() {
    const u6Official = state.items.filter(it => it.unit === 6 && it.sourceScope === 'textbook_wordlist');
    const u6CoreCount = u6Official.filter(it => it.textbookCore).length;
    const u6StarCount = u6Official.filter(it => !it.textbookCore).length;

    const items = state.items.filter(it => {
      if (vaultFilter === 'u6') return it.unit === 6 && it.sourceScope === 'textbook_wordlist';
      if (vaultFilter === 'u5') return it.unit === 5 && it.sourceScope === 'textbook_wordlist';
      if (vaultFilter === 'bridge') return it.sourceScope === 'foundation_bridge' || it.sourceScope === 'custom';
      if (vaultFilter === 'medals') return (state.mastery[it.id]?.badge || 'none') !== 'none';
      return true;
    });

    return `
      <section class="card">
        <div class="row between">
          <div>
            <h2 style="margin:0 0 4px">🏅 金银铜徽章图鉴 & 词表分层管理</h2>
            <p class="muted" style="margin:0">Unit 6 官方单元词表已核准为 <b>${u6Official.length} 项（核心词 ${u6CoreCount} 项 · 带 * 非核心词 ${u6StarCount} 项）</b>；补基础词独立归入扩展区。</p>
          </div>
          <div class="row">
            <button type="button" class="btn btn-sm ${vaultFilter === 'all' ? 'btn-primary' : ''}" data-vault-filter="all">全部 (${state.items.length})</button>
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
            : `<span class="pill">扩展/家庭补基础</span>`;

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

  // ==================== Tab 3: Ledger, Blind-Safe Due Entry & 4-Way Backup Preview ====================
  function renderLedgerTab() {
    const dueInfo = SnapCore.getDueQueue(state, SnapCore.todayISO(), 3);
    const summary = SnapCore.getStatsSummary(state);
    const pendingEvents = state.events.filter(e => e.actor === 'student' && e.taskType === 'paper_check' && e.verificationStatus === 'pending');
    const recentStudentEvents = state.events.filter(e => e.actor === 'student').slice().reverse().slice(0, 40);

    return `
      ${pendingEvents.length ? `
        <section class="card" style="border-color:#60a5fa;background:#eff6ff">
          <h2 style="margin-top:0">📸 待爸爸看微信照片核验（${pendingEvents.length} 项 · 核验后才计入正式统计）</h2>
          <div class="paper-list">
            ${pendingEvents.map(ev => {
              const it = itemById(ev.itemId);
              return `
                <div class="paper-item row between">
                  <div>
                    <strong>${esc(it?.zh || ev.itemId)}</strong>
                    <span class="muted">（标准词形：<b class="english">${esc(it?.en || '')}</b> · 纸本参考：${esc(ev.paperRef || ev.dateStr)}）</span>
                  </div>
                  <div class="row">
                    <button type="button" class="btn btn-sm btn-mint" data-verify-ev="${esc(ev.id)}" data-verify-out="paper_independent">✅ 核验：首答全对</button>
                    <button type="button" class="btn btn-sm btn-amber" data-verify-ev="${esc(ev.id)}" data-verify-out="blind_self_fixed">🔍 核验：盲查自改</button>
                    <button type="button" class="btn btn-sm" data-verify-ev="${esc(ev.id)}" data-verify-out="answer_corrected">✏️ 核验：有错订正</button>
                    <button type="button" class="btn btn-sm" data-verify-ev="${esc(ev.id)}" data-verify-out="blank">⬜ 核验：纸面空白</button>
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
            <h2 style="margin:0 0 4px">📅 到期复测与优先重抽队列（共 ${dueInfo.totalDue} 项到期 · 暂稳定低频池 ${dueInfo.lowFreqPool.length} 项）</h2>
            <p class="muted" style="margin:0">按首次独立写对当天 D0 排定 <b>D0+1、D0+3、D0+7</b> 三个检查点，三关全过转入低频抽样池；为防孩子同屏瞄见拼写，此处默认隐藏英文答案。</p>
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
        ` : `<p class="muted" style="margin-top:12px">🎉 当前没有到期必抽项！${dueInfo.lowFreqPool.length ? `（另有 ${dueInfo.lowFreqPool.length} 个已过 D+7 的暂稳定词在低频池）` : ''}</p>`}
      </section>

      <section class="card">
        <h2 style="margin:0 0 8px">📊 正式纸笔统计与可见问题分布</h2>
        <p style="margin:0 0 10px;font-weight:700">
          首答独立正确 / 已出题且已核验：<span id="ledger-ratio" class="english" style="font-size:20px;color:var(--primary-dark)">${esc(summary.paperRatioText)}</span>
          <span class="muted" style="font-weight:400;margin-left:12px">
            （其中已测空白：<b>${summary.blankCount}</b> 计入分母 ｜ 另单列未测：<b>${summary.untestedCount}</b> · 待核验：<b>${summary.pendingVerifyCount}</b>）
          </span>
        </p>
        <div class="row">
          ${SNAPWORD_CURRICULUM.ERROR_TAGS.map(t => {
            const count = summary.errorTotals[t.id] || 0;
            return `<span class="pill" style="padding:7px 13px;font-size:13.5px;${count ? 'background:#fee2e2;color:#991b1b' : ''}">${esc(t.label)}：<b>${count}</b></span>`;
          }).join('')}
        </div>
      </section>

      <section class="card">
        <h2 style="margin:0 0 8px">💾 备份导出与差异预览恢复（跨设备保留本机当前角色）</h2>
        <div class="row">
          <button type="button" class="btn btn-primary" data-act="export-json">⬇️ 导出完整 JSON 备份</button>
          <button type="button" class="btn" data-act="trigger-import">📂 选择 JSON 备份预览差异</button>
          <input type="file" id="import-file-input" accept=".json,application/json" hidden>
        </div>
        ${pendingImportPreview ? renderImportPreviewCard(pendingImportPreview) : ''}
        ${state.legacyTypingArchive?.length ? `<p class="muted" style="margin-top:8px">📦 独立保管的旧版键盘打字归档记录：${state.legacyTypingArchive.length} 条（未混入纸笔统计）。</p>` : ''}
      </section>

      <section class="card">
        <h3 style="margin-top:0">🕒 学生正式记录明细（含出题方式、提示状态、施测日与核验人）</h3>
        ${recentStudentEvents.length ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13.5px">
              <thead>
                <tr style="border-bottom:2px solid var(--border);text-align:left">
                  <th style="padding:7px">施测日期</th>
                  <th style="padding:7px">题号/词条</th>
                  <th style="padding:7px">出题与提示</th>
                  <th style="padding:7px">结果</th>
                  <th style="padding:7px">核验状态</th>
                  <th style="padding:7px">可见表现/备注</th>
                </tr>
              </thead>
              <tbody>
                ${recentStudentEvents.map(e => {
                  const it = itemById(e.itemId);
                  return `<tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:7px">${esc(e.dateStr)}</td>
                    <td style="padding:7px"><b>${esc(it?.zh || e.itemId)}</b> <span class="muted">(${esc(e.paperRef || '')})</span></td>
                    <td style="padding:7px">${esc(e.promptMode || '—')}${e.hadSpellingHint ? ' · <span style="color:#b45309;font-weight:700">含拼写提示</span>' : ''}</td>
                    <td style="padding:7px">${esc(e.outcome)}</td>
                    <td style="padding:7px">${esc(e.verificationStatus)} (${esc(e.verifiedBy || '—')})</td>
                    <td style="padding:7px" class="muted">${esc((e.errorTags || []).join(', ') || e.note || '—')}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="muted">暂无正式记录。</p>`}
      </section>
    `;
  }

  function renderImportPreviewCard(preview) {
    if (preview.kind === 'snapword') {
      return `
        <div class="help-callout" style="margin-top:14px">
          <strong>🔍 备份四分类差异预览（导入后将保持本机当前角色「${state.actorMode === 'parent_demo' ? '家长演练' : '学生正式'}」不变）：</strong>
          <ul style="margin:6px 0;padding-left:20px">
            <li>新增正式记录：<b>${preview.added}</b> 条</li>
            <li>完全相同跳过：<b>${preview.identical}</b> 条</li>
            <li>待核验升级为已核验：<b>${preview.verifiedUpgrades}</b> 条</li>
            <li>同 ID 内容冲突：<b>${preview.conflicts}</b> 条（另忽略备份中的演练记录 ${preview.demoEventCount} 条）</li>
          </ul>
          ${preview.conflicts > 0 ? `
            <div style="margin:8px 0">
              冲突处理方式：
              <label style="margin-right:12px"><input type="radio" name="conflict-pol" value="prefer_incoming" ${importConflictPolicy === 'prefer_incoming' ? 'checked' : ''}> 采用导入备份版本</label>
              <label><input type="radio" name="conflict-pol" value="keep_local" ${importConflictPolicy === 'keep_local' ? 'checked' : ''}> 保留本机现有版本</label>
            </div>
          ` : ''}
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

  // ==================== Tab 4: Coach Prep, Variant Policy & F07 Audio Check ====================
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
        <p class="muted">每行按 <code>英文 | 中文</code> 粘贴。若词条已在内置词库（如 <code>classmate</code> 标了“先听读认义”），会自动继承其分层规则，并在大厅预览中明确分流为纸写、认读或下轮候选，绝不静默丢弃超额词条。</p>
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
          <input type="text" id="ac-note" placeholder="记录孩子电脑实机听感（如：Edge合成音清楚、外放音量60%不压微信通话）" value="${esc(chk?.note || '')}" style="flex:1;min-width:260px">
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
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.onclick = () => {
        SnapAudio.stop();
        currentTab = btn.dataset.nav;
        render();
      };
    });

    document.querySelectorAll('[data-goto-tab]').forEach(btn => {
      btn.onclick = async () => {
        SnapAudio.stop();
        if (activeSession?.paperPhase === 'summary') {
          activeSession = null;
          state.activeDraft = null;
          await saveState();
        }
        currentTab = btn.dataset.gotoTab;
        render();
      };
    });

    // F03: Persisted Actor Toggle with Mid-Session Interception
    const actorBtn = $('#actor-toggle');
    if (actorBtn) {
      actorBtn.onclick = async () => {
        if (activeSession && activeSession.paperPhase !== 'summary') {
          roleSwitchModalOpen = true;
          render();
          return;
        }
        activeSession = null;
        state.activeDraft = null;
        state.actorMode = state.actorMode === 'student' ? 'parent_demo' : 'student';
        render();
        await saveState();
        toast(state.actorMode === 'parent_demo' ? '已切至「家长演练模式」（刷新或重开均保持演练身份）' : '已切回「学生正式学习模式」');
      };
    }

    document.querySelectorAll('[data-role-modal]').forEach(btn => {
      btn.onclick = async () => {
        const act = btn.dataset.roleModal;
        roleSwitchModalOpen = false;
        if (act === 'discard_switch') {
          SnapAudio.stop();
          activeSession = null;
          state.activeDraft = null;
          state.actorMode = state.actorMode === 'student' ? 'parent_demo' : 'student';
          await saveState();
          toast('已结束原课并切换至新身份');
        }
        render();
      };
    });

    $('#pack-select')?.addEventListener('change', async e => {
      state.selectedPackId = e.target.value;
      render();
      await saveState();
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

    document.querySelector('[data-act="resume-draft"]')?.addEventListener('click', async () => {
      if (state.activeDraft && state.activeDraft.lockedActor === state.actorMode) {
        activeSession = SnapCore.clone(state.activeDraft);
        activeSession.pausedToLobby = false;
        render();
        await saveState();
      }
    });

    document.querySelector('[data-act="discard-draft"]')?.addEventListener('click', async () => {
      state.activeDraft = null;
      activeSession = null;
      render();
      await saveState();
      toast('已清除未完课草稿');
    });

    document.querySelector('[data-act="pause-session"]')?.addEventListener('click', async () => {
      if (!activeSession) return;
      SnapAudio.stop();
      const paused = SnapCore.clone(activeSession);
      paused.pausedToLobby = true;
      activeSession = null;
      state.activeDraft = paused;
      render();
      await saveState();
      toast('进度已暂存为草稿，可随时继续');
    });

    document.querySelector('[data-act="abandon-session"]')?.addEventListener('click', async () => {
      if (!activeSession) return;
      if (hasAnyJudgedGrades(activeSession)) {
        // Offer safe pause instead of silent loss if grades were ticked
        toast('已将当前未提交草稿暂存至大厅（如需彻底丢弃可在大厅点“丢弃草稿”）');
        const paused = SnapCore.clone(activeSession);
        paused.pausedToLobby = true;
        activeSession = null;
        state.activeDraft = paused;
      } else {
        activeSession = null;
        state.activeDraft = null;
      }
      SnapAudio.stop();
      render();
      await saveState();
    });

    document.querySelector('[data-act="close-summary"]')?.addEventListener('click', async () => {
      activeSession = null;
      state.activeDraft = null;
      render();
      await saveState();
    });

    document.querySelectorAll('[data-jump-step]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        SnapAudio.stop();
        activeSession.step = btn.dataset.jumpStep;
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

    document.querySelector('[data-act="finish-due-precheck"]')?.addEventListener('click', async () => {
      if (!activeSession) return;
      activeSession.duePrewritten = true;
      activeSession.step = activeSession.mode === 'quick8'
        ? (activeSession.focusIds.length ? 'snap' : 'paper')
        : 'board';
      render();
      await saveState();
    });

    $('#prompt-mode-select')?.addEventListener('change', async e => {
      if (!activeSession) return;
      activeSession.promptMode = e.target.value;
      render();
      await saveState();
    });

    document.querySelectorAll('[data-give-paper-hint]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        activeSession.hintedOnPaper = activeSession.hintedOnPaper || {};
        activeSession.hintedOnPaper[btn.dataset.givePaperHint] = true;
        render();
        await saveState();
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
        SnapCore.recordEvent(state, {
          sessionId: activeSession.sessionId,
          actor: activeSession.lockedActor,
          itemId: item.id,
          taskType: 'scaffold_cloze',
          outcome: 'done'
        });
        await saveState();
      } else {
        st.clozeFeedback = `再核对一下这一截（共 ${ans.length} 个字符）`;
      }
      render();
    });

    const advanceSnapWord = async () => {
      if (!activeSession) return;
      if (activeSession.snapIndex + 1 < activeSession.focusIds.length) {
        activeSession.snapIndex++;
        initSnapCardState();
      } else {
        activeSession.stepsDone.snap = true;
        activeSession.step = activeSession.mode === 'quick8' ? 'paper' : 'bug';
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

    // Two-Pass Paper Station
    document.querySelectorAll('[data-paper-phase]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        highlightUnjudged = false;
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
        activeSession.hintedOnPaper = activeSession.hintedOnPaper || {};
        activeSession.hintedOnPaper[chk.dataset.toggleHinted] = chk.checked;
        render();
        await saveState();
      };
    });

    document.querySelectorAll('[data-paper-ref]').forEach(inp => {
      inp.onchange = async () => {
        if (!activeSession) return;
        const id = inp.dataset.paperRef;
        const prev = activeSession.paperGrades[id] || { outcome: 'unjudged', tags: [] };
        activeSession.paperGrades[id] = { ...prev, paperRef: inp.value.trim() };
        await saveState();
      };
    });

    document.querySelectorAll('[data-grade-item]').forEach(btn => {
      btn.onclick = async () => {
        if (!activeSession) return;
        const id = btn.dataset.gradeItem;
        const prev = activeSession.paperGrades[id] || { tags: [], paperRef: `${SnapCore.todayISO()} #${activeSession.paperIds.indexOf(id) + 1}` };
        activeSession.paperGrades[id] = { ...prev, outcome: btn.dataset.outcome };
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
            activeSession.paperGrades[id] = {
              outcome: targetOutcome,
              tags: [],
              paperRef: `${SnapCore.todayISO()} #${idx + 1}`
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
        const g = activeSession.paperGrades[id] || { outcome: 'answer_corrected', tags: [] };
        g.tags = (g.tags || []).includes(tag) ? g.tags.filter(t => t !== tag) : [...(g.tags || []), tag];
        activeSession.paperGrades[id] = g;
        render();
        await saveState();
      };
    });

    $('#baseline-note')?.addEventListener('input', e => {
      if (activeSession) activeSession.sentenceNote = e.target.value;
    });

    // F01: Explicit verification check + Idempotent submission lock
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
        const recordedEvents = [];
        const needReviewIds = [];
        activeSession.paperIds.forEach((id, idx) => {
          const g = activeSession.paperGrades[id];
          const evt = SnapCore.recordEvent(state, {
            sessionId: activeSession.sessionId,
            stageTag: 'paper',
            actor: activeSession.lockedActor,
            recordedBy: 'parent',
            itemId: id,
            questionNo: idx + 1,
            paperRef: g.paperRef || `${SnapCore.todayISO()} #${idx + 1}`,
            promptMode: activeSession.promptMode || 'audio_plus_zh',
            hadSpellingHint: Boolean(activeSession.hintedOnPaper?.[id]),
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
        state.activeDraft = null;
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

    // Ledger actions
    document.querySelectorAll('[data-verify-ev]').forEach(btn => {
      btn.onclick = async () => {
        SnapCore.resolvePendingVerify(state, btn.dataset.verifyEv, btn.dataset.verifyOut);
        render();
        await saveState();
        toast('照片核验已完成，正式统计与徽章已同步更新！');
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
        pendingImportPreview = SnapCore.inspectBackupJSON(parsed, state);
        render();
      } catch (err) {
        toast('无法解析备份：' + err.message);
      } finally {
        e.target.value = '';
      }
    });

    document.querySelectorAll('input[name="conflict-pol"]').forEach(r => {
      r.onchange = () => { importConflictPolicy = r.value; };
    });

    document.querySelector('[data-act="confirm-import-snapword"]')?.addEventListener('click', async () => {
      if (!pendingImportPreview) return;
      state = SnapCore.mergeSnapwordBackup(state, pendingImportPreview.payload, {
        includeDemo: false,
        conflictPolicy: importConflictPolicy
      });
      pendingImportPreview = null;
      render();
      await saveState();
      toast('备份合并完成（已保留本机当前角色并更新核验状态）！');
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

    // Coach Prep & F07 Audio Check
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
        await saveState();
        currentTab = 'learn';
        render();
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

  // Stop speech cleanly on tab hide
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) SnapAudio.stop();
  });

  // Boot
  (async () => {
    await initStorage();
    await saveState();
    render();
  })();
})();
