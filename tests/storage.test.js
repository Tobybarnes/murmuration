import test from 'node:test';
import assert from 'node:assert/strict';
import { readFaders, writeJSON, createMidiMapping } from '../src/storage.js';

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
test('16n mappings remain direct and learned controllers remain stable after restoring', () => {
  const mapping = createMidiMapping();
  assert.equal(mapping.lookup(0,32), 0);
  assert.equal(mapping.lookup(3,47), 15);
  assert.equal(mapping.lookup(0,1), 0);
  assert.equal(mapping.lookup(0,2), 1);
  assert.equal(mapping.lookup(0,1), 0);
  assert.equal(createMidiMapping(mapping.learned).lookup(0,2), 1);
  assert.equal(createMidiMapping({ '0:4': 90 }).lookup(0,4), 0);
  assert.equal(mapping.lookup(0,128), -1);
});
