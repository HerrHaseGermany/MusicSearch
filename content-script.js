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
  const maxAttempts = 80;
  let attempts = 0;
  let lastScrollTop = -1;

  const interval = setInterval(() => {
    attempts += 1;
    const match = findTrackElement(targetName, targetArtist);
    if (match) {
      clearPreviousHighlights();
      const target = getHighlightTarget(match);
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      simulateRowClick(target, match);
      setTimeout(() => {
        if (hasNativeSelection(target)) return;
        target.classList.add("amx-highlight");
        target.dataset.amxHighlight = "true";
        if (!target.hasAttribute("aria-selected")) {
          target.setAttribute("aria-selected", "true");
          target.dataset.amxSelected = "true";
        }
        applySelectionClasses(target);
      }, 200);
      clearInterval(interval);
    } else {
      const scroller = findScrollableContainer();
      if (scroller) {
        const nextTop = Math.min(
          scroller.scrollTop + scroller.clientHeight * 0.8,
          scroller.scrollHeight
        );
        if (nextTop !== lastScrollTop) {
          scroller.scrollTop = nextTop;
          lastScrollTop = nextTop;
        }
      } else {
        window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }
  }, 400);
}

function findTrackElement(targetName, targetArtist) {
  const candidates = new Set();
  const selectors = [
    "[data-testid*=\"track\"]",
    "[data-testid*=\"song\"]",
    "[data-testid*=\"row\"]",
    "[class*=\"library-track-name\"]",
    "[class*=\"track\"]",
    "[class*=\"song\"]",
    "[role=\"row\"]",
    "[role=\"gridcell\"]",
    "tr",
    "li"
  ];

  const root = document.querySelector("main") || document.body;
  selectors.forEach((sel) => {
    root.querySelectorAll(sel).forEach((el) => candidates.add(el));
  });

  const libraryNameEls = root.querySelectorAll("[class*=\"library-track-name__text\"], [class*=\"library-track-name\"]");
  for (const el of libraryNameEls) {
    const text = normalizeText(el.textContent || "");
    if (!text || !text.includes(targetName)) continue;
    if (targetArtist && !text.includes(targetArtist)) {
      const row = pickLibraryRow(el);
      if (row) return el;
    }
    return el;
  }

  let best = null;
  let bestScore = -1;

  candidates.forEach((el) => {
    const text = normalizeText(el.textContent || "");
    if (!text || !text.includes(targetName)) return;
    let score = 1;
    if (targetArtist && text.includes(targetArtist)) score += 2;
    if (text.length < 200) score += 1;
    const aria = normalizeText(el.getAttribute("aria-label") || "");
    if (aria && aria.includes(targetName)) score += 1;
    if (!best || score > bestScore) {
      best = el;
      bestScore = score;
    }
  });

  if (best) return best;

  const fallback = Array.from(root.querySelectorAll("div, li, tr")).slice(0, 3000);
  for (const el of fallback) {
    const text = normalizeText(el.textContent || "");
    if (!text || !text.includes(targetName)) continue;
    if (targetArtist && !text.includes(targetArtist)) continue;
    return el;
  }

  return null;
}

function getHighlightTarget(el) {
  if (!el) return el;
  const libraryRow = pickLibraryRow(el);
  if (libraryRow) {
    const wrapper = pickLibraryWrapper(libraryRow);
    return wrapper || libraryRow;
  }
  const row = pickRowElement(el);
  return row || el;
}

function pickRowElement(el) {
  const libraryRow = pickLibraryRow(el);
  if (libraryRow) return libraryRow;
  const selectors =
    "[role=\"row\"], [aria-rowindex], [data-row-index], [data-testid*=\"row\"], " +
    "[data-testid*=\"track\"], [data-testid*=\"song\"], " +
    "[class*=\"row\"], [class*=\"track\"], [class*=\"song\"], li, tr";

  let current = el;
  for (let i = 0; i < 6 && current; i += 1) {
    if (current.matches && current.matches(selectors) && current.clientWidth > 300) {
      if (!isDisplayContents(current)) return current;
    }
    current = current.parentElement;
  }

  const closest = el.closest ? el.closest(selectors) : null;
  if (closest && closest.clientWidth > 300 && !isDisplayContents(closest)) return closest;
  return closest || el;
}

