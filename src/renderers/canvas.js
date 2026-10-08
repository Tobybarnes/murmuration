import { drawBird } from './birds.js';

const TAU = Math.PI * 2;
const rgb = (c, a = 1) => a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function luminance(colour) {
  const channels = colour.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function birdColour(colours) {
  const background = luminance(colours.bg), foreground = luminance(colours.fg);
  const contrast = (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  return contrast >= 3 ? rgb(colours.fg) : background > 0.22 ? 'rgb(21,28,22)' : 'rgb(250,246,231)';
}

// Read the scene's reusable projection directly. Rendering never updates time,
// position, identity or wing phase, including when a paused view is redrawn.
export function createCanvasRenderer(ctx) {
  let previousAppearance = null;
  function draw(frame, { colours: C, appearance = 'dots', connections = appearance === 'dots', labels = appearance === 'dots' } = {}) {
    const P = frame.parameters;
    const birds = frame.birds;
    const links = frame.geometry.find(item => item.type === 'links');
    const predator = frame.geometry.find(item => item.type === 'predator');
    const trail = previousAppearance === appearance ? P.trails : 0;
    previousAppearance = appearance;
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgb(C.bg, trail > 0.005 ? 1 - trail : 1);
    ctx.fillRect(0, 0, frame.width, frame.height);

    if (appearance === 'birds' && trail < 0.005) {
      const weather = frame.environment?.weather;
      const freshWeather = weather?.expiresAt > Date.now() ? weather : null;
      const haze = freshWeather?.cloudCover ?? 0.28;
      const sky = ctx.createLinearGradient(0, 0, 0, frame.height);
      sky.addColorStop(0, rgb(C.hover, 0.07 + haze * 0.07));
      sky.addColorStop(0.56, rgb(C.bg, 0));
      sky.addColorStop(1, rgb(C.accent, 0.08));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, frame.width, frame.height);
    }

    if (connections && links?.count > 0 && P.linkA > 0.01) {
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = rgb(C.accent);
      for (let bucket = 0; bucket < 5; bucket++) {
        const lo = bucket / 5, hi = (bucket + 1) / 5;
        ctx.globalAlpha = P.linkA * (1 - lo);
        ctx.beginPath();
        for (let index = 0; index < links.count; index++) {
          const distance = links.distances[index];
          if (distance < lo || distance >= hi) continue;
          const a = birds[links.a[index]], b = birds[links.b[index]];
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (appearance === 'birds') {
      // Alpha follows depth. Reusing scene order avoids a sort/copy per frame.
      const colour = birdColour(C);
      for (const bird of birds) drawBird(ctx, bird, { colour, alpha: bird.alpha });
    } else {
      ctx.lineWidth = 1;
      ctx.fillStyle = rgb(C.bg);
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = rgb(pass ? C.accent : C.hover);
        ctx.beginPath();
        for (const bird of birds) {
          if (bird.linked !== pass) continue;
          ctx.moveTo(bird.x + bird.radius, bird.y);
          ctx.arc(bird.x, bird.y, bird.radius, 0, TAU);
        }
        if (P.size > 2.5) ctx.fill();
        ctx.stroke();
      }
    }

    const labelCount = labels ? Math.min(birds.length, Math.round(P.labels * Math.min(birds.length, 300))) : 0;
    if (labelCount > 0) {
      ctx.font = '600 9px monospace';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < labelCount; i++) {
        const bird = birds[i];
        ctx.fillStyle = bird.linked ? rgb(C.fg, 0.75) : rgb(C.hover);
        ctx.fillText(bird.birdId, bird.x + bird.radius + 5, bird.y);
      }
    }

    if (predator?.on) {
      ctx.fillStyle = rgb(C.accent);
      ctx.beginPath(); ctx.arc(predator.x, predator.y, predator.radius, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgb(C.accent, 0.35);
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(predator.x, predator.y, predator.fleeRadius, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  return { draw };
}
