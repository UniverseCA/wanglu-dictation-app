import { createSession } from '../core/session.js';
import { byId } from '../core/vocabulary.js';
import { lanes, dueEntries } from '../core/review.js';
import { escapeHTML as esc, button as btn, formatDate, icon } from '../ui.js';

const selectOptions = (values, selected) => values.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');

export class Wordbook {
  constructor(app) {this.app = app; this.limit = 100; this.audio = {};}

  sources(item) {return [...new Set([item.entry.chapterId, ...item.sourceIds.map(id => byId.get(id)?.chapterId).filter(Boolean)])];}

  filtered() {
    const a = this.app, f = a.wordFilter;
    const due = new Set(dueEntries(a.data.progress, f.lane).map(e => e.lexemeId));
    return Object.values(a.data.progress).filter(item => item.everWrong)
      .filter(item => !f.query || `${item.entry.display} ${item.entry.meaning}`.toLowerCase().includes(f.query.toLowerCase()))
      .filter(item => f.chapter === 'all' || this.sources(item).includes(f.chapter))
      .filter(item => !f.reason || item.attempts.some(attempt => attempt.reason === f.reason))
      .filter(item => f.status === 'all' || (f.status === 'due' ? due.has(item.entry.lexemeId) : f.status === 'mastered' ? item.lanes[f.lane]?.status === 'mastered' : item.lanes[f.lane]?.status !== 'mastered'))
      .sort((a, b) => Math.max(...Object.values(b.lanes).map(lane => lane.lapses), 0) - Math.max(...Object.values(a.lanes).map(lane => lane.lapses), 0));
  }

  render() {
    const a = this.app, f = a.wordFilter, items = this.filtered();
    const audio = {...a.data.audio, ...this.audio};
    const chapters = [...new Set(Object.values(a.data.progress).filter(i => i.everWrong).flatMap(i => this.sources(i)))];
    return `<div class="page-heading"><div><span class="eyebrow">WORDS TO COME BACK TO</span><h1>错过的，再认识一次。</h1><p>听写错误和背词时的“不会”都会留在这里，掌握情况按练习方式分别记录。</p></div></div>
      <div class="filter-bar"><label>搜索<input id="word-search" type="search" placeholder="英文或中文" value="${esc(f.query)}"></label><label>章节<select data-word-filter="chapter">${selectOptions([['all', '全部来源'], ...chapters.map(ch => [ch, ch])], f.chapter)}</select></label><label>练习方式<select data-word-filter="lane">${selectOptions(Object.entries(lanes), f.lane)}</select></label><label>状态<select data-word-filter="status">${selectOptions([['all', '全部错词'], ['learning', '仍需巩固'], ['due', '当前到期'], ['mastered', '已掌握']], f.status)}</select></label><label>错因<select data-word-filter="reason">${selectOptions([['', '全部错因'], ...['没听出', '拼写错误', '单复数或词尾', '跟丢或错行', '词义不熟', '其他'].map(value => [value, value])], f.reason)}</select></label></div>
      <section class="panel wordbook-playback"><div class="section-heading"><h2>错词播放设置</h2></div><div class="form-grid"><label>每个单词重复<select data-word-audio="repeat">${selectOptions([[1, '1 次'], [2, '2 次'], [3, '3 次']], audio.repeat)}</select></label><label for="word-gap"><span>词间停顿：<output id="word-gap-value" for="word-gap">${audio.gap} 秒</output></span><input id="word-gap" data-word-audio="gap" type="range" min="1" max="10" step="1" value="${audio.gap}" aria-valuetext="${audio.gap} 秒"></label></div><p class="field-note">每个词读完所选次数后，再停顿指定秒数。设置用于下方「练习筛选出的词」。</p></section>
      <div class="actions wordbook-actions">${btn('word-practice', '练习筛选出的词', 'button primary', items.length ? '' : 'disabled')}${btn('word-due', '本模式到期复习', 'button secondary')}<span class="muted">${items.length} 个词项</span></div>
      <section class="panel">${items.length ? items.slice(0, this.limit).map(item => {
        const lane = item.lanes[f.lane];
        return `<article class="wordbook-row"><div><strong>${esc(item.entry.display)}</strong><small>${esc(item.entry.meaning)}</small><small>${esc(this.sources(item).join(' / '))} · ${item.sourceIds.length} 个来源条目</small></div><span class="status">${lane ? `${lane.lapses} 次错误<br>${lane.status === 'mastered' ? '已掌握' : '巩固中'}` : '本模式未练习'}</span><span class="status">${lane ? `下次复习<br>${formatDate(lane.dueAt)}` : '—'}</span>${btn('word-detail', icon('arrow'), 'icon-button', `data-key="${esc(item.entry.lexemeId)}" aria-label="查看词条详情"`)}</article>`;
      }).join('') : a.empty('这里的空白，也是进步。', '可调整筛选范围，或先完成一轮背词、听写。')}${items.length > this.limit ? btn('word-more', '加载更多', 'button quiet wide') : ''}</section>`;
  }

