import test from 'node:test';
import assert from 'node:assert/strict';
import { readFaders, writeJSON } from '../src/storage.js';

test('corrupt and inaccessible local storage never prevent startup', () => {
  globalThis.localStorage = { getItem: () => '{bad', setItem: () => { throw new Error('Blocked'); } };
  assert.deepEqual(readFaders([.5, .6]), [.5, .6]);
  assert.doesNotThrow(() => writeJSON('example', [.1]));
  globalThis.localStorage.getItem = () => { throw new Error('Blocked'); };
  assert.deepEqual(readFaders([.5, .6]), [.5, .6]);
});
test('saved values are clamped, invalid entries fall back, wrong shapes reset', () => {
  globalThis.localStorage = { getItem: () => '[2,"0.3",-1,null]' };
  assert.deepEqual(readFaders([.1,.2,.3,.4]), [1,.2,0,.4]);
  assert.deepEqual(readFaders([.1,.2]), [.1,.2]);
});
