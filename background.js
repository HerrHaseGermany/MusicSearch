const API_BASES = ["https://amp-api.music.apple.com"];
const PAGE_API_BASES = ["https://amp-api.music.apple.com"];
const PAGE_HOST = "music.apple.com";

const state = {
  auth: null,
  index: null,
  indexMeta: { builtAt: null, playlists: 0, tracks: 0 },
  indexing: false,
  progress: { done: 0, total: 0 },
  lastError: null
};

async function loadIndex() {
  const stored = await chrome.storage.local.get(["index", "indexMeta"]);
  if (stored.index) {
    state.index = stored.index;
  }
  if (stored.indexMeta) {
    state.indexMeta = stored.indexMeta;
  } else {
    state.indexMeta = { builtAt: null, playlists: 0, tracks: 0 };
  }
}

loadIndex();

function nowIso() {
  return new Date().toISOString();
}

function normalizeBearer(value) {
  if (!value) return null;
  if (value.startsWith("Bearer ")) return value.slice(7).trim();
  return value.trim();
}

function bridgeInstallFn() {
  if (window.__amxBridgeInstalled) return;
  window.__amxBridgeInstalled = true;

  const CHANNEL = "amx-bridge";
  let lastAuth = { developerToken: null, musicUserToken: null, mediaUserToken: null };

  function normalizeBearerLocal(value) {
    if (!value) return null;
    if (value.startsWith("Bearer ")) return value.slice(7).trim();
    return value.trim();
  }

  function readStorage(store, keys) {
    if (!store) return null;
    for (const key of keys) {
      try {
        const value = store.getItem(key);
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
      musicUserToken = readStorage(window.localStorage, [
        "music-user-token",
        "musicUserToken"
      ]);
    }
    if (!musicUserToken) {
      musicUserToken = readStorage(window.sessionStorage, [
        "music-user-token",
        "musicUserToken"
      ]);
    }
    if (!mediaUserToken) {
      mediaUserToken = readStorage(window.localStorage, [
        "media-user-token",
        "mediaUserToken"
      ]);
    }
    if (!mediaUserToken) {
      mediaUserToken = readStorage(window.sessionStorage, [
        "media-user-token",
        "mediaUserToken"
      ]);
    }

    if (!developerToken) {
      developerToken = readStorage(window.localStorage, [
        "developer-token",
        "music-developer-token",
        "developerToken",
        "musicDeveloperToken"
      ]);
    }
    if (!developerToken) {
      developerToken = readStorage(window.sessionStorage, [
        "developer-token",
        "music-developer-token",
        "developerToken",
        "musicDeveloperToken"
      ]);
    }

    return {
      developerToken,
      musicUserToken,
      mediaUserToken,
      fetchedAt: new Date().toISOString()
    };
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
    postAuth({
      developerToken,
      musicUserToken,
      mediaUserToken,
      fetchedAt: new Date().toISOString()
    });
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
      developerToken = normalizeBearerLocal(headersLike.get("Authorization"));
      musicUserToken = headersLike.get("Music-User-Token");
      mediaUserToken = headersLike.get("Media-User-Token");
    } else if (Array.isArray(headersLike)) {
      for (const [key, value] of headersLike) {
        if (!key) continue;
        const k = key.toLowerCase();
        if (k === "authorization") developerToken = normalizeBearerLocal(value);
        if (k === "music-user-token") musicUserToken = value;
        if (k === "media-user-token") mediaUserToken = value;
      }
    } else if (typeof headersLike === "object") {
      for (const key of Object.keys(headersLike)) {
        const k = key.toLowerCase();
        const value = headersLike[key];
        if (k === "authorization") developerToken = normalizeBearerLocal(value);
        if (k === "music-user-token") musicUserToken = value;
        if (k === "media-user-token") mediaUserToken = value;
      }
    }

    if (developerToken || musicUserToken || mediaUserToken) {
      maybeSendAuth({ developerToken, musicUserToken, mediaUserToken });
    }
  }

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
}

