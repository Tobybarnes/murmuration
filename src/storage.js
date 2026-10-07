export const FADERS_KEY = 'murmuration.v1.faders';
export const MIDI_KEY = 'murmuration.v1.midi';

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

// Standard 16n CC numbers have priority; custom CCs learn in first-moved order.
export function createMidiMapping(saved = {}) {
  const learned = Object.create(null);
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [key, value] of Object.entries(saved)) {
      if (/^\d{1,2}:\d{1,3}$/.test(key) && Number.isInteger(value) && value >= 0 && value < 16) learned[key] = value;
    }
  }
  return {
    learned,
    lookup(channel, cc) {
      if (!Number.isInteger(channel) || channel < 0 || channel > 15 || !Number.isInteger(cc) || cc < 0 || cc > 127) return -1;
      if (cc >= 32 && cc <= 47) return cc - 32;
      const key = `${channel}:${cc}`;
      if (key in learned) return learned[key];
      const used = new Set(Object.values(learned));
      for (let index = 0; index < 16; index++) if (!used.has(index)) { learned[key] = index; return index; }
      return -1;
    },
  };
}
