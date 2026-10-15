export class Pronouncer {
  constructor(environment = globalThis.window, onStatus = () => {}) {
    this.env = environment; this.onStatus = onStatus; this.sequence = 0;
    this.urls = new Map(); this.failedLookups = new Map(); this.activeCancel = null; this.abort = null;
  }

  stop() {
    this.sequence++;
    this.activeCancel?.(); this.activeCancel = null;
    this.abort?.abort(); this.abort = null;
    this.env.speechSynthesis?.cancel();
  }

  async play(entry, settings = {}) {
    this.stop();
    const id = this.sequence;
    const text = entry.spoken || entry.display;
    const rate = Number(settings.rate) || 1;
    const repetitions = Math.min(3, Math.max(1, Number(settings.repeat) || 1));
    for (let i = 0; i < repetitions; i++) {
      let ok = false;
      if (settings.voice === 'real' && /^[A-Za-z'’-]+$/.test(text)) {
        const url = await this.dictionaryUrl(text);
        if (id !== this.sequence) return {cancelled: true};
        if (url) ok = await this.remote(url, rate, id, '词典发音');
      }
      if (!ok && id === this.sequence) ok = await this.native(text, rate, id);
      if (!ok && id === this.sequence && settings.voice !== 'offline') {
        const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=1`;
        ok = await this.remote(url, rate, id, '在线词典');
        if (!ok && id === this.sequence) ok = await this.remote(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-gb&q=${encodeURIComponent(text)}`, rate, id, '在线合成语音');
      }
      if (id !== this.sequence) return {cancelled: true};
      if (!ok) return {ok: false, error: settings.voice === 'offline' ? '没有可用的本地英语语音，请检查系统语音包或切换发音方式。' : '发音失败，请重试，或将本词标记为未播放并跳过。'};
      if (i < repetitions - 1) await this.delay(350, id);
    }
    return {ok: id === this.sequence, cancelled: id !== this.sequence};
  }

  delay(ms, id) {
    return new Promise(resolve => {
      const timer = setTimeout(() => {if (this.activeCancel === cancel) this.activeCancel = null; resolve(id === this.sequence);}, ms);
      const cancel = () => {clearTimeout(timer); resolve(false);};
      this.activeCancel = cancel;
    });
  }

  async native(text, rate, id) {
    const synth = this.env.speechSynthesis;
    if (!synth || !this.env.SpeechSynthesisUtterance) return false;
    if (!synth.getVoices().length) {
      await this.delay(900, id);
      if (id !== this.sequence) return false;
    }
    const voices = synth.getVoices().filter(voice => /^en[-_]/i.test(voice.lang))
      .sort((a, b) => voiceScore(b) - voiceScore(a));
    for (const voice of voices.slice(0, 2)) {
      if (id !== this.sequence) return false;
      if (voice.localService === false) continue;
      const ok = await new Promise(resolve => {
        const utterance = new this.env.SpeechSynthesisUtterance(text);
        let timer;
        const finish = result => {
          clearTimeout(timer); utterance.onend = utterance.onerror = utterance.onstart = null;
          if (this.activeCancel === cancel) this.activeCancel = null;
          resolve(result);
        };
        const cancel = () => finish(false);
        this.activeCancel = cancel;
        utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = rate;
        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(false);
        utterance.onstart = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {synth.cancel(); finish(false);}, Math.min(60000, Math.max(12000, text.length * 500 / rate)));
          this.onStatus('本地英语语音');
        };
        timer = setTimeout(() => {synth.cancel(); finish(false);}, 3000);
        try {synth.speak(utterance);} catch {finish(false);}
      });
      if (ok) return true;
    }
    return false;
  }

  remote(url, rate, id, label) {
    if (id !== this.sequence) return Promise.resolve(false);
    return new Promise(resolve => {
      const audio = new this.env.Audio();
      let timer, settled = false;
      const finish = result => {
        if (settled) return; settled = true;
        clearTimeout(timer); audio.onended = audio.onerror = audio.onplaying = null;
        if (!result) audio.pause();
        if (this.activeCancel === cancel) this.activeCancel = null;
        resolve(result);
      };
      const cancel = () => finish(false);
      this.activeCancel = cancel;
      audio.playbackRate = rate; audio.preload = 'auto';
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.onplaying = () => {
        this.onStatus(label); clearTimeout(timer);
        timer = setTimeout(() => finish(false), Math.min(60000, Math.max(15000, (audio.duration || 20) / rate * 1000 + 5000)));
      };
      timer = setTimeout(() => finish(false), 6500);
      try {audio.src = url; audio.play()?.catch(() => finish(false));} catch {finish(false);}
    });
  }

  async dictionaryUrl(text) {
    if (this.urls.has(text)) return this.urls.get(text);
    if (Date.now() - (this.failedLookups.get(text) || 0) < 60000) return null;
    const controller = new AbortController(); this.abort = controller;
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await this.env.fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`, {signal: controller.signal});
      if (!response.ok) throw new Error('dictionary');
      const result = await response.json();
      const phonetics = result[0]?.phonetics || [];
      const url = (phonetics.find(item => item.audio && /uk|_gb/i.test(item.audio)) || phonetics.find(item => item.audio))?.audio;
      if (url && /^https:\/\//.test(url)) {this.urls.set(text, url); return url;}
    } catch { /* The caller tries local synthesis and then other sources. */ }
    finally {clearTimeout(timer); if (this.abort === controller) this.abort = null;}
    this.failedLookups.set(text, Date.now());
    return null;
  }
}

function voiceScore(voice) {
  return (/^en[-_]gb/i.test(voice.lang) ? 100 : 40) + (voice.localService ? 50 : 0);
}

export class PlaybackQueue {
  constructor(player, {onChange = () => {}, onPlayed = () => {}} = {}) {
    this.player = player; this.onChange = onChange; this.onPlayed = onPlayed;
    this.entries = []; this.position = 0; this.running = false; this.generation = 0;
  }

  configure(entries, position = 0, settings = {}) {
    this.pause(); this.entries = entries; this.position = Math.min(position, entries.length);
    this.settings = {...settings}; this.status = 'idle'; this.emit();
  }

  emit(error = '') {this.onChange({index: this.position, running: this.running, status: this.status, error});}

  pause() {
    this.running = false; this.generation++;
    this.player.stop(); this.cancelGap?.(); this.cancelGap = null;
    this.status = 'paused'; this.emit();
  }

  async start() {
    if (this.running) return;
    if (this.position >= this.entries.length) this.position = 0;
    this.running = true;
    const generation = ++this.generation;
    while (this.running && generation === this.generation && this.position < this.entries.length) {
      this.status = 'playing'; this.emit();
      const entry = this.entries[this.position];
      const result = await this.player.play(entry, this.settings);
      if (generation !== this.generation || !this.running) return;
      if (!result.ok) {
        this.running = false; this.status = 'failed'; this.emit(result.error || '发音未完成，请重试'); return;
      }
      this.onPlayed(entry);
      this.position++;
      if (this.position < this.entries.length) {
        this.status = 'gap'; this.emit();
        await new Promise(resolve => {
          const timer = setTimeout(resolve, (this.settings.gap ?? 2) * 1000);
          this.cancelGap = () => {clearTimeout(timer); resolve();};
        });
        this.cancelGap = null;
      }
    }
    if (generation === this.generation) {this.running = false; this.status = 'ended'; this.emit();}
  }

  jump(index) {this.pause(); this.position = Math.max(0, Math.min(index, this.entries.length - 1)); this.emit();}
}
