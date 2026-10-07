// Parameter ranges, defaults, and formatting adapted from Ben Bashford's
// Murmuration: https://benbashford.com/experiments/murmuration/murmuration.html
// Original source retrieved 2026-10-07. See ATTRIBUTION.md for provenance.

export const PARAMS = Object.freeze([
  { key: 'count',   label: 'Nodes',      min: 40,   max: 2400, def: 0.42, curve: 2,   fmt: v => Math.round(v) },
  { key: 'speed',   label: 'Speed',      min: 0.6,  max: 9,    def: 0.36, fmt: v => v.toFixed(1) },
  { key: 'sep',     label: 'Separate',   min: 0,    max: 3,    def: 0.45, fmt: v => v.toFixed(2) },
  { key: 'align',   label: 'Align',      min: 0,    max: 0.2,  def: 0.55, fmt: v => v.toFixed(3) },
  { key: 'coh',     label: 'Cohere',     min: 0,    max: 0.005,def: 0.30, fmt: v => (v * 1000).toFixed(2) },
  { key: 'vision',  label: 'Vision',     min: 12,   max: 160,  def: 0.42, fmt: v => Math.round(v) + 'px' },
  { key: 'space',   label: 'Space',      min: 4,    max: 70,   def: 0.30, fmt: v => Math.round(v) + 'px' },
  { key: 'link',    label: 'Link dist',  min: 0,    max: 180,  def: 0.25, fmt: v => Math.round(v) + 'px' },
  { key: 'linkA',   label: 'Link alpha', min: 0,    max: 1,    def: 0.65, fmt: v => Math.round(v * 100) + '%' },
  { key: 'size',    label: 'Node size',  min: 1,    max: 22,   def: 0.22, fmt: v => v.toFixed(1) },
  { key: 'turb',    label: 'Turbulence', min: 0,    max: 1,    def: 0.25, fmt: v => Math.round(v * 100) + '%' },
  { key: 'attract', label: 'Attract',    min: 0,    max: 1,    def: 0.40, fmt: v => Math.round(v * 100) + '%' },
  { key: 'pred',    label: 'Predator',   min: 0,    max: 1,    def: 0.00, fmt: v => v < 0.02 ? 'off' : Math.round(v * 100) + '%' },
  { key: 'trails',  label: 'Trails',     min: 0,    max: 0.9,  def: 0.00, fmt: v => Math.round(v / 0.9 * 100) + '%' },
  { key: 'labels',  label: 'Labels',     min: 0,    max: 1,    def: 0.06, fmt: v => Math.round(v * 100) + '%' },
  { key: 'theme',   label: 'Dark/Light', min: 0,    max: 1,    def: 0.00, fmt: v => v < 0.02 ? 'dark' : v > 0.98 ? 'light' : Math.round(v * 100) + '%' },
].map(parameter => Object.freeze(parameter)));

export function resolveParameters(values = PARAMS.map(parameter => parameter.def)) {
  if (!Array.isArray(values) || values.length !== PARAMS.length) {
    throw new TypeError(`Expected ${PARAMS.length} normalized parameter values.`);
  }
  const resolved = {};
  PARAMS.forEach((parameter, index) => {
    const value = values[index];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`Parameter ${index} must be a finite number.`);
    }
    const normalized = Math.max(0, Math.min(1, value));
    const mapped = parameter.curve ? normalized ** parameter.curve : normalized;
    resolved[parameter.key] = parameter.min + (parameter.max - parameter.min) * mapped;
  });
  return resolved;
}
