// bridge.js - talks to the Streamlit host page when embedded as a custom component.
export const isEmbedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

function post(type, extra = {}) {
  if (!isEmbedded) return;
  window.parent.postMessage({ isStreamlitMessage: true, type, ...extra }, '*');
}

export function initBridge() {
  if (!isEmbedded) return;
  post('streamlit:componentReady', { apiVersion: 1 });
  const setHeight = () => {
    let h = 720;
    try { h = Math.max(520, Math.round((window.parent.innerHeight || 760) - 12)); } catch { h = Math.max(560, Math.round(screen.height * 0.8)); }
    post('streamlit:setFrameHeight', { height: h });
  };
  setHeight();
  // newer Streamlit versions can ignore a height sent before they reply: send it again on their
  // 'render' message and a few more times while the page settles.
  window.addEventListener('message', (e) => { if (e.data && e.data.type === 'streamlit:render') setHeight(); });
  [150, 600, 1500, 3500].forEach((t) => setTimeout(setHeight, t));
  try { window.parent.addEventListener('resize', setHeight); } catch { /* cross-origin parent */ }
}

/** URL of this same page, top-level (camera and motion sensors are most reliable there). */
export function standaloneUrl() {
  if (window.__SKY_FS_PATH__) {                       // single-file build inside Streamlit: full-screen copy is served as a static file
    let origin = '';
    try { origin = window.parent.location.origin; } catch { try { origin = new URL(document.referrer).origin; } catch { /* none */ } }
    return origin ? `${origin}${window.__SKY_FS_PATH__}?fs=1` : '';
  }
  const u = new URL(window.location.href);
  u.search = '?fs=1';
  u.hash = '';
  return u.toString();
}
