/* 词哒 · SnapWord Audio Subsystem (v0.1.0)
 * Pure human/TTS pronunciation without noisy background SFX (safe for concurrent WeChat speakerphone calls).
 * Explicitly labels audio source: 家长自带录音 / 内置真人发音(CC) / 系统合成朗读 / 家长范读兜底.
 */
const SnapAudio = (() => {
  let activeAudio = null;
  let activeUtterance = null;
  let seq = 0;

  function findBundledRecord(text) {
    if (typeof SNAPWORD_AUDIO_CLIPS === 'undefined' || !SNAPWORD_AUDIO_CLIPS) return null;
    const raw = String(text ?? '').trim();
    if (Object.hasOwn(SNAPWORD_AUDIO_CLIPS, raw)) return SNAPWORD_AUDIO_CLIPS[raw];
    const lower = raw.toLowerCase();
    for (const [k, val] of Object.entries(SNAPWORD_AUDIO_CLIPS)) {
      if (k.toLowerCase() === lower) return val;
    }
    return null;
  }

  function resolveSourceInfo(state, itemOrText) {
    if (typeof itemOrText === 'object' && itemOrText !== null) {
      const custom = state?.recordings?.[itemOrText.id];
      if (custom) {
        return { kind: 'custom', label: '🎙️ 家长自带录音', data: custom, text: itemOrText.en };
      }
      const bundled = findBundledRecord(itemOrText.en);
      if (bundled) {
        return { kind: 'human_cc', label: '🔊 内置真人发音 (CC)', data: bundled.data, meta: bundled, text: itemOrText.en };
      }
      return { kind: 'tts', label: '🤖 系统合成朗读（建议爸爸听核）', data: null, text: itemOrText.en };
    }
    const text = String(itemOrText ?? '').trim();
    const bundled = findBundledRecord(text);
    if (bundled) {
      return { kind: 'human_cc', label: '🔊 内置真人发音 (CC)', data: bundled.data, meta: bundled, text };
    }
    return { kind: 'tts', label: '🤖 系统合成朗读', data: null, text };
  }

  function stop() {
    seq++;
    if (activeAudio) {
      try { activeAudio.pause(); } catch {}
      activeAudio = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
    activeUtterance = null;
  }

  function speakTTS(text, token, onNotice) {
    if (token !== seq) return;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      onNotice?.('当前浏览器未提供系统朗读，请直接由爸爸在视频中口头范读即可。');
      return;
    }
    const voices = (synth.getVoices?.() || []).filter(v => /^en(?:[-_]|$)/i.test(v.lang));
    const chosen = voices.find(v => v.localService && /^en[-_]GB$/i.test(v.lang))
      || voices.find(v => v.localService)
      || voices.find(v => /^en[-_]GB$/i.test(v.lang))
      || voices[0];

    const u = new SpeechSynthesisUtterance(text);
    if (chosen) u.voice = chosen;
    u.lang = chosen?.lang || 'en-GB';
    u.rate = 0.85;
    u.onend = () => { if (activeUtterance === u) activeUtterance = null; };
    u.onerror = e => {
      if (activeUtterance === u) activeUtterance = null;
      if (token === seq && !['canceled', 'interrupted'].includes(e?.error)) {
        onNotice?.('系统朗读未能播放，可由爸爸直接口头范读，不影响继续练习。');
      }
    };
    activeUtterance = u;
    try {
      synth.speak(u);
    } catch {
      activeUtterance = null;
      onNotice?.('系统语音暂不可用，请由爸爸口头范读。');
    }
  }

  function play(state, itemOrText, onNotice) {
    stop();
    const info = resolveSourceInfo(state, itemOrText);
    if (!info.text) return info;
    const token = seq;

    if (info.data) {
      const player = new Audio(info.data);
      activeAudio = player;
      player.onended = () => { if (activeAudio === player) activeAudio = null; };
      player.play().catch(() => {
        if (activeAudio === player && token === seq) {
          activeAudio = null;
          speakTTS(info.text, token, onNotice);
        }
      });
      return info;
    }

    speakTTS(info.text, token, onNotice);
    return info;
  }

  async function validateAndEncodeAudioFile(file) {
    if (!file) throw new Error('请选择音频文件');
    const ext = file.name.split('.').pop().toLowerCase();
    const mime = { mp3: 'mpeg', wav: 'wav', ogg: 'ogg' }[ext];
    if (!mime || file.size < 16 || file.size > 500 * 1024) {
      throw new Error('请选择 500 KB 以内的 MP3、WAV 或 OGG 录音文件');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = String.fromCharCode(...bytes.slice(0, 12));
    const valid = mime === 'wav' ? head.startsWith('RIFF') && head.endsWith('WAVE')
      : mime === 'ogg' ? head.startsWith('OggS')
      : head.startsWith('ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224);
    if (!valid) throw new Error('音频文件头格式不匹配，请检查文件是否损坏');

    const chunks = [];
    for (let i = 0; i < bytes.length; i += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    }
    return `data:audio/${mime};base64,${btoa(chunks.join(''))}`;
  }

  function isPlaying() {
    return Boolean((activeAudio && !activeAudio.paused && !activeAudio.ended) || activeUtterance);
  }

  return {
    resolveSourceInfo,
    play,
    stop,
    isPlaying,
    validateAndEncodeAudioFile
  };
})();

if (typeof module !== 'undefined') module.exports = SnapAudio;