function normalize(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function trackKey(track) {
  const id = track?.id || "";
  if (id) return `id:${id}`;
  const name = track?.attributes?.name || "";
  const artist = track?.attributes?.artistName || "";
  const album = track?.attributes?.albumName || "";
  const duration = track?.attributes?.durationInMillis || "";
  return normalize(`${name}|${artist}|${album}|${duration}`);
}

function sanitizePlayParams(playParams) {
  if (!playParams) return null;
  const { id, kind, isLibrary, catalogId } = playParams;
  return {
    id: id || null,
    kind: kind || null,
    isLibrary: !!isLibrary,
    catalogId: catalogId || null
  };
}

async function saveIndex(index, meta) {
  await chrome.storage.local.set({ index, indexMeta: meta });
  state.index = index;
  state.indexMeta = meta;
}

async function setAuth(auth) {
  state.auth = auth;
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.set({ auth });
    } else {
      await chrome.storage.local.set({ auth });
    }
  } catch {
    // Ignore storage errors for auth; in-memory is enough for active session.
  }
}

async function updateAuth(partial) {
  if (!partial) return;
  const current = state.auth || {};
  const merged = {
    developerToken: partial.developerToken || current.developerToken || null,
    musicUserToken: partial.musicUserToken || current.musicUserToken || null,
    mediaUserToken: partial.mediaUserToken || current.mediaUserToken || null,
    fetchedAt: partial.fetchedAt || current.fetchedAt || nowIso()
  };
  if (merged.developerToken && (merged.musicUserToken || merged.mediaUserToken)) {
    await setAuth(merged);
  } else {
    state.auth = merged;
  }
}

async function clearAuth() {
  state.auth = null;
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.remove([ "auth" ]);
    }
  } catch {
    // ignore
  }
  try {
    await chrome.storage.local.remove([ "auth" ]);
  } catch {
    // ignore
  }
}

async function refreshAuth(timeoutMs = 6000) {
  await installBridgeOnAnyTab();
  await requestAuthFromActiveTab();
  await requestAuthFromAnyTab();
  const waited = await waitForAuth(timeoutMs);
  return !!(waited?.developerToken && (waited?.musicUserToken || waited?.mediaUserToken));
}

async function loadAuthFromStorage() {
  try {
    if (chrome.storage?.session) {
      const stored = await chrome.storage.session.get(["auth"]);
      if (stored.auth) return stored.auth;
    }
  } catch {
    // ignore
  }
  const stored = await chrome.storage.local.get(["auth"]);
  return stored.auth || null;
}

async function ensureAuth() {
  if (state.auth?.developerToken && (state.auth?.musicUserToken || state.auth?.mediaUserToken)) {
    return state.auth;
  }
  const stored = await loadAuthFromStorage();
  if (stored?.developerToken && (stored?.musicUserToken || stored?.mediaUserToken)) {
    state.auth = stored;
    return stored;
  }
  await installBridgeOnAnyTab();
  const sent = (await requestAuthFromActiveTab()) || (await requestAuthFromAnyTab());
  if (sent) {
    const waited = await waitForAuth(4000);
    if (waited?.developerToken && (waited?.musicUserToken || waited?.mediaUserToken)) {
      return waited;
    }
  }
  return null;
}

async function requestAuthFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;
  if (!tab.url || !tab.url.includes(PAGE_HOST)) return false;
  await installBridgeOnTab(tab.id);
  return sendMessageToTab(tab.id, { type: "request-auth" });
}

async function requestAuthFromAnyTab() {
  const tabs = await chrome.tabs.query({ url: `https://${PAGE_HOST}/*` });
  let sent = false;
  for (const tab of tabs) {
    if (!tab?.id) continue;
    await installBridgeOnTab(tab.id);
    if (await sendMessageToTab(tab.id, { type: "request-auth" })) {
      sent = true;
    }
  }
  return sent;
}

