import { isCorrect, spellingHint, shuffled } from './vocabulary.js';

export function uid(prefix = 'session') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function createSession(entries, options = {}, now = new Date()) {
  if (!entries.length) throw new Error('没有可练习的词条');
  const words = options.shuffle ? shuffled(entries) : [...entries];
  return {
    id: uid(), kind: options.kind || 'dictation', lane: options.lane || 'dictation',
    source: options.source || '章节练习', chapterId: options.chapterId || null,
    options: {...options}, entries: words, answers: {}, attempts: {}, reasons: {},
    ratings: {}, firstAttempt: null, feedback: null, cursor: 0, audioIndex: 0,
    audioComplete: false, playCounts: {}, unplayed: [], revealed: false,
    startedAt: now.toISOString(), completedAt: null, elapsedMs: 0
  };
}

export function summarize(results) {
  const eligible = results.filter(result => result.status !== 'unplayed');
  const correct = eligible.filter(result => result.correct).length;
  return {correct, total: eligible.length, score: eligible.length ? Math.round(correct / eligible.length * 100) : null};
}

export function grade(session, now = new Date()) {
  const at = now.toISOString();
  const results = session.entries.map(entry => {
    const typed = session.answers[entry.id] || '';
    const rating = session.ratings[entry.id] || null;
    const unplayed = session.unplayed.includes(entry.id);
    const correct = session.kind === 'cards' ? rating === 'known' : isCorrect(typed, entry);
    const status = unplayed ? 'unplayed' : correct ? 'correct' : typed || rating ? 'incorrect' : 'blank';
    const attempts = session.attempts[entry.id] ||= [];
    if (!unplayed && (!attempts.length || attempts.at(-1).typed !== typed || attempts.at(-1).rating !== rating)) {
      attempts.push({typed, rating: rating || null, at, correct});
    }
    return {entry, typed, correct: !unplayed && correct, status, rating: rating || null,
      reason: session.reasons[entry.id] || '', hint: correct ? '' : spellingHint(typed, entry)};
  });
  session.feedback = results;
  if (!session.firstAttempt) session.firstAttempt = {at, results: structuredClone(results), ...summarize(results)};
  return results;
}

export function finish(session, now = new Date()) {
  if (session.completedAt) return session;
  grade(session, now);
  session.completedAt = now.toISOString();
  return session;
}

export function rateCard(session, rating) {
  if (!['known', 'unsure', 'unknown'].includes(rating)) throw new Error('无效的掌握标记');
  const entry = session.entries[session.cursor];
  if (!entry || !session.revealed) throw new Error('请先揭晓答案，再标记掌握情况');
  session.ratings[entry.id] = rating;
  session.cursor++;
  session.revealed = false;
  return session.cursor >= session.entries.length;
}

export function alignAnswers(session, index, direction) {
  const values = session.entries.map(entry => session.answers[entry.id] || '');
  if (direction === 'down') values.splice(index, 0, '');
  else values.splice(index, 1);
  session.entries.forEach((entry, i) => { session.answers[entry.id] = values[i] || ''; });
  session.feedback = null;
}

export function trackActivity(session, now = Date.now()) {
  if (session.lastActivityAt) session.elapsedMs += Math.min(Math.max(0, now - session.lastActivityAt), 30000);
  session.lastActivityAt = now;
}
