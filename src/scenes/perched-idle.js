const TAU = Math.PI * 2;
const FIELDS = ['breath', 'lean', 'headTurn', 'headBob', 'ruffle', 'wingStretch', 'tailFlick'];
const clamp = value => Math.max(0, Math.min(1, value));
const mix = value => {
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return (value ^ value >>> 16) >>> 0;
};
const unit = value => mix(value) / 4294967296;

export function createPerchedIdle(seed) {
  return {
    seed: mix(seed), period: 7 + unit(seed + 1) * 5,
    offset: unit(seed + 2) * 12,
    breathPeriod: 2.8 + unit(seed + 3) * 2,
    pose: { breath: 0, lean: 0, headTurn: 0, headBob: 0, ruffle: 0, wingStretch: 0, tailFlick: 0 },
  };
}

// Each bird has a quiet gap between gestures. The cycle changes the gesture,
// while identity fixes its timing. Sampling never allocates or advances time.
export function samplePerchedIdle(idle, timeMs, strength = 1) {
  const pose = idle.pose;
  for (const key of FIELDS) pose[key] = 0;
  if (strength <= 0) return pose;
  const seconds = timeMs / 1000;
  const local = seconds + idle.offset;
  const cycle = Math.floor(local / idle.period);
  const choice = mix(idle.seed ^ Math.imul(cycle + 1, 0x9e3779b9));
  const gesture = choice % 5;
  const duration = gesture === 3 ? 2.1 : gesture === 2 ? .85 : 1.5 + unit(choice + 1) * .6;
  const progress = (local % idle.period) / duration;
  const amount = progress <= 1 ? Math.sin(progress * Math.PI) ** 2 * strength : 0;
  const direction = choice & 1 ? 1 : -1;
  pose.breath = (.5 + .5 * Math.sin(seconds * TAU / idle.breathPeriod + idle.seed % 628 / 100)) * .65 * strength;
  if (gesture === 0) pose.headTurn = direction * amount;
  else if (gesture === 1) { pose.lean = direction * amount; pose.headBob = amount * .55; }
  else if (gesture === 2) pose.ruffle = amount * (.55 + .45 * Math.sin(progress * TAU * 3));
  else if (gesture === 3) { pose.wingStretch = amount; pose.lean = amount * .35; }
  else pose.tailFlick = direction * amount * Math.sin(progress * TAU);
  return pose;
}

export const perchedIdleFade = elapsedMs => clamp(elapsedMs / 650);
