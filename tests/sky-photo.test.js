import test from 'node:test';
import assert from 'node:assert/strict';
import { skyPhotoPlacement, drawSky } from '../src/renderers/sky.js';

test('photographic drift covers portrait, landscape and wide windows throughout its cycle', () => {
  for (const [width, height] of [[390, 844], [658, 762], [1440, 900], [2560, 700]]) {
    for (let time = 0; time <= 240_000; time += 1000) {
      const photo = skyPhotoPlacement(width, height, 1300, 867, time);
      assert.ok(photo.x <= 0 && photo.y <= 0);
      assert.ok(photo.x + photo.width >= width && photo.y + photo.height >= height);
      const next = skyPhotoPlacement(width, height, 1300, 867, time + 1000 / 60);
      assert.ok(Math.hypot(next.x - photo.x, next.y - photo.y) < .04, 'drift has no visible frame jumps');
    }
  }
});

test('a failed image draws a fallback instead of attempting an invalid canvas image', () => {
  let filled = false;
  const ctx = { createLinearGradient: () => ({ addColorStop() {} }), fillRect() { filled = true; }, drawImage() { assert.fail('invalid image must not be drawn'); } };
  drawSky(ctx, { complete: true, naturalWidth: 0, naturalHeight: 0 }, 390, 844, 0);
  assert.ok(filled);
});
