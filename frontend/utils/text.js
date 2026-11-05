// text.js - config text tokens and safe HTML escaping.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function tokens(model, config) {
  return {
    her: (config.names?.her || '').trim() || 'you',
    him: (config.names?.him || '').trim() || 'me',
    km: Math.round(model.km).toLocaleString('en-IN'),
    sep: model.centreSepDeg.toFixed(0),
    tetherSep: model.tether.sepDeg.toFixed(0),
    tetherFrom: model.tether.from.name,
    tetherTo: model.tether.to.name,
  };
}
export const fmt = (str, tk) => String(str ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in tk ? tk[k] : m));
