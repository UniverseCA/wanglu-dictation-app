import test from 'node:test';
import assert from 'node:assert/strict';
import { chapters, vocabulary, makeEntry, isCorrect, parseWordList } from '../src/core/vocabulary.js';
import { createSession, grade, finish, rateCard, alignAnswers } from '../src/core/session.js';
import { applyResults, dueEntries, dayKey } from '../src/core/review.js';
import { Repository, emptyState, STORAGE_KEY, migrateLegacy } from '../src/core/storage.js';

const word = (text = 'hello', id = 'test:1') => makeEntry({w: text, m: '你好'}, {id, chapterId: 'test'});
const at = date => new Date(`${date}T12:00:00+08:00`);
function memory() {
  const values = new Map();
  return {values, writes: 0, getItem(key) {return values.get(key) ?? null;}, setItem(key, value) {this.writes++; values.set(key, value);}};
}

test('all 5873 source records and 32 sections retain distinct source IDs', () => {
  assert.equal(vocabulary.length, 5873);
  assert.equal(chapters.length, 32);
  assert.equal(new Set(vocabulary.map(w => w.id)).size, 5873);
  assert.equal(chapters.find(c => c.id === '11.4').entries.length, 916);
});

test('annotation and spelling variants are accepted without fuzzy spelling or plural forgiveness', () => {
  for (const [answer, typed] of [['fertiliser=fertilizer', 'fertilizer'], ['archaeologist=archeologist', 'archaeologist'], ['RA(research assistant)', 'RA'], ['truck licence', 'truck license'], ['colour blind', 'color blind']]) assert(isCorrect(typed, word(answer)));
  assert(!isCorrect('helllo', word()));
  assert(!isCorrect('hellos', word()));
  assert(!isCorrect('', word()));
});

test('blank correction is recalculated while first attempt remains frozen', () => {
  const session = createSession([word()]);
  grade(session);
  assert.equal(session.firstAttempt.score, 0);
  session.answers['test:1'] = 'hello';
  assert.equal(grade(session)[0].correct, true);
  assert.equal(session.firstAttempt.score, 0);
  assert.equal(session.attempts['test:1'].length, 2);
  grade(session);
  assert.equal(session.attempts['test:1'].length, 2);
});

test('grading has no storage side effect and completing twice counts once', () => {
  const storage = memory(), repo = new Repository(storage); repo.load();
  const session = createSession([word()]);
  grade(session); grade(session);
  assert.equal(storage.writes, 0);
  finish(session, at('2026-10-16')); repo.commit(session); repo.commit(session);
  assert.equal(storage.writes, 1);
  assert.equal(repo.data.sessions.length, 1);
  assert.equal(repo.data.progress[word().lexemeId].lanes.dictation.lapses, 1);
});

test('draft round trip preserves exact random order, answers and independent audio cursor', () => {
  const storage = memory(), repo = new Repository(storage); repo.load();
  const session = createSession([word('one', '1'), word('two', '2')], {shuffle: true});
  session.answers[session.entries[0].id] = '<b>my original answer</b>';
  session.audioIndex = 1;
  repo.update(state => {state.draft = session;});
  assert.deepEqual(new Repository(storage).load().draft, session);
});

test('failed storage write does not pretend memory was committed', () => {
  const storage = memory(), repo = new Repository(storage); repo.load();
  storage.setItem = () => {throw new Error('quota');};
  assert.throws(() => repo.update(state => {state.plan.words = 100;}), /保存失败/);
  assert.equal(repo.data.plan.words, 50);
});

test('damaged storage is preserved and another tab cannot silently overwrite data', () => {
  const storage = memory(); storage.values.set(STORAGE_KEY, 'null');
  assert.throws(() => new Repository(storage).load(), /读取失败/);
  assert.equal(storage.getItem(STORAGE_KEY), 'null');
  storage.values.clear();
  const a = new Repository(storage), b = new Repository(storage); a.load(); b.load();
  a.update(state => {state.plan.words = 80;});
  assert.throws(() => b.update(state => {state.plan.words = 20;}), /另一个页面/);
});