function pickLibraryRow(el) {
  if (!el) return null;
  const direct = el.closest?.("[data-testid=\"library-track\"], .library-track");
  if (direct && direct.clientWidth > 300 && !isDisplayContents(direct)) return direct;
  let current = el;
  for (let i = 0; i < 8 && current; i += 1) {
    if (current.classList) {
      for (const cls of current.classList) {
        if (cls.includes("library-track")) {
          if (current.clientWidth > 300 && !isDisplayContents(current)) return current;
        }
      }
    }
    current = current.parentElement;
  }
  return null;
}

function pickLibraryWrapper(el) {
  if (!el) return null;
  const wrapper = el.closest?.("[data-testid=\"virtual-row\"], .virtual-row");
  if (wrapper && wrapper.clientWidth > 300 && !isDisplayContents(wrapper)) return wrapper;
  return null;
}

function isDisplayContents(el) {
  try {
    return window.getComputedStyle(el).display === "contents";
  } catch {
    return false;
  }
}

function simulateRowClick(target, match) {
  const clickable =
    target.querySelector("button, a") ||
    target.closest("button, a") ||
    match.querySelector("button, a") ||
    match.closest("button, a") ||
    target;

  const opts = { bubbles: true, cancelable: true, view: window };
  clickable.dispatchEvent(new MouseEvent("mousedown", opts));
  clickable.dispatchEvent(new MouseEvent("mouseup", opts));
  clickable.dispatchEvent(new MouseEvent("click", opts));

  try {
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + Math.min(rect.height / 2, 18);
    const topEl = document.elementFromPoint(centerX, centerY);
    if (topEl && topEl !== clickable) {
      topEl.dispatchEvent(new MouseEvent("mousedown", opts));
      topEl.dispatchEvent(new MouseEvent("mouseup", opts));
      topEl.dispatchEvent(new MouseEvent("click", opts));
    }
  } catch {
    // ignore
  }
}

function hasNativeSelection(el) {
  if (!el) return false;
  if (el.getAttribute("aria-selected") === "true") return true;
  const className = el.className || "";
  if (typeof className === "string" && /(selected|is-selected|active|playing)/i.test(className)) {
    return true;
  }
  if (el.dataset && el.dataset.selected) return true;
  return false;
}

function findScrollableContainer() {
  const root = document.querySelector("main") || document.body;
  const candidates = Array.from(
    root.querySelectorAll("[role=\"grid\"], [role=\"table\"], div, section")
  );
  let best = null;
  let bestScroll = 0;

  for (const el of candidates) {
    const style = window.getComputedStyle(el);
    if (style.overflowY === "hidden") continue;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable > bestScroll && el.clientHeight > 200) {
      best = el;
      bestScroll = scrollable;
    }
  }

  return best;
}

function clearPreviousHighlights() {
  document.querySelectorAll("[data-amx-highlight]").forEach((el) => {
    el.classList.remove("amx-highlight");
    delete el.dataset.amxHighlight;
  });
  document.querySelectorAll("[data-amx-selected]").forEach((el) => {
    if (el.getAttribute("aria-selected") === "true") {
      el.removeAttribute("aria-selected");
    }
    delete el.dataset.amxSelected;
  });
  document.querySelectorAll("[data-amx-selection-class]").forEach((el) => {
    const classes = el.dataset.amxSelectionClass?.split(" ") || [];
    classes.forEach((cls) => el.classList.remove(cls));
    delete el.dataset.amxSelectionClass;
  });
}

function applySelectionClasses(el) {
  if (!el) return;
  const classes = ["selected", "is-selected", "active", "playing"];
  classes.forEach((cls) => el.classList.add(cls));
  el.dataset.amxSelectionClass = classes.join(" ");
  if (!el.dataset.selected) el.dataset.selected = "true";
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
      border-radius: 6px !important;
      box-shadow: 0 0 0 2px rgba(250, 36, 60, 0.12) !important;
      background: transparent !important;
    }
  `;
  document.head.appendChild(style);
  highlightStyleInjected = true;
}

setTimeout(requestAuthFromPage, 1500);

let lastRegion = null;
function detectRegion() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] && /^[a-z]{2}$/i.test(parts[0])) return parts[0].toLowerCase();
  return null;
}

function sendRegion() {
  const region = detectRegion();
  if (!region || region === lastRegion) return;
  lastRegion = region;
  chrome.runtime.sendMessage({ type: "set-region", region });
}

window.addEventListener("popstate", sendRegion);
window.addEventListener("hashchange", sendRegion);
setInterval(sendRegion, 5000);

sendRegion();
