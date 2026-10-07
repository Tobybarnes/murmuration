export const FADERS_KEY = 'murmuration.v1.faders';

export function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing may block storage. */ }
}
export function readFaders(defaults) {
  const saved = readJSON(FADERS_KEY, null);
  if (!Array.isArray(saved) || saved.length !== defaults.length) return [...defaults];
  return saved.map((value, index) => typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value)) : defaults[index]);
}