test('legacy migration preserves spelling, old totals, chapter and original source storage', () => {
  const storage = memory();
  const hist = {'3.2': [{n: 1, pct: 50, correct: 1, total: 2, date: '2026-10-11', all: [{w: 'hello', m: '你好', p: '', typed: 'helo', ok: false}]}]};
  storage.values.set('wl3_hist', JSON.stringify(hist));
  storage.values.set('wl3_wb', JSON.stringify({hello: {word: 'hello', mean: '你好', n: 4, chap: '3.2'}}));
  const data = new Repository(storage).load();
  assert.equal(data.sessions[0].firstAttempt.score, 50);
  assert.equal(data.sessions[0].firstAttempt.results[0].typed, 'helo');
  assert.equal(storage.getItem('wl3_hist'), JSON.stringify(hist));
  assert.equal(Object.values(data.progress)[0].lanes.dictation.lapses, 4);
  assert.throws(() => migrateLegacy(null), /无效/);
});

test('backup round trip and repeated merging keep one session and preserve pre-import backup', () => {
  const a = new Repository(memory()); a.load();
  const session = finish(createSession([word()]), at('2026-10-16')); a.commit(session);
  const storage = memory(), b = new Repository(storage); b.load();
  b.restore(a.backup()); b.restore(a.backup());
  assert.equal(b.data.sessions.length, 1);
  assert.equal(Object.values(b.data.progress)[0].attempts.length, 1);
  assert(storage.getItem('wl4_before_import'));
  const before = b.backup();
  assert.throws(() => b.restore('{"__proto__":{"polluted":true}}'));
  assert.deepEqual(JSON.parse(b.backup()).data, JSON.parse(before).data);
});

test('visual and audio recall are separate and same-day repeats do not imply mastery', () => {
  const progress = {};
  function success(date, lane) {
    const session = createSession([word()], {kind: 'cards', lane});
    session.revealed = true; assert(rateCard(session, 'known'));
    finish(session, at(date)); applyResults(progress, session);
  }
  success('2026-10-16', 'visual'); success('2026-10-16', 'visual');
  assert.equal(progress[word().lexemeId].lanes.visual.streak, 1);
  assert.equal(progress[word().lexemeId].lanes.audio, undefined);
  success('2026-10-17', 'visual'); success('2026-10-18', 'visual');
  assert.equal(progress[word().lexemeId].lanes.visual.status, 'mastered');
  assert.equal(dueEntries(progress, 'visual', at('2026-10-19')).length, 0);
  assert.equal(dueEntries(progress, 'visual', at('2026-10-30')).length, 1);
});

test('unplayed words do not count as errors and repeated sources count as one lexeme', () => {
  const first = word(), duplicate = {...first, id: 'test:2'};
  const session = createSession([first, duplicate]); session.answers[first.id] = 'hello';
  finish(session, at('2026-10-16'));
  const progress = {}; applyResults(progress, session);
  assert.equal(progress[first.lexemeId].lanes.dictation.lapses, 1);
  assert.deepEqual(progress[first.lexemeId].sourceIds, ['test:1', 'test:2']);
  const failed = createSession([word()]); failed.unplayed.push(first.id); finish(failed);
  assert.equal(failed.firstAttempt.total, 0);
  assert.equal(failed.firstAttempt.score, null);
  const empty = {}; applyResults(empty, failed); assert.deepEqual(empty, {});
});

test('personal terms retain literal spelling and alignment preserves first answers', () => {
  const terms = parseWordList('ablility | 能力\nanalysit\t分析员', 'mine');
  assert.equal(terms[0].display, 'ablility');
  assert.equal(terms[1].display, 'analysit');
  const session = createSession(terms); session.answers[terms[0].id] = 'ability'; grade(session);
  alignAnswers(session, 0, 'down');
  assert.equal(session.answers[terms[1].id], 'ability');
  assert.equal(session.firstAttempt.results[0].typed, 'ability');
  assert.equal(emptyState().version, 4);
  assert.match(dayKey(at('2026-10-16')), /^\d{4}-\d{2}-\d{2}$/);
});
