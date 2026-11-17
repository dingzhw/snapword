/* 词哒 · SnapWord Core Pedagogical & Ledger Engine (v0.1.0)
 * Pure state logic: Actor isolation, Bronze/Silver/Gold delayed mastery,
 * Two-Pass Red-Pen grading, D+1/D+3/D+7 review queue, and safe backup migration.
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
    // True if target contains an uppercase letter (e.g., Saturday, TV, Chinese, I)
    return /[A-Z]/.test(str);
  }

  function judgeSpelling(item, rawInput) {
    const input = normText(rawInput);
    if (!input) return { ok: false, kind: 'blank', suggestedTag: null };

    const targets = [item.en, ...(item.acceptedVariants || [])].map(normText);
    const strictCase = targets.some(hasRequiredCapital);

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (input === t || (!strictCase && input.toLowerCase() === t.toLowerCase())) {
        return {
          ok: true,
          kind: i === 0 ? 'exact' : 'variant',
          matched: t,
          note: i === 0 ? '' : `已匹配可用表达「${t}」（课本主词条：${item.en}）`
        };
      }
    }

    // Check case-only error (e.g., saturday -> Saturday)
    for (const t of targets) {
      if (input.toLowerCase() === t.toLowerCase()) {
        return { ok: false, kind: 'case_missing', suggestedTag: 'case_missing' };
      }
    }

    // Check missing/extra word space error (e.g., stay uplate -> stay up late)
    const inputNoSpace = input.toLowerCase().replace(/\s+/g, '');
    for (const t of targets) {
      if (t.includes(' ') && inputNoSpace === t.toLowerCase().replace(/\s+/g, '')) {
        return { ok: false, kind: 'space_missing', suggestedTag: 'space_missing' };
      }
    }

    return { ok: false, kind: 'spelling', suggestedTag: 'missing_letter' };
  }

  function emptyMastery() {
    return {
      badge: 'none', // 'none' | 'bronze' | 'silver' | 'gold'
      d0Date: null,
      independentDates: [],
      nextDueDate: null,
      stageStep: 0,
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
      actorMode: 'student', // 'student' | 'parent_demo'
      selectedPackId: 'pack-autumn-1',
      items: clone(curriculum.ITEMS),
      packs: clone(curriculum.PACKS),
      events: [],
      mastery: {},
      boardNotes: [
        {
          id: 'bn_welcome',
          en: 'I play football with my friends on Saturday.',
          zh: '我在星期六和朋友们一起踢足球。',
          highlight: 'with',
          at: 1794915000000
        }
      ],
      recordings: {}
    };
  }

  function applyEventToMastery(m, evt) {
    if (evt.actor !== 'student') return m;
    const next = m ? clone(m) : emptyMastery();
    const dateStr = evt.dateStr || todayISO(evt.timestamp);
    next.lastAt = Math.max(next.lastAt || 0, evt.timestamp);

    // Record visible error tags when present
    for (const tag of (evt.errorTags || [])) {
      next.errorCounts[tag] = (next.errorCounts[tag] || 0) + 1;
    }

    if (evt.taskType === 'scaffold_snap' || evt.taskType === 'scaffold_cloze' || evt.taskType === 'read_aloud') {
      next.badge = maxBadge(next.badge, 'bronze');
      return next;
    }

    if (evt.taskType === 'paper_check') {
      const outcome = evt.outcome; // 'paper_independent' | 'blind_self_fixed' | 'answer_corrected' | 'blank' | 'untested' | 'pending_verify'
      if (outcome === 'untested' || outcome === 'pending_verify') {
        next.lastOutcome = outcome;
        return next;
      }

      next.lastOutcome = outcome;

      if (outcome === 'paper_independent') {
        if (!next.independentDates.includes(dateStr)) {
          next.independentDates.push(dateStr);
          next.independentDates.sort();
        }
        const distinctDays = next.independentDates.length;
        next.needsReview = false;
        if (distinctDays === 1) {
          next.d0Date = next.d0Date || dateStr;
          next.badge = maxBadge(next.badge, 'silver');
          next.stageStep = 1;
          next.nextDueDate = addDaysISO(dateStr, 1); // D+1
        } else if (distinctDays === 2) {
          next.badge = maxBadge(next.badge, 'gold');
          next.stageStep = 2;
          next.nextDueDate = addDaysISO(dateStr, 3); // D+3
        } else {
          next.badge = maxBadge(next.badge, 'gold');
          next.stageStep = 3;
          next.nextDueDate = addDaysISO(dateStr, 7); // D+7 (暂稳定)
        }
      } else if (outcome === 'blind_self_fixed' || outcome === 'answer_corrected') {
        // Effort rewarded with at least bronze, never downgrades silver/gold,
        // BUT requires unassisted paper re-test next session!
        next.badge = maxBadge(next.badge, 'bronze');
        next.needsReview = true;
        next.stageStep = 0;
        next.nextDueDate = dateStr;
      } else if (outcome === 'blank') {
        next.needsReview = true;
        next.stageStep = 0;
        next.nextDueDate = dateStr;
      }
    }
    return next;
  }

  function rebuildMastery(state) {
    const mastery = {};
    const sorted = [...state.events].sort((a, b) => a.timestamp - b.timestamp);
    for (const evt of sorted) {
      if (evt.actor !== 'student') continue;
      if (evt.verificationStatus === 'rejected') continue;
      mastery[evt.itemId] = applyEventToMastery(mastery[evt.itemId], evt);
    }
    state.mastery = mastery;
    return mastery;
  }

  function recordEvent(state, payload) {
    const now = payload.timestamp ?? Date.now();
    const dateStr = payload.dateStr ?? todayISO(now);
    const actor = payload.actor ?? state.actorMode ?? 'student';
    const item = state.items.find(x => x.id === payload.itemId);

    const evt = {
      id: payload.id || uid('evt'),
      timestamp: now,
      dateStr,
      isoTime: new Date(now).toISOString(),
      actor, // 'student' | 'parent_demo'
      itemId: payload.itemId,
      itemVersion: item?.version ?? 1,
      taskType: payload.taskType, // 'read_aloud' | 'scaffold_snap' | 'scaffold_cloze' | 'paper_check' | 'sentence_use'
      outcome: payload.outcome || 'done',
      errorTags: Array.isArray(payload.errorTags) ? [...new Set(payload.errorTags)] : [],
      verificationStatus: payload.outcome === 'pending_verify' ? 'pending' : (payload.verificationStatus || 'verified'),
      note: String(payload.note ?? '').slice(0, 300)
    };

    state.events.push(evt);
    if (actor === 'student') {
      state.mastery[evt.itemId] = applyEventToMastery(state.mastery[evt.itemId], evt);
    }
    return evt;
  }

  function resolvePendingVerify(state, eventId, finalOutcome, errorTags = [], note = '') {
    const evt = state.events.find(e => e.id === eventId);
    if (!evt) return null;
    evt.outcome = finalOutcome;
    evt.errorTags = Array.isArray(errorTags) ? [...new Set(errorTags)] : [];
    evt.verificationStatus = 'verified';
    if (note) evt.note = String(note).slice(0, 300);
    rebuildMastery(state);
    return evt;
  }

  function getDueQueue(state, dateStr = todayISO(), limit = 3) {
    const candidates = [];
    for (const item of state.items) {
      const m = state.mastery[item.id];
      if (!m) continue;
      // Only pull items that require dictation or have already been started on paper
      if (m.needsReview) {
        candidates.push({ item, m, priority: 1, reason: '上次订正/未稳，优先复测' });
      } else if (m.nextDueDate && m.nextDueDate <= dateStr) {
        const label = m.stageStep === 1 ? 'D+1 隔日抽查（冲金章！）'
          : m.stageStep === 2 ? 'D+3 巩固抽查' : 'D+7 稳定抽查';
        candidates.push({ item, m, priority: 2, reason: label });
      }
    }
    candidates.sort((a, b) => a.priority - b.priority || (a.m.lastAt - b.m.lastAt));
    return {
      todayPick: candidates.slice(0, limit),
      totalDue: candidates.length
    };
  }

  function getStatsSummary(state) {
    let bronze = 0, silver = 0, gold = 0;
    for (const item of state.items) {
      const b = state.mastery[item.id]?.badge || 'none';
      if (b === 'bronze') bronze++;
      else if (b === 'silver') silver++;
      else if (b === 'gold') gold++;
    }
    const studentPaper = state.events.filter(e =>
      e.actor === 'student' &&
      e.taskType === 'paper_check' &&
      !['untested', 'pending_verify'].includes(e.outcome)
    );
    const independentPass = studentPaper.filter(e => e.outcome === 'paper_independent').length;
    const pendingVerifyCount = state.events.filter(e =>
      e.actor === 'student' && e.taskType === 'paper_check' && e.outcome === 'pending_verify'
    ).length;

    const errorTotals = {};
    for (const e of state.events) {
      if (e.actor !== 'student') continue;
      for (const t of (e.errorTags || [])) {
        errorTotals[t] = (errorTotals[t] || 0) + 1;
      }
    }

    return {
      bronze,
      silver,
      gold,
      totalBadges: bronze + silver + gold,
      paperTestedCount: studentPaper.length,
      independentPass,
      pendingVerifyCount,
      errorTotals
    };
  }

  // Smart suggestion helper when parent pastes "English | 中文" lines
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
      bookPage: null,
      textbookCore: true,
      classRequirement: 'dictation',
      type: isPhrase ? 'phrase' : 'word',
      en,
      acceptedVariants: [],
      zh,
      helpKind: isPhrase ? 'word_boundary' : 'spelling_focus',
      displayChunks: isPhrase ? en.replace(/\s+/g, ' ␣ ') : pieces.join(' ｜ '),
      helpNote: isPhrase ? '先整句听读，注意词间留空。' : '先整词听读，留意分段拼写难点。',
      bridgeNote: '家长自建词条（可在排课台随时调整）。',
      snap: { pieces, decoys },
      cloze,
      context: { en, zh, origin: '家长自定义任务' }
    };
  }

  function parseQuickLessonLines(rawText) {
    const lines = String(rawText ?? '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    if (!lines.length) throw new Error('请输入至少一行“英文 | 中文”内容');
    if (lines.length > 40) throw new Error('单次快速粘贴最多支持 40 项（每晚建议只选 3–5 项）');

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

  // Safe backup validation & preview (supports SnapWord schema 1 + legacy 词汇撤离 schema 1)
  function inspectBackupJSON(rawObj, currentState) {
    if (!rawObj || typeof rawObj !== 'object') throw new Error('不是有效的 JSON 备份文件');

    // Case A: Native SnapWord backup
    if (rawObj.app === 'snapword' && rawObj.schema === 1) {
      if (!Array.isArray(rawObj.items) || !Array.isArray(rawObj.packs) || !Array.isArray(rawObj.events)) {
        throw new Error('词哒备份结构不完整');
      }
      const existingIds = new Set(currentState.events.map(e => e.id));
      const studentEvents = rawObj.events.filter(e => e.actor === 'student');
      const demoEvents = rawObj.events.filter(e => e.actor !== 'student');
      const newEventsCount = studentEvents.filter(e => !existingIds.has(e.id)).length;
      return {
        kind: 'snapword',
        itemCount: rawObj.items.length,
        packCount: rawObj.packs.length,
        studentEventCount: studentEvents.length,
        demoEventCount: demoEvents.length,
        newStudentEvents: newEventsCount,
        payload: rawObj
      };
    }

    // Case B: Legacy 词汇撤离 backup (isolated keyboard-typing history)
    if (rawObj.schema === 1 && Array.isArray(rawObj.words) && Array.isArray(rawObj.events)) {
      return {
        kind: 'legacy_extraction',
        wordCount: rawObj.words.length,
        typingEventCount: rawObj.events.length,
        warning: '检测到旧版《词汇撤离》备份。注意：旧版记录可能包含家长本机测试数据且均为键盘打字口径，建议仅合并自定义词条，默认不把旧打字记录混入学生纸笔统计。',
        payload: rawObj
      };
    }

    throw new Error('无法识别的备份格式（仅支持词哒 SnapWord 或旧版词汇撤离 JSON）');
  }

  function mergeSnapwordBackup(currentState, backupObj, options = { includeDemo: false }) {
    const next = clone(currentState);
    if (backupObj.profile?.nickname) next.profile.nickname = String(backupObj.profile.nickname).slice(0, 24);
    if (Number.isFinite(backupObj.profile?.budgetMinutes)) next.profile.budgetMinutes = backupObj.profile.budgetMinutes;

    const itemMap = new Map(next.items.map(it => [it.id, it]));
    for (const it of backupObj.items) {
      if (!it?.id || !it?.en) continue;
      const existing = itemMap.get(it.id);
      if (!existing || (it.version || 1) >= (existing.version || 1)) {
        itemMap.set(it.id, it);
      }
    }
    next.items = [...itemMap.values()];

    const packMap = new Map(next.packs.map(p => [p.id, p]));
    for (const p of backupObj.packs) {
      if (p?.id && Array.isArray(p.itemIds)) packMap.set(p.id, p);
    }
    next.packs = [...packMap.values()];

    const eventMap = new Map(next.events.map(e => [e.id, e]));
    for (const e of backupObj.events) {
      if (!e?.id || !e?.itemId) continue;
      if (!options.includeDemo && e.actor !== 'student') continue;
      if (!eventMap.has(e.id)) eventMap.set(e.id, e);
    }
    next.events = [...eventMap.values()].sort((a, b) => a.timestamp - b.timestamp);

    if (backupObj.recordings && typeof backupObj.recordings === 'object') {
      next.recordings = { ...next.recordings, ...backupObj.recordings };
    }

    rebuildMastery(next);
    return next;
  }

  function importLegacyWordsOnly(currentState, legacyObj) {
    const next = clone(currentState);
    const knownEn = new Set(next.items.map(i => normText(i.en).toLowerCase()));
    const addedIds = [];
    legacyObj.words.forEach((w, idx) => {
      if (!w?.en || !w?.zh) return;
      const key = normText(w.en).toLowerCase();
      const existing = next.items.find(i => normText(i.en).toLowerCase() === key);
      if (existing) {
        addedIds.push(existing.id);
      } else if (!knownEn.has(key)) {
        const created = suggestItemFromPair(w.en, w.zh, idx);
        if (w.tip) created.helpNote = String(w.tip);
        next.items.push(created);
        knownEn.add(key);
        addedIds.push(created.id);
      }
    });
    if (addedIds.length) {
      const packId = 'pack-legacy-' + todayISO();
      if (!next.packs.some(p => p.id === packId)) {
        next.packs.push({
          id: packId,
          title: '迁入词单 · 来自旧版备份',
          subtitle: `已安全隔离旧测试日志，提取词条 ${addedIds.slice(0, 5).length} 项（可按需调整）`,
          modeHint: 'standard',
          itemIds: addedIds.slice(0, 5)
        });
      }
    }
    return next;
  }

  return {
    clone,
    normText,
    todayISO,
    addDaysISO,
    uid,
    judgeSpelling,
    freshState,
    rebuildMastery,
    recordEvent,
    resolvePendingVerify,
    getDueQueue,
    getStatsSummary,
    suggestItemFromPair,
    parseQuickLessonLines,
    inspectBackupJSON,
    mergeSnapwordBackup,
    importLegacyWordsOnly
  };
})();

if (typeof module !== 'undefined') module.exports = SnapCore;