  input(event) {
    const target = event.target, key = target.dataset.wordAudio;
    if (!['repeat', 'gap'].includes(key)) return;
    const value = Number(target.value);
    if (!Number.isInteger(value) || value < 1 || value > (key === 'repeat' ? 3 : 10)) return;
    this.audio[key] = value;
    if (key === 'gap') {
      this.app.doc.getElementById('word-gap-value').textContent = `${value} 秒`;
      target.setAttribute('aria-valuetext', `${value} 秒`);
    }
  }

  change(event) {
    const target = event.target;
    this.input(event);
    if (target.dataset.wordFilter) {this.app.wordFilter[target.dataset.wordFilter] = target.value; this.limit = 100; this.app.render();}
    if (target.id === 'word-search') {this.app.wordFilter.query = target.value; this.limit = 100; this.app.render();}
  }

  async action(action, element) {
    const a = this.app;
    if (!action.startsWith('word-')) return false;
    if (action === 'word-more') {this.limit += 100; a.render();}
    if (action === 'word-due') {a.selection.pool = 'due'; a.selection.chapter = 'all'; a.selection.lane = a.wordFilter.lane; a.navigate('study');}
    if (action === 'word-practice') {
      const entries = this.filtered().map(item => item.entry);
      if (a.data.draft && !a.win.confirm('开始错词练习会替换原草稿，确认开始？')) return true;
      a.session = createSession(entries, {kind: a.wordFilter.lane === 'dictation' ? 'dictation' : 'cards', lane: a.wordFilter.lane, source: '错词复练', shuffle: false, audio: {...a.data.audio, ...this.audio}});
      a.route = a.session.kind === 'cards' ? 'cards' : 'dictation'; a.flushDraft(); a.render(); a.configureQueue();
      if (a.session.lane === 'audio') await a.recall.play();
    }
    if (action === 'word-detail') {
      const item = a.data.progress[element.dataset.key];
      a.openModal(`<h2>${esc(item.entry.display)}</h2><p>${esc(item.entry.meaning)}</p><div class="detail-lanes">${Object.entries(lanes).map(([key, name]) => `<div>${esc(name)}<small>${item.lanes[key] ? `${item.lanes[key].reviews} 次复习 / ${item.lanes[key].lapses} 次错误 / ${item.lanes[key].status === 'mastered' ? '已掌握' : '巩固中'}` : '还没有本模式记录'}</small></div>`).join('')}</div><div class="section-heading"><h2>回忆与错拼记录</h2></div>${item.attempts.length ? [...item.attempts].reverse().map(attempt => `<div class="clip-note"><small>${formatDate(attempt.at, true)} · ${esc(lanes[attempt.lane])} · ${attempt.correct ? '首次正确' : '仍需复习'} ${attempt.reason ? `· ${esc(attempt.reason)}` : ''}</small><div class="spelling-chain">${attempt.submissions?.length ? attempt.submissions.map(s => esc(s.typed || ({known: '认识', unsure: '模糊', unknown: '不会'}[s.rating]) || '未填')).join(' → ') : esc(attempt.typed || '旧版未保存原始输入')}</div></div>`).join('') : '<p class="field-note">这是旧版迁移的错词，旧版未保存每次输入。</p>'}`);
    }
    return true;
  }
}
