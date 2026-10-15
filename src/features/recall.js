import { rateCard, trackActivity } from '../core/session.js';
import { isCorrect } from '../core/vocabulary.js';
import { escapeHTML as esc, icon, button as btn } from '../ui.js';

export class Recall {
  constructor(app) {this.app = app; this.error = ''; this.busy = false;}

  render() {
    const s = this.app.session, entry = s.entries[s.cursor], audio = s.lane === 'audio';
    const played = !!s.playCounts[entry.id], skipped = s.unplayed.includes(entry.id);
    return `<div class="recall-shell"><div class="practice-heading"><div><span class="eyebrow">${audio ? 'LISTEN, THEN REMEMBER' : 'READ, THEN REMEMBER'}</span><h1>${audio ? '先听见，再想起来。' : '看见英文，想起它的意思。'}</h1><p>${esc(s.source)} · ${btn('nav', '保存并离开', 'text-button', 'data-page="home"')}</p></div><span class="pill">${s.cursor + 1} / ${s.entries.length}</span></div>
      <div class="recall-progress"><div style="width:${s.cursor / s.entries.length * 100}%"></div></div>
      <section class="recall-card" aria-label="回忆卡片">
      ${audio && !s.revealed ? `${btn('card-play', icon('audio'), 'audio-orb', `aria-label="播放当前词" ${this.busy ? 'disabled' : ''}`)}<h2>${this.busy ? '正在播放…' : played ? '这个声音，是什么意思？' : '听英文，回忆单词和意思'}</h2><p class="recall-question">先在心里回忆，也可以输入拼写自测。</p><input id="recall-spelling" aria-label="可选的拼写回忆" placeholder="可选：写下你听到的单词" value="${esc(s.answers[entry.id] || '')}" maxlength="512" spellcheck="false" autocomplete="off" autocapitalize="off">`
        : `<div class="recall-word">${esc(entry.display)}</div>${entry.phonetic ? `<div class="phonetic">${esc(entry.phonetic)}</div>` : ''}${btn('card-play', `${icon('audio')} ${this.busy ? '播放中…' : '听发音'}`, 'button quiet small', this.busy ? 'disabled' : '')}
        ${s.revealed ? `<div class="meaning">${esc(entry.meaning || '这条词尚未填写中文释义')}</div>${entry.needsReview ? '<p class="field-note">本词原始音标或拼写待核对，原文已保留。</p>' : ''}${audio && s.answers[entry.id] ? `<p class="field-note">你回忆的拼写：${esc(s.answers[entry.id])} · ${isCorrect(s.answers[entry.id], entry) ? '拼写正确' : '拼写仍需复习'}</p>` : ''}` : '<p class="recall-question">别急着翻面，给自己几秒钟回忆中文词义。</p>'}`}
      ${this.error ? `<div class="audio-error" role="alert">${esc(this.error)}<br>${btn('card-skip', '未播放，跳过本词', 'text-button')}</div>` : ''}
      ${!s.revealed ? `<div class="recall-controls">${btn('card-reveal', `揭晓${audio ? '拼写与词义' : '词义'} ${icon('arrow')}`, 'button primary', audio && !played && !skipped ? 'disabled' : '')}</div>` : skipped ? `<p class="field-note">本词未成功播放，不计入成绩与错误次数。</p>${btn('card-rate', '下一词', 'button primary', 'data-rating="unknown"')}` : '<p class="field-note">按你揭晓答案前的回忆情况标记。</p>'}
      </section>
      ${s.revealed && !skipped ? `<div class="recall-controls ratings">${btn('card-rate', '不会 · 3', 'button rating-unknown', 'data-rating="unknown"')}${btn('card-rate', '模糊 · 2', 'button rating-unsure', 'data-rating="unsure"')}${btn('card-rate', '认识 · 1', 'button primary', 'data-rating="known"')}</div>` : ''}
      <div class="recall-foot">${btn('card-prev', '← 上一个', 'text-button', s.cursor === 0 ? 'disabled' : '')}<span>空格揭晓 · 1 / 2 / 3 标记</span>${btn('finish', '结束本轮', 'text-button')}</div></div>`;
  }

  async play() {
    const a = this.app, session = a.session, entry = session.entries[session.cursor];
    if (this.busy) return;
    this.busy = true; this.error = ''; a.render();
    const result = await a.player.play(entry, session.options.audio);
    this.busy = false;
    if (a.route !== 'cards' || a.session?.id !== session.id || session.entries[session.cursor]?.id !== entry.id) return;
    if (result.ok) a.wordPlayed(entry);
    else if (!result.cancelled) this.error = result.error || '发音失败，请重试';
    a.render();
  }

  async action(action, element) {
    const a = this.app, s = a.session;
    if (!action.startsWith('card-') || a.route !== 'cards') return false;
    trackActivity(s);
    if (action === 'card-play') await this.play();
    if (action === 'card-reveal') {
      const entry = s.entries[s.cursor];
      if (s.lane === 'audio' && !s.playCounts[entry.id] && !s.unplayed.includes(entry.id)) return true;
      s.revealed = true; a.flushDraft(); a.render();
    }
    if (action === 'card-prev' && s.cursor > 0) {a.player.stop(); this.busy = false; this.error = ''; s.cursor--; s.revealed = false; a.flushDraft(); a.render();}
    if (action === 'card-skip') {s.unplayed.push(s.entries[s.cursor].id); s.revealed = true; this.error = ''; a.flushDraft(); a.render();}
    if (action === 'card-rate') {
      a.player.stop(); this.busy = false; this.error = '';
      let rating = element.dataset.rating;
      const entry = s.entries[s.cursor];
      if (rating === 'known' && s.lane === 'audio' && s.answers[entry.id]?.trim() && !isCorrect(s.answers[entry.id], entry)) {
        rating = 'unsure'; a.toast('拼写仍需复习，已记为模糊');
      }
      if (rateCard(s, rating)) await a.complete();
      else {a.flushDraft(); a.render(); if (s.lane === 'audio') await this.play();}
    }
    return true;
  }

  keydown(event) {
    if (this.app.route !== 'cards' || event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.code === 'Space' && !this.app.session.revealed) {event.preventDefault(); this.app.guard(() => this.action('card-reveal'));}
    const rating = {'1': 'known', '2': 'unsure', '3': 'unknown'}[event.key];
    if (rating && this.app.session.revealed) {event.preventDefault(); this.app.guard(() => this.action('card-rate', {dataset: {rating}}));}
  }
}
