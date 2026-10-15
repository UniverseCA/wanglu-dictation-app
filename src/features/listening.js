import { uid } from '../core/session.js';
import { escapeHTML as esc, button as btn, icon, formatDate, diffHTML } from '../ui.js';
import { specialties } from './specialties.js';

export function validateRange(from, to, duration) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || (Number.isFinite(duration) && to > duration + 0.05)) throw new Error('片段需满足：0 ≤ A < B，且不能超过录音时长');
  return {from, to};
}

export class SegmentPlayer {
  constructor(audio, onError = () => {}) {
    this.audio = audio; this.onError = onError;
    audio.addEventListener('timeupdate', () => this.boundary());
    audio.addEventListener('ended', () => this.boundary());
  }
  async play({from, to, loop, rate = 1}) {
    validateRange(from, to, this.audio.duration);
    this.range = {from, to, loop}; this.active = true;
    this.audio.currentTime = from; this.audio.playbackRate = rate;
    try {await this.audio.play();} catch {this.stop(); throw new Error('录音无法播放，请检查文件或重新选择录音');}
  }
  boundary() {
    if (!this.active || this.audio.currentTime < this.range.to - 0.03) return;
    if (this.range.loop) {this.audio.currentTime = this.range.from; this.audio.play()?.catch(error => {this.stop(); this.onError(error.message);});}
    else this.stop();
  }
  stop() {this.active = false; this.audio.pause();}
}

