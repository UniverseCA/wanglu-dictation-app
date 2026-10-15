import { chapters, vocabulary, byId, shuffled, parseWordList, isCorrect } from './core/vocabulary.js';
import { createSession, grade, finish, rateCard, alignAnswers, trackActivity, summarize, uid } from './core/session.js';
import { Repository, emptyState, STORAGE_KEY, SAFETY_KEY } from './core/storage.js';
import { lanes, dayKey, dueEntries, wrongEntries, activitySummary } from './core/review.js';
import { Pronouncer, PlaybackQueue } from './audio.js';
import { escapeHTML as esc, icon, button as btn, formatDate, percent, diffHTML } from './ui.js';
import { Recall } from './features/recall.js';
import { Wordbook } from './features/wordbook.js';
import { ListeningRoom } from './features/listening.js';
import { specialtyOptions, specialtyEntries } from './features/specialties.js';

const reasonOptions = ['', '没听出', '拼写错误', '单复数或词尾', '跟丢或错行', '词义不熟', '其他'];
const navigation = [['home', 'home', '今日学习'], ['study', 'book', '词库练习'], ['wrong', 'repeat', '错词本'], ['listening', 'audio', '精听室'], ['history', 'chart', '学习记录'], ['settings', 'settings', '数据与设置']];
const options = (items, selected) => items.map(([value, label]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`).join('');

export class StudyApp {
  constructor(win, repository, player) {
    this.win = win; this.doc = win.document; this.root = this.doc.getElementById('app');
    this.repo = repository || new Repository(win.localStorage);
    this.route = 'home'; this.session = null; this.modalContent = ''; this.alignmentUndo = [];
    this.selection = {kind: 'cards', lane: 'visual', pool: 'all', chapter: '3.2', count: '20', from: '1', to: '', shuffle: false};
    this.wordFilter = {query: '', chapter: 'all', status: 'all', lane: 'dictation', reason: ''};
    this.historyFilter = {lane: 'all', chapter: 'all'};
    this.player = player || new Pronouncer(win, source => this.setAudioMessage(source));
    this.recall = new Recall(this); this.wordbook = new Wordbook(this); this.listening = new ListeningRoom(this);
    this.queue = new PlaybackQueue(this.player, {onChange: state => this.queueChanged(state), onPlayed: entry => this.wordPlayed(entry)});
    this.clickHandler = event => {
      const target = event.target.closest?.('[data-action]');
      if (target && (this.root.contains(target) || this.dialog?.contains(target))) this.guard(() => this.action(target.dataset.action, target));
    };
    this.inputHandler = event => this.guard(() => this.input(event));
    this.changeHandler = event => this.guard(() => this.change(event));
    this.submitHandler = event => {
      if (!event.target.matches?.('[data-form]')) return;
      event.preventDefault(); this.guard(() => this.submit(event.target));
    };
    this.keyHandler = event => this.keydown(event);
    this.focusHandler = event => {
      if (event.target.matches?.('.dictation-input') && this.session) {
        this.session.cursor = Number(event.target.dataset.index); this.scheduleDraft();
        if (this.session.options.audio.auto && !this.queue.running) this.guard(() => this.playOne(this.session.cursor));
      }
    };
    this.pageHideHandler = () => {this.queue.pause(); this.flushDraft();};
  }

  start() {
    try {this.data = this.repo.load();}
    catch (error) {this.renderRecovery(error.message); return this;}
    this.doc.addEventListener('click', this.clickHandler);
    this.doc.addEventListener('input', this.inputHandler);
    this.doc.addEventListener('change', this.changeHandler);
    this.doc.addEventListener('submit', this.submitHandler);
    this.doc.addEventListener('keydown', this.keyHandler);
    this.doc.addEventListener('focusin', this.focusHandler);
    this.win.addEventListener('pagehide', this.pageHideHandler);
    this.visibilityHandler = () => {if (this.doc.hidden) {this.queue.pause(); this.flushDraft();}};
    this.doc.addEventListener('visibilitychange', this.visibilityHandler);
    this.systemTheme = this.win.matchMedia?.('(prefers-color-scheme: dark)');
    this.themeHandler = () => this.applyTheme();
    this.systemTheme?.addEventListener?.('change', this.themeHandler);
    this.applyTheme(); this.render();
    return this;
  }

  async guard(work) {
    try {await work();} catch (error) {this.toast(error.message || '操作未完成，请重试', true);}
  }

  update(change) {this.data = this.repo.update(change); return this.data;}

  applyTheme() {
    const dark = this.data.theme === 'dark' || (this.data.theme === 'system' && this.systemTheme?.matches);
    this.doc.documentElement.dataset.theme = dark ? 'dark' : 'light';
    this.doc.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }

  render() {
    const due = this.allDue().length;
    const pages = {home: () => this.homePage(), study: () => this.studyPage(), dictation: () => this.dictationPage(),
      cards: () => this.recall.render(), result: () => this.resultPage(), wrong: () => this.wordbook.render(),
      history: () => this.historyPage(), settings: () => this.settingsPage(), listening: () => this.listening.render()};
    const dark = this.doc.documentElement.dataset.theme === 'dark';
    this.root.innerHTML = `<div class="workspace">
      <aside class="sidebar"><a href="#home" class="brand" data-action="nav" data-page="home"><span class="brand-mark">词</span><span>词间<small>WANGLU · STUDY</small></span></a>
      <div class="nav-label">我的学习空间</div><nav aria-label="主导航">${navigation.map(([page, symbol, label]) => btn('nav', `${icon(symbol)}<span>${label}</span>${page === 'wrong' && due ? `<span class="nav-count">${due}</span>` : ''}`, `nav-item ${this.route === page || (page === 'study' && ['dictation', 'cards', 'result'].includes(this.route)) ? 'active' : ''}`, `data-page="${page}"`)).join('')}</nav>
      <div class="sidebar-foot"><span class="local-dot"></span> 保存在当前浏览器<small>每天一点，把声音记下来。</small></div></aside>
      <div class="main-shell"><header class="topbar"><div class="breadcrumb">我的学习空间 <span>/</span> ${navigation.find(item => item[0] === this.route)?.[2] || '专注练习'}</div>
      <div class="top-actions"><span class="today-date">${new Date().toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'})}</span>${btn('toggle-theme', `${icon(dark ? 'sun' : 'moon')}<span>${dark ? '白天' : '黑夜'}</span>`, 'button quiet small', `aria-label="切换${dark ? '白天' : '黑夜'}模式"`)}</div></header>
      <main id="main-content" tabindex="-1">${(pages[this.route] || pages.home)()}</main>
      <footer class="page-foot"><span>词间 · 王陆听力工作台</span><span>4 个大章 / 32 个单元 / 5873 条语料</span></footer></div>
      </div><div id="toast" class="toast" role="status" aria-live="polite"></div>`;
    if (this.route === 'dictation') this.renderAudioState();
    if (this.route === 'listening') this.listening.attach();
  }

  allDue() {
    return [...new Map(Object.keys(lanes).flatMap(lane => dueEntries(this.data.progress, lane)).map(entry => [entry.lexemeId, entry])).values()];
  }

  homePage() {
    const activity = activitySummary(this.data.sessions), due = this.allDue().length;
    const ratio = Math.min(100, Math.round(activity.words / this.data.plan.words * 100));
    const draft = this.data.draft;
    const recent = this.data.sessions.slice(-4).reverse();
    return `<div class="page-heading"><div><span class="eyebrow">A LITTLE, EVERY DAY</span><h1>今天，也记住一点。</h1><p>听清一个声音，记住一个意思，再留给明天检验。</p></div><span class="edition">个人学习工作台 / 02</span></div>
      <section class="dashboard-hero"><div class="hero-copy"><span class="pill">${icon('spark')} 今日学习</span><h2>让听过的词，<br>成为记得住的词。</h2><p>${due ? `有 ${due} 个词到了复习时间，先给记忆一次回响。` : '从一小组词开始。选择看词、听音，或一次专注听写。'}</p>
      <div class="actions">${btn(draft ? 'resume' : 'quick-start', `${draft ? '继续上次练习' : '开始今天的练习'} ${icon('arrow')}`, 'button primary', 'data-lane="visual"')}${btn('quick-due', '复习到期词', 'button secondary')}</div>${draft ? `<small class="hero-note">上次：${esc(lanes[draft.lane])} · ${draft.entries.length} 词 · 进度已保存</small>` : '<small class="hero-note">一次 20 个词，给专注留一点余地。</small>'}</div>
      <div class="hero-progress"><div class="progress-ring" style="--progress:${ratio}%"><div><strong>${activity.words}</strong><span>/ ${this.data.plan.words} 词</span></div></div><span>今日已完成 · 按不同词项计数</span></div></section>
      <div class="metric-grid"><div class="metric">${icon('book')}<div><span>今日练习</span><strong>${activity.sessions}<small>次</small></strong></div></div><div class="metric">${icon('repeat')}<div><span>待复习</span><strong>${due}<small>词</small></strong></div></div><div class="metric">${icon('clock')}<div><span>今日专注</span><strong>${activity.minutes}<small>/ ${this.data.plan.minutes} 分钟</small></strong></div></div><div class="metric">${icon('flag')}<div><span>积累错词</span><strong>${wrongEntries(this.data.progress).length}<small>词</small></strong></div></div></div>
      <div class="section-heading"><h2>选择你的练习方式</h2><span>看见、听见，然后想起来</span></div><div class="mode-grid">
      ${[['visual', 'book', '看词回忆', '看英文，想起中文词义。', '01'], ['audio', 'audio', '听音回忆', '只听声音，回忆拼写和意思。', '02'], ['dictation', 'repeat', '专注听写', '听音输入，检查第一次的掌握。', '03']].map(([lane, symbol, title, text, number]) => `<button class="mode-card" data-action="quick-start" data-lane="${lane}"><div class="mode-card-top">${icon(symbol)}<span>${number}</span></div><h3>${title}</h3><p>${text}</p><span class="mode-link">开始练习 ${icon('arrow')}</span></button>`).join('')}</div>
      <div class="section-heading"><h2>最近的学习足迹</h2>${btn('nav', '全部记录 →', 'text-button', 'data-page="history"')}</div><section class="panel">${recent.length ? this.sessionRows(recent) : this.empty('第一份记录，留给今天。', '完成一轮背词或听写后，会在这里保留你的首次成绩。')}</section>`;
  }

  studyPage() {
    const s = this.selection, pool = this.poolEntries();
    return `<div class="page-heading"><div><span class="eyebrow">YOUR NEXT SESSION</span><h1>从一组词开始。</h1><p>按自己的节奏选择范围，背词与听写的掌握情况分别记录。</p></div></div>
      ${this.data.draft ? `<div class="resume-banner">${icon('clock')}<span>有一份未完成的${esc(lanes[this.data.draft.lane])}，可以继续原来的题目顺序。</span>${btn('resume', '继续练习 →', 'text-button')}</div>` : ''}
      <form data-form="start" class="study-layout"><section class="panel selection-panel"><div class="section-heading"><h2>练习设置</h2><span>01 / 选择方式与范围</span></div>
      <label>练习方式<select name="lane">${options(Object.entries(lanes), s.lane)}</select></label>
      <div class="form-grid"><label>词库范围<select name="pool">${options([['all', '全部词'], ['wrong', '错词'], ['due', '本模式到期复习'], ...this.data.customLists.map(list => [`custom:${list.id}`, `我的词表 · ${list.name}`]), ...specialtyOptions()], s.pool)}</select></label>
      <label>章节<select name="chapter">${options([['all', '全部章节'], ...chapters.map(ch => [ch.id, `${ch.id} · ${ch.entries.length} 词`]), ['个人词表', '个人词表']], s.chapter)}</select></label></div>
      <div class="form-grid three"><label>每轮词量<select name="count">${options([['20', '20 词'], ['50', '50 词'], ['100', '100 词'], ['0', '所选范围全部']], s.count)}</select></label><label>起始位置<input name="from" type="number" min="1" value="${esc(s.from)}"></label><label>结束位置<input name="to" type="number" min="1" placeholder="至末尾" value="${esc(s.to)}"></label></div>
      <label class="checkbox"><input type="checkbox" name="shuffle" ${s.shuffle ? 'checked' : ''}>打乱本轮词序</label>
      <p class="field-note">本轮只统计选入的词。词库中的原始记录和多个章节来源均保留。</p>
      <button class="button primary wide" type="submit">开始${esc(lanes[s.lane])} ${icon('arrow')}</button></section>
      <aside class="panel session-preview"><span class="eyebrow">THIS SESSION</span><h2>${esc(lanes[s.lane])}</h2><div class="preview-count">${pool.length}<small>个可选词条</small></div><hr><p>${s.lane === 'visual' ? '先看英文，在心里回忆词义，再揭晓答案。' : s.lane === 'audio' ? '先隐藏拼写和词义。听到英文后，回忆它是什么、是什么意思，再揭晓。' : '音频和输入位置独立控制；连播时光标保持原位，按 Enter 换行。'}</p><p class="field-note">完成后保留首次表现，订正不会覆盖首次成绩。</p></aside></form>
      <div class="section-heading"><h2>语料章节</h2><span>${vocabulary.length} 条原始语料</span></div>${['第 3 章', '第 4 章', '第 5 章', '第 11 章'].map(group => `<section class="chapter-group"><h3>${group}</h3><div class="chapter-grid">${chapters.filter(ch => ch.group === group).map(ch => `<button class="chapter-card ${s.chapter === ch.id ? 'selected' : ''}" data-action="select-chapter" data-id="${ch.id}"><strong>${ch.id}</strong><span>${ch.entries.length} 词 ${icon('arrow')}</span></button>`).join('')}</div></section>`).join('')}`;
  }

  poolEntries() {
    const s = this.selection;
    let entries = s.pool === 'wrong' ? wrongEntries(this.data.progress) : s.pool === 'due' ? dueEntries(this.data.progress, s.lane)
      : s.pool.startsWith('custom:') ? this.data.customLists.find(list => list.id === s.pool.slice(7))?.entries || []
        : specialtyEntries(s.pool) || vocabulary;
    if (s.chapter !== 'all' && !s.pool.startsWith('custom:') && !s.pool.startsWith('special:')) entries = entries.filter(entry => entry.chapterId === s.chapter || this.data.progress[entry.lexemeId]?.sourceIds.some(id => byId.get(id)?.chapterId === s.chapter));
    return entries;
  }

  async begin() {
    if (this.data.draft && !this.win.confirm('开始新练习会替换未完成的草稿。确认开始？')) return;
    let entries = this.poolEntries();
    const from = Math.max(1, Number(this.selection.from) || 1), to = Number(this.selection.to) || entries.length;
    if (to < from) throw new Error('结束位置不能早于起始位置');
    entries = entries.slice(from - 1, to);
    if (this.selection.shuffle) entries = shuffled(entries);
    if (Number(this.selection.count)) entries = entries.slice(0, Number(this.selection.count));
    this.session = createSession(entries, {kind: this.selection.lane === 'dictation' ? 'dictation' : 'cards', lane: this.selection.lane,
      chapterId: this.selection.chapter === 'all' ? null : this.selection.chapter,
      source: this.selection.pool === 'all' ? '章节练习' : this.selection.pool === 'wrong' ? '错词复练' : this.selection.pool === 'due' ? '到期复习' : this.selection.pool.startsWith('special:') ? '专项练习' : '个人词表',
      shuffle: this.selection.shuffle, audio: {...this.data.audio}});
    this.session.lastActivityAt = Date.now(); this.alignmentUndo = [];
    this.route = this.session.kind === 'cards' ? 'cards' : 'dictation';
    this.flushDraft(); this.render(); this.configureQueue();
    if (this.route === 'dictation') this.doc.getElementById('input-0')?.focus();
    else if (this.session.lane === 'audio') await this.recall.play();
  }

  configureQueue() {this.queue.configure(this.session.entries, this.session.audioComplete ? this.session.entries.length : this.session.audioIndex, this.session.options.audio);}

  scheduleDraft() {
    this.win.clearTimeout(this.draftTimer);
    this.draftTimer = this.win.setTimeout(() => this.guard(() => this.flushDraft()), 250);
  }

  flushDraft() {
    this.win.clearTimeout(this.draftTimer);
    if (this.session && !this.session.completedAt && this.session.cursor < this.session.entries.length) {
      this.update(state => {state.draft = structuredClone(this.session);});
    }
  }

  navigate(page) {
    this.queue.pause(); this.listening.pause(); this.flushDraft(); this.closeModal();
    this.route = page; this.render(); this.doc.getElementById('main-content')?.focus(); this.win.scrollTo?.(0, 0);
  }

  resume() {
    if (!this.data.draft) return;
    this.queue.pause(); this.session = structuredClone(this.data.draft);
    this.session.lastActivityAt = Date.now(); this.route = this.session.kind === 'cards' ? 'cards' : 'dictation';
    this.render(); this.configureQueue();
    if (this.route === 'dictation') this.doc.getElementById(`input-${this.session.cursor}`)?.focus();
  }

  dictationPage() {
    const session = this.session, filled = session.entries.filter(entry => session.answers[entry.id]?.trim()).length;
    return `<div class="practice-heading"><div><span class="eyebrow">LISTEN & WRITE</span><h1>给声音，一个准确的拼写。</h1><p>${esc(session.source)} · ${session.entries.length} 词 · ${session.options.shuffle ? '乱序' : '顺序'} · ${btn('nav', '保存并离开', 'text-button', 'data-page="home"')}</p></div><span class="pill" id="filled-count">${filled} / ${session.entries.length} 已填写</span></div>
      <section class="playback-bar" aria-label="听写播放控制"><div class="playback-info">${icon('audio')}<div><strong id="audio-position">播放进度</strong><span id="audio-message">光标由你控制，连播不自动换行</span></div></div><div class="actions compact">${btn('audio-prev', '上一词', 'button quiet small')}${btn('audio-replay', `${icon('repeat')} 重播`, 'button secondary small')}${btn('audio-toggle', `${icon('play')} 连播`, 'button primary small', 'id="audio-toggle"')}${btn('audio-next', '下一词', 'button quiet small')}</div></section>
      <div id="audio-error" class="audio-error" role="alert"></div><section class="panel dictation-panel"><div class="dictation-table-head"><span>题号</span><span>听写输入</span><span>批改反馈</span></div>
      ${session.entries.map((entry, index) => this.dictationRow(entry, index)).join('')}</section>
      <div class="practice-footer"><span>Enter 下一行 · F2 播放当前输入词 · Ctrl/⌘ + Enter 批改</span><div class="actions compact">${btn('align-down', '插空', 'button quiet small')}${btn('align-up', '上移', 'button quiet small')}${btn('align-undo', '撤销对齐', 'button quiet small', this.alignmentUndo.length ? '' : 'disabled')}${btn('grade', '批改', 'button secondary')}${btn('finish', '完成本轮', 'button primary')}</div></div>`;
  }

  dictationRow(entry, index) {
    const result = this.session.feedback?.[index];
    return `<div class="dictation-row ${result ? result.correct ? 'correct' : 'incorrect' : ''}" id="row-${index}"><div class="row-index"><span>${String(index + 1).padStart(2, '0')}</span>${btn('play-row', icon('play'), 'icon-button', `data-index="${index}" aria-label="播放第 ${index + 1} 词"`)}</div>
      <label class="dictation-input-wrap">${entry.context ? `<span class="context-cue">${esc(entry.context)}</span>` : ''}<input id="input-${index}" data-index="${index}" class="dictation-input" aria-label="第 ${index + 1} 题答案" value="${esc(this.session.answers[entry.id] || '')}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="512" placeholder="听到后，写在这里…"></label>
      <div class="row-feedback">${result ? this.rowFeedback(result) : '<span class="muted">—</span>'}</div></div>`;
  }

  rowFeedback(result) {
    return result.status === 'unplayed' ? '<span class="muted">未成功播放，不计分</span>' : result.correct ? `<span class="success">${icon('check')} 正确</span>` : `<strong>${esc(result.entry.answers.join(' / '))}</strong><small>${esc(result.entry.meaning)}</small>`;
  }

  queueChanged(state) {
    this.audioState = state;
    if (this.session && !this.session.completedAt && this.route === 'dictation') {
      this.session.audioIndex = Math.min(state.index, this.session.entries.length - 1);
      this.session.audioComplete = state.index >= this.session.entries.length;
      this.scheduleDraft();
    }
    this.renderAudioState();
  }

  renderAudioState() {
    const state = this.audioState || {}, position = this.doc.getElementById('audio-position');
    if (!position || !this.session) return;
    position.textContent = state.status === 'ended' ? '本轮音频已播完' : `音频 ${Math.min((state.index || 0) + 1, this.session.entries.length)} / ${this.session.entries.length}`;
    const control = this.doc.getElementById('audio-toggle');
    if (control) control.innerHTML = `${icon(state.running ? 'pause' : 'play')} ${state.running ? '暂停' : state.status === 'ended' ? '重新连播' : '连播 / 继续'}`;
    const error = this.doc.getElementById('audio-error');
    if (error) error.innerHTML = state.status === 'failed' ? `${esc(state.error)}<div class="actions">${btn('audio-toggle', '重试当前词', 'button small secondary')}${btn('skip-audio', '标记未播放并跳过', 'button small quiet')}</div>` : '';
    this.doc.querySelectorAll('.dictation-row.speaking').forEach(row => row.classList.remove('speaking'));
    if (state.running && state.status === 'playing') this.doc.getElementById(`row-${state.index}`)?.classList.add('speaking');
  }

  setAudioMessage(message) {const element = this.doc.getElementById('audio-message'); if (element) element.textContent = message;}

  wordPlayed(entry) {
    if (!this.session || this.session.completedAt) return;
    this.session.playCounts[entry.id] = (this.session.playCounts[entry.id] || 0) + 1;
    this.session.unplayed = this.session.unplayed.filter(id => id !== entry.id);
    this.scheduleDraft();
  }

  async playOne(index) {
    this.queue.jump(index);
    const entry = this.session.entries[index];
    if (!entry) return;
    const result = await this.player.play(entry, this.session.options.audio);
    if (result.ok) this.wordPlayed(entry);
    else if (!result.cancelled) {this.audioState = {...this.audioState, index, status: 'failed', error: result.error}; this.renderAudioState();}
  }

  async complete() {
    const session = this.session;
    if (session.completedAt) return;
    if (session.kind === 'dictation' && session.entries.some(entry => !session.answers[entry.id]?.trim()) && !this.win.confirm('本轮还有空题，完成后会计为未作答。确认完成？')) return;
    this.queue.pause(); trackActivity(session);
    if (session.kind === 'cards') session.unplayed.push(...session.entries.filter(entry => !session.ratings[entry.id]).map(entry => entry.id));
    finish(session);
    this.data = this.repo.commit(session); this.route = 'result'; this.render();
  }

  resultPage() {
    const session = this.session, first = session.firstAttempt, corrected = summarize(session.feedback);
    return `<div class="page-heading"><div><span class="eyebrow">A SESSION WELL SPENT</span><h1>这一轮，留下了什么？</h1><p>${esc(lanes[session.lane])} · ${esc(session.source)} · ${formatDate(session.completedAt, true)}</p></div></div>
      <section class="result-summary panel"><div><span>首次${session.kind === 'cards' ? '回忆' : '正确率'}</span><strong>${percent(first.score)}</strong><small>${first.correct} / ${first.total} 词</small></div><div><span>订正后</span><strong>${percent(corrected.score)}</strong><small>首次表现已独立保留</small></div><div><span>本轮重复播放</span><strong>${Object.values(session.playCounts).reduce((a, b) => a + b, 0)}</strong><small>设置：${session.options.audio?.rate || 1} 倍 / ${session.options.audio?.repeat || 1} 次</small></div></section>
      <div class="actions result-actions">${btn('retry-wrong', '再练本轮错词', 'button primary')}${btn('nav', '回到今日学习', 'button secondary', 'data-page="home"')}${btn('nav', '查看学习记录', 'button quiet', 'data-page="history"')}</div>
      <div class="section-heading"><h2>首次表现与订正</h2><span>保留原始答案，下一次再检验</span></div><section class="panel result-list">${first.results.map((result, index) => this.resultRow(result, session.feedback?.[index], session)).join('')}</section>`;
  }

  resultRow(result, correction, session) {
    const entry = result.entry;
    return `<article class="result-row"><div class="result-word"><span class="result-dot ${result.correct ? 'ok' : result.status === 'unplayed' ? 'neutral' : 'err'}"></span><div><strong>${esc(entry.display)}</strong><span>${esc(entry.meaning)}</span></div></div><div class="result-answer"><small>${result.status === 'unplayed' ? '未播放，不计分' : session.kind === 'cards' ? '首次回忆' : '首次输入'}</small><span>${session.kind === 'cards' ? esc({known: '认识', unsure: '模糊', unknown: '不会'}[result.rating] || '未练习') : result.correct ? esc(result.typed) : diffHTML(result.typed, entry.answers[0])}</span>${correction?.correct && !result.correct ? '<small class="success">订正后正确</small>' : ''}</div><div>${!result.correct && result.status !== 'unplayed' ? `<label class="reason-label">错因<select data-reason="${esc(entry.id)}" data-session="${esc(session.id)}">${options(reasonOptions.map(value => [value, value || '选择错因（可选）']), result.reason)}</select></label>` : '<span class="success">已记录</span>'}</div></article>`;
  }

  empty(title, description) {return `<div class="empty-state">${icon('book')}<h3>${title}</h3><p>${description}</p></div>`;}

  sessionRows(sessions) {
    return `<div class="history-table"><div class="history-head"><span>练习</span><span>首次成绩</span><span>时间</span><span></span></div>${sessions.map(session => `<div class="history-row"><div><strong>${esc(lanes[session.lane] || '旧版听写')}<span class="tag">${session.legacy ? '旧版' : session.options.shuffle ? '乱序' : '顺序'}</span></strong><small>${esc(session.chapterId || session.source)} · ${session.firstAttempt.total} 词 · ${session.legacy ? '旧记录未保存辅助条件' : `${session.options.audio?.rate || 1} 倍 / ${session.options.audio?.repeat || 1} 次`}</small></div><span class="score">${percent(session.firstAttempt.score)}</span><span class="muted">${formatDate(session.completedAt, true)}</span>${btn('history-detail', '查看', 'text-button', `data-id="${esc(session.id)}"`)}</div>`).join('')}</div>`;
  }

  historyPage() {
    const sessions = this.data.sessions.filter(session => (this.historyFilter.lane === 'all' || session.lane === this.historyFilter.lane) && (this.historyFilter.chapter === 'all' || session.chapterId === this.historyFilter.chapter));
    return `<div class="page-heading"><div><span class="eyebrow">LEARNING JOURNAL</span><h1>进步，有迹可循。</h1><p>先看第一次的表现，再看订正。不同题集和辅助条件请分别比较。</p></div></div><div class="filter-bar"><label>练习方式<select data-history-filter="lane">${options([['all', '全部方式'], ...Object.entries(lanes)], this.historyFilter.lane)}</select></label><label>章节<select data-history-filter="chapter">${options([['all', '全部章节'], ...chapters.map(ch => [ch.id, ch.id])], this.historyFilter.chapter)}</select></label><span>${sessions.length} 次已保存练习</span></div><section class="panel">${sessions.length ? this.sessionRows([...sessions].reverse()) : this.empty('还没有这个范围的记录。', '完成练习后，首次答案和辅助条件会一起保存。')}</section>`;
  }

  settingsPage() {
    const data = this.data;
    return `<div class="page-heading"><div><span class="eyebrow">MAKE ROOM FOR YOURSELF</span><h1>适合自己的节奏。</h1><p>调整外观与声音，也给学习记录留一份备份。</p></div></div><div class="settings-grid"><form data-form="settings" class="panel"><div class="section-heading"><h2>外观与学习目标</h2></div><label>界面主题<select name="theme">${options([['system', '跟随系统'], ['light', '白天 · 暖白与墨绿'], ['dark', '黑夜 · 深灰与墨绿']], data.theme)}</select></label><div class="form-grid"><label>每日词量目标<input name="words" type="number" min="1" max="5000" value="${data.plan.words}" required></label><label>每日专注分钟<input name="minutes" type="number" min="1" max="1440" value="${data.plan.minutes}" required></label></div><div class="section-heading inset"><h2>发音偏好</h2></div><label>声音来源<select name="voice">${options([['tts', '本地优先，联网兜底'], ['offline', '仅本地英语语音'], ['real', '优先词典发音（联网）']], data.audio.voice)}</select></label><div class="form-grid three"><label>语速<select name="rate">${options([['0.75', '0.75 倍'], ['1', '1 倍'], ['1.25', '1.25 倍']], data.audio.rate)}</select></label><label>每词重复<select name="repeat">${options([['1', '1 次'], ['2', '2 次'], ['3', '3 次']], data.audio.repeat)}</select></label><label>连播间隔<select name="gap">${options([['1', '1 秒'], ['2', '2 秒'], ['3', '3 秒'], ['5', '5 秒']], data.audio.gap)}</select></label></div><label class="checkbox"><input name="auto" type="checkbox" ${data.audio.auto ? 'checked' : ''}>听写时，移入输入框自动播放该词</label><p class="field-note">仅本地模式不调用在线发音。联网模式按需请求当前词条。设置用于新练习，已保存草稿保留原条件。</p><div class="actions"><button class="button primary" type="submit">保存设置</button>${btn('test-voice', '测试语音', 'button secondary')}</div></form>
      <div><section class="panel"><div class="section-heading"><h2>备份与恢复</h2>${icon('download')}</div><p>本机保存的记录不会自动同步到其他设备。定期导出，可带走历史、错词、个人词表和草稿。</p><div class="actions wrap">${btn('export', '导出完整备份', 'button primary small')}${btn('import-file', '选择备份文件', 'button secondary small')}<input id="backup-file" type="file" accept=".json,application/json" hidden></div><label class="inset">或粘贴旧版 / 新版 JSON<textarea id="import-text" rows="4" placeholder='旧版格式：{"hist":{},"wb":{}}'></textarea></label>${btn('preview-import', '检查并预览导入', 'button secondary small')}<p class="field-note">导入前自动保留当前状态；旧版浏览器键值保持不变。</p>${this.win.localStorage.getItem(SAFETY_KEY) ? btn('download-safety', '下载上次导入前备份', 'text-button') : ''}</section>
      <section class="panel inset"><div class="section-heading"><h2>我的词表</h2></div><form data-form="word-list"><label>词表名称<input name="name" maxlength="80" placeholder="例如：本周听力错词" required></label><label>每行一个词，用 | 或 Tab 分隔英文、中文、音标<textarea name="terms" rows="5" placeholder="ability | 能力&#10;analyst | 分析员" required></textarea></label><button type="submit" class="button secondary small">保存词表</button></form>${data.customLists.map(list => `<div class="list-item"><span>${esc(list.name)} <small>${list.entries.length} 词</small></span>${btn('practice-list', '练习 →', 'text-button', `data-id="${esc(list.id)}"`)}</div>`).join('')}</section>
      <section class="panel inset subtle"><h3>管理本地记录</h3><p class="field-note">开始清空前请导出备份。旧版原始存储保留，新版工作台将重置。</p>${btn('reset', '备份并清空新版记录', 'text-button danger')}</section></div></div>`;
  }

  download(name, contents, type = 'application/json') {
    const url = this.win.URL.createObjectURL(new this.win.Blob([contents], {type}));
    const link = this.doc.createElement('a'); link.href = url; link.download = name;
    this.doc.body.append(link); link.click(); link.remove();
    this.win.setTimeout(() => this.win.URL.revokeObjectURL(url), 1000);
  }

  previewImport(text) {
    const preview = this.repo.previewImport(text); this.pendingImport = text;
    this.openModal(`<span class="eyebrow">BACKUP PREVIEW</span><h2>确认这份学习记录</h2><p>${preview.sessions} 次练习 · ${preview.words} 个复习词项 · ${preview.lists} 份个人词表</p><p class="field-note">合并保留当前数据并按记录 ID 去重；替换会使用备份内容。两种方式均先保留导入前快照。</p><div class="actions">${btn('restore-merge', '合并导入', 'button primary')}${btn('restore-replace', '替换当前记录', 'button secondary')}${btn('close-modal', '取消', 'button quiet')}</div>`);
  }

  openModal(html) {
    this.closeModal();
    this.modalPreviousFocus = this.doc.activeElement;
    this.dialog = this.doc.createElement('dialog'); this.dialog.className = 'modal';
    this.dialog.setAttribute('aria-label', '详情与操作');
    this.dialog.innerHTML = `<div class="modal-header">${btn('close-modal', icon('close'), 'icon-button', 'aria-label="关闭对话框"')}</div><div class="modal-content">${html}</div>`;
    this.doc.body.append(this.dialog);
    if (this.dialog.showModal) this.dialog.showModal(); else this.dialog.setAttribute('open', '');
    this.dialog.querySelector('button, input, select')?.focus();
  }

  closeModal() {this.dialog?.close?.(); this.dialog?.remove(); this.dialog = null; this.modalPreviousFocus?.focus?.();}

  toast(message, error = false) {
    let target = this.doc.getElementById('toast');
    if (!target) {target = this.doc.createElement('div'); target.id = 'toast'; target.className = 'toast'; this.doc.body.append(target);}
    target.textContent = message; target.classList.add('visible'); target.classList.toggle('error', error);
    this.win.clearTimeout(this.toastTimer); this.toastTimer = this.win.setTimeout(() => target.classList.remove('visible'), 6500);
  }

  input(event) {
    const target = event.target;
    if (target.matches('.dictation-input, #recall-spelling')) {
      const index = target.id === 'recall-spelling' ? this.session.cursor : Number(target.dataset.index);
      const entry = this.session.entries[index];
      this.session.answers[entry.id] = target.value; this.session.feedback = null;
      trackActivity(this.session); this.scheduleDraft();
      const row = target.closest('.dictation-row');
      if (row) {row.classList.remove('correct', 'incorrect'); row.querySelector('.row-feedback').innerHTML = '<span class="muted">待重新批改</span>';}
      const count = this.doc.getElementById('filled-count');
      if (count) count.textContent = `${this.session.entries.filter(e => this.session.answers[e.id]?.trim()).length} / ${this.session.entries.length} 已填写`;
    }
  }

  async change(event) {
    const target = event.target;
    if (target.closest('[data-form="start"]')) {this.readSelection(target.form); this.render();}
    if (target.dataset.historyFilter) {this.historyFilter[target.dataset.historyFilter] = target.value; this.render();}
    if (target.dataset.reason) this.annotate(target.dataset.session, target.dataset.reason, target.value);
    if (target.id === 'backup-file' && target.files[0]) this.previewImport(await target.files[0].text());
    this.wordbook.change(event); await this.listening.change(event);
  }

  readSelection(form) {
    const data = new this.win.FormData(form);
    for (const name of ['lane', 'pool', 'chapter', 'count', 'from', 'to']) this.selection[name] = String(data.get(name) || '');
    this.selection.kind = this.selection.lane === 'dictation' ? 'dictation' : 'cards';
    this.selection.shuffle = data.has('shuffle');
  }

  async submit(form) {
    const values = new this.win.FormData(form);
    if (form.dataset.form === 'start') {this.readSelection(form); await this.begin();}
    if (form.dataset.form === 'settings') {
      this.update(state => {
        state.theme = String(values.get('theme')); state.plan = {words: Number(values.get('words')), minutes: Number(values.get('minutes'))};
        state.audio = {voice: String(values.get('voice')), rate: Number(values.get('rate')), repeat: Number(values.get('repeat')), gap: Number(values.get('gap')), auto: values.has('auto')};
      });
      this.applyTheme(); this.render(); this.toast('设置已保存');
    }
    if (form.dataset.form === 'word-list') {
      const id = uid('list'), entries = parseWordList(String(values.get('terms')), id);
      this.update(state => state.customLists.push({id, name: String(values.get('name')).trim() || '我的词表', entries, createdAt: new Date().toISOString()}));
      this.render(); this.toast(`已保存 ${entries.length} 个词条，原始拼写保持不变`);
    }
    this.listening.submit(form, values);
  }

  annotate(sessionId, entryId, reason) {
    if (!reasonOptions.includes(reason)) return;
    if (this.session?.id === sessionId) {
      this.session.reasons[entryId] = reason;
      for (const list of [this.session.firstAttempt?.results, this.session.feedback]) {
        const result = list?.find(row => row.entry.id === entryId); if (result) result.reason = reason;
      }
      if (!this.session.completedAt) this.scheduleDraft();
    }
    if (this.data.sessions.some(s => s.id === sessionId)) this.update(state => {
      const session = state.sessions.find(s => s.id === sessionId);
      for (const list of [session.firstAttempt.results, session.feedback]) {const row = list?.find(r => r.entry.id === entryId); if (row) row.reason = reason;}
      for (const item of Object.values(state.progress)) for (const attempt of item.attempts) if (attempt.sessionId === sessionId && item.sourceIds.includes(entryId)) attempt.reason = reason;
    });
  }

  async action(action, element) {
    if (action === 'nav') this.navigate(element.dataset.page);
    else if (action === 'toggle-theme') {this.update(state => {state.theme = this.doc.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';}); this.applyTheme(); this.render();}
    else if (action === 'quick-start') {this.selection.lane = element.dataset.lane; this.selection.kind = element.dataset.lane === 'dictation' ? 'dictation' : 'cards'; this.selection.pool = 'all'; this.navigate('study');}
    else if (action === 'quick-due') {this.selection.pool = 'due'; this.selection.chapter = 'all'; this.navigate('study');}
    else if (action === 'select-chapter') {this.selection.chapter = element.dataset.id; this.selection.pool = 'all'; this.render(); this.doc.querySelector('[data-form="start"]')?.scrollIntoView?.({behavior: 'smooth'});}
    else if (action === 'resume') this.resume();
    else if (action === 'audio-toggle') {if (this.queue.running) this.queue.pause(); else await this.queue.start();}
    else if (action === 'audio-replay') await this.playOne(Math.min(this.queue.position, this.session.entries.length - 1));
    else if (action === 'audio-prev' || action === 'audio-next') await this.playOne(Math.min(this.session.entries.length - 1, Math.max(0, this.queue.position + (action === 'audio-prev' ? -1 : 1))));
    else if (action === 'skip-audio') {this.session.unplayed.push(this.session.entries[this.queue.position].id); if (this.queue.position === this.session.entries.length - 1) {this.queue.pause(); this.toast('最后一词已标记为未播放');} else {this.queue.jump(this.queue.position + 1); await this.queue.start();} this.scheduleDraft();}
    else if (action === 'play-row') await this.playOne(Number(element.dataset.index));
    else if (action === 'grade') {trackActivity(this.session); grade(this.session); this.flushDraft(); this.render(); this.toast(`首次成绩 ${percent(this.session.firstAttempt.score)}，订正会另行记录`);}
    else if (action === 'finish') await this.complete();
    else if (action.startsWith('align-')) {
      const index = this.session.cursor;
      if (action === 'align-undo') {const snapshot = this.alignmentUndo.pop(); if (snapshot) this.session.answers = snapshot;}
      else {this.alignmentUndo.push(structuredClone(this.session.answers)); alignAnswers(this.session, index, action === 'align-down' ? 'down' : 'up');}
      this.session.feedback = null; this.flushDraft(); this.render(); this.doc.getElementById(`input-${index}`)?.focus();
    }
    else if (action === 'retry-wrong') {
      const entries = this.session.firstAttempt.results.filter(result => !result.correct && result.status !== 'unplayed').map(result => result.entry);
      if (!entries.length) {this.toast('本轮没有错词'); return;}
      this.session = createSession(entries, {...this.session.options, source: '本轮错词'}); this.route = this.session.kind === 'cards' ? 'cards' : 'dictation'; this.flushDraft(); this.render(); this.configureQueue();
    }
    else if (action === 'history-detail') {
      const session = this.data.sessions.find(item => item.id === element.dataset.id);
      this.openModal(`<h2>${esc(lanes[session.lane])} · ${percent(session.firstAttempt.score)}</h2><p>${esc(session.source)} · ${formatDate(session.completedAt, true)}</p>${session.partial ? '<p class="field-note">旧版只保存了错词，以下不是完整答题列表。</p>' : ''}${session.firstAttempt.results.map((row, i) => this.resultRow(row, session.feedback?.[i], session)).join('')}`);
    }
    else if (action === 'export') {this.download(`词间备份-${dayKey()}.json`, this.repo.backup()); this.toast('完整备份已导出');}
    else if (action === 'import-file') this.doc.getElementById('backup-file').click();
    else if (action === 'preview-import') this.previewImport(this.doc.getElementById('import-text').value);
    else if (action.startsWith('restore-')) {this.data = this.repo.restore(this.pendingImport, action === 'restore-merge' ? 'merge' : 'replace'); this.session = null; this.closeModal(); this.applyTheme(); this.render(); this.toast('记录已恢复，导入前备份已保留');}
    else if (action === 'download-safety') this.download('词间导入前备份.json', this.win.localStorage.getItem(SAFETY_KEY));
    else if (action === 'practice-list') {this.selection.pool = `custom:${element.dataset.id}`; this.selection.chapter = 'all'; this.navigate('study');}
    else if (action === 'reset') {if (this.win.confirm('将先下载备份，再清空新版工作台记录。确认继续？')) {this.download(`词间清空前备份-${dayKey()}.json`, this.repo.backup()); this.session = null; this.update(state => Object.assign(state, emptyState(), {revision: state.revision})); this.applyTheme(); this.render();}}
    else if (action === 'test-voice') {this.queue.pause(); const result = await this.player.play({display: 'Ready for a little practice?'}, this.data.audio); this.toast(result.ok ? '语音播放完成' : result.error || '播放已取消', !result.ok);}
    else if (action === 'close-modal') this.closeModal();
    else if (!await this.recall.action(action, element) && !await this.wordbook.action(action, element)) await this.listening.action(action, element);
  }

  keydown(event) {
    if (event.key === 'Escape') {this.closeModal(); this.queue.pause();}
    if (this.route === 'dictation' && this.session) {
      if (event.target.matches?.('.dictation-input')) {
        this.session.cursor = Number(event.target.dataset.index);
        if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {event.preventDefault(); this.doc.getElementById(`input-${this.session.cursor + 1}`)?.focus();}
      }
      if (event.key === 'F2') {event.preventDefault(); this.guard(() => this.playOne(this.session.cursor));}
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); this.guard(() => this.action('grade'));}
    }
    this.recall.keydown(event);
  }

  renderRecovery(message) {
    this.root.innerHTML = `<div class="recovery panel"><h1>先保护你的学习记录。</h1><p>${esc(message)}</p><button id="raw-export" class="button primary">导出原始数据</button><p>原始数据没有被覆盖。导出后可修复数据，再重新打开页面。</p></div>`;
    this.doc.getElementById('raw-export').onclick = () => {
      const raw = {};
      for (const key of [STORAGE_KEY, SAFETY_KEY, 'wl3_hist', 'wl3_wb', 'wl3_audio', 'wl2_hist', 'wl2_wb']) raw[key] = this.win.localStorage.getItem(key);
      this.download(`词间原始数据-${dayKey()}.json`, JSON.stringify(raw, null, 2));
    };
  }

  destroy() {
    this.queue.pause(); this.player.stop(); this.listening.pause(); this.closeModal();
    this.win.clearTimeout(this.draftTimer); this.win.clearTimeout(this.toastTimer);
    this.doc.removeEventListener('click', this.clickHandler); this.doc.removeEventListener('input', this.inputHandler);
    this.doc.removeEventListener('change', this.changeHandler); this.doc.removeEventListener('submit', this.submitHandler);
    this.doc.removeEventListener('keydown', this.keyHandler); this.doc.removeEventListener('visibilitychange', this.visibilityHandler);
    this.doc.removeEventListener('focusin', this.focusHandler);
    this.win.removeEventListener('pagehide', this.pageHideHandler); this.systemTheme?.removeEventListener?.('change', this.themeHandler);
  }
}

export function mountApp(win, repository, player) {return new StudyApp(win, repository, player).start();}
