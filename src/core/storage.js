import { makeEntry, vocabulary } from './vocabulary.js';
import { applyResults } from './review.js';

export const STORAGE_KEY = 'wl4_workspace';
export const SAFETY_KEY = 'wl4_before_import';
const clone = value => structuredClone(value);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

export function emptyState() {
  return {
    version: 4, revision: 0, sessions: [], progress: {}, draft: null, customLists: [],
    clips: [], clipNotes: [], plan: {words: 50, minutes: 30},
    audio: {rate: 1, repeat: 1, gap: 2, voice: 'tts', auto: false}, theme: 'system',
    migration: null, lastBackupAt: null
  };
}

function rejectUnsafe(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('备份包含不支持的字段');
    rejectUnsafe(child);
  }
}

function validEntry(entry) {
  return isObject(entry) && typeof entry.id === 'string' && typeof entry.display === 'string'
    && typeof entry.lexemeId === 'string' && typeof entry.meaning === 'string'
    && !['__proto__', 'constructor', 'prototype'].includes(entry.id)
    && !['__proto__', 'constructor', 'prototype'].includes(entry.lexemeId)
    && Array.isArray(entry.answers) && entry.answers.length > 0 && entry.answers.every(answer => typeof answer === 'string');
}

function validResult(result) {
  return isObject(result) && validEntry(result.entry) && typeof result.typed === 'string'
    && typeof result.correct === 'boolean' && ['unplayed', 'correct', 'incorrect', 'blank'].includes(result.status);
}

function validPractice(session, draft = false) {
  return isObject(session) && typeof session.id === 'string' && ['cards', 'dictation'].includes(session.kind)
    && ['visual', 'audio', 'dictation'].includes(session.lane) && Array.isArray(session.entries) && session.entries.every(validEntry)
    && isObject(session.options) && isObject(session.answers) && isObject(session.attempts) && isObject(session.playCounts)
    && (!draft || (session.entries.length > 0 && isObject(session.ratings) && isObject(session.reasons) && Array.isArray(session.unplayed)
      && Number.isInteger(session.cursor) && session.cursor >= 0 && session.cursor < session.entries.length
      && Number.isInteger(session.audioIndex) && session.audioIndex >= 0 && session.audioIndex < session.entries.length));
}

export function validateState(state) {
  rejectUnsafe(state);
  if (!isObject(state) || state.version !== 4 || !Number.isInteger(state.revision)
    || !Array.isArray(state.sessions) || !isObject(state.progress) || !Array.isArray(state.customLists)
    || !Array.isArray(state.clips) || !Array.isArray(state.clipNotes) || !isObject(state.plan) || !isObject(state.audio)
    || !['light', 'dark', 'system'].includes(state.theme)) throw new Error('不是有效的 v4 学习数据');
  if (state.sessions.some(session => !validPractice(session) || !Number.isFinite(Date.parse(session.completedAt)) || !isObject(session.firstAttempt)
    || !Array.isArray(session.firstAttempt.results) || !session.firstAttempt.results.every(validResult)
    || (session.firstAttempt.score !== null && (!Number.isFinite(session.firstAttempt.score) || session.firstAttempt.score < 0 || session.firstAttempt.score > 100))
    || (session.feedback && (!Array.isArray(session.feedback) || !session.feedback.every(validResult))))) throw new Error('练习历史格式不完整');
  if (state.draft && !validPractice(state.draft, true)) throw new Error('练习草稿格式不完整');
  if (state.customLists.some(list => !isObject(list) || typeof list.id !== 'string' || !Array.isArray(list.entries) || !list.entries.every(validEntry))) throw new Error('个人词表格式不完整');
  for (const item of Object.values(state.progress)) {
    if (!isObject(item) || !validEntry(item.entry) || !Array.isArray(item.sourceIds) || !Array.isArray(item.attempts) || !isObject(item.lanes)) throw new Error('复习数据格式不完整');
    for (const [lane, data] of Object.entries(item.lanes)) {
      if (!['visual', 'audio', 'dictation'].includes(lane) || !isObject(data) || !Number.isFinite(Date.parse(data.dueAt))
        || ![data.reviews, data.lapses, data.streak].every(n => Number.isInteger(n) && n >= 0)) throw new Error('复习时间或模式无效');
    }
  }
  if (![state.plan.words, state.plan.minutes].every(n => Number.isFinite(n) && n > 0 && n <= 5000)) throw new Error('每日目标超出范围');
  if (!['tts', 'offline', 'real'].includes(state.audio.voice) || ![0.75, 1, 1.25].includes(state.audio.rate)
    || ![1, 2, 3].includes(state.audio.repeat) || ![1, 2, 3, 5].includes(state.audio.gap)) throw new Error('发音设置无效');
  if (state.clips.some(file => !isObject(file) || typeof file.id !== 'string' || typeof file.name !== 'string')) throw new Error('录音信息无效');
  if (state.clipNotes.some(note => !isObject(note) || typeof note.id !== 'string' || typeof note.fileId !== 'string'
    || typeof note.typed !== 'string' || typeof note.firstTyped !== 'string' || typeof note.reference !== 'string'
    || !Number.isFinite(note.from) || !Number.isFinite(note.to) || note.from < 0 || note.to <= note.from)) throw new Error('片段笔记无效');
  return state;
}

function legacyObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} 格式无效，原数据已保留`);
  return value;
}

export function migrateLegacy(hist = {}, wb = {}, audio = {}) {
  legacyObject(hist, '旧版历史'); legacyObject(wb, '旧版错词'); legacyObject(audio, '旧版设置');
  const state = emptyState();
  state.audio = {rate: [0.75, 1, 1.25].includes(audio.rate) ? audio.rate : 1,
    repeat: [1, 2, 3].includes(audio.rep) ? audio.rep : 1, gap: [1, 2, 3, 5].includes(audio.gap) ? audio.gap : 2,
    voice: audio.voice === 'real' ? 'real' : 'tts', auto: !!audio.auto};
  for (const [chapterId, sessions] of Object.entries(hist)) {
    if (!Array.isArray(sessions)) throw new Error('旧版章节历史应为列表');
    for (const [index, old] of sessions.entries()) {
      if (!isObject(old)) throw new Error('旧版练习记录无效');
      const list = Array.isArray(old.all) && old.all.length ? old.all : (old.wrong || []);
      if (!Array.isArray(list)) throw new Error('旧版答案列表无效');
      const entries = list.map((word, i) => makeEntry(word, {chapterId, index: i}));
      const results = entries.map((entry, i) => ({entry, typed: String(list[i].typed || ''), correct: !!list[i].ok,
        status: list[i].ok ? 'correct' : 'incorrect', reason: '', rating: null}));
      const at = Number.isFinite(Date.parse(old.date)) ? new Date(old.date).toISOString() : new Date(0).toISOString();
      state.sessions.push({id: `legacy:${chapterId}:${old.n || index + 1}:${at}`, kind: 'dictation', lane: 'dictation',
        source: '旧版迁移', chapterId, options: {shuffle: old.mode === 'shuffle'}, entries,
        firstAttempt: {at, results, score: Number(old.pct) || 0, correct: Number(old.correct) || 0, total: Number(old.total) || entries.length},
        feedback: results, attempts: {}, answers: {}, reasons: {}, playCounts: {},
        startedAt: at, completedAt: at, elapsedMs: 0, legacy: true, partial: !old.all?.length});
    }
  }
  for (const old of Object.values(wb)) {
    if (!isObject(old) || typeof old.word !== 'string') throw new Error('旧版错词格式无效');
    const match = vocabulary.find(entry => entry.display.toLowerCase() === old.word.toLowerCase() && entry.chapterId === old.chap);
    const entry = match || makeEntry({w: old.word, m: old.mean, p: old.phon}, {chapterId: old.chap || '旧版错词'});
    state.progress[entry.lexemeId] = {entry, sourceIds: [entry.id], everWrong: true, attempts: [], lanes: {
      dictation: {reviews: 0, lapses: Number(old.n) || 1, streak: 0, lastSuccessDay: null,
        dueAt: new Date(0).toISOString(), lastAt: null, status: 'learning', lastRating: 'unknown'}
    }};
  }
  state.migration = {at: new Date().toISOString(), sessions: state.sessions.length, words: Object.keys(state.progress).length};
  return validateState(state);
}

export class Repository {
  constructor(storage) { this.storage = storage; this.data = null; }

  load() {
    const text = this.storage.getItem(STORAGE_KEY);
    if (text !== null) {
      try { this.data = validateState(JSON.parse(text)); }
      catch (error) { throw new Error(`学习数据读取失败：${error.message}。请先导出原始数据再恢复。`); }
    } else {
      const read = (key, fallback = '{}') => JSON.parse(this.storage.getItem(key) ?? fallback);
      const hasLegacy = ['wl3_hist', 'wl3_wb', 'wl2_hist', 'wl2_wb'].some(key => this.storage.getItem(key) !== null);
      this.data = hasLegacy ? migrateLegacy(read(this.storage.getItem('wl3_hist') !== null ? 'wl3_hist' : 'wl2_hist'), read(this.storage.getItem('wl3_wb') !== null ? 'wl3_wb' : 'wl2_wb'), read('wl3_audio')) : emptyState();
      if (hasLegacy) this.save(this.data);
    }
    return clone(this.data);
  }

  save(next) {
    validateState(next);
    const current = this.storage.getItem(STORAGE_KEY);
    if (current !== null && this.data && JSON.parse(current).revision !== this.data.revision) throw new Error('另一个页面更新了数据。请先导出本页草稿，再刷新。');
    const value = clone(next);
    value.revision = (this.data?.revision || 0) + 1;
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(value)); }
    catch { throw new Error('保存失败：浏览器空间不足或存储不可用，请先导出备份。'); }
    this.data = value;
    return clone(value);
  }

  update(change) {
    const next = clone(this.data);
    change(next);
    return this.save(next);
  }

  commit(session) {
    if (!session.completedAt) throw new Error('练习尚未完成');
    if (this.data.sessions.some(old => old.id === session.id)) return clone(this.data);
    return this.update(next => {
      next.sessions.push(clone(session));
      applyResults(next.progress, session);
      if (next.draft?.id === session.id) next.draft = null;
    });
  }

  backup() {
    return JSON.stringify({format: 'wanglu-study', exportedAt: new Date().toISOString(), data: this.data}, null, 2);
  }

  previewImport(text) {
    let input;
    try { input = JSON.parse(text); } catch { throw new Error('不是有效的 JSON 文件'); }
    rejectUnsafe(input);
    const data = input?.format === 'wanglu-study' ? validateState(input.data)
      : input?.hist && input?.wb ? migrateLegacy(input.hist, input.wb) : validateState(input);
    return {data, sessions: data.sessions.length, words: Object.keys(data.progress).length, lists: data.customLists.length};
  }

  restore(text, mode = 'merge') {
    const {data: incoming} = this.previewImport(text);
    if (!['merge', 'replace'].includes(mode)) throw new Error('无效的恢复方式');
    const next = mode === 'replace' ? clone(incoming) : clone(this.data);
    if (mode === 'merge') {
      const ids = new Set(next.sessions.map(s => s.id));
      next.sessions.push(...incoming.sessions.filter(s => !ids.has(s.id)));
      next.sessions.sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
      for (const [key, item] of Object.entries(incoming.progress)) {
        const old = next.progress[key];
        if (!old) { next.progress[key] = clone(item); continue; }
        old.sourceIds = [...new Set([...old.sourceIds, ...item.sourceIds])];
        old.everWrong ||= item.everWrong;
        for (const [lane, state] of Object.entries(item.lanes)) {
          if (!old.lanes[lane] || Date.parse(state.lastAt || 0) > Date.parse(old.lanes[lane].lastAt || 0)) old.lanes[lane] = clone(state);
        }
        const attemptIds = new Set(old.attempts.map(a => `${a.sessionId}:${a.lane}`));
        old.attempts.push(...item.attempts.filter(a => !attemptIds.has(`${a.sessionId}:${a.lane}`)));
      }
      for (const field of ['customLists', 'clips', 'clipNotes']) {
        const existing = new Set(next[field].map(item => item.id));
        next[field].push(...incoming[field].filter(item => !existing.has(item.id)));
      }
      if (!next.draft && incoming.draft) next.draft = clone(incoming.draft);
    }
    try { this.storage.setItem(SAFETY_KEY, this.backup()); }
    catch { throw new Error('无法保存恢复前备份，已取消导入。请先手动导出并腾出浏览器空间。'); }
    return this.save(next);
  }
}
