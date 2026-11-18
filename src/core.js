/* 词哒 · SnapWord Core Pedagogical & Ledger Engine (v0.1.5)
 * Closes F01–F07, R01–R08, N01–N05, and Round-4 findings Q01–Q02:
 * - Q01: Strict separation of pre-attempt hadSpellingHint vs post-attempt answerRevealedDuringGrading when archiving sibling items.
 * - Q02: Canonical deep draft equality covering itemContexts, hintedOnPaper, lockedHint, answerRevealed, exposureSources, dates & item lists.
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

  function uid(prefix = 'id') {
    const rand = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now()}_${rand}`;
  }

  function hasRequiredCapital(str) {
    return /[A-Z]/.test(str);
  }

  // R07 + F05: Unified per-item target, prompt & spoken text resolver
  function getTargetAnswers(item, options = {}) {
    const mode = options.promptMode || 'audio_plus_zh';
    const allowUS = Boolean(options.allowAmericanSpelling);
    const variantKey = options.variantKey || null;

    if (mode === 'sentence_context' && (item.sentenceVariants?.length || item.sentencePrompt)) {
      const chosenVar = (item.sentenceVariants || []).find(v => v.key === variantKey)
        || (item.sentenceVariants || [])[0]
        || item.sentencePrompt;
      const primary = normText(chosenVar.expected || item.en);
      const list = [primary];
      if (primary === normText(item.en) && item.acceptedVariants?.length) {
        list.push(...item.acceptedVariants.map(normText));
      }
      if (allowUS && item.usVariant && primary === normText(item.en)) {
        list.push(normText(item.usVariant));
      }
      return {
        promptMode: mode,
        variantKey: chosenVar.key || null,
        promptZh: chosenVar.zh || item.zh,
        sentenceTemplate: chosenVar.template || null,
        primary,
        accepted: [...new Set(list)],
        spokenText: primary,
        displayChunks: chosenVar.chunks || item.displayChunks || primary
      };
    }

    const primary = normText(item.en);
    const list = [primary, ...(item.acceptedVariants || []).map(normText)];
    if (allowUS && item.usVariant) list.push(normText(item.usVariant));
    if (options.allowSelfPronoun && item.selfVariant) list.push(normText(item.selfVariant));
    return {
      promptMode: mode,
      variantKey: null,
      promptZh: item.zh,
      sentenceTemplate: null,
      primary,
      accepted: [...new Set(list)],
      spokenText: primary,
      displayChunks: item.displayChunks || primary
    };
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

    const stripPunct = s => s.replace(/[.?!,'"]/g, '').trim();
    for (const t of accepted) {
      if (stripPunct(input) === stripPunct(t) && stripPunct(t).length > 0) {
        return { ok: false, kind: 'boundary_punct', suggestedTag: 'boundary_punct', note: '单词与大小写都对啦，请检查是否漏了撇号或句末标点符号！' };
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
      pendingCorrection: false,
      uncorrectedEventIds: [],
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
      packOverrides: {},
      items: clone(curriculum.ITEMS),
      itemHistory: [],
      packs: clone(curriculum.PACKS),
      events: [],
      mastery: {},
      lastAnswerSeenDate: {},
      unjudgedRevealDate: {},
      drafts: { student: null, parent_demo: null },
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

  // F04 + R04 + R08: Strict spacing-gated D0 mastery & follow-up correction state machine
  function applyEventToMastery(m, evt) {
    if (evt.actor !== 'student') return m;
    if (evt.verificationStatus === 'pending' || evt.verificationStatus === 'rejected') {
      const pendingNext = m ? clone(m) : emptyMastery();
      if (evt.verificationStatus === 'pending') pendingNext.lastOutcome = 'pending_verify';
      return pendingNext;
    }

    const next = m ? clone(m) : emptyMastery();
    const dateStr = evt.dateStr || todayISO(evt.testedAt ?? evt.timestamp);
    next.lastAt = Math.max(next.lastAt || 0, evt.testedAt ?? evt.timestamp ?? 0);

    for (const tag of (evt.errorTags || [])) {
      next.errorCounts[tag] = (next.errorCounts[tag] || 0) + 1;
    }

    // R08: Follow-up red-pen correction for an earlier answered_wrong paper attempt
    if (evt.taskType === 'red_pen_correction') {
      next.badge = maxBadge(next.badge, 'bronze');
      next.pendingCorrection = false;
      // Still requires an unassisted cross-day paper recall!
      return next;
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
      next.pendingCorrection = false;

      // Same-night pass after failing earlier on the SAME dateStr stays in review
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

      // Establish fresh D0 if starting new or recovering from review
      if (next.needsReview || !next.anchorD0 || next.checkpointIdx === 0) {
        next.anchorD0 = dateStr;
        next.checkpointIdx = 1; // Waiting for D0 + 1
        next.stabilized = false;
        next.needsReview = false;
        next.nextDueDate = addDaysISO(dateStr, 1);
        return next;
      }

      // R04 Critical Spacing Gate: If already stabilized OR practiced BEFORE scheduled nextDueDate,
      // keep existing checkpoint & nextDueDate intact (do NOT prematurely finish delayed checks!)
      if (next.stabilized || (next.nextDueDate && dateStr < next.nextDueDate)) {
        return next;
      }

      // Reached or passed scheduled checkpoint date (dateStr >= next.nextDueDate)
      if (next.checkpointIdx === 1) {
        next.checkpointIdx = 2; // Waiting for D0 + 3
        next.needsReview = false;
        const target = addDaysISO(next.anchorD0, 3);
        next.nextDueDate = target > dateStr ? target : addDaysISO(dateStr, 2);
      } else if (next.checkpointIdx === 2) {
        next.checkpointIdx = 3; // Waiting for D0 + 7
        next.needsReview = false;
        const target = addDaysISO(next.anchorD0, 7);
        next.nextDueDate = target > dateStr ? target : addDaysISO(dateStr, 4);
      } else {
        next.checkpointIdx = 4; // Passed D0 + 7 -> Graduated to stabilized low-freq pool
        next.stabilized = true;
        next.needsReview = false;
        next.nextDueDate = null;
      }
      return next;
    }

    // Non-independent outcomes: hinted_correct, blind_self_fixed, answer_corrected, answered_wrong, blank
    if (['blind_self_fixed', 'answer_corrected', 'hinted_correct'].includes(effectiveOutcome)) {
      next.badge = maxBadge(next.badge, 'bronze');
      next.pendingCorrection = false;
    } else if (effectiveOutcome === 'answered_wrong' || effectiveOutcome === 'blank') {
      next.pendingCorrection = effectiveOutcome === 'answered_wrong';
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
    next.nextDueDate = addDaysISO(dateStr, 1);
    return next;
  }

  // N03: Per-event uncorrected wrong query (matches each answered_wrong eventId against red_pen_correction.linkedEventId)
  function getUncorrectedWrongEvents(state, targetActor = 'student') {
    const correctedIds = new Set(
      (state.events || [])
        .filter(c => c.actor === targetActor && c.taskType === 'red_pen_correction' && c.linkedEventId)
        .map(c => c.linkedEventId)
    );
    return (state.events || []).filter(e =>
      e.actor === targetActor &&
      e.taskType === 'paper_check' &&
      e.verificationStatus === 'verified' &&
      e.outcome === 'answered_wrong' &&
      !correctedIds.has(e.id)
    );
  }

  function rebuildMastery(state) {
    const mastery = {};
    const sorted = [...state.events].sort((a, b) => {
      const ta = a.testedAt ?? a.timestamp ?? 0;
      const tb = b.testedAt ?? b.timestamp ?? 0;
      return (ta - tb) || ((a.timestamp || 0) - (b.timestamp || 0)) || String(a.id).localeCompare(String(b.id));
    });
    for (const evt of sorted) {
      if (evt.actor !== 'student') continue;
      const updated = applyEventToMastery(mastery[evt.itemId], evt);
      if (updated) mastery[evt.itemId] = updated;
    }
    // N03: Summarize item-level pendingCorrection strictly from remaining uncorrected answered_wrong events
    const uncorrMap = new Map();
    for (const ev of getUncorrectedWrongEvents(state, 'student')) {
      const arr = uncorrMap.get(ev.itemId) || [];
      arr.push(ev.id);
      uncorrMap.set(ev.itemId, arr);
    }
    for (const [itemId, m] of Object.entries(mastery)) {
      const ids = uncorrMap.get(itemId) || [];
      m.uncorrectedEventIds = ids;
      m.pendingCorrection = ids.length > 0;
    }
    state.mastery = mastery;
    return mastery;
  }

  // R07: Separate testedAt / dateStr (administration date) from submittedAt (submission timestamp)
  function recordEvent(state, payload) {
    if (!payload || !payload.itemId) throw new Error('recordEvent requires itemId');
    if (payload.taskType === 'paper_check' && (!payload.outcome || payload.outcome === 'unjudged')) {
      return null;
    }

    const submittedAt = payload.submittedAt ?? payload.timestamp ?? Date.now();
    const testedAt = payload.testedAt ?? payload.timestamp ?? submittedAt;
    const dateStr = payload.dateStr || todayISO(testedAt);
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
      updatedAt: submittedAt,
      submittedAt,
      testedAt: existingIdx >= 0 ? state.events[existingIdx].testedAt : testedAt,
      verifiedAt: isPending ? null : (payload.verifiedAt ?? submittedAt),
      sessionId: payload.sessionId || null,
      stageTag: payload.stageTag || null,
      linkedEventId: payload.linkedEventId || null,
      timestamp: existingIdx >= 0 ? state.events[existingIdx].timestamp : testedAt,
      dateStr,
      isoTime: new Date(testedAt).toISOString(),
      actor,
      recordedBy: payload.recordedBy || 'parent',
      verifiedBy,
      verificationStatus,
      itemId: payload.itemId,
      itemVersion: item?.version ?? 1,
      paperRef: payload.paperRef || `${dateStr} #${payload.questionNo || 1}`,
      promptMode: payload.promptMode || 'audio_plus_zh',
      variantKey: payload.variantKey || null,
      expectedAnswer: payload.expectedAnswer || item?.en || '',
      spokenText: payload.spokenText || payload.expectedAnswer || item?.en || '',
      hadSpellingHint,
      answerRevealedDuringGrading: Boolean(payload.answerRevealedDuringGrading),
      exposureSource: payload.exposureSource || null,
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
      rebuildMastery(state);
    }
    return evt;
  }

  // R03 + R08: Strict actor-isolated pending verification + full 5 outcomes + errorTags
  function resolvePendingVerify(state, eventId, finalOutcome, errorTags = [], note = '', options = {}) {
    const evt = state.events.find(e => e.id === eventId);
    if (!evt || !VERIFIED_DENOMINATOR_OUTCOMES.has(finalOutcome)) return null;

    // R03 Hard Guard: Never allow parent_demo mode to mutate a student event (or vice versa)!
    const activeActor = options.actorMode ?? state.actorMode ?? 'student';
    if (evt.actor !== activeActor) {
      return { blocked: true, reason: 'ACTOR_MODE_MISMATCH' };
    }

    // Idempotent guard: only verify pending events once unless explicit override
    if (evt.verificationStatus === 'verified' && !options.allowReverify) {
      return evt;
    }

    const now = options.verifiedAt ?? Date.now();
    evt.outcome = normalizePaperOutcome(finalOutcome, evt.hadSpellingHint);
    evt.errorTags = Array.isArray(errorTags) ? [...new Set(errorTags)] : [];
    evt.verificationStatus = 'verified';
    evt.verifiedBy = activeActor === 'parent_demo' ? 'demo' : 'parent';
    evt.verifiedAt = now;
    evt.rev = (evt.rev || 1) + 1;
    evt.updatedAt = now;
    if (note) evt.note = String(note).slice(0, 300);

    if (activeActor === 'student') {
      rebuildMastery(state);
    }
    return evt;
  }

  // R08: Append follow-up correction without overwriting original answered_wrong first-attempt record
  function recordFollowUpCorrection(state, originalEventId, note = '', options = {}) {
    const orig = state.events.find(e => e.id === originalEventId);
    if (!orig) return null;
    const activeActor = options.actorMode ?? state.actorMode ?? 'student';
    if (orig.actor !== activeActor) {
      return { blocked: true, reason: 'ACTOR_MODE_MISMATCH' };
    }
    const existingCorr = state.events.find(e => e.taskType === 'red_pen_correction' && e.linkedEventId === originalEventId);
    if (existingCorr) return existingCorr;

    const now = options.timestamp ?? Date.now();
    return recordEvent(state, {
      id: `corr_${originalEventId}`,
      linkedEventId: originalEventId,
      actor: orig.actor,
      recordedBy: 'parent',
      verifiedBy: orig.actor === 'parent_demo' ? 'demo' : 'parent',
      itemId: orig.itemId,
      paperRef: orig.paperRef,
      promptMode: orig.promptMode,
      testedAt: now,
      submittedAt: now,
      dateStr: options.dateStr || todayISO(now),
      taskType: 'red_pen_correction',
      outcome: 'corrected_followup',
      note: note || `已完成对 ${orig.paperRef}（原首答错）的红笔订正`
    });
  }

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
          : (m.pendingCorrection ? '上次已答仍错（待补订正并复测）' : '上次订正/含提示/留白，优先独立复测');
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

  function getStatsSummary(state, targetActor = 'student') {
    let bronze = 0, silver = 0, gold = 0, goldSlip = 0, stabilizedCount = 0;
    if (targetActor === 'student') {
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
    }

    const actorPaperEvents = state.events.filter(e => e.actor === targetActor && e.taskType === 'paper_check');
    const paperBreakdown = summarizePaperEvents(actorPaperEvents);

    const errorTotals = {};
    for (const e of state.events) {
      if (e.actor !== targetActor || e.verificationStatus === 'pending') continue;
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
      answeredWrongCount: paperBreakdown.answeredWrong,
      blankCount: paperBreakdown.blank,
      untestedCount: paperBreakdown.untested,
      pendingVerifyCount: paperBreakdown.pendingVerify,
      paperRatioText: paperBreakdown.ratioText,
      errorTotals
    };
  }

  function defaultActivityForItem(item, packOverride) {
    if (packOverride) return packOverride;
    if (item.classRequirement === 'dictation_verified') return 'paper_dictation';
    if (item.classRequirement === 'read_meaning_use') return 'oral_only';
    return item.textbookCore === false && item.sourceScope === 'textbook_wordlist'
      ? 'oral_only'
      : 'paper_dictation';
  }

  // R02 + F05: Exact allocation without forced fallback to paper items
  function planPackAllocation(state, packId, itemIds, options = {}) {
    const totalPaperCap = options.totalPaperCap ?? 5;
    const dueIds = options.dueIds || [];
    const remainingPaperSlots = Math.max(0, totalPaperCap - dueIds.length);
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
      combinedPaperIds: [...dueIds, ...paperNowIds],
      hasAnyActiveTask: (dueIds.length + paperNowIds.length + oralOnlyIds.length) > 0
    };
  }

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
    const words = en.split(' ').filter(Boolean);
    const isSentence = /[.?!]$/.test(en) || words.length >= 5;
    const isPhrase = !isSentence && words.length > 1;
    let pieces = [];
    let cloze = null;

    if (isSentence) {
      // Group sentence into 3–5 natural sense-group chunks (2–3 words each) for low-frustration magnetic building
      const targetGroupSize = words.length <= 4 ? 1 : (words.length <= 8 ? 2 : 3);
      for (let i = 0; i < words.length; i += targetGroupSize) {
        pieces.push(words.slice(i, i + targetGroupSize).join(' '));
      }
      const midIdx = Math.min(words.length - 1, Math.max(1, Math.floor(words.length / 2)));
      const prefix = words.slice(0, midIdx).join(' ') + ' ';
      const suffix = midIdx + 1 < words.length ? ' ' + words.slice(midIdx + 1).join(' ') : '';
      cloze = { prefix, blank: words[midIdx].replace(/[.?!]$/, ''), suffix: (/[.?!]$/.test(words[midIdx]) ? words[midIdx].slice(-1) : '') + suffix, hint: '补全句中关键单词' };
    } else if (isPhrase) {
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
      decoys.push({ text: pieces[0].toLowerCase(), tip: '🎩 开头第一个字母需要戴大写礼帽哦！' });
    }
    if (isSentence && /[.?!]$/.test(pieces[pieces.length - 1])) {
      decoys.push({ text: pieces[pieces.length - 1].replace(/[.?!]$/, ''), tip: '🔴 整句默写别漏掉句末的标点符号哦！' });
    } else if (isPhrase) {
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
      type: isSentence ? 'sentence' : (isPhrase ? 'phrase' : 'word'),
      en,
      acceptedVariants: [],
      zh,
      helpKind: isSentence ? 'sentence_grammar' : (isPhrase ? 'word_boundary' : 'spelling_focus'),
      displayChunks: isSentence ? pieces.join(' ｜ ') : (isPhrase ? en.replace(/\s+/g, ' ␣ ') : pieces.join(' ｜ ')),
      helpNote: isSentence ? '先整句听读顺畅，写完重点查句首大写、动词变化、词间空格与句末标点。' : (isPhrase ? '先整句听读，注意词间留空。' : '先整词听读，留意分段拼写难点。'),
      bridgeNote: '家庭试排练习词句（可在词库标注本班要求）。',
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

  // N05: Two-slot draft extraction, comparison & summary helpers
  function extractDraftSlots(obj) {
    const slots = { student: null, parent_demo: null };
    if (!obj || typeof obj !== 'object') return slots;
    if (obj.drafts && typeof obj.drafts === 'object') {
      if (obj.drafts.student && typeof obj.drafts.student === 'object') {
        slots.student = clone(obj.drafts.student);
      }
      if (obj.drafts.parent_demo && typeof obj.drafts.parent_demo === 'object') {
        slots.parent_demo = clone(obj.drafts.parent_demo);
      }
    }
    if (obj.activeDraft && typeof obj.activeDraft === 'object') {
      const actor = obj.activeDraft.lockedActor === 'parent_demo' ? 'parent_demo' : 'student';
      if (!slots[actor]) slots[actor] = clone(obj.activeDraft);
    }
    return slots;
  }

  function cleanBoolMap(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [k, v] of Object.entries(obj)) {
      if (v) out[k] = true;
    }
    return out;
  }

  function cleanStrMap(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [k, v] of Object.entries(obj)) {
      if (v != null && v !== '') out[k] = String(v);
    }
    return out;
  }

  function stableStringify(val) {
    if (val === null || typeof val !== 'object') return JSON.stringify(val);
    if (Array.isArray(val)) return '[' + val.map(stableStringify).join(',') + ']';
    const keys = Object.keys(val).filter(k => val[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(val[k])).join(',') + '}';
  }

  function draftCanonicalProjection(d) {
    return {
      sessionId: d.sessionId || null,
      lockedActor: d.lockedActor || 'student',
      mode: d.mode || 'standard',
      packId: d.packId || null,
      packTitle: d.packTitle || '',
      step: d.step || '',
      paperPhase: d.paperPhase || '',
      oralPhase: d.oralPhase || 'active',
      promptMode: d.promptMode || 'audio_plus_zh',
      duePrewritten: Boolean(d.duePrewritten),
      dueIds: Array.isArray(d.dueIds) ? d.dueIds : [],
      paperNowIds: Array.isArray(d.paperNowIds) ? d.paperNowIds : [],
      oralOnlyIds: Array.isArray(d.oralOnlyIds) ? d.oralOnlyIds : [],
      deferredIds: Array.isArray(d.deferredIds) ? d.deferredIds : [],
      focusIds: Array.isArray(d.focusIds) ? d.focusIds : [],
      paperIds: Array.isArray(d.paperIds) ? d.paperIds : [],
      itemContexts: d.itemContexts || {},
      hintedOnPaper: cleanBoolMap(d.hintedOnPaper),
      showChunkHint: cleanBoolMap(d.showChunkHint),
      lockedHint: cleanBoolMap(d.lockedHint),
      answerRevealed: cleanBoolMap(d.answerRevealed),
      exposureSources: cleanStrMap(d.exposureSources),
      maskedAnswers: cleanBoolMap(d.maskedAnswers),
      blindChecks: {
        cap: Boolean(d.blindChecks?.cap),
        space: Boolean(d.blindChecks?.space),
        chunk: Boolean(d.blindChecks?.chunk)
      },
      paperGrades: d.paperGrades || {},
      oralChecked: cleanBoolMap(d.oralChecked),
      prereadDone: Boolean(d.prereadDone),
      prereadNote: String(d.prereadNote || ''),
      sentenceNote: String(d.sentenceNote || '')
    };
  }

  // Q02: Deep canonical comparison across all administration, context, hint, exposure, date & item-list fields!
  function draftSlotEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return stableStringify(draftCanonicalProjection(a)) === stableStringify(draftCanonicalProjection(b));
  }

  function summarizeDraft(d) {
    if (!d) return null;
    const gradedCount = Object.values(d.paperGrades || {}).filter(g => g?.outcome && g.outcome !== 'unjudged').length;
    const oralCount = Object.values(d.oralChecked || {}).filter(Boolean).length;
    const hintedCount = Object.keys(cleanBoolMap(d.hintedOnPaper)).length;
    const revealedCount = Object.keys(cleanBoolMap(d.answerRevealed)).length;
    const modes = [...new Set([
      ...Object.values(d.itemContexts || {}).map(c => c?.promptMode).filter(Boolean),
      d.promptMode
    ].filter(Boolean))];
    const dates = [...new Set([
      ...Object.values(d.paperGrades || {}).map(g => g?.testedDateStr).filter(Boolean),
      ...Object.values(d.itemContexts || {}).map(c => c?.testedDateStr).filter(Boolean)
    ])];
    return {
      sessionId: d.sessionId || null,
      lockedActor: d.lockedActor || 'student',
      packId: d.packId || null,
      packTitle: d.packTitle || '未完课草稿',
      draftStatus: d.draftStatus || 'suspended',
      savedAt: d.savedAt || d.startedAt || 0,
      paperCount: Array.isArray(d.paperIds) ? d.paperIds.length : 0,
      gradedCount,
      oralCount,
      hintedCount,
      revealedCount,
      modes,
      dates
    };
  }

  function restoreLocalState(curriculum, saved) {
    const base = freshState(curriculum);
    if (!saved || saved.app !== 'snapword') return base;

    const merged = mergeSnapwordBackup(base, saved, {
      includeDemo: true,
      conflictPolicy: 'prefer_incoming',
      draftPolicy: 'restore_incoming',
      preserveDraftStatus: true
    });
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
    merged.activeDraft = merged.drafts[merged.actorMode] ? clone(merged.drafts[merged.actorMode]) : null;
    return merged;
  }

  // R06 + N05: Itemized diff, strict conflict classification & two-slot draft preview
  function inspectBackupJSON(rawObj, currentState) {
    if (!rawObj || typeof rawObj !== 'object') throw new Error('不是有效的 JSON 备份文件');

    if (rawObj.app === 'snapword' && rawObj.schema === 1) {
      if (!Array.isArray(rawObj.items) || !Array.isArray(rawObj.packs) || !Array.isArray(rawObj.events)) {
        throw new Error('词哒备份结构不完整');
      }
      const localMap = new Map(currentState.events.map(e => [e.id, e]));
      const itemLookup = new Map([...currentState.items, ...rawObj.items].map(it => [it.id, it]));
      const studentEvents = rawObj.events.filter(e => e.actor === 'student');
      const demoEvents = rawObj.events.filter(e => e.actor !== 'student');

      let added = 0, identical = 0;
      const upgradeDetails = [];
      const conflictDetails = [];

      for (const inc of studentEvents) {
        const loc = localMap.get(inc.id);
        const label = itemLookup.get(inc.itemId)?.zh || inc.itemId;
        if (!loc) {
          added++;
        } else if (eventContentEqual(loc, inc)) {
          identical++;
        } else if (loc.verificationStatus === 'pending' && inc.verificationStatus === 'verified') {
          upgradeDetails.push({
            id: inc.id,
            itemId: inc.itemId,
            label,
            dateStr: inc.dateStr || loc.dateStr,
            toOutcome: inc.outcome
          });
        } else if (inc.verificationStatus === 'pending' && loc.verificationStatus === 'verified') {
          identical++;
        } else {
          conflictDetails.push({
            id: inc.id,
            itemId: inc.itemId,
            label,
            dateStr: loc.dateStr || inc.dateStr,
            localOutcome: loc.outcome,
            localRev: loc.rev || 1,
            incomingOutcome: inc.outcome,
            incomingRev: inc.rev || 1
          });
        }
      }

      const localSlots = extractDraftSlots(currentState);
      const incomingSlots = extractDraftSlots(rawObj);
      const draftSlots = {};
      let hasIncomingDrafts = false;
      let hasDraftConflicts = false;

      for (const actor of ['student', 'parent_demo']) {
        const locD = localSlots[actor];
        const incD = incomingSlots[actor];
        if (incD) hasIncomingDrafts = true;
        let status = 'none';
        if (incD && !locD) status = 'incoming_only';
        else if (!incD && locD) status = 'local_only';
        else if (incD && locD) {
          status = draftSlotEqual(locD, incD) ? 'identical' : 'conflict';
          if (status === 'conflict') hasDraftConflicts = true;
        }
        draftSlots[actor] = {
          actor,
          status,
          local: summarizeDraft(locD),
          incoming: summarizeDraft(incD)
        };
      }

      return {
        kind: 'snapword',
        itemCount: rawObj.items.length,
        packCount: rawObj.packs.length,
        studentEventCount: studentEvents.length,
        demoEventCount: demoEvents.length,
        added,
        identical,
        verifiedUpgrades: upgradeDetails.length,
        conflicts: conflictDetails.length,
        upgradeDetails,
        conflictDetails,
        draftSlots,
        hasIncomingDrafts,
        hasDraftConflicts,
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

  // R06 + N05: Strict obedience to conflictPolicy AND draftPolicy across both actor slots!
  function mergeSnapwordBackup(currentState, backupObj, options = {}) {
    const includeDemo = Boolean(options.includeDemo);
    const conflictPolicy = options.conflictPolicy || 'prefer_incoming'; // 'prefer_incoming' | 'keep_local'
    const draftPolicy = options.draftPolicy || 'restore_incoming'; // 'restore_incoming' | 'keep_local' | 'skip_incoming'
    const preserveDraftStatus = Boolean(options.preserveDraftStatus);
    const next = clone(currentState);
    const preservedActorMode = next.actorMode;

    if (backupObj.profile?.nickname) next.profile.nickname = String(backupObj.profile.nickname).slice(0, 24);
    if (Number.isFinite(backupObj.profile?.budgetMinutes)) next.profile.budgetMinutes = backupObj.profile.budgetMinutes;
    if (backupObj.classSettings && typeof backupObj.classSettings === 'object') {
      next.classSettings = { ...next.classSettings, ...backupObj.classSettings };
    }
    if (backupObj.packOverrides && typeof backupObj.packOverrides === 'object') {
      next.packOverrides = { ...next.packOverrides, ...backupObj.packOverrides };
    }

    const histKey = h => `${h.id}@v${h.version}`;
    const histMap = new Map((next.itemHistory || []).map(h => [histKey(h), h]));
    for (const h of (backupObj.itemHistory || [])) {
      if (h?.id) histMap.set(histKey(h), h);
    }
    next.itemHistory = [...histMap.values()];

    const itemMap = new Map(next.items.map(it => [it.id, it]));
    for (const it of backupObj.items) {
      if (!it?.id || !it?.en) continue;
      const existing = itemMap.get(it.id);
      if (!existing) {
        itemMap.set(it.id, it);
      } else if ((it.version || 1) > (existing.version || 1)) {
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

    const packMap = new Map(next.packs.map(p => [p.id, p]));
    for (const p of backupObj.packs) {
      if (p?.id && Array.isArray(p.itemIds)) packMap.set(p.id, p);
    }
    next.packs = [...packMap.values()];

    if (Array.isArray(backupObj.boardNotes)) {
      const noteMap = new Map((next.boardNotes || []).map(n => [n.id, n]));
      for (const n of backupObj.boardNotes) {
        if (n?.id && n?.en) noteMap.set(n.id, n);
      }
      next.boardNotes = [...noteMap.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30);
    }

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
        // Pending -> Verified upgrade
        eventMap.set(inc.id, { ...inc, rev: Math.max((loc.rev || 1) + 1, inc.rev || 2) });
      } else if (inc.verificationStatus === 'pending' && loc.verificationStatus === 'verified') {
        continue;
      } else {
        // R06: True verified conflict -> strictly obey user's conflictPolicy regardless of rev!
        if (conflictPolicy === 'prefer_incoming') {
          eventMap.set(inc.id, { ...inc, rev: Math.max(loc.rev || 1, inc.rev || 1) });
        }
        // When conflictPolicy === 'keep_local', keep `loc` untouched!
      }
    }
    next.events = [...eventMap.values()].sort((a, b) => {
      const ta = a.testedAt ?? a.timestamp ?? 0;
      const tb = b.testedAt ?? b.timestamp ?? 0;
      return (ta - tb) || ((a.timestamp || 0) - (b.timestamp || 0)) || String(a.id).localeCompare(String(b.id));
    });

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

    next.lastAnswerSeenDate = { ...(next.lastAnswerSeenDate || {}) };
    if (backupObj.lastAnswerSeenDate && typeof backupObj.lastAnswerSeenDate === 'object') {
      for (const [k, v] of Object.entries(backupObj.lastAnswerSeenDate)) {
        if (typeof v === 'string' && (!next.lastAnswerSeenDate[k] || v > next.lastAnswerSeenDate[k])) {
          next.lastAnswerSeenDate[k] = v;
        }
      }
    }
    next.unjudgedRevealDate = { ...(next.unjudgedRevealDate || {}) };
    if (backupObj.unjudgedRevealDate && typeof backupObj.unjudgedRevealDate === 'object') {
      for (const [k, v] of Object.entries(backupObj.unjudgedRevealDate)) {
        if (typeof v === 'string' && (!next.unjudgedRevealDate[k] || v > next.unjudgedRevealDate[k])) {
          next.unjudgedRevealDate[k] = v;
        }
      }
    }

    // N05: Merge suspended/in-progress drafts for both student & parent_demo slots
    const localSlots = extractDraftSlots(next);
    const incomingSlots = extractDraftSlots(backupObj);
    next.drafts = { student: localSlots.student, parent_demo: localSlots.parent_demo };
    for (const actor of ['student', 'parent_demo']) {
      const locD = localSlots[actor];
      const incD = incomingSlots[actor];
      if (!incD) continue;
      const normalizedInc = clone(incD);
      normalizedInc.lockedActor = actor;
      if (!preserveDraftStatus) {
        normalizedInc.draftStatus = 'suspended';
      }
      if (!locD) {
        if (draftPolicy !== 'skip_incoming') {
          next.drafts[actor] = normalizedInc;
        }
      } else if (draftSlotEqual(locD, incD)) {
        next.drafts[actor] = clone(locD);
      } else if (draftPolicy === 'restore_incoming') {
        next.drafts[actor] = normalizedInc;
      }
    }

    next.actorMode = preservedActorMode;
    next.activeDraft = next.drafts[next.actorMode] ? clone(next.drafts[next.actorMode]) : null;
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
    getUncorrectedWrongEvents,
    recordEvent,
    resolvePendingVerify,
    recordFollowUpCorrection,
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
