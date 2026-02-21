const BRIDGE_ID = "amx-bridge-script";
const CHANNEL = "amx-bridge";
const pendingFetches = new Map();
let fetchSeq = 0;
let highlightStyleInjected = false;

function injectBridge() {
  if (document.getElementById(BRIDGE_ID)) return;
  const script = document.createElement("script");
  script.id = BRIDGE_ID;
  script.src = chrome.runtime.getURL("page-bridge.js");
  script.type = "text/javascript";
  (document.head || document.documentElement).appendChild(script);
}

function requestAuthFromPage() {
  window.postMessage({ source: CHANNEL, type: "request-auth" }, "*");
}

injectBridge();
chrome.runtime.sendMessage({ type: "install-bridge" });

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== CHANNEL) return;

  if (data.type === "auth") {
    chrome.runtime.sendMessage({ type: "auth", auth: data.auth });
  }

  if (data.type === "fetch-result" && data.id) {
    const pending = pendingFetches.get(data.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingFetches.delete(data.id);
    pending.sendResponse?.(data.response);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === "request-auth") {
    chrome.runtime.sendMessage({ type: "install-bridge" });
    requestAuthFromPage();
    sendResponse?.({ ok: true });
  }
  if (msg.type === "highlight-track" && msg.track) {
    highlightTrack(msg.track);
    sendResponse?.({ ok: true });
  }
  if (msg.type === "page-fetch") {
    const id = `fetch-${Date.now()}-${fetchSeq++}`;
    const timeout = setTimeout(() => {
      pendingFetches.delete(id);
      sendResponse?.({ ok: false, error: "timeout" });
    }, 30000);
    pendingFetches.set(id, { sendResponse, timeout });
    window.postMessage(
      {
        source: CHANNEL,
        type: "fetch",
        id,
        url: msg.url,
        headers: msg.headers || {}
      },
      "*"
    );
    return true;
  }
});

function highlightTrack(track) {
  if (!track?.name) return;
  injectHighlightStyle();
  const targetName = normalizeText(track.name);
  const targetArtist = normalizeText(track.artist || "");
  const maxAttempts = 25;
  let attempts = 0;

  const interval = setInterval(() => {
    attempts += 1;
    const match = findTrackElement(targetName, targetArtist);
    if (match) {
      match.classList.add("amx-highlight");
      match.scrollIntoView({ behavior: "smooth", block: "center" });
      const clickable = match.closest("button, a");
      if (clickable) clickable.click();
      clearInterval(interval);
    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
    }
  }, 500);
}

function findTrackElement(targetName, targetArtist) {
  const candidates = new Set();
  const selectors = [
    "[data-testid*=\"track\"]",
    "[data-testid*=\"song\"]",
    "[class*=\"track\"]",
    "[class*=\"song\"]",
    "[role=\"row\"]",
    "li"
  ];

  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => candidates.add(el));
  });

  let best = null;
  let bestScore = -1;

  candidates.forEach((el) => {
    const text = normalizeText(el.textContent || "");
    if (!text || !text.includes(targetName)) return;
    let score = 1;
    if (targetArtist && text.includes(targetArtist)) score += 2;
    if (text.length < 120) score += 1;
    if (!best || score > bestScore) {
      best = el;
      bestScore = score;
    }
  });

  if (best) return best;

  const fallback = Array.from(document.querySelectorAll("div, li, tr")).slice(0, 2000);
  for (const el of fallback) {
    const text = normalizeText(el.textContent || "");
    if (!text || !text.includes(targetName)) continue;
    if (targetArtist && !text.includes(targetArtist)) continue;
    return el;
  }

  return null;
}

function normalizeText(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function injectHighlightStyle() {
  if (highlightStyleInjected) return;
  const style = document.createElement("style");
  style.textContent = `
    .amx-highlight {
      outline: 2px solid #fa243c !important;
      border-radius: 8px !important;
      box-shadow: 0 0 0 4px rgba(250, 36, 60, 0.15) !important;
    }
  `;
  document.head.appendChild(style);
  highlightStyleInjected = true;
}

setTimeout(requestAuthFromPage, 1500);