function recordingDatabase(win) {
  return new Promise((resolve, reject) => {
    if (!win.indexedDB) {reject(new Error('浏览器不支持录音缓存')); return;}
    const request = win.indexedDB.open('wanglu-recordings', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

async function mediaFile(win, id, file) {
  const db = await recordingDatabase(win);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('files', file ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('files');
      const request = file ? store.put(file, id) : store.get(id);
      let value; request.onsuccess = () => {value = request.result;};
      transaction.oncomplete = () => resolve(value); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  } finally {db.close();}
}

export class ListeningRoom {
  constructor(app) {
    this.app = app; this.audio = app.doc.createElement('audio'); this.audio.controls = true;
    this.player = new SegmentPlayer(this.audio, message => app.toast(message, true));
    this.range = {from: 0, to: 10, loop: true, rate: 1}; this.file = null; this.noteId = null;
    this.audio.addEventListener('loadedmetadata', () => {
      this.range.to = Math.min(this.range.to, this.audio.duration || this.range.to);
      if (app.route === 'listening') {const to = app.doc.querySelector('[name="to"]'); if (to) to.value = this.range.to.toFixed(2);}
    });
    this.audio.addEventListener('error', () => app.toast('这份录音无法解码，请换用浏览器支持的音频格式', true));
  }

  render() {
    const a = this.app, notes = a.data.clipNotes.filter(note => !this.file || note.fileId === this.file.id);
    return `<div class="page-heading"><div><span class="eyebrow">LISTEN A LITTLE CLOSER</span><h1>把没听清的，慢慢听清。</h1><p>选择自己的录音，标记片段，听写、对照，再复听。</p></div></div>
      <div class="listening-layout"><section class="panel"><div class="recording-drop">${icon('audio')}<h3>${this.file ? esc(this.file.name) : '把一份录音带到这里'}</h3><p>选择书本录音或自己的练习材料，文件保存在本机。</p><input id="recording-file" type="file" accept="audio/*" aria-label="选择本地录音"></div><div id="recording-slot" class="recording-player"></div>
      <form data-form="clip-note"><div class="clip-toolbar"><label>A / 起点（秒）<input name="from" type="number" min="0" step="0.01" value="${this.range.from}"></label><label>B / 终点（秒）<input name="to" type="number" min="0" step="0.01" value="${this.range.to}"></label><label>语速<select name="rate">${[0.75, 1, 1.25].map(rate => `<option value="${rate}" ${rate === this.range.rate ? 'selected' : ''}>${rate} 倍</option>`).join('')}</select></label></div><div class="actions compact wrap">${btn('clip-from', '当前位置设为 A', 'button quiet small')}${btn('clip-to', '当前位置设为 B', 'button quiet small')}${btn('clip-play', `${icon('play')} 播放片段`, 'button primary small', this.file ? '' : 'disabled')}${btn('clip-pause', '暂停', 'button secondary small')}</div><label class="checkbox inset"><input type="checkbox" name="loop" ${this.range.loop ? 'checked' : ''}>A–B 循环播放</label>
      <label>我的听写<textarea name="typed" rows="4" placeholder="先听，再把听到的内容写下来。">${esc(this.editing?.typed || '')}</textarea></label><label>参考原文（可选）<textarea name="reference" rows="3" placeholder="从自己的材料中填入原文，用于对照。">${esc(this.editing?.reference || '')}</textarea></label><label>来源 / 题号<input name="source" value="${esc(this.editing?.source || '')}" placeholder="例如：剑雅 · Test · Part · 题号" maxlength="200"></label><button class="button secondary" type="submit" ${this.file ? '' : 'disabled'}>保存片段与听写</button><p class="field-note">JSON 备份包含片段标记和文字，不包含录音文件。音频缓存不可用时，可重新选择同名文件继续。</p></form></section>
      <aside><section class="panel"><div class="section-heading"><h2>我的录音</h2></div>${a.data.clips.length ? a.data.clips.map(file => `<div class="list-item"><span>${esc(file.name)}</span>${btn('clip-load', '打开', 'text-button', `data-id="${esc(file.id)}"`)}</div>`).join('') : '<p>首次选择录音后，会在这里保留文件记录。</p>'}</section><section class="panel inset"><div class="section-heading"><h2>片段笔记</h2></div>${notes.length ? notes.slice().reverse().map(note => `<div class="clip-note"><strong>${esc(note.source || note.fileName)}</strong><small>${note.from.toFixed(1)}–${note.to.toFixed(1)} 秒 · ${formatDate(note.at)}</small><p>${esc(note.typed)}</p>${btn('clip-edit', '复听与订正 →', 'text-button', `data-id="${esc(note.id)}"`)}</div>`).join('') : '<p>记录最需要复听的几秒钟。</p>'}</section></aside></div>
      <div class="section-heading"><h2>听力专项练习</h2><span>工具自编练习 · 非官方试题</span></div><div class="special-grid">${specialties.map(set => `<button class="special-card" data-action="specialty" data-id="${set.id}"><strong>${esc(set.name)}</strong><span>${esc(set.description)}</span><span>${set.entries.length} 题 ${icon('arrow')}</span></button>`).join('')}</div>`;
  }

  attach() {this.app.doc.getElementById('recording-slot')?.append(this.audio);}
  pause() {this.player.stop();}

  useFile(meta, file) {
    this.pause(); if (this.url) this.app.win.URL.revokeObjectURL(this.url);
    this.file = meta; this.url = this.app.win.URL.createObjectURL(file); this.audio.src = this.url;
    this.app.render();
  }

  async change(event) {
    if (event.target.id !== 'recording-file' || !event.target.files[0]) return;
    const a = this.app, file = event.target.files[0];
    const id = `${file.name}:${file.size}:${file.lastModified}`;
    const meta = {id, name: file.name, size: file.size, lastModified: file.lastModified};
    if (this.file?.id !== id) {this.editing = null; this.range = {from: 0, to: 10, loop: true, rate: 1};}
    if (!a.data.clips.some(item => item.id === id)) a.update(state => state.clips.push(meta));
    try {await mediaFile(a.win, id, file);} catch {a.toast('录音在本页可用；浏览器未能缓存文件，下次需重新选择。');}
    this.useFile(meta, file);
  }

  readRange() {
    const form = this.app.doc.querySelector('[data-form="clip-note"]');
    const values = new this.app.win.FormData(form);
    this.range = {...validateRange(Number(values.get('from')), Number(values.get('to')), this.audio.duration), rate: Number(values.get('rate')), loop: values.has('loop')};
    return this.range;
  }

  submit(form, values) {
    if (form.dataset.form !== 'clip-note') return;
    if (!this.file) throw new Error('请先选择录音');
    const range = this.readRange(), old = this.editing;
    const note = {id: old?.id || uid('clip'), fileId: this.file.id, fileName: this.file.name, ...range,
      typed: String(values.get('typed')), firstTyped: old?.firstTyped ?? String(values.get('typed')),
      reference: String(values.get('reference')), source: String(values.get('source')), at: new Date().toISOString()};
    this.app.update(state => {const index = state.clipNotes.findIndex(item => item.id === note.id); if (index < 0) state.clipNotes.push(note); else state.clipNotes[index] = note;});
    this.editing = note;
    this.app.render();
    this.app.openModal(`<h2>片段已保存</h2><p>${esc(note.source || note.fileName)} · ${range.from}–${range.to} 秒</p><div class="section-heading"><h2>首次听写</h2></div><p>${esc(note.firstTyped || '未填写')}</p>${note.typed !== note.firstTyped ? `<div class="section-heading"><h2>本次订正</h2></div><p>${esc(note.typed)}</p>` : ''}${note.reference ? `<div class="section-heading"><h2>参考原文</h2></div><p>${esc(note.reference)}</p><div class="spelling-chain">${diffHTML(note.typed, note.reference)}</div>` : ''}`);
  }

  async action(action, element) {
    const a = this.app;
    if (action === 'specialty') {a.selection.pool = `special:${element.dataset.id}`; a.selection.chapter = 'all'; a.selection.lane = 'dictation'; a.navigate('study'); return true;}
    if (!action.startsWith('clip-')) return false;
    if (action === 'clip-from' || action === 'clip-to') {const name = action === 'clip-from' ? 'from' : 'to'; a.doc.querySelector(`[name="${name}"]`).value = this.audio.currentTime.toFixed(2);}
    if (action === 'clip-play') {if (!this.file) throw new Error('请先选择录音'); await this.player.play(this.readRange());}
    if (action === 'clip-pause') this.pause();
    if (action === 'clip-load') {
      const meta = a.data.clips.find(file => file.id === element.dataset.id);
      const file = await mediaFile(a.win, meta.id);
      if (file) {this.editing = null; this.useFile(meta, file);} else throw new Error('录音缓存不存在，请重新选择原文件。片段笔记仍保留。');
    }
    if (action === 'clip-edit') {
      const note = a.data.clipNotes.find(item => item.id === element.dataset.id);
      if (this.file?.id !== note.fileId) {
        const meta = a.data.clips.find(file => file.id === note.fileId), file = await mediaFile(a.win, note.fileId);
        if (!file) throw new Error(`请先重新选择录音：${note.fileName}`);
        this.useFile(meta, file);
      }
      this.editing = note; this.range = {from: note.from, to: note.to, rate: note.rate, loop: note.loop}; a.render();
    }
    return true;
  }
}
