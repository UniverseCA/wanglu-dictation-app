export const lanes = {visual: '看词回忆', audio: '听音回忆', dictation: '听写'};
const intervals = [1, 3, 7, 14, 30, 60];

export function dayKey(value = new Date()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function afterDays(now, days) {
  const result = new Date(now);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);
  return result.toISOString();
}

export function applyResults(progress, session) {
  const now = new Date(session.completedAt);
  const groups = new Map();
  for (const result of session.firstAttempt.results) {
    if (result.status === 'unplayed') continue;
    const previous = groups.get(result.entry.lexemeId);
    if (!previous || (!result.correct && previous.correct)) groups.set(result.entry.lexemeId, result);
  }
  for (const result of groups.values()) {
    const key = result.entry.lexemeId;
    const item = progress[key] ||= {entry: result.entry, sourceIds: [], lanes: {}, attempts: [], everWrong: false};
    const sources = session.entries.filter(entry => entry.lexemeId === key).map(entry => entry.id);
    item.sourceIds = [...new Set([...item.sourceIds, ...sources])];
    const previous = item.lanes[session.lane] || {reviews: 0, lapses: 0, streak: 0, lastSuccessDay: null};
    const crossDay = previous.lastSuccessDay !== dayKey(now);
    const streak = result.correct ? previous.streak + (crossDay ? 1 : 0) : 0;
    const wrong = !result.correct && (result.rating !== 'unsure' || result.spellingCorrect === false);
    item.everWrong ||= wrong;
    item.lanes[session.lane] = {
      reviews: previous.reviews + 1, lapses: previous.lapses + (wrong ? 1 : 0), streak,
      lastSuccessDay: result.correct ? dayKey(now) : previous.lastSuccessDay,
      lastAt: now.toISOString(), dueAt: afterDays(now, result.correct ? intervals[Math.min(Math.max(streak - 1, 0), intervals.length - 1)] : 1),
      status: streak >= 3 ? 'mastered' : 'learning', lastRating: result.rating || (result.correct ? 'known' : 'unknown')
    };
    item.attempts.push({sessionId: session.id, lane: session.lane, at: now.toISOString(),
      typed: result.typed, rating: result.rating, correct: result.correct, reason: result.reason,
      submissions: structuredClone(session.attempts[result.entry.id] || [])});
  }
  return progress;
}

export function dueEntries(progress, lane, now = new Date()) {
  return Object.values(progress).filter(item => item.lanes[lane] && Date.parse(item.lanes[lane].dueAt) <= +now)
    .sort((a, b) => Date.parse(a.lanes[lane].dueAt) - Date.parse(b.lanes[lane].dueAt)).map(item => item.entry);
}

export function wrongEntries(progress) {
  return Object.values(progress).filter(item => item.everWrong)
    .sort((a, b) => Math.max(...Object.values(b.lanes).map(lane => lane.lapses), 0) - Math.max(...Object.values(a.lanes).map(lane => lane.lapses), 0))
    .map(item => item.entry);
}

export function activitySummary(sessions, now = new Date()) {
  const today = sessions.filter(session => session.completedAt && dayKey(session.completedAt) === dayKey(now));
  const words = new Set(today.flatMap(session => (session.firstAttempt?.results || []).filter(result => result.status !== 'unplayed').map(result => result.entry.lexemeId)));
  return {sessions: today.length, words: words.size, minutes: Math.round(today.reduce((sum, session) => sum + (session.elapsedMs || 0), 0) / 60000)};
}
