const CHANNEL = "amx-bridge";

let lastAuth = { developerToken: null, musicUserToken: null, mediaUserToken: null };

function normalizeBearer(value) {
  if (!value) return null;
  if (value.startsWith("Bearer ")) return value.slice(7).trim();
  return value.trim();
}

function readLocalStorage(keys) {
  for (const key of keys) {
    try {
      const value = window.localStorage.getItem(key);
      if (value) return value;
    } catch {
      // ignore
    }
  }
  return null;
}

function readSessionStorage(keys) {
  for (const key of keys) {
    try {
      const value = window.sessionStorage.getItem(key);
      if (value) return value;
    } catch {
      // ignore
    }
  }
  return null;
}

function collectAuth() {
  let developerToken = null;
  let musicUserToken = null;
  let mediaUserToken = null;

  try {
    const mk = window.MusicKit?.getInstance?.();
    developerToken = mk?.developerToken || developerToken;
    musicUserToken = mk?.musicUserToken || musicUserToken;
  } catch {
    // ignore
  }

  if (!musicUserToken) {
    musicUserToken = readLocalStorage([
      "music-user-token",
      "musicUserToken"
    ]);
  }

  if (!musicUserToken) {
    musicUserToken = readSessionStorage([
      "music-user-token",
      "musicUserToken"
    ]);
  }

  if (!mediaUserToken) {
    mediaUserToken = readLocalStorage([
      "media-user-token",
      "mediaUserToken"
    ]);
  }

  if (!mediaUserToken) {
    mediaUserToken = readSessionStorage([
      "media-user-token",
      "mediaUserToken"
    ]);
  }

  if (!developerToken) {
    developerToken = readLocalStorage([
      "developer-token",
      "music-developer-token",
      "developerToken",
      "musicDeveloperToken"
    ]);
  }

  if (!developerToken) {
    developerToken = readSessionStorage([
      "developer-token",
      "music-developer-token",
      "developerToken",
      "musicDeveloperToken"
    ]);
  }

  return { developerToken, musicUserToken, mediaUserToken, fetchedAt: new Date().toISOString() };
}

function postAuth(auth) {
  window.postMessage({ source: CHANNEL, type: "auth", auth }, "*");
}

function maybeSendAuth(auth) {
  const developerToken = auth?.developerToken || null;
  const musicUserToken = auth?.musicUserToken || null;
  const mediaUserToken = auth?.mediaUserToken || null;

  if (!developerToken || (!musicUserToken && !mediaUserToken)) return;
  if (
    developerToken === lastAuth.developerToken &&
    musicUserToken === lastAuth.musicUserToken &&
    mediaUserToken === lastAuth.mediaUserToken
  ) {
    return;
  }

  lastAuth = { developerToken, musicUserToken, mediaUserToken };
  postAuth({ developerToken, musicUserToken, mediaUserToken, fetchedAt: new Date().toISOString() });
}

function sendAuth() {
  const auth = collectAuth();
  maybeSendAuth(auth);
}

function captureHeaders(headersLike) {
  if (!headersLike) return;
  let developerToken = null;
  let musicUserToken = null;
  let mediaUserToken = null;

  if (headersLike instanceof Headers) {
    developerToken = normalizeBearer(headersLike.get("Authorization"));
    musicUserToken = headersLike.get("Music-User-Token");
    mediaUserToken = headersLike.get("Media-User-Token");
  } else if (Array.isArray(headersLike)) {
    for (const [key, value] of headersLike) {
      if (!key) continue;
      const k = key.toLowerCase();
      if (k === "authorization") developerToken = normalizeBearer(value);
      if (k === "music-user-token") musicUserToken = value;
      if (k === "media-user-token") mediaUserToken = value;
    }
  } else if (typeof headersLike === "object") {
    for (const key of Object.keys(headersLike)) {
      const k = key.toLowerCase();
      const value = headersLike[key];
      if (k === "authorization") developerToken = normalizeBearer(value);
      if (k === "music-user-token") musicUserToken = value;
      if (k === "media-user-token") mediaUserToken = value;
    }
  }

  if (developerToken || musicUserToken || mediaUserToken) {
    maybeSendAuth({ developerToken, musicUserToken, mediaUserToken });
  }
}

function hookFetch() {
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    try {
      if (args[0] instanceof Request) {
        captureHeaders(args[0].headers);
      } else if (args[1]?.headers) {
        captureHeaders(args[1].headers);
      }
    } catch {
      // ignore
    }
    return originalFetch.apply(this, args);
  };
}

function hookXHR() {
  const headerStore = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSet = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__amx_url = url;
    headerStore.set(this, {});
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
    const headers = headerStore.get(this) || {};
    headers[header] = value;
    headerStore.set(this, headers);
    return originalSet.call(this, header, value);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const headers = headerStore.get(this);
    if (headers) captureHeaders(headers);
    return originalSend.apply(this, args);
  };
}

hookFetch();
hookXHR();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== CHANNEL) return;
  if (data.type === "request-auth") {
    sendAuth();
  }
  if (data.type === "fetch" && data.id && data.url) {
    const headers = data.headers || {};
    fetch(data.url, {
      method: "GET",
      headers,
      credentials: "omit"
    })
      .then(async (res) => {
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          // ignore
        }
        window.postMessage(
          {
            source: CHANNEL,
            type: "fetch-result",
            id: data.id,
            response: {
              ok: res.ok,
              status: res.status,
              json,
              text: res.ok ? null : text.slice(0, 1000)
            }
          },
          "*"
        );
      })
      .catch((err) => {
        window.postMessage(
          {
            source: CHANNEL,
            type: "fetch-result",
            id: data.id,
            response: { ok: false, error: err?.message || String(err) }
          },
          "*"
        );
      });
  }
});

sendAuth();

let attempts = 0;
const poll = setInterval(() => {
  attempts += 1;
  sendAuth();
  if (attempts >= 30) clearInterval(poll);
}, 2000);
