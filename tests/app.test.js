import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountApp } from '../src/app.js';
import { Repository } from '../src/core/storage.js';
import { createSession } from '../src/core/session.js';
import { makeEntry, vocabulary } from '../src/core/vocabulary.js';
import { validateRange, SegmentPlayer } from '../src/features/listening.js';
import { specialties } from '../src/features/specialties.js';

function setup() {
  const win = new Window({url: 'http://localhost:4173'});
  win.document.body.innerHTML = '<div id="app"></div>';
  win.confirm = () => true;
  const player = {stop() {}, async play() {return {ok: true};}};
  const app = mountApp(win, new Repository(win.localStorage), player);
  return {app, win, doc: win.document, close: () => {app.destroy(); win.happyDOM.abort();}};
}
function enter(win, input, value) {input.value = value; input.dispatchEvent(new win.Event('input', {bubbles: true}));}
const entry = () => makeEntry({w: 'hello', m: '你好'}, {id: 'test:hello'});

test('every main route renders and theme preference survives reload', async () => {
  const t = setup();
  try {
    for (const route of ['home', 'study', 'wrong', 'history', 'settings', 'listening']) {t.app.navigate(route); assert(t.doc.querySelector('h1'));}
    assert([...t.doc.querySelectorAll('.nav-item')].every(button => button.getAttribute('aria-label')));
    await t.app.action('toggle-theme');
    assert.equal(t.doc.documentElement.dataset.theme, 'dark');
    assert.equal(new Repository(t.win.localStorage).load().theme, 'dark');
  } finally {t.close();}
});

test('wordbook chapter filters include every original source of a repeated word', () => {
  const t = setup();
  try {
    const groups = new Map();
    for (const word of vocabulary) {const list = groups.get(word.lexemeId) || []; list.push(word); groups.set(word.lexemeId, list);}
    const group = [...groups.values()].find(words => new Set(words.map(word => word.chapterId)).size > 1);
    const first = group[0], second = group.find(word => word.chapterId !== first.chapterId);
    t.app.data.progress[first.lexemeId] = {entry: first, sourceIds: [first.id, second.id], lanes: {}, attempts: [], everWrong: true};
    t.app.wordFilter.chapter = second.chapterId;
    assert.equal(t.app.wordbook.filtered().length, 1);
    t.app.navigate('wrong');
    assert(t.doc.querySelector('.wordbook-row').textContent.includes(second.chapterId));
  } finally {t.close();}
});

test('view recall shows English and hides meaning until revealed', async () => {
  const t = setup();
  try {
    t.app.session = createSession([entry()], {kind: 'cards', lane: 'visual', audio: {}}); t.app.route = 'cards'; t.app.render();
    assert(t.doc.querySelector('.recall-card').textContent.includes('hello'));
    assert(!t.doc.querySelector('.meaning'));
    await t.app.recall.action('card-reveal');
    assert.equal(t.doc.querySelector('.meaning').textContent, '你好');
    await t.app.recall.action('card-rate', {dataset: {rating: 'unknown'}});
    assert.equal(t.app.route, 'result');
    assert.equal(Object.values(t.app.data.progress)[0].everWrong, true);
    assert.equal(t.app.data.draft, null);
  } finally {t.close();}
});

test('audio recall hides both English and meaning; reveal waits for playback', async () => {
  const t = setup();
  try {
    t.app.session = createSession([entry()], {kind: 'cards', lane: 'audio', audio: {}}); t.app.route = 'cards'; t.app.render();
    assert(!t.doc.querySelector('.recall-word')); assert(!t.doc.querySelector('.meaning'));
    assert(t.doc.querySelector('[data-action="card-reveal"]').disabled);
    await t.app.recall.play();
    assert(!t.doc.querySelector('[data-action="card-reveal"]').disabled);
    await t.app.recall.action('card-reveal');
    assert.equal(t.doc.querySelector('.recall-word').textContent, 'hello');
    assert.equal(t.doc.querySelector('.meaning').textContent, '你好');
  } finally {t.close();}
});

