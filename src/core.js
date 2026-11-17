/* 词哒 · SnapWord Core Pedagogical & Ledger Engine (v0.1.1)
 * Fixes F01–F06:
 * - F01: Mandatory explicit judgment ('unjudged' never auto-passes); 1/4 denominator (blank in denominator; untested & pending_verify separate); idempotent session records; full provenance.
 * - F02: Tracks hadSpellingHint so hinted items never count as unassisted paper_independent.
 * - F03: Persists local actorMode separately from cross-device backup imports; enforces session-locked actor & three role fields (actor, recordedBy, verifiedBy).
 * - F04: Strict D0-anchored checkpoints (D0+1, D0+3, D0+7 -> stabilized low-freq pool); same-night pass after error stays in review; Gold preserved with recentSlip flag on subsequent error.
 * - F05: Separates textbook_wordlist (exact 24 Unit 6 items: 19 core + 5 starred) vs foundation_bridge; connects textbookCore + classRequirement + sessionActivity without silent truncation; context/variant-aware answer resolution.
 * - F06: Restores selectedPackId, boardNotes, activeDraft; versioned event merge (added / identical / verifiedUpgrades / conflicts) + itemHistory snapshots.
 */
const SnapCore = (() => {
  const clone = x => JSON.parse(JSON.stringify(x));

  function normText(s) {
    return String(s ?? '').trim().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ');
  }

  function todayISO(nowMs = Date.now()) {
    const d = new Date(nowMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDaysISO(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  }

  function maxISO(a, b) {
    return a >= b ? a : b;
  }

  function uid(prefix = 'id') {
    const rand = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now()}_${rand}`;
  }

  function hasRequiredCapital(str) {
    return /[A-Z]/.test(str);
  }

  // Context & class-setting aware target answer resolver (F05)
  function getTargetAnswers(item, options = {}) {
    const mode = options.promptMode || 'zh_prompt';
    const allowUS = Boolean(options.allowAmericanSpelling);

    if (mode === 'sentence_context' && item.sentencePrompt?.expected) {
      const primary = normText(item.sentencePrompt.expected);
      const list = [primary];
      if (allowUS && item.usVariant && primary === normText(item.en)) {
        list.push(normText(item.usVariant));
      }
      return { primary, accepted: [...new Set(list)] };
    }

    const primary = normText(item.en);
    const list = [primary, ...(item.acceptedVariants || []).map(normText)];
    if (allowUS && item.usVariant) list.push(normText(item.usVariant));
    if (options.allowSelfPronoun && item.selfVariant) list.push(normText(item.selfVariant));
    return { primary, accepted: [...new Set(list)] };
  }

  function judgeSpelling(item, rawInput, options = {}) {
    const input = normText(rawInput);
    if (!input) return { ok: false, kind: 'blank', suggestedTag: null };

    const { primary, accepted } = getTargetAnswers(item, options);
    const strictCase = accepted.some(hasRequiredCapital);

    for (let i = 0; i < accepted.length; i++) {
      const t = accepted[i];
      if (input === t || (!strictCase && input.toLowerCase() === t.toLowerCase())) {
        return {
          ok: true,
          kind: t === primary || (!strictCase && t.toLowerCase() === primary.toLowerCase()) ? 'exact' : 'variant',
          matched: t,
          note: i === 0 ? '' : `已按设置接受变体「${t}」（主词条：${primary}）`
        };
      }
    }

    // Check unaccepted American / pronoun variant for clear feedback
    if (item.usVariant && input.toLowerCase() === normText(item.usVariant).toLowerCase()) {
      return { ok: false, kind: 'us_variant_blocked', suggestedTag: 'letter_swap', note: `当前按江苏教材要求英式拼写「${item.en}」` };
    }
    if (item.selfVariant && input.toLowerCase() === normText(item.selfVariant).toLowerCase()) {
      return { ok: false, kind: 'pronoun_mismatch', suggestedTag: 'word_choice', note: `请留意本题人称提示，应写「${primary}」` };
    }

    for (const t of accepted) {
      if (input.toLowerCase() === t.toLowerCase()) {
        return { ok: false, kind: 'case_missing', suggestedTag: 'case_missing' };
      }
    }

    const inputNoSpace = input.toLowerCase().replace(/\s+/g, '');
    for (const t of accepted) {
      if (t.includes(' ') && inputNoSpace === t.toLowerCase().replace(/\s+/g, '')) {
        return { ok: false, kind: 'space_missing', suggestedTag: 'space_missing' };
      }
    }

    return { ok: false, kind: 'spelling', suggestedTag: 'missing_letter' };
  }

  function emptyMastery() {
    return {
      badge: 'none', // 'none' | 'bronze' | 'silver' | 'gold'
      anchorD0: null,
      checkpointIdx: 0, // 0: none/relearn, 1: waiting D0+1, 2: waiting D0+3, 3: waiting D0+7, 4: stabilized
      stabilized: false,
      recentSlip: false,
      lastPassDate: null,
      lastFailDate: null,
      independentDates: [],
      nextDueDate: null,
      needsReview: false,
      lastOutcome: null,
      lastAt: 0,
      errorCounts: {}
    };
  }

  const BADGE_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 };
  function maxBadge(a, b) {
    return (BADGE_RANK[b] || 0) > (BADGE_RANK[a] || 0) ? b : a;
  }

  function freshState(curriculum) {
    return {
      app: 'snapword',
      schema: 1,
      profile: {
        nickname: '小探索家',
        budgetMinutes: 18
      },
      classSettings: {
        allowAmericanSpelling: false
      },
      actorMode: 'student', // 'student' | 'parent_demo'
      selectedPackId: 'pack-autumn-1',
      packOverrides: {}, // { [packId]: { [itemId]: 'paper_dictation' | 'oral_only' | 'next_candidate' } }
      items: clone(curriculum.ITEMS),
      itemHistory: [], // Archived snapshots when an item is edited
      packs: clone(curriculum.PACKS),
      events: [],
      mastery: {},
      activeDraft: null,
      boardNotes: [
        {
          id: 'bn_welcome',
          en: 'I play football with my friends on Saturday.',
          zh: '我在星期六和朋友们一起踢足球。',
          highlight: 'with',
          at: 1794915000000
        }
      ],
      audioCheckLog: null,
      legacyTypingArchive: [],
      recordings: {}
    };
  }

  const VERIFIED_DENOMINATOR_OUTCOMES = new Set([
    'paper_independent',
    'hinted_correct',
    'blind_self_fixed',
    'answer_corrected',
    'answered_wrong',
    'blank'
  ]);

  function normalizePaperOutcome(outcome, hadSpellingHint) {
    if (outcome === 'paper_independent' && hadSpellingHint) {
      return 'hinted_correct';
    }
    return outcome;
  }

  // F01 + F04: Strict D0-anchored mastery & slip state machine
  function applyEventToMastery(m, evt) {
    if (evt.actor !== 'student') return m;
    if (evt.verificationStatus === 'pending' || evt.verificationStatus === 'rejected') {
      const pendingNext = m ? clone(m) : emptyMastery();
      if (evt.verificationStatus === 'pending') pendingNext.lastOutcome = 'pending_verify';
      return pendingNext;
    }

    const next = m ? clone(m) : emptyMastery();
    const dateStr = evt.dateStr || todayISO(evt.timestamp);
    next.lastAt = Math.max(next.lastAt || 0, evt.timestamp || 0);

    for (const tag of (evt.errorTags || [])) {
      next.errorCounts[tag] = (next.errorCounts[tag] || 0) + 1;
    }

    if (['scaffold_snap', 'scaffold_cloze', 'read_aloud', 'oral_comprehension'].includes(evt.taskType)) {
      next.badge = maxBadge(next.badge, 'bronze');
      return next;
    }

    if (evt.taskType !== 'paper_check') return next;

    const rawOutcome = evt.outcome;
    if (!rawOutcome || rawOutcome === 'unjudged' || rawOutcome === 'untested' || rawOutcome === 'pending_verify') {
      if (rawOutcome === 'untested' || rawOutcome === 'pending_verify') next.lastOutcome = rawOutcome;
      return next;
    }

    const effectiveOutcome = normalizePaperOutcome(rawOutcome, Boolean(evt.hadSpellingHint));
    next.lastOutcome = effectiveOutcome;

    if (effectiveOutcome === 'paper_independent') {
      // F04 Critical Rule: If this word ALREADY failed/needed help earlier on the SAME dateStr,
      // same-night re-writing is consolidation, NOT an unassisted cross-day pass!
      if (next.lastFailDate === dateStr) {
        next.badge = maxBadge(next.badge, 'bronze');
        next.needsReview = true;
        next.nextDueDate = addDaysISO(dateStr, 1);
        return next;
      }

      // Same-day duplicate independent pass does not advance checkpoint stage
      if (next.lastPassDate === dateStr) {
        return next;
      }

      next.lastPassDate = dateStr;
      if (!next.independentDates.includes(dateStr)) {
        next.independentDates.push(dateStr);
        next.independentDates.sort();
      }

      if (next.independentDates.length >= 2) {
        next.badge = maxBadge(next.badge, 'gold');
      } else {
        next.badge = maxBadge(next.badge, 'silver');
      }

      next.recentSlip = false;

      if (next.needsReview || !next.anchorD0 || next.checkpointIdx === 0) {
        // Establish fresh D0 anchor
        next.anchorD0 = dateStr;
        next.checkpointIdx = 1; // Next check: D0 + 1
        next.stabilized = false;
        next.needsReview = false;
        next.nextDueDate = addDaysISO(dateStr, 1);
      } else if (next.checkpointIdx === 1) {
        // Passed D0 + 1 -> schedule D0 + 3
        next.checkpointIdx = 2;
        next.needsReview = false;
        const target = addDaysISO(next.anchorD0, 3);
        next.nextDueDate = target > dateStr ? target : addDaysISO(dateStr, 2);
      } else if (next.checkpointIdx === 2) {
        // Passed D0 + 3 -> schedule D0 + 7
        next.checkpointIdx = 3;
        next.needsReview = false;
        const target = addDaysISO(next.anchorD0, 7);
        next.nextDueDate = target > dateStr ? target : addDaysISO(dateStr, 4);
      } else {
        // Passed D0 + 7 -> Graduate to 'stabilized' (exits mandatory daily queue, enters low-freq sampling)
        next.checkpointIdx = 4;
        next.stabilized = true;
        next.needsReview = false;
        next.nextDueDate = null;
      }
      return next;
    }

    // Non-independent outcomes: hinted_correct, blind_self_fixed, answer_corrected, answered_wrong, blank
    if (['blind_self_fixed', 'answer_corrected', 'hinted_correct'].includes(effectiveOutcome)) {
      next.badge = maxBadge(next.badge, 'bronze');
    }

    if (effectiveOutcome !== 'hinted_correct') {
      next.lastFailDate = dateStr;
      if (next.badge === 'gold' || next.stabilized || next.checkpointIdx > 0) {
        next.recentSlip = true;
      }
    }

    next.anchorD0 = null;
    next.checkpointIdx = 0;
    next.stabilized = false;
    next.needsReview = true;
    next.nextDueDate = maxISO(dateStr, next.nextDueDate ? dateStr : dateStr);
    return next;
  }

  function rebuildMastery(state) {
    const mastery = {};
    const sorted = [...state.events].sort((a, b) => (a.timestamp - b.timestamp) || String(a.id).localeCompare(String(b.id)));
    for (const evt of sorted) {
      if (evt.actor !== 'student') continue;
      const updated = applyEventToMastery(mastery[evt.itemId], evt);
      if (updated) mastery[evt.itemId] = updated;
    }
    state.mastery = mastery;
    return mastery;
  }

  function recordEvent(state, payload) {
    if (!payload || !payload.itemId) throw new Error('recordEvent requires itemId');
    if (payload.taskType === 'paper_check' && (!payload.outcome || payload.outcome === 'unjudged')) {
      return null; // F01: Never write unjudged items
    }

    const now = payload.timestamp ?? Date.now();
    const dateStr = payload.dateStr ?? todayISO(now);
    const actor = payload.actor || 'student';
    const item = state.items.find(x => x.id === payload.itemId);
    const hadSpellingHint = Boolean(payload.hadSpellingHint);
    const rawOutcome = payload.outcome || 'done';
    const finalOutcome = payload.taskType === 'paper_check'
      ? normalizePaperOutcome(rawOutcome, hadSpellingHint)
      : rawOutcome;

    const deterministicId = payload.id || (
      payload.sessionId && payload.taskType === 'paper_check'
        ? `pevt_${payload.sessionId}_${payload.stageTag || 'main'}_${payload.itemId}`
        : uid('evt')
    );

    const isPending = finalOutcome === 'pending_verify';
    const verificationStatus = isPending ? 'pending' : (payload.verificationStatus || 'verified');
    const verifiedBy = actor === 'parent_demo' ? 'demo' : (isPending ? 'pending' : (payload.verifiedBy || 'parent'));

    const existingIdx = state.events.findIndex(e => e.id === deterministicId);
    const evt = {
      id: deterministicId,
      rev: existingIdx >= 0 ? (state.events[existingIdx].rev || 1) + 1 : (payload.rev || 1),
      updatedAt: now,
      sessionId: payload.sessionId || null,
      stageTag: payload.stageTag || null,
      timestamp: existingIdx >= 0 ? state.events[existingIdx].timestamp : now,
      dateStr,
      isoTime: new Date(now).toISOString(),
      actor, // 'student' | 'parent_demo'
      recordedBy: payload.recordedBy || 'parent',
      verifiedBy,
      verificationStatus,
      itemId: payload.itemId,
      itemVersion: item?.version ?? 1,
      paperRef: payload.paperRef || `${dateStr} #${payload.questionNo || 1}`,
      promptMode: payload.promptMode || 'audio_plus_zh',
      hadSpellingHint,
      taskType: payload.taskType,
      outcome: finalOutcome,
      errorTags: Array.isArray(payload.errorTags) ? [...new Set(payload.errorTags)] : [],
      note: String(payload.note ?? '').slice(0, 300)
    };

    if (existingIdx >= 0) {
      state.events[existingIdx] = evt;
      rebuildMastery(state);
    } else {
      state.events.push(evt);
      if (actor === 'student') {
        const updated = applyEventToMastery(state.mastery[evt.itemId], evt);
        if (updated) state.mastery[evt.itemId] = updated;
      }
    }
    return evt;
  }

  function resolvePendingVerify(state, eventId, finalOutcome, errorTags = [], note = '') {
    const evt = state.events.find(e => e.id === eventId);
    if (!evt || !VERIFIED_DENOMINATOR_OUTCOMES.has(finalOutcome)) return null;
    evt.outcome = normalizePaperOutcome(finalOutcome, evt.hadSpellingHint);
    evt.errorTags = Array.isArray(errorTags) ? [...new Set(errorTags)] : [];
    evt.verificationStatus = 'verified';
    evt.verifiedBy = 'parent';
    evt.rev = (evt.rev || 1) + 1;
    evt.updatedAt = Date.now();
    if (note) evt.note = String(note).slice(0, 300);
    rebuildMastery(state);
    return evt;
  }

  // F01: Exact batch tally helper (used by both session settlement and ledger)
  function summarizePaperEvents(events) {
    let independent = 0;
    let hintedCorrect = 0;
    let blindSelfFixed = 0;
    let answerCorrected = 0;
    let answeredWrong = 0;
    let blank = 0;
    let untested = 0;
    let pendingVerify = 0;

    for (const e of events) {
      if (e.taskType !== 'paper_check') continue;
      if (e.verificationStatus === 'pending' || e.outcome === 'pending_verify') {
        pendingVerify++;
        continue;
      }
      switch (e.outcome) {
        case 'paper_independent': independent++; break;
        case 'hinted_correct': hintedCorrect++; break;
        case 'blind_self_fixed': blindSelfFixed++; break;
        case 'answer_corrected': answerCorrected++; break;
        case 'answered_wrong': answeredWrong++; break;
        case 'blank': blank++; break;
        case 'untested': untested++; break;
        default: break;
      }
    }

    const denominator = independent + hintedCorrect + blindSelfFixed + answerCorrected + answeredWrong + blank;
    return {
      independent,
      hintedCorrect,
      blindSelfFixed,
      answerCorrected,
      answeredWrong,
      blank,
      untested,
      pendingVerify,
      denominator,
      ratioText: `${independent} / ${denominator}`
    };
  }

  // F04: Due queue (priority 1: needsReview / recentSlip; priority 2: D0+1/3/7 due; separate lowFreqPool for stabilized)
  function getDueQueue(state, dateStr = todayISO(), limit = 3) {
    const candidates = [];
    const lowFreqPool = [];

    for (const item of state.items) {
      const m = state.mastery[item.id];
      if (!m) continue;
      if (m.stabilized && !m.needsReview) {
        lowFreqPool.push({ item, m });
        continue;
      }
      if (m.needsReview) {
        const reason = m.recentSlip
          ? '最近失手，下次课优先复测'
          : '上次订正/含提示/留白，优先独立复测';
        candidates.push({ item, m, priority: 1, reason });
      } else if (m.nextDueDate && m.nextDueDate <= dateStr) {
        const label = m.checkpointIdx === 1 ? `D+1 隔日抽查（D0=${m.anchorD0}）`
          : m.checkpointIdx === 2 ? `D+3 巩固抽查（D0=${m.anchorD0}）`
          : `D+7 稳定抽查（D0=${m.anchorD0}）`;
        candidates.push({ item, m, priority: 2, reason: label });
      }
    }

    candidates.sort((a, b) =>
      a.priority - b.priority ||
      String(a.m.nextDueDate || '').localeCompare(String(b.m.nextDueDate || '')) ||
      (a.m.lastAt - b.m.lastAt)
    );

    return {
      todayPick: candidates.slice(0, limit),
      allDue: candidates,
      totalDue: candidates.length,
      lowFreqPool
    };
  }

  function getStatsSummary(state) {
    let bronze = 0, silver = 0, gold = 0, goldSlip = 0, stabilizedCount = 0;
    for (const item of state.items) {
      const m = state.mastery[item.id];
      const b = m?.badge || 'none';
      if (b === 'bronze') bronze++;
      else if (b === 'silver') silver++;
      else if (b === 'gold') {
        gold++;
        if (m?.recentSlip) goldSlip++;
      }
      if (m?.stabilized) stabilizedCount++;
    }

    const studentPaperEvents = state.events.filter(e => e.actor === 'student' && e.taskType === 'paper_check');
    const paperBreakdown = summarizePaperEvents(studentPaperEvents);

    const errorTotals = {};
    for (const e of state.events) {
      if (e.actor !== 'student' || e.verificationStatus === 'pending') continue;
      for (const t of (e.errorTags || [])) {
        errorTotals[t] = (errorTotals[t] || 0) + 1;
      }
    }

    return {
      bronze,
      silver,
      gold,
      goldSlip,
      stabilizedCount,
      totalBadges: bronze + silver + gold,
      paperTestedCount: paperBreakdown.denominator,
      independentPass: paperBreakdown.independent,
      blankCount: paperBreakdown.blank,
      untestedCount: paperBreakdown.untested,
      pendingVerifyCount: paperBreakdown.pendingVerify,
      paperRatioText: paperBreakdown.ratioText,
      errorTotals
    };
  }

  // F05: Derive default session activity from classRequirement + textbookCore + packOverrides
  function defaultActivityForItem(item, packOverride) {
    if (packOverride) return packOverride;
    if (item.classRequirement === 'dictation_verified') return 'paper_dictation';
    if (item.classRequirement === 'read_meaning_use') return 'oral_only';
    // 'unverified_family': default core/custom/bridge words selected in a pack to practice dictation, starred to oral
    return item.textbookCore === false && item.sourceScope === 'textbook_wordlist'
      ? 'oral_only'
      : 'paper_dictation';
  }

  function planPackAllocation(state, packId, itemIds, options = {}) {
    const totalPaperCap = options.totalPaperCap ?? 5;
    const dueIds = options.dueIds || [];
    const remainingPaperSlots = Math.max(1, totalPaperCap - dueIds.length);
    const overrides = state.packOverrides?.[packId] || {};

    const paperNowIds = [];
    const oralOnlyIds = [];
    const deferredIds = [];

    for (const id of itemIds) {
      if (dueIds.includes(id)) continue;
      const it = state.items.find(x => x.id === id);
      if (!it) continue;
      const act = defaultActivityForItem(it, overrides[id]);
      if (act === 'oral_only') {
        oralOnlyIds.push(id);
      } else if (act === 'next_candidate') {
        deferredIds.push(id);
      } else {
        if (paperNowIds.length < remainingPaperSlots) {
          paperNowIds.push(id);
        } else {
          deferredIds.push(id);
        }
      }
    }

    return {
      dueIds: [...dueIds],
      paperNowIds,
      oralOnlyIds,
      deferredIds,
      combinedPaperIds: [...dueIds, ...paperNowIds]
    };
  }

  // Update item with version archive (F06)
  function updateCurriculumItem(state, itemId, patch) {
    const idx = state.items.findIndex(x => x.id === itemId);
    if (idx < 0) return null;
    const current = state.items[idx];
    const contentChanged = (patch.en && normText(patch.en) !== normText(current.en)) ||
      (patch.zh && normText(patch.zh) !== normText(current.zh));

    if (contentChanged) {
      state.itemHistory = state.itemHistory || [];
      state.itemHistory.push({
        id: current.id,
        version: current.version || 1,
        en: current.en,
        zh: current.zh,
        acceptedVariants: clone(current.acceptedVariants || []),
        archivedAt: Date.now()
      });
    }

    const updated = {
      ...current,
      ...patch,
      version: contentChanged ? (current.version || 1) + 1 : (current.version || 1)
    };
    state.items[idx] = updated;
    return updated;
  }

  function suggestItemFromPair(enRaw, zhRaw, index = 0) {
    const en = normText(enRaw);
    const zh = normText(zhRaw);
    const isPhrase = en.includes(' ');
    let pieces = [];
    let cloze = null;

    if (isPhrase) {
      const words = en.split(' ');
      words.forEach((w, idx) => {
        if (idx > 0) pieces.push('␣');
        pieces.push(w);
      });
      const lastWord = words[words.length - 1];
      const prefix = words.slice(0, -1).join(' ') + ' ';
      cloze = { prefix, blank: lastWord, suffix: '', hint: '补全最后一个词' };
    } else if (en.length <= 4) {
      pieces = [en.slice(0, Math.ceil(en.length / 2)), en.slice(Math.ceil(en.length / 2))].filter(Boolean);
      cloze = { prefix: en[0], blank: en.slice(1), suffix: '', hint: '补全剩余字母' };
    } else {
      const cut1 = Math.max(2, Math.floor(en.length / 3));
      const cut2 = Math.max(cut1 + 1, Math.floor((en.length * 2) / 3));
      pieces = [en.slice(0, cut1), en.slice(cut1, cut2), en.slice(cut2)].filter(Boolean);
      cloze = { prefix: en.slice(0, cut1), blank: en.slice(cut1, cut2), suffix: en.slice(cut2), hint: '补全中间容易漏掉的一截' };
    }

    const decoys = [];
    if (hasRequiredCapital(en[0])) {
      decoys.push({ text: pieces[0].toLowerCase(), tip: '🎩 这个词开头需要首字母大写哦！' });
    }
    if (isPhrase) {
      decoys.push({ text: en.replace(/\s+/g, ''), tip: '✂️ 词与词之间记得留出空格 ␣ 哦！' });
    }

    return {
      id: uid('custom_' + index),
      version: 1,
      unit: 0,
      sourceScope: 'custom',
      bookPage: null,
      textbookCore: false,
      classRequirement: 'unverified_family',
      type: isPhrase ? 'phrase' : 'word',
      en,
      acceptedVariants: [],
      zh,
      helpKind: isPhrase ? 'word_boundary' : 'spelling_focus',
      displayChunks: isPhrase ? en.replace(/\s+/g, ' ␣ ') : pieces.join(' ｜ '),
      helpNote: isPhrase ? '先整句听读，注意词间留空。' : '先整词听读，留意分段拼写难点。',
      bridgeNote: '家庭试排练习词条（可在词库标注本班要求）。',
      snap: { pieces, decoys },
      cloze,
      sentencePrompt: { template: `Please write: ______ (${zh})`, zh, expected: en },
      context: { en, zh, origin: '家长自定义任务' }
    };
  }

  function parseQuickLessonLines(rawText) {
    const lines = String(rawText ?? '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    if (!lines.length) throw new Error('请输入至少一行“英文 | 中文”内容');
    if (lines.length > 40) throw new Error('单次快速粘贴最多支持 40 项（可勾选分配当晚纸写与下轮候选）');

    const seen = new Set();
    return lines.map((line, i) => {
      const parts = line.split(/[|｜\t]/).map(s => s.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        throw new Error(`第 ${i + 1} 行格式有误，请按“英文 | 中文”填写`);
      }
      const key = normText(parts[0]).toLowerCase();
      if (seen.has(key)) throw new Error(`第 ${i + 1} 行「${parts[0]}」在本组中重复了`);
      seen.add(key);
      return { en: normText(parts[0]), zh: normText(parts[1]) };
    });
  }

  function eventContentEqual(a, b) {
    return a.outcome === b.outcome &&
      a.verificationStatus === b.verificationStatus &&
      JSON.stringify(a.errorTags || []) === JSON.stringify(b.errorTags || []) &&
      (a.note || '') === (b.note || '');
  }

  // F03 + F06: Restore local machine snapshot (preserves actorMode, selectedPackId, activeDraft, boardNotes!)
  function restoreLocalState(curriculum, saved) {
    const base = freshState(curriculum);
    if (!saved || saved.app !== 'snapword') return base;

    const merged = mergeSnapwordBackup(base, saved, { includeDemo: true, conflictPolicy: 'prefer_incoming' });
    merged.actorMode = saved.actorMode === 'parent_demo' ? 'parent_demo' : 'student';
    if (saved.selectedPackId && merged.packs.some(p => p.id === saved.selectedPackId)) {
      merged.selectedPackId = saved.selectedPackId;
    }
    if (saved.packOverrides && typeof saved.packOverrides === 'object') {
      merged.packOverrides = clone(saved.packOverrides);
    }
    if (saved.classSettings && typeof saved.classSettings === 'object') {
      merged.classSettings = { ...merged.classSettings, ...saved.classSettings };
    }
    if (saved.audioCheckLog) {
      merged.audioCheckLog = clone(saved.audioCheckLog);
    }
    if (saved.activeDraft && saved.activeDraft.lockedActor === merged.actorMode) {
      merged.activeDraft = clone(saved.activeDraft);
    } else {
      merged.activeDraft = null;
    }
    return merged;
  }

  // F06: Detailed 4-way diff preview for SnapWord backups + Legacy isolation
  function inspectBackupJSON(rawObj, currentState) {
    if (!rawObj || typeof rawObj !== 'object') throw new Error('不是有效的 JSON 备份文件');

    if (rawObj.app === 'snapword' && rawObj.schema === 1) {
      if (!Array.isArray(rawObj.items) || !Array.isArray(rawObj.packs) || !Array.isArray(rawObj.events)) {
        throw new Error('词哒备份结构不完整');
      }
      const localMap = new Map(currentState.events.map(e => [e.id, e]));
      const studentEvents = rawObj.events.filter(e => e.actor === 'student');
      const demoEvents = rawObj.events.filter(e => e.actor !== 'student');

      let added = 0, identical = 0, verifiedUpgrades = 0, conflicts = 0;
      for (const inc of studentEvents) {
        const loc = localMap.get(inc.id);
        if (!loc) {
          added++;
        } else if (eventContentEqual(loc, inc)) {
          identical++;
        } else if (loc.verificationStatus === 'pending' && inc.verificationStatus === 'verified') {
          verifiedUpgrades++;
        } else if (inc.verificationStatus === 'pending' && loc.verificationStatus === 'verified') {
          identical++; // Local is already verified; keep local without conflict
        } else {
          conflicts++;
        }
      }

      return {
        kind: 'snapword',
        itemCount: rawObj.items.length,
        packCount: rawObj.packs.length,
        studentEventCount: studentEvents.length,
        demoEventCount: demoEvents.length,
        added,
        identical,
        verifiedUpgrades,
        conflicts,
        payload: rawObj
      };
    }

    if (rawObj.schema === 1 && Array.isArray(rawObj.words) && Array.isArray(rawObj.events)) {
      return {
        kind: 'legacy_extraction',
        wordCount: rawObj.words.length,
        typingEventCount: rawObj.events.length,
        warning: '检测到旧版《词汇撤离》备份。词条将提取至扩展词库；旧键盘打字记录将独立保存在「旧版键盘归档区」，绝不混入学生纸笔正式账本。',
        payload: rawObj
      };
    }

    throw new Error('无法识别的备份格式（仅支持词哒 SnapWord 或旧版词汇撤离 JSON）');
  }

  // F03 + F06: Cross-device backup merge (NEVER overwrites local actorMode!)
  function mergeSnapwordBackup(currentState, backupObj, options = {}) {
    const includeDemo = Boolean(options.includeDemo);
    const conflictPolicy = options.conflictPolicy || 'prefer_incoming'; // 'prefer_incoming' | 'keep_local'
    const next = clone(currentState);
    const preservedActorMode = next.actorMode; // F03: Keep local machine's selected role!

    if (backupObj.profile?.nickname) next.profile.nickname = String(backupObj.profile.nickname).slice(0, 24);
    if (Number.isFinite(backupObj.profile?.budgetMinutes)) next.profile.budgetMinutes = backupObj.profile.budgetMinutes;
    if (backupObj.classSettings && typeof backupObj.classSettings === 'object') {
      next.classSettings = { ...next.classSettings, ...backupObj.classSettings };
    }
    if (backupObj.packOverrides && typeof backupObj.packOverrides === 'object') {
      next.packOverrides = { ...next.packOverrides, ...backupObj.packOverrides };
    }

    // Merge itemHistory
    const histKey = h => `${h.id}@v${h.version}`;
    const histMap = new Map((next.itemHistory || []).map(h => [histKey(h), h]));
    for (const h of (backupObj.itemHistory || [])) {
      if (h?.id) histMap.set(histKey(h), h);
    }
    next.itemHistory = [...histMap.values()];

    // Merge items (preserve user classRequirement edits and higher versions)
    const itemMap = new Map(next.items.map(it => [it.id, it]));
    for (const it of backupObj.items) {
      if (!it?.id || !it?.en) continue;
      const existing = itemMap.get(it.id);
      if (!existing) {
        itemMap.set(it.id, it);
      } else if ((it.version || 1) > (existing.version || 1)) {
        // Archive older version if not yet archived
        if (!histMap.has(histKey(existing))) {
          next.itemHistory.push({
            id: existing.id,
            version: existing.version || 1,
            en: existing.en,
            zh: existing.zh,
            acceptedVariants: clone(existing.acceptedVariants || []),
            archivedAt: Date.now()
          });
        }
        itemMap.set(it.id, it);
      } else if ((it.version || 1) === (existing.version || 1) && it.classRequirement) {
        itemMap.set(it.id, { ...existing, classRequirement: it.classRequirement });
      }
    }
    next.items = [...itemMap.values()];

    // Merge packs
    const packMap = new Map(next.packs.map(p => [p.id, p]));
    for (const p of backupObj.packs) {
      if (p?.id && Array.isArray(p.itemIds)) packMap.set(p.id, p);
    }
    next.packs = [...packMap.values()];

    // Merge boardNotes (F06 fix!)
    if (Array.isArray(backupObj.boardNotes)) {
      const noteMap = new Map((next.boardNotes || []).map(n => [n.id, n]));
      for (const n of backupObj.boardNotes) {
        if (n?.id && n?.en) noteMap.set(n.id, n);
      }
      next.boardNotes = [...noteMap.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30);
    }

    // Merge events with pending -> verified upgrade & conflict policy (F06 fix!)
    const eventMap = new Map(next.events.map(e => [e.id, e]));
    for (const inc of backupObj.events) {
      if (!inc?.id || !inc?.itemId) continue;
      if (!includeDemo && inc.actor !== 'student') continue;
      const loc = eventMap.get(inc.id);
      if (!loc) {
        eventMap.set(inc.id, inc);
      } else if (eventContentEqual(loc, inc)) {
        continue;
      } else if (loc.verificationStatus === 'pending' && inc.verificationStatus === 'verified') {
        // Always upgrade pending -> verified!
        eventMap.set(inc.id, { ...inc, rev: Math.max((loc.rev || 1) + 1, inc.rev || 2) });
      } else if (inc.verificationStatus === 'pending' && loc.verificationStatus === 'verified') {
        continue; // Keep local verified
      } else if ((inc.rev || 1) > (loc.rev || 1)) {
        eventMap.set(inc.id, inc);
      } else if ((inc.rev || 1) === (loc.rev || 1) && conflictPolicy === 'prefer_incoming') {
        eventMap.set(inc.id, inc);
      }
    }
    next.events = [...eventMap.values()].sort((a, b) => (a.timestamp - b.timestamp) || String(a.id).localeCompare(String(b.id)));

    if (backupObj.recordings && typeof backupObj.recordings === 'object') {
      next.recordings = { ...next.recordings, ...backupObj.recordings };
    }
    if (Array.isArray(backupObj.legacyTypingArchive) && backupObj.legacyTypingArchive.length) {
      const archIds = new Set((next.legacyTypingArchive || []).map(x => x.id));
      for (const x of backupObj.legacyTypingArchive) {
        if (x?.id && !archIds.has(x.id)) {
          next.legacyTypingArchive.push(x);
          archIds.add(x.id);
        }
      }
    }

    next.actorMode = preservedActorMode;
    rebuildMastery(next);
    return next;
  }

  function importLegacyWordsOnly(currentState, legacyObj) {
    const next = clone(currentState);
    const knownEn = new Set(next.items.map(i => normText(i.en).toLowerCase()));
    const matchedOrAddedIds = [];

    legacyObj.words.forEach((w, idx) => {
      if (!w?.en || !w?.zh) return;
      const key = normText(w.en).toLowerCase();
      const existing = next.items.find(i => normText(i.en).toLowerCase() === key);
      if (existing) {
        matchedOrAddedIds.push(existing.id);
      } else if (!knownEn.has(key)) {
        const created = suggestItemFromPair(w.en, w.zh, idx);
        if (w.tip) created.helpNote = String(w.tip);
        next.items.push(created);
        knownEn.add(key);
        matchedOrAddedIds.push(created.id);
      }
    });

    // Store legacy typing events separately in legacyTypingArchive (never mixed into paper events)
    next.legacyTypingArchive = next.legacyTypingArchive || [];
    const seenArch = new Set(next.legacyTypingArchive.map(x => x.id));
    for (const ev of (legacyObj.events || [])) {
      if (ev?.id && !seenArch.has(ev.id)) {
        next.legacyTypingArchive.push({ ...ev, archivedFrom: 'legacy_extraction' });
        seenArch.add(ev.id);
      }
    }

    if (matchedOrAddedIds.length) {
      const packId = 'pack-legacy-' + todayISO();
      next.packs = next.packs.filter(p => p.id !== packId);
      next.packs.unshift({
        id: packId,
        title: '迁入词单 · 来自旧版备份',
        subtitle: `共关联词条 ${matchedOrAddedIds.length} 项（旧打字记录已独立归档隔离）`,
        modeHint: 'standard',
        itemIds: matchedOrAddedIds
      });
      next.selectedPackId = packId;
    }
    return next;
  }

  return {
    clone,
    normText,
    todayISO,
    addDaysISO,
    uid,
    VERIFIED_DENOMINATOR_OUTCOMES,
    getTargetAnswers,
    judgeSpelling,
    freshState,
    restoreLocalState,
    rebuildMastery,
    recordEvent,
    resolvePendingVerify,
    summarizePaperEvents,
    getDueQueue,
    getStatsSummary,
    defaultActivityForItem,
    planPackAllocation,
    updateCurriculumItem,
    suggestItemFromPair,
    parseQuickLessonLines,
    inspectBackupJSON,
    mergeSnapwordBackup,
    importLegacyWordsOnly
  };
})();

if (typeof module !== 'undefined') module.exports = SnapCore;
