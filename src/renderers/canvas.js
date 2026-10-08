import { drawBird } from './birds.js';
import {typeStyle} from '../inputs/public-appearance.js';

const TAU = Math.PI * 2;
const rgb = (c, a = 1) => a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Choose the better of near-black and ivory against the actual interpolated
// sky. Source fills keep their identity through the entire theme slider.
export function publicMarkerOutline(background) {
  const luminance=channels=>channels.map(value=>{const n=value/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const bg=luminance(background),dark=[2,4,2],light=[255,254,248];
  const contrast=colour=>(Math.max(bg,luminance(colour))+.05)/(Math.min(bg,luminance(colour))+.05);
  return rgb(contrast(dark)>contrast(light)?dark:light);
}

// Read the scene's reusable projection directly. Rendering never updates time,
// position, identity or wing phase, including when a paused view is redrawn.
export function createCanvasRenderer(ctx) {
  let previousAppearance = null;
  function draw(frame, { colours: C, appearance = 'dots', connections = appearance === 'dots', labels = appearance === 'dots', publicMode=false, photo=false, selectedId=null } = {}) {
    const P = frame.parameters;
    const birds = frame.birds;
    const links = frame.geometry.find(item => item.type === 'links');
    const predator = frame.geometry.find(item => item.type === 'predator');
    const weather = frame.environment?.weather;
    const freshWeather = weather?.expiresAt > Date.now() ? weather : null;
    const background = C.bg;
    const trail = previousAppearance === appearance ? P.trails : 0;
    previousAppearance = appearance;
    ctx.globalAlpha = 1;
    if(photo)ctx.clearRect(0,0,frame.width,frame.height);
    ctx.fillStyle = rgb(background, photo ? .28 : trail > 0.005 ? 1 - trail : 1);
    ctx.fillRect(0, 0, frame.width, frame.height);

    if (!photo && (appearance === 'birds' || freshWeather) && trail < 0.005) {
      const haze = freshWeather?.cloudCover ?? 0.28;
      const sky = ctx.createLinearGradient(0, 0, 0, frame.height);
      sky.addColorStop(0, rgb(C.hover, 0.07 + haze * 0.07));
      sky.addColorStop(0.56, rgb(background, 0));
      sky.addColorStop(1, rgb(freshWeather?.isDay === false ? C.hover : C.accent, 0.08));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, frame.width, frame.height);
    }

    if (connections && links?.count > 0 && P.linkA > 0.01) {
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = rgb(C.accent);
      for (let bucket = 0; bucket < 5; bucket++) {
        const lo = bucket / 5, hi = (bucket + 1) / 5;
        ctx.globalAlpha = P.linkA * (1 - lo) * (publicMode ? .32 : 1);
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
      for (const bird of birds) drawBird(ctx, bird, { colour: rgb(C.fg), alpha: bird.alpha });
    } else if(publicMode) {
      for(const bird of birds) {
        const style=typeStyle(bird.publicType,P.theme>.5);
        if(!style)continue;
        const radius=Math.max(4.2,bird.radius*1.35),x=bird.x,y=bird.y;
        ctx.beginPath();
        if(style.shape==='circle'){ctx.arc(x,y,radius,0,TAU);}
        else if(style.shape==='triangle'){ctx.moveTo(x,y-radius*1.25);ctx.lineTo(x+radius,y+radius*.8);ctx.lineTo(x-radius,y+radius*.8);ctx.closePath();}
        else if(style.shape==='diamond'){ctx.moveTo(x,y-radius*1.3);ctx.lineTo(x+radius,y);ctx.lineTo(x,y+radius*1.3);ctx.lineTo(x-radius,y);ctx.closePath();}
        else {ctx.rect(x-radius*.85,y-radius*.85,radius*1.7,radius*1.7);}
        // The outline keeps marks distinct on both bright and dark sky photos.
        ctx.strokeStyle=photo?'rgba(38,57,46,.95)':publicMarkerOutline(C.bg);ctx.lineWidth=3.5;ctx.stroke();
        ctx.fillStyle=style.colour;ctx.fill();
        ctx.strokeStyle=style.colour;ctx.lineWidth=1.1;ctx.stroke();
        if(bird.birdId===selectedId) {
          ctx.beginPath();ctx.arc(x,y,radius+6,0,TAU);ctx.strokeStyle=photo?'rgb(255,254,248)':rgb(C.fg);ctx.lineWidth=1.3;ctx.stroke();
          ctx.beginPath();ctx.arc(x,y,radius+8,0,TAU);ctx.strokeStyle=style.colour;ctx.lineWidth=.8;ctx.stroke();
        }
      }
    } else {
      ctx.lineWidth = 1;
      ctx.fillStyle = rgb(background);
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
      // Unread metadata remains legible after the arrival/read pulse has ended.
      ctx.fillStyle = rgb(C.accent, 0.7);
      ctx.beginPath();
      for (const bird of birds) {
        if (bird.readState !== 'unread') continue;
        const core = Math.max(0.7, bird.radius * 0.3);
        ctx.moveTo(bird.x + core, bird.y);
        ctx.arc(bird.x, bird.y, core, 0, TAU);
      }
      ctx.fill();
    }

    const labelCount = labels && (!publicMode||P.labels>.12) ? Math.min(birds.length, Math.round(P.labels * Math.min(birds.length, 300))) : 0;
    if (labelCount > 0) {
      ctx.font = '600 9px monospace';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < labelCount; i++) {
        const bird = birds[i];
        ctx.fillStyle = bird.linked ? rgb(C.fg, 0.75) : rgb(C.hover);
        ctx.fillText(bird.label || bird.birdId, bird.x + bird.radius + 5, bird.y);
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
