// Shared procedural silhouettes. No assets, animation clock or scene state.
// Flock motion remains adapted from Ben Bashford; see ../../ATTRIBUTION.md.
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function perchedBird(ctx, activity) {
  // Body, breast and head are one contour; the short beak breaks the silhouette.
  const lift = activity * 0.05;
  ctx.beginPath();
  ctx.moveTo(-0.19, -0.31);
  ctx.bezierCurveTo(-0.51, -0.45, -0.48, -0.95 - lift, -0.13, -1.07 - lift);
  ctx.bezierCurveTo(-0.01, -1.1 - lift, 0.01, -1.31 - lift, 0.2, -1.33 - lift);
  ctx.bezierCurveTo(0.39, -1.37 - lift, 0.51, -1.25 - lift, 0.47, -1.14 - lift);
  ctx.lineTo(0.76, -1.08 - lift);
  ctx.lineTo(0.43, -1.03 - lift);
  ctx.bezierCurveTo(0.5, -0.79, 0.41, -0.44, 0.12, -0.28);
  ctx.lineTo(-0.54, -0.08);
  ctx.lineTo(-0.4, -0.48);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.065;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-0.08, -0.35); ctx.lineTo(-0.1, 0); ctx.lineTo(-0.23, 0);
  ctx.moveTo(-0.1, 0); ctx.lineTo(0.03, 0);
  ctx.moveTo(0.15, -0.38); ctx.lineTo(0.2, 0); ctx.lineTo(0.32, 0);
  ctx.stroke();
}

function flightBird(ctx, bird) {
  const pose = bird.pose || 'flying';
  const progress = clamp(finite(bird.poseProgress, 0.5), 0, 1);
  const bank = clamp(finite(bird.bank), -1, 1);
  const phase = finite(bird.wingPhase);
  const gliding = pose === 'gliding';
  const flap = gliding ? 0.1 : Math.cos(phase);
  const flare = pose === 'landing' ? 0.35 + progress * 0.2 : pose === 'takeoff' ? 0.35 * (1 - progress) : 0;
  const reach = 1.05 + flap * 0.48 + flare;
  const sweep = -0.14 - Math.sin(phase) * (gliding ? 0 : 0.2) - flare * 0.3;

  // Each wing tapers from the shoulder to a pointed primary feather, with a
  // curved trailing edge. Banking foreshortens the far wing independently.
  for (const side of [-1, 1]) {
    const span = reach * (1 + bank * side * 0.38);
    ctx.beginPath();
    ctx.moveTo(0.2, side * 0.1);
    ctx.bezierCurveTo(0.09, side * 0.39, sweep + 0.23, side * span * 0.82, sweep + 0.12, side * span);
    ctx.bezierCurveTo(sweep - 0.17, side * span * 0.89, -0.58, side * 0.46, -0.28, side * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  // Narrow body, separate head and a small forked tail keep the bird readable
  // at the few pixels used by a distant murmuration.
  ctx.beginPath();
  ctx.moveTo(0.51, -0.09);
  ctx.bezierCurveTo(0.36, -0.2, -0.11, -0.23, -0.41, -0.08);
  ctx.lineTo(-0.8, -0.18);
  ctx.lineTo(-0.67, 0);
  ctx.lineTo(-0.8, 0.18);
  ctx.lineTo(-0.41, 0.08);
  ctx.bezierCurveTo(-0.11, 0.23, 0.36, 0.2, 0.51, 0.09);
  ctx.lineTo(0.75, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.43, 0, 0.18, 0.135, 0, 0, TAU);
  ctx.fill();
}

/** Draw one bird. Perched x/y anchors the feet; flight x/y anchors the body. */
export function drawBird(ctx, bird, { colour = '#354333', alpha = 1 } = {}) {
  if (![bird?.x, bird?.y, bird?.size].every(Number.isFinite) || bird.size <= 0) return false;
  const activity = clamp(finite(bird.activity), 0, 1);
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.scale(bird.size, bird.size);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.globalAlpha = clamp(finite(alpha, 1), 0, 1);

  if (bird.pose === 'perched') {
    const facing = bird.facing === -1 ? -1 : bird.facing === 1 ? 1 : Math.cos(finite(bird.heading)) < 0 ? -1 : 1;
    ctx.scale(facing, 1);
    perchedBird(ctx, activity);
  } else {
    ctx.save();
    ctx.rotate(finite(bird.heading));
    flightBird(ctx, bird);
    ctx.restore();
    if (bird.pose === 'landing' || bird.pose === 'takeoff') {
      const progress = clamp(finite(bird.poseProgress, 0.5), 0, 1);
      const extension = bird.pose === 'landing' ? progress : 1 - progress;
      ctx.lineWidth = 0.055;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-0.1, 0.1); ctx.lineTo(-0.17, 0.18 + extension * 0.44);
      ctx.lineTo(-0.03, 0.18 + extension * 0.44);
      ctx.moveTo(0.14, 0.1); ctx.lineTo(0.2, 0.18 + extension * 0.44);
      ctx.lineTo(0.34, 0.18 + extension * 0.44);
      ctx.stroke();
    }
  }
  ctx.restore();
  return true;
}