test('incorrect spelling during audio recall enters wordbook even if meaning is known', async () => {
  const t = setup();
  try {
    t.app.session = createSession([entry()], {kind: 'cards', lane: 'audio', audio: {}});
    t.app.route = 'cards'; t.app.session.answers['test:hello'] = 'helo'; t.app.session.revealed = true; t.app.render();
    await t.app.recall.action('card-rate', {dataset: {rating: 'known'}});
    assert.equal(t.app.session.firstAttempt.results[0].rating, 'unsure');
    const progress = Object.values(t.app.data.progress)[0];
    assert.equal(progress.everWrong, true); assert.equal(progress.lanes.audio.lapses, 1);
  } finally {t.close();}
});

test('actual input events fix a previously blank answer and keep first score', async () => {
  const t = setup();
  try {
    t.app.session = createSession([entry()], {audio: {gap: 0}}); t.app.route = 'dictation'; t.app.render();
    await t.app.action('grade');
    enter(t.win, t.doc.getElementById('input-0'), 'hello');
    await t.app.complete();
    assert.equal(t.app.data.sessions[0].firstAttempt.score, 0);
    assert.equal(t.app.data.sessions[0].feedback[0].correct, true);
    assert.equal(Object.values(t.app.data.progress)[0].lanes.dictation.lapses, 1);
  } finally {t.close();}
});

test('playback leaves input focus unchanged and navigation preserves draft', async () => {
  const t = setup();
  try {
    t.app.session = createSession([entry(), {...entry(), id: 'test:2'}], {audio: {gap: 0}}); t.app.route = 'dictation'; t.app.render(); t.app.configureQueue();
    t.doc.getElementById('input-0').focus();
    const focused = t.doc.activeElement;
    await t.app.queue.start();
    assert.equal(t.doc.activeElement, focused);
    enter(t.win, focused, 'my literal answer');
    t.app.navigate('wrong');
    assert.equal(t.app.queue.running, false);
    assert.equal(t.app.data.draft.answers['test:hello'], 'my literal answer');
    t.app.resume();
    assert.equal(t.doc.getElementById('input-0').value, 'my literal answer');
  } finally {t.close();}
});

test('typed HTML is displayed literally in result and history DOM', async () => {
  const t = setup();
  try {
    t.app.session = createSession([entry()], {audio: {}}); t.app.route = 'dictation'; t.app.render();
    enter(t.win, t.doc.getElementById('input-0'), '<img src=x onerror=alert(1)>');
    await t.app.complete();
    assert.equal(t.doc.querySelectorAll('img').length, 0);
    assert(t.doc.querySelector('.result-answer').textContent.includes('<img'));
    await t.app.action('history-detail', {dataset: {id: t.app.session.id}});
    assert.equal(t.doc.querySelectorAll('img').length, 0);
  } finally {t.close();}
});

test('study scope and limit determine score denominator; custom spelling remains literal', async () => {
  const t = setup();
  try {
    t.app.navigate('study');
    t.app.selection = {lane: 'dictation', pool: 'all', chapter: '3.2', from: '2', to: '4', count: '20', shuffle: false};
    await t.app.begin();
    assert.equal(t.app.session.entries.length, 3);
    assert.equal(t.app.session.entries[0].sourceIndex, 2);
    await t.app.complete();
    assert.equal(t.app.session.firstAttempt.total, 3);
  } finally {t.close();}
});

test('sequential chapter 3.3-3 excludes other chapters even after shared words were studied', async () => {
  const t = setup();
  try {
    const expected = vocabulary.filter(word => word.chapterId === '3.3-3');
    for (const word of expected) {
      const sources = vocabulary.filter(source => source.lexemeId === word.lexemeId);
      t.app.data.progress[word.lexemeId] = {entry: word, sourceIds: sources.map(source => source.id), lanes: {}, attempts: [], everWrong: true};
    }
    t.app.selection = {lane: 'dictation', pool: 'all', chapter: '3.3-3', from: '1', to: '', count: '0', shuffle: false};
    assert.deepEqual(t.app.poolEntries().map(word => word.id), expected.map(word => word.id));
    await t.app.begin();
    assert.equal(t.app.session.entries.length, 113);
    assert.deepEqual(t.app.session.entries.map(word => word.id), expected.map(word => word.id));
    assert.deepEqual(t.app.session.entries.slice(0, 4).map(word => word.display), ['debt', 'decade', 'decision', 'decline']);
  } finally {t.close();}
});

