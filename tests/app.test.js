import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountApp } from '../src/app.js';
import { Repository } from '../src/core/storage.js';
import { createSession } from '../src/core/session.js';
import { makeEntry } from '../src/core/vocabulary.js';
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
    await t.app.action('toggle-theme');
    assert.equal(t.doc.documentElement.dataset.theme, 'dark');
    assert.equal(new Repository(t.win.localStorage).load().theme, 'dark');
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