async function waitForAuth(timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (state.auth?.developerToken && (state.auth?.musicUserToken || state.auth?.mediaUserToken)) {
      return state.auth;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

function sendMessageToTabWithResponse(tabId, message, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response ?? null);
    });
  });
}

async function installBridgeOnTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: bridgeInstallFn
    });
    return true;
  } catch {
    return false;
  }
}

async function installBridgeOnAnyTab() {
  const tabs = await chrome.tabs.query({ url: `https://${PAGE_HOST}/*` });
  for (const tab of tabs) {
    if (!tab?.id) continue;
    await installBridgeOnTab(tab.id);
  }
}

async function reloadMusicTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let targetTab = null;
  if (activeTab?.url && activeTab.url.includes(PAGE_HOST)) {
    targetTab = activeTab;
  } else {
    const tabs = await chrome.tabs.query({ url: `https://${PAGE_HOST}/*` });
    targetTab = tabs?.[0] || null;
  }

  if (!targetTab?.id) return { reloaded: false };
  try {
    await chrome.tabs.reload(targetTab.id, { bypassCache: true });
    return { reloaded: true, tabId: targetTab.id };
  } catch {
    return { reloaded: false };
  }
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return;
      if (info.status === "complete") {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function fetchJson(pathOrUrl, allowRetry = true) {
  const auth = await ensureAuth();
  if (!auth) throw new Error("auth-missing");
  const userToken = auth.musicUserToken || auth.mediaUserToken;
  if (!userToken) throw new Error("auth-missing");

  let lastErr = null;
  for (const base of API_BASES) {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${base}${pathOrUrl}`;
    try {
      const headers = {
        Authorization: `Bearer ${auth.developerToken}`,
        Accept: "application/json",
        "Music-User-Token": userToken
      };

      const pageResponse = PAGE_API_BASES.includes(base)
        ? await fetchJsonViaPage(url, headers)
        : null;
      if (pageResponse) {
        if (pageResponse.status === 401 || pageResponse.status === 403) {
          await clearAuth();
          const refreshed = await refreshAuth(8000);
          if (allowRetry && refreshed) {
            return await fetchJson(pathOrUrl, false);
          }
          throw new Error("auth-invalid");
        }
        if (!pageResponse.ok) {
          if (!pageResponse.status && pageResponse.error) {
            throw new Error(`page-fetch:${pageResponse.error}`);
          }
          if (pageResponse.status === 404) {
            throw new Error("http-404");
          }
          throw new Error(`http-${pageResponse.status}:${(pageResponse.text || "").slice(0, 200)}`);
        }
        if (pageResponse.json) return pageResponse.json;
        throw new Error("json-parse-failed");
      }

      const res = await fetch(url, { headers: { ...headers } });
      if (res.status === 401 || res.status === 403) {
        await clearAuth();
        const refreshed = await refreshAuth(8000);
        if (allowRetry && refreshed) {
          return await fetchJson(pathOrUrl, false);
        }
        throw new Error("auth-invalid");
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`http-${res.status}:${text.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("fetch-failed");
}

async function fetchJsonViaPage(url, headers) {
  const tabs = await chrome.tabs.query({ url: `https://${PAGE_HOST}/*` });
  for (const tab of tabs) {
    if (!tab?.id) continue;
    await installBridgeOnTab(tab.id);
    const response = await sendMessageToTabWithResponse(tab.id, {
      type: "page-fetch",
      url,
      headers
    });
    if (response) return response;
  }
  return null;
}

async function fetchAllPages(initialPath) {
  let path = initialPath;
  const items = [];
  while (path) {
    const json = await fetchJson(path);
    if (Array.isArray(json.data)) items.push(...json.data);
    if (json.next) {
      path = json.next;
    } else {
      path = null;
    }
  }
  return items;
}

async function buildIndex() {
  if (state.indexing) return;
  state.indexing = true;
  state.lastError = null;
  state.progress = {
    done: 0,
    total: 0,
    skipped: 0,
    skippedByReason: { folder: 0, type: 0, notFound: 0 }
  };
  state.skippedSamples = [];
  chrome.runtime.sendMessage({ type: "index-progress", progress: state.progress });

  const windowFocus = setInterval(() => {
    requestAuthFromAnyTab();
  }, 5000);

  try {
    const reloadInfo = await reloadMusicTab();
    if (reloadInfo?.reloaded) {
      chrome.runtime.sendMessage({ type: "index-status", message: "Reloading music.apple.com..." });
      await waitForTabComplete(reloadInfo.tabId, 20000);
      await refreshAuth(8000);
    }

    const playlists = await fetchAllPages("/v1/me/library/playlists?limit=100");
    state.progress.total = playlists.length;
    chrome.runtime.sendMessage({ type: "index-progress", progress: state.progress });

    const trackMap = new Map();
    let trackCount = 0;

    for (const playlist of playlists) {
      if (playlist?.attributes?.isFolder || (playlist?.type && playlist.type !== "library-playlists")) {
        const reason = playlist?.attributes?.isFolder ? "folder" : "type";
        state.progress.skippedByReason[reason] += 1;
        state.progress.skipped += 1;
        state.progress.done += 1;
        if (state.skippedSamples.length < 200) {
          state.skippedSamples.push({
            id: playlist.id,
            name: playlist?.attributes?.name || "Untitled Playlist",
            reason
          });
        }
        chrome.runtime.sendMessage({ type: "index-progress", progress: state.progress });
        continue;
      }
      const playlistId = playlist.id;
      const playlistName = playlist?.attributes?.name || "Untitled Playlist";
      const playlistUrl =
        playlist?.attributes?.url || `https://music.apple.com/library/playlist/${playlistId}`;
      let tracks = [];
      try {
        tracks = await fetchAllPages(`/v1/me/library/playlists/${playlistId}/tracks?limit=100`);
      } catch (err) {
        const raw = err?.message || String(err);
        if (raw.startsWith("http-404")) {
          state.progress.skippedByReason.notFound += 1;
          state.progress.skipped += 1;
          state.progress.done += 1;
          if (state.skippedSamples.length < 200) {
            state.skippedSamples.push({
              id: playlistId,
              name: playlistName,
              reason: "notFound"
            });
          }
          chrome.runtime.sendMessage({ type: "index-progress", progress: state.progress });
          continue;
        }
        throw err;
      }

      for (const track of tracks) {
        const key = trackKey(track);
        if (!key) continue;
        if (!trackMap.has(key)) {
          trackMap.set(key, {
            id: track.id || null,
            name: track?.attributes?.name || "Unknown Title",
            artist: track?.attributes?.artistName || "Unknown Artist",
            album: track?.attributes?.albumName || "Unknown Album",
            url: track?.attributes?.url || null,
            playParams: sanitizePlayParams(track?.attributes?.playParams),
            playlists: new Map()
          });
          trackCount += 1;
        }
        trackMap.get(key).playlists.set(playlistId, {
          id: playlistId,
          name: playlistName,
          url: playlistUrl
        });
      }

      state.progress.done += 1;
      chrome.runtime.sendMessage({ type: "index-progress", progress: state.progress });
    }

    const index = Array.from(trackMap.values()).map((track) => ({
      ...track,
      playlists: Array.from(track.playlists.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    }));

    const meta = {
      builtAt: nowIso(),
      playlists: playlists.length,
      tracks: trackCount,
      skipped: state.progress.skipped || 0,
      skippedByReason: state.progress.skippedByReason,
      skippedSamples: state.skippedSamples
    };

    await saveIndex(index, meta);
    state.indexing = false;
    clearInterval(windowFocus);
    chrome.runtime.sendMessage({ type: "index-complete", meta });
  } catch (err) {
    state.indexing = false;
    clearInterval(windowFocus);
    const raw = err?.message || String(err);
    if (raw === "auth-missing") {
      state.lastError = "Open music.apple.com, sign in, and try again.";
    } else if (raw === "auth-invalid") {
      state.lastError = "Session expired. Refresh music.apple.com and re-index.";
    } else {
      state.lastError = raw;
    }
    chrome.runtime.sendMessage({ type: "index-error", error: state.lastError });
  }
}

function searchIndex({ query, field, playlistFilter }) {
  if (!state.index || !Array.isArray(state.index)) {
    return { error: "Index not built. Click Index Library first." };
  }
  const q = normalize(query);
  if (!q) return { results: [] };

  const playlistNeedle = normalize(playlistFilter);
  const results = [];

  for (const track of state.index) {
    const fields = {
      all: `${track.name} ${track.artist} ${track.album}`,
      title: track.name,
      artist: track.artist,
      album: track.album
    };
    const hay = normalize(fields[field] || fields.all);
    if (!hay.includes(q)) continue;

    let playlists = track.playlists;
    if (playlistNeedle) {
      playlists = playlists.filter((entry) =>
        normalize(typeof entry === "string" ? entry : entry.name).includes(playlistNeedle)
      );
      if (playlists.length === 0) continue;
    }

    results.push({
      name: track.name,
      artist: track.artist,
      album: track.album,
      url: track.url || null,
      playParams: track.playParams || null,
      playlists
    });
  }

  results.sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.artist.localeCompare(b.artist);
  });

  return { results };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "auth" && msg.auth) {
    updateAuth(msg.auth);
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === "get-state") {
    sendResponse?.({
      auth: !!state.auth,
      indexing: state.indexing,
      progress: state.progress,
      meta: state.indexMeta || null,
      lastError: state.lastError || null
    });
    return;
  }

  if (msg.type === "start-index") {
    buildIndex();
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === "search") {
    sendResponse?.(searchIndex(msg));
    return;
  }

  if (msg.type === "clear-index") {
    state.index = null;
    state.indexMeta = { builtAt: null, playlists: 0, tracks: 0 };
    chrome.storage.local.remove(["index", "indexMeta"]);
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === "request-auth") {
    requestAuthFromActiveTab();
    requestAuthFromAnyTab();
    sendResponse?.({ ok: true });
  }

  if (msg.type === "open-url" && msg.url) {
    openInMusicTab(msg.url);
    sendResponse?.({ ok: true });
  }

  if (msg.type === "open-playlist-track" && msg.playlistUrl && msg.track) {
    openPlaylistAndHighlight(msg.playlistUrl, msg.track);
    sendResponse?.({ ok: true });
  }

  if (msg.type === "install-bridge" && sender?.tab?.id) {
    installBridgeOnTab(sender.tab.id);
    sendResponse?.({ ok: true });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

async function openInMusicTab(url) {
  const tabs = await chrome.tabs.query({ url: `https://${PAGE_HOST}/*` });
  if (tabs?.length) {
    return await chrome.tabs.update(tabs[0].id, { url, active: true });
  } else {
    return await chrome.tabs.create({ url });
  }
}

async function openPlaylistAndHighlight(playlistUrl, track) {
  const tab = await openInMusicTab(playlistUrl);
  if (!tab?.id) return;
  await waitForTabComplete(tab.id, 20000);
  await sendMessageToTab(tab.id, {
    type: "highlight-track",
    track
  });
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const headers = details.requestHeaders || [];
    let developerToken = null;
    let musicUserToken = null;
    let mediaUserToken = null;

    for (const header of headers) {
      const name = header.name?.toLowerCase?.();
      if (name === "authorization") {
        developerToken = normalizeBearer(header.value || "");
      }
      if (name === "music-user-token") {
        musicUserToken = header.value || "";
      }
      if (name === "media-user-token") {
        mediaUserToken = header.value || "";
      }
    }

    if (developerToken || musicUserToken || mediaUserToken) {
      updateAuth({ developerToken, musicUserToken, mediaUserToken, fetchedAt: nowIso() });
    }
  },
  {
    urls: [
      "https://amp-api.music.apple.com/*",
      "https://api.music.apple.com/*"
    ]
  },
  ["requestHeaders", "extraHeaders"]
);
