// weather.js - cloud cover from Open-Meteo (free, no key, CORS enabled), with a graceful mock fallback.
const cache = new Map();
const TTL = 20 * 60 * 1000;

export async function fetchWeather(obs) {
  const key = `${obs.lat.toFixed(2)},${obs.lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + obs.lat + '&longitude=' + obs.lon +
    '&current=temperature_2m,cloud_cover,relative_humidity_2m&hourly=cloud_cover&forecast_days=3&timezone=Asia%2FKolkata';
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error('weather ' + res.status);
    const j = await res.json();
    const hourly = (j.hourly?.time || []).map((t, i) => ({ t: new Date(t + ':00+05:30').getTime(), cloud: j.hourly.cloud_cover[i] }));
    const data = { live: true, cloud: j.current?.cloud_cover ?? null, temp: j.current?.temperature_2m ?? null, humidity: j.current?.relative_humidity_2m ?? null, hourly };
    cache.set(key, { t: Date.now(), data });
    return data;
  } catch {
    return mockWeather();
  }
}

function mockWeather() {
  const now = Date.now();
  const hourly = Array.from({ length: 72 }, (_, i) => ({ t: now + i * 3600000, cloud: 15 + Math.round(10 * Math.sin(i / 5)) }));
  return { live: false, cloud: 20, temp: null, humidity: null, hourly };
}

/** Cloud cover (%) near a given instant, or null. */
export function cloudAt(weather, dateMs) {
  if (!weather) return null;
  if (!weather.hourly?.length) return weather.cloud;
  let best = null, bd = Infinity;
  for (const h of weather.hourly) { const d = Math.abs(h.t - dateMs); if (d < bd) { bd = d; best = h; } }
  return bd < 2 * 3600000 ? best.cloud : weather.cloud;
}
