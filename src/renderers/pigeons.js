// Flight silhouettes for the sky view. Scene movement and identity stay with
// the host; drawing uses only its projected frame and never advances the clock.
import { drawBird } from './birds.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function wing(ctx, side, reach, sweep, bank, detail, colour, alpha) {
  ctx.save();
  ctx.scale(1, side * (1 + bank * side * 0.38));
  ctx.beginPath();
  ctx.moveTo(0.16, 0.12);
  // A full shoulder and elbow lead into a short pointed primary tip. The
  // trailing edge stays broad, rather than narrowing into a swallow's wing.
  ctx.bezierCurveTo(0.37, reach * 0.31, sweep + 0.38, reach * 0.74, sweep + 0.13, reach);
  ctx.bezierCurveTo(sweep - 0.04, reach * 0.96, sweep - 0.25, reach * 0.85, sweep - 0.36, reach * 0.7);
  ctx.bezierCurveTo(-0.59, reach * 0.49, -0.5, 0.24, -0.34, 0.1);
  ctx.closePath();
  ctx.fill();

  if (detail > 0) {
    ctx.clip();
    // A faint grey wing panel lets the two bars read as dark markings while
    // keeping the distant bird a single silhouette in the caller's palette.
    ctx.fillStyle = '#c6cec8';
    ctx.globalAlpha = alpha * detail * 0.19;
    ctx.beginPath();
    ctx.ellipse(-0.17, reach * 0.43, 0.34, reach * 0.44, -0.14, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.86;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 0.095;
    ctx.lineCap = 'round';
    for (let bar = 0; bar < 2; bar++) {
      const y = reach * (0.43 + bar * 0.17);
      ctx.beginPath();
      ctx.moveTo(-0.52, y - reach * 0.05);
      ctx.bezierCurveTo(-0.27, y - reach * 0.02, -0.02, y + reach * 0.09, 0.21, y + reach * 0.14);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function body(ctx, flare) {
  // The tail widens from the rump into a continuous, gently rounded fan.
  ctx.beginPath();
  ctx.moveTo(-0.35, -0.11);
  ctx.lineTo(-0.99, -0.24 - flare * 0.1);
  ctx.quadraticCurveTo(-1.1, 0, -0.99, 0.24 + flare * 0.1);
  ctx.lineTo(-0.35, 0.11);
  ctx.closePath();
  ctx.fill();

  // Plump breast, short neck, small round head and a short beak. The head joins
  // the body directly so the silhouette remains readable at 7–12 CSS pixels.
  ctx.beginPath();
  ctx.moveTo(0.39, -0.13);
  ctx.bezierCurveTo(0.2, -0.26, -0.26, -0.34, -0.52, -0.14);
  ctx.bezierCurveTo(-0.63, -0.05, -0.63, 0.05, -0.52, 0.14);
  ctx.bezierCurveTo(-0.26, 0.34, 0.2, 0.26, 0.39, 0.13);
  ctx.bezierCurveTo(0.45, 0.22, 0.67, 0.19, 0.69, 0.07);
  ctx.lineTo(0.86, 0.015);
  ctx.lineTo(0.69, -0.035);
  ctx.bezierCurveTo(0.69, -0.21, 0.45, -0.22, 0.39, -0.13);
  ctx.closePath();
  ctx.fill();
}

/** Draw a pigeon in projected CSS pixels. All Canvas state is restored. */
export function drawPigeon(ctx, bird, { colour = '#364743', alpha = 1 } = {}) {
  if (![bird?.x, bird?.y, bird?.size].every(Number.isFinite) || bird.size <= 0) return false;
  // Existing perched birds keep their current renderer and feet anchor.
  if (bird.pose === 'perched') return drawBird(ctx, bird, { colour, alpha });

  const opacity = clamp(finite(alpha, 1), 0, 1);
  const bank = clamp(finite(bird.bank), -1, 1);
  const phase = finite(bird.wingPhase);
  const cycle = ((phase / TAU) % 1 + 1) % 1;
  // The recovery/upstroke occupies a shorter part of each wingbeat.
  const stroke = cycle < 0.64 ? Math.cos(cycle / 0.64 * Math.PI) : -Math.cos((cycle - 0.64) / 0.36 * Math.PI);
  const activity = clamp(finite(bird.activity), 0, 1);
  // Replies briefly resume flapping, then settle back into the scene's glide.
  const gliding = bird.pose === 'gliding' && activity <= 0.05;
  const progress = clamp(finite(bird.poseProgress, 0.5), 0, 1);
  const flare = bird.pose === 'landing' ? 0.15 + progress * 0.25 : bird.pose === 'takeoff' ? (1 - progress) * 0.24 : 0;
  const reach = (gliding ? 1.3 : 0.99 + stroke * 0.46) + flare + activity * 0.13;
  const sweep = gliding ? -0.21 : -0.22 - Math.sin(cycle * TAU) * 0.16;
  const detail = clamp((bird.size - 5) / 4, 0, 1);

  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(finite(bird.heading));
  ctx.scale(bird.size, bird.size);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.globalAlpha = opacity;
  wing(ctx, -1, reach, sweep, bank, detail, colour, opacity);
  wing(ctx, 1, reach, sweep, bank, detail, colour, opacity);
  body(ctx, flare);
  ctx.restore();
  return true;
}
