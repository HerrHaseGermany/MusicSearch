const BRIDGE_ID = "amx-bridge-script";
const CHANNEL = "amx-bridge";
const pendingFetches = new Map();
let fetchSeq = 0;

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

setTimeout(requestAuthFromPage, 1500);
