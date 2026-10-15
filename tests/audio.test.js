import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackQueue, Pronouncer } from '../src/audio.js';

test('continuous playback advances audio without any DOM or input focus dependency', async () => {
  const played = [], states = [];
  const player = {stop() {}, async play(entry) {played.push(entry.id); return {ok: true};}};
  const queue = new PlaybackQueue(player, {onChange: state => states.push(state)});
  queue.configure([{id: 'a'}, {id: 'b'}], 0, {gap: 0});
  await queue.start();
  assert.deepEqual(played, ['a', 'b']);
  assert.equal(queue.position, 2);
  assert.equal(states.at(-1).status, 'ended');
});

test('failed audio stops at the failed word and can be retried', async () => {
  let fail = true;
  const played = [];
  const queue = new PlaybackQueue({stop() {}, async play(entry) {played.push(entry.id); return {ok: !fail, error: 'offline'};}});
  queue.configure([{id: 'a'}, {id: 'b'}], 0, {gap: 0});
  await queue.start();
  assert.equal(queue.position, 0); assert.equal(queue.status, 'failed');
  fail = false; await queue.start();
  assert.deepEqual(played, ['a', 'a', 'b']);
});

test('navigation cancellation cannot advance or revive an old queue', async () => {
  let resolvePlay;
  const player = {stop() {}, play() {return new Promise(resolve => {resolvePlay = resolve;});}};
  const queue = new PlaybackQueue(player);
  queue.configure([{id: 'a'}, {id: 'b'}], 0, {gap: 0});
  const pending = queue.start(); queue.pause(); resolvePlay({ok: true}); await pending;
  assert.equal(queue.position, 0); assert.equal(queue.running, false);
});

test('offline mode reports failure instead of attempting network playback', async () => {
  const player = new Pronouncer({});
  player.remote = () => {throw new Error('network should not be called');};
  const result = await player.play({display: 'hello'}, {voice: 'offline'});
  assert.equal(result.ok, false);
  assert.match(result.error, /本地英语语音/);
});
