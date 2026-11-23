/* 词哒 · SnapWord Multi-Provider AI Coaching & Dynamic Quiz Engine (v0.3.0)
 * Supports OpenAI (default: gpt-6.2-sol), Google Gemini, DeepSeek, Local LM Studio / Ollama,
 * and any OpenAI-compatible endpoint.
 * Security: API keys are stored strictly in an isolated localStorage slot (NEVER inside state or exported JSON backups).
 */
const SnapAI = (() => {
  const SECRET_STORAGE_KEY = 'snapword_ai_secrets_v1';
  const BANK_STORAGE_KEY = 'snapword_ai_bank_v1';

  const PROVIDERS = {
    openai: {
      id: 'openai',
      label: 'OpenAI（主力默认）',
      protocol: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-6.2-sol',
      needsKey: true,
      keyPlaceholder: 'sk-...',
      helpText: '默认模型已设为 gpt-6.2-sol；填入 Key 后可点「读取模型列表」自由选择或手动输入。'
    },
    gemini: {
      id: 'gemini',
      label: 'Google Gemini',
      protocol: 'gemini',
      defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-2.5-flash',
      needsKey: true,
      keyPlaceholder: 'AIza...',
      helpText: '支持 Google AI Studio API Key，自动拉取可用 Gemini 模型列表。'
    },
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek（深度求索）',
      protocol: 'openai',
      defaultBaseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
      needsKey: true,
      keyPlaceholder: 'sk-...',
      helpText: '国内网络直连低延迟，支持 deepseek-chat 与 deepseek-reasoner。'
    },
    lmstudio: {
      id: 'lmstudio',
      label: '本地 LM Studio / Ollama',
      protocol: 'openai',
      defaultBaseUrl: 'http://127.0.0.1:1234/v1',
      defaultModel: 'local-model',
      needsKey: false,
      keyPlaceholder: '本地模型无需填写 Key（留空即可）',
      helpText: '请在 LM Studio 的 Developer 页开启 Local Server 与 CORS 开关，再点「读取模型列表」。'
    },
    custom: {
      id: 'custom',
      label: '自定义 OpenAI 兼容接口',
      protocol: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-6.2-sol',
      needsKey: false,
      keyPlaceholder: 'sk-...（按服务商要求填写）',
      helpText: '兼容硅基流动、阿里百炼、火山方舟、OpenRouter 或自建转发网关。'
    }
  };

  function defaultConfig() {
    const providerProfiles = {};
    for (const [k, p] of Object.entries(PROVIDERS)) {
      providerProfiles[k] = {
        baseUrl: p.defaultBaseUrl,
        apiKey: '',
        model: p.defaultModel,
        fetchedModels: []
      };
    }
    return {
      enabled: true,
      activeProvider: 'openai',
      timeoutMs: 22000,
      profiles: providerProfiles
    };
  }

  let memConfig = null;
  let memBank = null;

  function loadConfig() {
    if (memConfig) return memConfig;
    const base = defaultConfig();
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(SECRET_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.enabled === 'boolean') base.enabled = parsed.enabled;
          if (parsed.activeProvider && PROVIDERS[parsed.activeProvider]) {
            base.activeProvider = parsed.activeProvider;
          }
          if (Number.isFinite(parsed.timeoutMs)) {
            base.timeoutMs = Math.max(5000, Math.min(60000, parsed.timeoutMs));
          }
          if (parsed.profiles && typeof parsed.profiles === 'object') {
            for (const k of Object.keys(PROVIDERS)) {
              const inc = parsed.profiles[k];
              if (inc && typeof inc === 'object') {
                base.profiles[k] = {
                  baseUrl: String(inc.baseUrl || PROVIDERS[k].defaultBaseUrl).trim(),
                  apiKey: String(inc.apiKey || '').trim(),
                  model: String(inc.model || PROVIDERS[k].defaultModel).trim(),
                  fetchedModels: Array.isArray(inc.fetchedModels)
                    ? inc.fetchedModels.map(x => String(x).trim()).filter(Boolean).slice(0, 200)
                    : []
                };
              }
            }
          }
        }
      }
    } catch {}
    memConfig = base;
    return base;
  }

  function saveConfig(patch = {}) {
    const cur = loadConfig();
    if (typeof patch.enabled === 'boolean') cur.enabled = patch.enabled;
    if (patch.activeProvider && PROVIDERS[patch.activeProvider]) {
      cur.activeProvider = patch.activeProvider;
    }
    if (patch.profilePatch && typeof patch.profilePatch === 'object') {
      const pid = patch.providerId || cur.activeProvider;
      if (PROVIDERS[pid]) {
        const prev = cur.profiles[pid] || {
          baseUrl: PROVIDERS[pid].defaultBaseUrl,
          apiKey: '',
          model: PROVIDERS[pid].defaultModel,
          fetchedModels: []
        };
        cur.profiles[pid] = {
          baseUrl: patch.profilePatch.baseUrl !== undefined
            ? (String(patch.profilePatch.baseUrl).trim() || PROVIDERS[pid].defaultBaseUrl)
            : prev.baseUrl,
          apiKey: patch.profilePatch.apiKey !== undefined
            ? String(patch.profilePatch.apiKey).trim()
            : prev.apiKey,
          model: patch.profilePatch.model !== undefined
            ? (String(patch.profilePatch.model).trim() || PROVIDERS[pid].defaultModel)
            : prev.model,
          fetchedModels: Array.isArray(patch.profilePatch.fetchedModels)
            ? [...new Set(patch.profilePatch.fetchedModels.map(x => String(x).trim()).filter(Boolean))].slice(0, 200)
            : prev.fetchedModels
        };
      }
    }
    memConfig = cur;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SECRET_STORAGE_KEY, JSON.stringify(cur));
      }
    } catch {}
    return cur;
  }

  function getActiveProfile(cfg = loadConfig()) {
    const provider = PROVIDERS[cfg.activeProvider] || PROVIDERS.openai;
    const prof = cfg.profiles[provider.id] || {
      baseUrl: provider.defaultBaseUrl,
      apiKey: '',
      model: provider.defaultModel,
      fetchedModels: []
    };
    return {
      enabled: Boolean(cfg.enabled),
      providerId: provider.id,
      providerLabel: provider.label,
      protocol: provider.protocol,
      needsKey: provider.needsKey,
      defaultBaseUrl: provider.defaultBaseUrl,
      defaultModel: provider.defaultModel,
      baseUrl: prof.baseUrl || provider.defaultBaseUrl,
      apiKey: prof.apiKey || '',
      model: prof.model || provider.defaultModel,
      fetchedModels: prof.fetchedModels || [],
      timeoutMs: cfg.timeoutMs || 22000
    };
  }

  function isReady(cfg = loadConfig()) {
    const act = getActiveProfile(cfg);
    if (!act.enabled) return false;
    if (act.needsKey && !act.apiKey) return false;
    return Boolean(act.baseUrl && act.model);
  }

  function normalizeBaseUrl(rawUrl, protocol = 'openai') {
    let u = String(rawUrl || '').trim().replace(/\/+$/, '');
    if (!u) return protocol === 'gemini' ? PROVIDERS.gemini.defaultBaseUrl : PROVIDERS.openai.defaultBaseUrl;
    u = u.replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '');
    return u;
  }

  function stripReasoningAndExtractJSON(rawText) {
    let text = String(rawText || '').trim();
    // Strip <think>...</think> blocks emitted by reasoning models (DeepSeek-R1, Qwen3, local GGUFs)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Strip markdown code fences if present
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) text = fenceMatch[1].trim();
    try {
      return JSON.parse(text);
    } catch {
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      }
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket >= 0 && lastBracket > firstBracket) {
        return JSON.parse(text.slice(firstBracket, lastBracket + 1));
      }
      throw new Error('模型返回内容未能解析为有效 JSON');
    }
  }

  function explainFetchError(err, profile) {
    const msg = String(err?.message || err || '');
    if (err?.name === 'AbortError' || /timeout|aborted/i.test(msg)) {
      return '请求超时，请检查网络连接或适当换用响应更快的模型。';
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      if (profile.providerId === 'lmstudio' || /127\.0\.0\.1|localhost/i.test(profile.baseUrl)) {
        return '无法连接本地模型服务：请确认 LM Studio / Ollama 已启动，并在设置中开启 CORS（跨域允许）开关。';
      }
      return '浏览器网络或跨域（CORS）连接受阻：请检查代理/网络连接，或确认自定义接口地址支持跨域访问。';
    }
    return msg;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const resp = await fetch(url, ctrl ? { ...options, signal: ctrl.signal } : options);
      return resp;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ==================== Fetch Available Models List ====================
  async function fetchModels(override = {}) {
    const cur = getActiveProfile();
    const providerId = override.providerId || cur.providerId;
    const providerMeta = PROVIDERS[providerId] || PROVIDERS.openai;
    const protocol = providerMeta.protocol;
    const baseUrl = normalizeBaseUrl(override.baseUrl ?? cur.baseUrl, protocol);
    const apiKey = override.apiKey !== undefined ? String(override.apiKey).trim() : cur.apiKey;

    if (providerMeta.needsKey && !apiKey) {
      throw new Error(`请先填入 ${providerMeta.label} 的 API 密钥后再读取模型列表`);
    }

    try {
      let models = [];
      if (protocol === 'gemini') {
        const url = `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`;
        const resp = await fetchWithTimeout(url, { method: 'GET' }, 15000);
        if (!resp.ok) {
          const detail = await resp.text().catch(() => '');
          throw new Error(`读取 Gemini 模型失败 (HTTP ${resp.status}) ${detail.slice(0, 120)}`);
        }
        const data = await resp.json();
        models = (data.models || [])
          .filter(m => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent'))
          .map(m => String(m.name || '').replace(/^models\//, '').trim())
          .filter(Boolean);
      } else {
        const headers = { Accept: 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        let url = `${baseUrl}/models`;
        let resp = await fetchWithTimeout(url, { method: 'GET', headers }, 15000);
        if (resp.status === 404 && !/\/v1$/i.test(baseUrl)) {
          url = `${baseUrl}/v1/models`;
          resp = await fetchWithTimeout(url, { method: 'GET', headers }, 15000);
        }
        if (!resp.ok) {
          const detail = await resp.text().catch(() => '');
          throw new Error(`读取模型列表失败 (HTTP ${resp.status}) ${detail.slice(0, 120)}`);
        }
        const data = await resp.json();
        const rawList = Array.isArray(data?.data)
          ? data.data
          : (Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : []));
        models = rawList
          .map(m => typeof m === 'string' ? m : String(m?.id || m?.name || '').replace(/^models\//, '').trim())
          .filter(Boolean);
      }

      const unique = [...new Set([providerMeta.defaultModel, ...models])];
      saveConfig({
        providerId,
        profilePatch: {
          baseUrl,
          apiKey,
          fetchedModels: unique
        }
      });
      return unique;
    } catch (err) {
      throw new Error(explainFetchError(err, { providerId, baseUrl }));
    }
  }

  // ==================== Unified Chat JSON Completion ====================
  async function requestJSON({ systemPrompt, userPrompt, temperature = 0.55 }, overrideProfile = null) {
    const prof = overrideProfile || getActiveProfile();
    if (prof.needsKey && !prof.apiKey) {
      throw new Error(`尚未配置 ${prof.providerLabel} 的 API Key`);
    }
    const baseUrl = normalizeBaseUrl(prof.baseUrl, prof.protocol);
    const model = String(prof.model || prof.defaultModel).trim();

    try {
      if (prof.protocol === 'gemini') {
        const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(prof.apiKey)}`;
        const body = {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature,
            responseMimeType: 'application/json'
          }
        };
        const resp = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }, prof.timeoutMs || 22000);
        if (!resp.ok) {
          const detail = await resp.text().catch(() => '');
          throw new Error(`Gemini 调用失败 (HTTP ${resp.status}): ${detail.slice(0, 140)}`);
        }
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') || '';
        return stripReasoningAndExtractJSON(text);
      }

      // OpenAI / DeepSeek / LM Studio / Custom OpenAI-compatible
      let chatUrl = `${baseUrl}/chat/completions`;
      const headers = { 'Content-Type': 'application/json' };
      if (prof.apiKey) {
        headers.Authorization = `Bearer ${prof.apiKey}`;
      } else if (prof.providerId === 'lmstudio') {
        headers.Authorization = 'Bearer lm-studio';
      }

      const payload = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature
      };
      // DeepSeek & OpenAI support json_object; avoid forcing on local LM Studio where some GGUF templates reject response_format
      if (prof.providerId === 'openai' || prof.providerId === 'deepseek') {
        payload.response_format = { type: 'json_object' };
      }

      let resp = await fetchWithTimeout(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      }, prof.timeoutMs || 22000);

      // Retry without response_format if a custom/newer reasoning model rejects json_object
      if (resp.status === 400 && payload.response_format) {
        delete payload.response_format;
        resp = await fetchWithTimeout(chatUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        }, prof.timeoutMs || 22000);
      }

      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        throw new Error(`AI 接口调用失败 (HTTP ${resp.status}): ${detail.slice(0, 140)}`);
      }
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content || '';
      return stripReasoningAndExtractJSON(content);
    } catch (err) {
      throw new Error(explainFetchError(err, prof));
    }
  }

  async function testConnection(override = {}) {
    const cur = getActiveProfile();
    const pid = override.providerId || cur.providerId;
    const pMeta = PROVIDERS[pid] || PROVIDERS.openai;
    const testProf = {
      ...cur,
      providerId: pid,
      providerLabel: pMeta.label,
      protocol: pMeta.protocol,
      needsKey: pMeta.needsKey,
      defaultModel: pMeta.defaultModel,
      baseUrl: override.baseUrl || cur.baseUrl,
      apiKey: override.apiKey !== undefined ? override.apiKey : cur.apiKey,
      model: override.model || cur.model,
      timeoutMs: 15000
    };
    const t0 = Date.now();
    const res = await requestJSON({
      systemPrompt: 'You are a concise assistant. Output strict JSON only: {"ok":true,"greeting":"string"}',
      userPrompt: '请用一句15字以内的中文鼓励五年级小朋友背英语单词，返回 {"ok":true,"greeting":"..."}',
      temperature: 0.3
    }, testProf);
    return {
      ok: true,
      latencyMs: Date.now() - t0,
      model: testProf.model,
      greeting: String(res?.greeting || '连接畅通，AI 伴学教练已就位！')
    };
  }

  // ==================== Local AI Bank & Anti-Spoiler / Grade-5A Validator ====================
  function loadBank() {
    if (memBank) return memBank;
    let bank = { items: {} };
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(BANK_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.items === 'object') bank = parsed;
        }
      }
    } catch {}
    memBank = bank;
    return bank;
  }

  function saveBank() {
    if (!memBank) return;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(memBank));
      }
    } catch {}
  }

  function isCleanNonSpoilerHint(hint, targetEn) {
    const h = String(hint || '').trim();
    if (!h || h.length > 80) return false;
    if (/[A-Za-z]-[A-Za-z]/.test(h)) return false;
    const normTarget = String(targetEn || '').trim().toLowerCase();
    if (normTarget.length >= 2 && h.toLowerCase().includes(normTarget)) return false;
    // Disallow leaking multi-letter words from target answer inside hint
    const targetWords = normTarget.split(/[^a-z]+/).filter(w => w.length >= 3);
    for (const w of targetWords) {
      if (h.toLowerCase().includes(w)) return false;
    }
    return true;
  }

  function validateGeneratedVariant(item, rawVar) {
    if (!rawVar || typeof rawVar !== 'object') return null;
    const expected = String(rawVar.expected || item.en || '').trim();
    const validTargets = [
      item.en,
      item.usVariant,
      item.selfVariant,
      ...(item.acceptedVariants || []),
      ...(item.contextVariants || [])
    ].filter(Boolean).map(s => String(s).trim().toLowerCase());

    if (!validTargets.includes(expected.toLowerCase())) return null;

    let template = String(rawVar.template || '').trim();
    if (!template) return null;
    // Normalize blank placeholder to ______
    if (!template.includes('______')) {
      const escExp = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(`\\b${escExp}\\b`, 'i');
      if (reg.test(template)) {
        template = template.replace(reg, '______');
      } else if (/_{2,}/.test(template)) {
        template = template.replace(/_{2,}/g, '______');
      } else {
        return null;
      }
    }

    // Ensure answer isn't leaked elsewhere in the template
    const restText = template.replace(/______/g, '').toLowerCase();
    if (expected.length >= 3 && restText.includes(expected.toLowerCase())) return null;

    // Enforce Jiangsu Grade 5A sentence length ceiling (max 15 words)
    const wordCount = template.split(/\s+/).filter(Boolean).length;
    if (wordCount < 2 || wordCount > 15) return null;

    const zh = String(rawVar.zh || item.zh || '').trim();
    if (!zh || zh.length > 60) return null;

    const rawHint = String(rawVar.hint || '').trim();
    const hint = isCleanNonSpoilerHint(rawHint, expected)
      ? rawHint
      : (item.cloze?.hint || '根据句意与读音拼出空缺内容');

    const memoryTip = String(rawVar.memoryTip || '').trim().slice(0, 110);

    // Validate distractors (2-3 distinct plausible wrong spellings/words)
    const rawDecoys = Array.isArray(rawVar.distractors) ? rawVar.distractors : [];
    const distractors = [];
    for (const d of rawDecoys) {
      const ds = String(d || '').trim();
      if (ds && ds.toLowerCase() !== expected.toLowerCase() && !distractors.includes(ds)) {
        distractors.push(ds);
      }
      if (distractors.length >= 3) break;
    }

    return {
      template,
      zh,
      expected,
      hint,
      memoryTip,
      distractors,
      createdAt: Date.now(),
      fromAI: true
    };
  }

  // ==================== Built-in Algorithmic Distractor & Fallback Generator ====================
  const LOCAL_EXTRA_TEMPLATES = {
    u6_get_along_with: [
      { template: 'Good friends always ______ each other.', zh: '好朋友们总是彼此和睦相处。', expected: 'get along with' },
      { template: 'Can Billy ______ Sam and Bobby?', zh: '比利能和山姆、波比和睦相处吗？', expected: 'get along with' }
    ],
    u6_between: [
      { template: 'Su Hai sits ______ Mike and Helen.', zh: '苏海坐在迈克和海伦中间。', expected: 'between' },
      { template: 'There is a small tree ______ the two walls.', zh: '两堵围墙中间有一棵小树。', expected: 'between' }
    ],
    u6_wall: [
      { template: 'There is a nice picture on the ______.', zh: '墙上有一幅好看的画。', expected: 'wall' },
      { template: 'Why not move our ______ back?', zh: '为什么不把我们的围墙往后退呢？', expected: 'wall' }
    ],
    u6_neighbour: [
      { template: 'Mrs Wu is a very kind ______.', zh: '吴太太是一位非常友善的邻居。', expected: 'neighbour' },
      { template: 'I often play chess with my ______.', zh: '我经常和我的邻居下棋。', expected: 'neighbour' }
    ],
    u6_heavy: [
      { template: 'This box of books is too ______!', zh: '这箱书太重了！', expected: 'heavy' },
      { template: 'Let me help you with your ______ bag.', zh: '让我帮你拿这个沉甸甸的包吧。', expected: 'heavy' }
    ],
    u6_drink: [
      { template: 'Would you like to ______ some milk?', zh: '你想喝点牛奶吗？', expected: 'drink' },
      { template: 'We usually ______ warm water after PE.', zh: '体育课后我们通常喝温水。', expected: 'drink' }
    ],
    u6_some: [
      { template: 'Let us buy ______ apples for grandma.', zh: '让我们给奶奶买一些苹果吧。', expected: 'some' },
      { template: 'There are ______ nice books on the desk.', zh: '书桌上有一些好看的书。', expected: 'some' }
    ],
    u6_way_back: [
      { template: "Please be careful ______.", zh: '在某人回去的路上请小心。（填词表短语原形）', expected: "on one's way back" },
      { template: 'They see a cute cat ______.', zh: '他们在回去的路上看到一只可爱的小猫。', expected: 'on their way back' }
    ],
    u6_next_to: [
      { template: 'The bookshop is ______ our school.', zh: '书店紧挨着我们的学校。', expected: 'next to' },
      { template: 'Liu Tao sits ______ Wang Bing in class.', zh: '课堂上刘涛坐在王兵旁边。', expected: 'next to' }
    ],
    u6_space: [
      { template: 'There is a big ______ behind the house.', zh: '房子后面有一大片空地。', expected: 'space' },
      { template: 'Children can play games in this ______.', zh: '孩子们可以在这块空地上做游戏。', expected: 'space' }
    ]
  };

  function synthesizeDistractors(item, expectedRaw) {
    const expected = String(expectedRaw || item.en).trim();
    const out = [];
    const add = s => {
      const clean = String(s || '').trim();
      if (clean && clean.toLowerCase() !== expected.toLowerCase() && !out.includes(clean)) {
        out.push(clean);
      }
    };

    // 1. Pull curated phonetic/trap decoys if full-word compatible
    for (const d of (item.snap?.decoys || [])) {
      if (item.type === 'word' && item.snap?.pieces?.length === 2) {
        add(d.text + item.snap.pieces[1]);
        add(item.snap.pieces[0] + d.text);
      }
    }

    // 2. Grade-5 high-frequency orthographic mutations
    if (expected.includes(' ')) {
      add(expected.replace(/\s+/g, ''));
      if (expected.includes("'")) add(expected.replace(/'/g, ''));
      if (/\bto\b/.test(expected)) add(expected.replace(/\bto\b/, 'too'));
      if (/\bwith\b/.test(expected)) add(expected.replace(/\bwith\b/, 'was'));
      if (/\bon\b/.test(expected)) add(expected.replace(/\bon\b/, 'in'));
      if (/\bthe\b/.test(expected)) add(expected.replace(/\bthe\b/, 'a'));
    } else {
      if (/ea/i.test(expected)) add(expected.replace(/ea/i, 'e'));
      if (/ee/i.test(expected)) add(expected.replace(/ee/i, 'ea'));
      if (/eigh/i.test(expected)) add(expected.replace(/eigh/i, 'iegh'));
      if (/our/i.test(expected)) add(expected.replace(/our/i, 'er'));
      if (/ie/i.test(expected)) add(expected.replace(/ie/i, 'ei'));
      if (/all$/i.test(expected)) add(expected.replace(/all$/i, 'al'));
      if (/e$/i.test(expected) && expected.length >= 4) add(expected.slice(0, -1));
      if (/([a-z])\1/i.test(expected)) add(expected.replace(/([a-z])\1/i, '$1'));
      if (/^[A-Z]/.test(expected)) add(expected.toLowerCase());
      if (expected.length >= 4) {
        const mid = Math.floor(expected.length / 2);
        add(expected.slice(0, mid - 1) + expected[mid] + expected[mid - 1] + expected.slice(mid + 1));
      }
    }

    while (out.length < 3) {
      add(expected + (expected.endsWith('s') ? 'es' : 'e'));
      if (out.length < 3) add(expected.slice(0, Math.max(2, expected.length - 1)));
      break;
    }
    return out.slice(0, 3);
  }

  function pickQuizVariant(item, difficulty = 'normal', useWordlistForm = true) {
    const bank = loadBank();
    const cachedList = bank.items?.[item.id]?.variants || [];
    const localPool = [];

    if (item.sentencePrompt?.template) {
      localPool.push({
        template: item.sentencePrompt.template,
        zh: item.sentencePrompt.zh || item.zh,
        expected: useWordlistForm && item.id === 'u6_way_back' && difficulty !== 'challenge'
          ? item.sentencePrompt.expected
          : (item.sentencePrompt.expected || item.en),
        hint: item.cloze?.hint || '根据句意与读音补全空缺',
        memoryTip: item.helpNote || '',
        distractors: synthesizeDistractors(item, item.sentencePrompt.expected || item.en),
        fromAI: false
      });
    }

    for (const extra of (LOCAL_EXTRA_TEMPLATES[item.id] || [])) {
      if (useWordlistForm && extra.expected !== item.en && difficulty === 'easy') continue;
      localPool.push({
        ...extra,
        hint: item.cloze?.hint || '根据句意与读音拼出目标词',
        memoryTip: item.helpNote || '',
        distractors: synthesizeDistractors(item, extra.expected),
        fromAI: false
      });
    }

    const combined = [...cachedList, ...localPool];
    if (!combined.length) {
      return {
        template: '______',
        zh: item.zh,
        expected: item.en,
        hint: item.cloze?.hint || '按读音拼出完整内容',
        memoryTip: item.helpNote || '',
        distractors: synthesizeDistractors(item, item.en),
        fromAI: false
      };
    }

    // Rotate through variants so repeated sessions don't show the exact same question!
    const cursorKey = `${item.id}_${difficulty}`;
    bank.cursors = bank.cursors || {};
    const idx = (bank.cursors[cursorKey] || 0) % combined.length;
    bank.cursors[cursorKey] = idx + 1;
    saveBank();

    const chosen = combined[idx];
    if (!chosen.distractors?.length) {
      chosen.distractors = synthesizeDistractors(item, chosen.expected);
    }
    return chosen;
  }

  function getMemoryCoachTip(item) {
    const bank = loadBank();
    return bank.items?.[item.id]?.memoryTip || item.helpNote || '';
  }

  // ==================== Background Batch AI Prefetch (Zero-Blocking) ====================
  let inflightSessionKey = null;

  async function prefetchPackQuestions(items, difficulty = 'normal', errorSummary = {}) {
    if (!isReady() || !Array.isArray(items) || !items.length) {
      return { ok: false, reason: 'AI_NOT_CONFIGURED' };
    }
    const batchItems = items.slice(0, 12);
    const sig = `${getActiveProfile().providerId}:${getActiveProfile().model}:${difficulty}:${batchItems.map(i => i.id).join(',')}`;
    if (inflightSessionKey === sig) return { ok: true, skipped: true };
    inflightSessionKey = sig;

    const bank = loadBank();
    const diffDesc = difficulty === 'easy'
      ? '初学·简单模式（侧重形象巧记口诀与最直观的五上日常短句）'
      : (difficulty === 'challenge'
        ? '考核·挑战模式（侧重易混拼写陷阱、词组空格/撇号细节与新情境活用）'
        : '温习·普通模式（侧重贴近课本的五上全新简单句挖空与常见错拼干扰项）');

    const topErrs = Object.entries(errorSummary || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k)
      .join(', ') || '漏写不发音e、元音组合混淆、短语漏空格';

    const itemBriefs = batchItems.map(it => {
      const prevTemplates = (bank.items?.[it.id]?.variants || []).slice(0, 3).map(v => v.template);
      return {
        id: it.id,
        en: it.en,
        zh: it.zh,
        type: it.type,
        avoidTemplates: prevTemplates
      };
    });

    const systemPrompt = [
      '你是江苏省苏教译林版小学英语五年级上册（2026新课标版）资深伴学教练。',
      '请为给定的词条生成适合中国小学五年级上学期水平（CEFR Pre-A1~A1）的巧记法与全新测试题，严格返回 JSON 对象。',
      '硬性约束：',
      '1. 例句必须极简自然（每句 4~11 个英文词），只准使用译林三至五年级常见基础词（如 I, we, he, she, Mike, Su Hai, Bobby, Sam, home, school, park, bag, book, house, water, friend, good, nice 等），严禁出现初中及以上超纲生词！',
      '2. template 中目标词位置必须统一用 6 个下划线 ______ 挖空，expected 必须与原词条 en 完全一致（保留英式拼写如 neighbour / favourite 及短语原形）。',
      '3. hint 为纯中文思考提示（不超28字），严禁在 hint 中直接写出目标英文单词或 a-b-c 连字符字母剧透！',
      '4. distractors 提供 3 个五年级学生最容易拼错的近形错词或易混干扰项（如漏哑e、ea写e、next too 等）。',
      '5. 避开 avoidTemplates 中已出过的旧句子，保证每次题目新鲜不重样。',
      '返回格式：{"items":[{"id":"词条id","memoryTip":"一句话五上趣味巧记口诀","template":"含 ______ 的简单英文句","zh":"对应中文句意","hint":"不剧透的中文提示","distractors":["错项1","错项2","错项3"]}]}'
    ].join('\n');

    const userPrompt = JSON.stringify({
      difficultyMode: diffDesc,
      studentCommonWeakness: topErrs,
      targets: itemBriefs
    });

    try {
      const data = await requestJSON({ systemPrompt, userPrompt, temperature: 0.65 });
      const arr = Array.isArray(data?.items) ? data.items : [];
      let acceptedCount = 0;

      for (const raw of arr) {
        const targetItem = batchItems.find(x => x.id === raw?.id);
        if (!targetItem) continue;
        const cleanVar = validateGeneratedVariant(targetItem, raw);
        if (!cleanVar) continue;

        bank.items[targetItem.id] = bank.items[targetItem.id] || { memoryTip: '', variants: [] };
        if (cleanVar.memoryTip) {
          bank.items[targetItem.id].memoryTip = cleanVar.memoryTip;
        }
        const existingVars = bank.items[targetItem.id].variants;
        const isDup = existingVars.some(v => v.template.toLowerCase() === cleanVar.template.toLowerCase());
        if (!isDup) {
          existingVars.unshift(cleanVar);
          bank.items[targetItem.id].variants = existingVars.slice(0, 6);
        }
        acceptedCount++;
      }
      saveBank();
      return { ok: true, acceptedCount };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    } finally {
      if (inflightSessionKey === sig) inflightSessionKey = null;
    }
  }

  // ==================== On-Demand Mistake Micro-Diagnosis ====================
  async function diagnoseMistake(item, wrongInput) {
    if (!isReady() || !item || !wrongInput) return null;
    try {
      const res = await requestJSON({
        systemPrompt: '你是温和风趣的江苏五年级英语老师。对比学生的错拼与正确单词，用一句不超过45字的中文指出漏了哪/错在哪，并给一个秒记小口诀。严格返回 JSON：{"tip":"..."}',
        userPrompt: JSON.stringify({ target: item.en, meaning: item.zh, studentTyped: String(wrongInput).slice(0, 60) }),
        temperature: 0.4
      });
      return res?.tip ? String(res.tip).trim().slice(0, 100) : null;
    } catch {
      return null;
    }
  }

  // ==================== Parent Prep: AI Custom Wordlist Enrichment ====================
  async function enrichCustomItems(items) {
    if (!isReady() || !Array.isArray(items) || !items.length) {
      throw new Error('请先在上方配置并启用 AI 接口');
    }
    const targets = items.slice(0, 20).map(it => ({ id: it.id, en: it.en, zh: it.zh, type: it.type }));
    const systemPrompt = [
      '你是江苏译林版小学五年级英语教研员。请为家长导入的词条补全自然拼读拆块、记忆口诀、2个易错拼写干扰块和1句五年级简单例句挖空。',
      '严格返回 JSON：{"items":[{"id":"...","pieces":["音节或词块1","块2"],"helpNote":"一句话拼写记忆法","decoys":[{"text":"干扰块","tip":"温和纠错提示"}],"template":"含 ______ 的五年级简单例句","sentenceZh":"例句中文","clozeHint":"不剧透任何英文字母的中文提示"}]}'
    ].join('\n');

    const data = await requestJSON({
      systemPrompt,
      userPrompt: JSON.stringify({ items: targets }),
      temperature: 0.45
    });
    return Array.isArray(data?.items) ? data.items : [];
  }

  // ==================== Surface 1: On-Demand Alternative AI Mnemonic ====================
  async function generateAltMnemonic(item, prevTip = '') {
    if (!isReady() || !item) throw new Error('请先在「🤖 家长与AI设置」配置并启用 AI 接口');
    const res = await requestJSON({
      systemPrompt: '你是很会哄江苏小学五年级孩子记单词的金牌英语老师。请换一种全新的、更好玩的记忆法（如画面联想、拆音节故事或同类词口诀），不要和旧口诀重复，不超过55字。严格返回 JSON：{"tip":"..."}',
      userPrompt: JSON.stringify({ word: item.en, meaning: item.zh, previousTip: prevTip }),
      temperature: 0.85
    });
    const tip = String(res?.tip || '').trim().slice(0, 110);
    if (!tip) throw new Error('AI 未返回有效记法');
    const bank = loadBank();
    bank.items[item.id] = bank.items[item.id] || { memoryTip: '', variants: [] };
    bank.items[item.id].memoryTip = tip;
    saveBank();
    return tip;
  }

  // ==================== Surface 3: Current-Pack Context Story & AI Story Weaver ====================
  function buildLocalMiniStory(packId, items) {
    const list = (items || []).slice(0, 10);
    // Dedicated coherent story when practicing Unit 6 Wordlist 1-10 (all 10 words!)
    const idSet = new Set(list.map(it => it.id));
    if (idSet.has('u6_get_along_with') && idSet.has('u6_between') && idSet.has('u6_heavy')) {
      const lines = [
        { en: 'Bobby and Sam live next to their friendly neighbour.', zh: '波比和山姆住在他们友好的邻居隔壁。', targets: ['next to', 'neighbour'] },
        { en: 'They always get along with each other.', zh: '他们总是彼此和睦相处。', targets: ['get along with'] },
        { en: 'There is a big space between two old walls.', zh: '两堵旧围墙中间有一大片空地。', targets: ['space', 'between', 'wall'] },
        { en: 'On their way back, Billy carries a very heavy bag.', zh: '在回去的路上，比利提着一个非常重的包。', targets: ['on their way back', 'heavy'] },
        { en: 'Let us stop and drink some water together!', zh: '让我们停下来一起喝点水吧！', targets: ['drink', 'some'] }
      ];
      return {
        title: '📖 本组词串记微故事：好邻居与野餐归途（精准覆盖本组生词）',
        sentences: lines.filter(l => l.targets.some(t => list.some(it => it.en.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(it.en.toLowerCase().replace("one's", 'their'))))),
        fromAI: false
      };
    }

    const sentences = list.map(it => {
      const ctxEn = it.context?.en || (it.sentencePrompt?.template ? it.sentencePrompt.template.replace('______', it.sentencePrompt.expected || it.en) : it.en);
      const ctxZh = it.context?.zh || it.sentencePrompt?.zh || it.zh;
      return { en: ctxEn, zh: ctxZh, targets: [it.sentencePrompt?.expected || it.en] };
    });
    return {
      title: `📖 本组 ${list.length} 个词专属语境句卡（100% 紧扣当前词单）`,
      sentences,
      fromAI: false
    };
  }

  function getMiniStory(packId, items) {
    const bank = loadBank();
    if (bank.stories?.[packId]?.sentences?.length) {
      return bank.stories[packId];
    }
    return buildLocalMiniStory(packId, items);
  }

  async function generateMiniStory(packId, items) {
    if (!isReady() || !Array.isArray(items) || !items.length) {
      throw new Error('请先在「🤖 家长与AI设置」配置并启用 AI 接口');
    }
    const list = items.slice(0, 10);
    const systemPrompt = [
      '你是江苏译林版小学英语五年级上册创意老师。请把下面这组必默词全部串联进一篇 4~6 句搞笑温馨的五年级小短文（主角可用 Bobby、Sam、Billy、Su Hai、Mike）。',
      '硬性要求：1. 句式与词汇严格保持江苏三至五年级上学期水平，绝不超纲；2. 每句 6~13 个词；3. 尽量用上全部目标词，并在 targets 数组里列出该句实际用到的目标词原文。',
      '严格返回 JSON：{"title":"中文趣味标题","sentences":[{"en":"英文句子","zh":"中文翻译","targets":["本句用到的目标词1"]}]}'
    ].join('\n');
    const data = await requestJSON({
      systemPrompt,
      userPrompt: JSON.stringify({ words: list.map(it => ({ en: it.en, zh: it.zh })) }),
      temperature: 0.78
    });
    const rawSents = Array.isArray(data?.sentences) ? data.sentences : [];
    const cleanSents = rawSents
      .map(s => ({
        en: String(s?.en || '').trim(),
        zh: String(s?.zh || '').trim(),
        targets: Array.isArray(s?.targets) ? s.targets.map(t => String(t).trim()).filter(Boolean) : []
      }))
      .filter(s => s.en && s.zh)
      .slice(0, 8);
    if (!cleanSents.length) throw new Error('AI 未返回有效短文');
    const story = {
      title: `🤖 AI 现编五上串词小故事：${String(data?.title || '今日词单奇遇记').slice(0, 36)}`,
      sentences: cleanSents,
      fromAI: true,
      createdAt: Date.now()
    };
    const bank = loadBank();
    bank.stories = bank.stories || {};
    bank.stories[packId] = story;
    saveBank();
    return story;
  }

  // ==================== Surface 2: Multi-Round Anti-Mash True/False & Fix Arcade ====================
  function buildLocalRadarArcadeSet(items, difficulty = 'normal') {
    const list = (items || []).slice(0, 10);
    const rounds = [];
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    const targetCount = Math.min(8, Math.max(list.length, 5));

    for (let i = 0; i < targetCount; i++) {
      const it = shuffled[i % shuffled.length];
      if (!it) continue;
      const v = pickQuizVariant(it, difficulty, true);
      const correctWord = String(v.expected || it.en).trim();
      const parts = String(v.template || '______').split('______');
      const before = parts[0] || '';
      const after = parts.slice(1).join('______') || '';
      const decoys = (v.distractors || synthesizeDistractors(it, correctWord)).filter(d => d.toLowerCase() !== correctWord.toLowerCase());
      // ~60% trap rounds so child gets real defuse typing practice, ~40% true rounds so they can't blindly always pick "trap"!
      const isTrap = decoys.length > 0 && (i % 5 !== 1 && i % 5 !== 4);
      const shownWord = isTrap ? decoys[i % decoys.length] : correctWord;
      rounds.push({
        itemId: it.id,
        isTrap,
        shownWord,
        correctWord,
        before,
        after,
        zh: v.zh || it.zh,
        reason: isTrap
          ? (it.helpNote || `注意正确拼写应为 ${correctWord}`)
          : `完全正确！「${correctWord}」在这个句子里拼写与用法都没毛病。`,
        fromAI: Boolean(v.fromAI)
      });
    }
    return rounds;
  }

  async function generateRadarArcadeSet(items, difficulty = 'normal') {
    if (!isReady() || !Array.isArray(items) || !items.length) {
      throw new Error('请先在「🤖 家长与AI设置」配置并启用 AI 接口');
    }
    const list = items.slice(0, 8);
    const diffLabel = difficulty === 'challenge'
      ? '挑战难度（极易混淆的细微拼写陷阱：哑音e、双写字母、撇号、介词to/too、英式our）'
      : '五上适中难度（贴近小学生真实错拼的明显拼写陷阱）';
    const systemPrompt = [
      '你是江苏译林版小学五年级英语游戏关卡设计师。请为「真假拼写鉴别官」小游戏设计一组多轮连续关卡（每词1关）。',
      '规则：一半关卡 isTrap=true（把目标词改成五年级最容易犯的错拼，如 hevy / nieghbour / bitween / next too / get along was / on ones way back），另一半 isTrap=false（完全正确拼写）。句子必须是极简五上水平（5~11词），目标词位置用 ______ 标记。',
      '严格返回 JSON：{"rounds":[{"id":"词条id","isTrap":true,"shownWord":"显示在空里的词(真或假)","correctWord":"正确目标词","template":"含 ______ 的五上简单句","zh":"中文句意","reason":"1句简短中文解析"}]}'
    ].join('\n');

    const data = await requestJSON({
      systemPrompt,
      userPrompt: JSON.stringify({ difficulty: diffLabel, items: list.map(it => ({ id: it.id, en: it.en, zh: it.zh })) }),
      temperature: 0.72
    });
    const rawRounds = Array.isArray(data?.rounds) ? data.rounds : [];
    const valid = [];
    for (const r of rawRounds) {
      const it = list.find(x => x.id === r?.id);
      if (!it) continue;
      const tpl = String(r?.template || '').trim();
      if (!tpl.includes('______')) continue;
      const correctWord = String(r?.correctWord || it.en).trim();
      const shownWord = String(r?.shownWord || '').trim();
      if (!shownWord || !correctWord) continue;
      const isTrap = shownWord.toLowerCase() !== correctWord.toLowerCase() || (/[A-Z]/.test(correctWord) && shownWord !== correctWord);
      const parts = tpl.split('______');
      valid.push({
        itemId: it.id,
        isTrap,
        shownWord,
        correctWord,
        before: parts[0] || '',
        after: parts.slice(1).join('______') || '',
        zh: String(r?.zh || it.zh).trim(),
        reason: String(r?.reason || it.helpNote || '').trim().slice(0, 90),
        fromAI: true
      });
    }
    if (valid.length < 2) throw new Error('AI 返回的有效关卡数量不足，已保持内置关卡');
    return valid;
  }

  // ==================== Surface 6: Post-Session AI Coach Debrief ====================
  async function generateSessionCoachReport(payload) {
    if (!isReady()) return null;
    try {
      const res = await requestJSON({
        systemPrompt: '你是温暖专业的江苏小学五年级英语伴学教练。根据学生刚刚完成的无纸化默写成绩，给出3条极简实用的中文反馈（每条不超过40字）：1.praise(表扬具体亮点)；2.focusTip(指出明天课堂默写最需提防的1-2个拼写陷阱)；3.tomorrowDrill(给家长睡前30秒口头抽查建议)。严格返回 JSON：{"praise":"...","focusTip":"...","tomorrowDrill":"..."}',
        userPrompt: JSON.stringify(payload),
        temperature: 0.5
      });
      if (!res?.praise) return null;
      return {
        praise: String(res.praise).trim().slice(0, 90),
        focusTip: String(res.focusTip || '').trim().slice(0, 100),
        tomorrowDrill: String(res.tomorrowDrill || '').trim().slice(0, 100)
      };
    } catch {
      return null;
    }
  }

  return {
    PROVIDERS,
    SECRET_STORAGE_KEY,
    loadConfig,
    saveConfig,
    getActiveProfile,
    isReady,
    fetchModels,
    testConnection,
    requestJSON,
    stripReasoningAndExtractJSON,
    isCleanNonSpoilerHint,
    validateGeneratedVariant,
    synthesizeDistractors,
    pickQuizVariant,
    getMemoryCoachTip,
    prefetchPackQuestions,
    diagnoseMistake,
    enrichCustomItems,
    generateAltMnemonic,
    buildLocalMiniStory,
    getMiniStory,
    generateMiniStory,
    buildLocalRadarArcadeSet,
    generateRadarArcadeSet,
    generateSessionCoachReport
  };
})();

if (typeof module !== 'undefined') module.exports = SnapAI;