test('shuffle applies only to the current round and draft resume preserves its order', async () => {
  const t = setup();
  try {
    await t.app.action('quick-start', {dataset: {lane: 'dictation'}});
    const checkbox = t.doc.querySelector('[name="shuffle"]');
    checkbox.checked = true;
    await t.app.change({target: checkbox});
    await t.app.submit(t.doc.querySelector('[data-form="start"]'));
    assert.equal(t.app.session.options.shuffle, true);
    const order = t.app.session.entries.map(word => word.id);

    t.app.navigate('home');
    await t.app.action('quick-start', {dataset: {lane: 'dictation'}});
    assert.equal(t.doc.querySelector('[name="shuffle"]').checked, false);
    t.app.resume();
    assert.equal(t.app.session.options.shuffle, true);
    assert.deepEqual(t.app.session.entries.map(word => word.id), order);

    t.app.navigate('study');
    const expected = t.app.poolEntries().slice(0, 20).map(word => word.id);
    await t.app.submit(t.doc.querySelector('[data-form="start"]'));
    assert.equal(t.app.session.options.shuffle, false);
    assert.deepEqual(t.app.session.entries.map(word => word.id), expected);
  } finally {t.close();}
});

test('failed completion can be retried without losing the session or double counting', async () => {
  const t = setup();
  try {
    t.app.session = createSession([entry()], {audio: {}}); t.app.route = 'dictation'; t.app.render();
    enter(t.win, t.doc.getElementById('input-0'), 'hello');
    const original = t.app.repo.storage;
    t.app.repo.storage = {getItem: key => original.getItem(key), setItem: () => {throw new Error('quota');}};
    await assert.rejects(t.app.complete(), /保存失败/);
    assert.equal(t.app.session.completedAt, null);
    t.app.repo.storage = original;
    await t.app.complete();
    assert.equal(t.app.route, 'result');
    assert.equal(t.app.data.sessions.length, 1);
  } finally {t.close();}
});

test('returning to an earlier card cannot overwrite its first recall rating', async () => {
  const t = setup();
  try {
    t.app.session = createSession([entry(), {...entry(), id: 'second', lexemeId: 'second'}], {kind: 'cards', lane: 'visual', audio: {}}); t.app.route = 'cards'; t.app.render();
    await t.app.recall.action('card-reveal'); await t.app.recall.action('card-rate', {dataset: {rating: 'unknown'}});
    await t.app.recall.action('card-prev'); await t.app.recall.action('card-reveal'); await t.app.recall.action('card-rate', {dataset: {rating: 'known'}});
    await t.app.recall.action('card-reveal'); await t.app.recall.action('card-rate', {dataset: {rating: 'known'}});
    assert.equal(t.app.session.firstAttempt.score, 50);
    assert.equal(t.app.session.feedback[0].correct, true);
  } finally {t.close();}
});

test('A-B player enforces boundaries, repeats only when selected, and rejects invalid ranges', async () => {
  const handlers = {};
  const audio = {duration: 60, currentTime: 0, played: 0, paused: 0, addEventListener(name, fn) {handlers[name] = fn;}, async play() {this.played++;}, pause() {this.paused++;}};
  const player = new SegmentPlayer(audio);
  await player.play({from: 5, to: 10, loop: true, rate: 0.75});
  audio.currentTime = 10; handlers.timeupdate();
  assert.equal(audio.currentTime, 5); assert.equal(audio.played, 2);
  await player.play({from: 20, to: 25, loop: false}); audio.currentTime = 25; handlers.timeupdate();
  assert.equal(player.active, false); assert.equal(audio.paused, 1);
  assert.throws(() => validateRange(10, 5, 60)); assert.throws(() => validateRange(0, 100, 60));
  assert.equal(specialties.length, 8); assert(specialties.every(set => set.entries.length >= 4));
});
