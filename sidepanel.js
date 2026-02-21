const statusEl = document.getElementById("status");
const indexBtn = document.getElementById("indexBtn");
const playlistFilterEl = document.getElementById("playlistFilter");
const fieldFilterEl = document.getElementById("fieldFilter");
const queryEl = document.getElementById("query");
const clearBtn = document.getElementById("clearBtn");
const resultsEl = document.getElementById("results");
const skippedDetailsEl = document.getElementById("skippedDetails");
const skippedSummaryEl = document.getElementById("skippedSummary");
const skippedListEl = document.getElementById("skippedList");

let lastMeta = null;
let lastProgress = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function formatMeta(meta) {
  if (!meta || !meta.builtAt) return "Not indexed yet.";
  const date = new Date(meta.builtAt);
  const skipped = meta.skipped ? ` · ${meta.skipped} skipped` : "";
  const summary = `${meta.playlists} playlists · ${meta.tracks} tracks${skipped}`;
  return `Indexed ${summary} · ${date.toLocaleString()}`;
}

function renderSkipped(meta) {
  if (!meta || !meta.skipped) {
    skippedSummaryEl.textContent = "No skipped playlists.";
    skippedListEl.innerHTML = "";
    skippedDetailsEl.open = false;
    skippedDetailsEl.style.display = "none";
    return;
  }

  skippedDetailsEl.style.display = "block";
  const reasons = meta.skippedByReason || {};
  const parts = [
    reasons.folder ? `${reasons.folder} folders` : null,
    reasons.type ? `${reasons.type} non-playlist items` : null,
    reasons.notFound ? `${reasons.notFound} not found` : null
  ].filter(Boolean);

  skippedSummaryEl.textContent = parts.length
    ? `Skipped ${meta.skipped} total: ${parts.join(", ")}.`
    : `Skipped ${meta.skipped} total.`;

  skippedListEl.innerHTML = "";
  const samples = meta.skippedSamples || [];
  samples.forEach((item) => {
    const row = document.createElement("div");
    row.className = "skipped-item";

    const name = document.createElement("div");
    name.textContent = item.name || item.id || "Unknown";

    const reason = document.createElement("div");
    reason.className = "skipped-reason";
    reason.textContent = item.reason || "unknown";

    row.appendChild(name);
    row.appendChild(reason);
    skippedListEl.appendChild(row);
  });
}

function renderEmpty(message) {
  resultsEl.innerHTML = "";
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = message;
  resultsEl.appendChild(div);
}

function renderResults(results) {
  resultsEl.innerHTML = "";
  if (!results || results.length === 0) {
    renderEmpty("No matches yet. Try another query.");
    return;
  }

  const fragment = document.createDocumentFragment();
  results.forEach((item) => {
    const card = document.createElement("div");
    card.className = "result";

    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = `${item.name} — ${item.artist}`;
    if (item.playlists && item.playlists.length) {
      title.classList.add("clickable");
      title.addEventListener("click", () => openTrackInPlaylist(item));
      title.title = "Open playlist and highlight this song";
    } else {
      title.classList.add("clickable");
      title.addEventListener("click", () => openTrackInPlaylist(item));
      title.title = "Open library and highlight this song";
    }

    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = item.album || "";

    const tags = document.createElement("div");
    tags.className = "tags";
    item.playlists.forEach((playlist) => {
      const playlistObj = normalizePlaylist(playlist);
      const tag = document.createElement("div");
      tag.className = "tag";
      tag.textContent = playlistObj.name || "Playlist";
      if (playlistObj.id === "__library__" || playlistObj.name === "No playlist") {
        tag.title = "No playlist";
      } else if (playlistObj.url) {
        tag.classList.add("clickable");
        tag.addEventListener("click", () => openUrl(playlistObj.url));
        tag.title = "Open playlist in Apple Music";
      }
      tags.appendChild(tag);
    });

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(tags);
    fragment.appendChild(card);
  });

  resultsEl.appendChild(fragment);
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

function currentSearchPayload() {
  return {
    type: "search",
    query: queryEl.value || "",
    field: fieldFilterEl.value || "all",
    playlistFilter: playlistFilterEl.value || ""
  };
}

function requestSearch() {
  const payload = currentSearchPayload();
  if (!payload.query.trim()) {
    renderEmpty("Type a song name to search your playlists.");
    return;
  }

  chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError) {
      renderEmpty("Extension error. Reload the side panel.");
      return;
    }
    if (response?.error) {
      renderEmpty(response.error);
      return;
    }
    renderResults(response?.results || []);
  });
}

function resolveTrackUrl(item) {
  if (item.libraryUrl) return item.libraryUrl;
  if (item.url) return item.url;
  const pp = item.playParams;
  if (pp?.isLibrary && pp?.kind && pp?.id) {
    return `https://music.apple.com/library/${pp.kind}/${pp.id}`;
  }
  return null;
}

function normalizePlaylist(entry) {
  if (!entry) return { name: "", url: "" };
  if (typeof entry === "string") return { name: entry, url: "" };
  if (entry.id === "__library__" || entry.name === "No playlist") {
    return {
      id: "__library__",
      name: "No playlist",
      url: normalizeLibraryListUrl(entry.url) || "https://music.apple.com/library/songs"
    };
  }
  if (entry.url) return entry;
  if (entry.id) {
    return {
      name: entry.name || entry.id,
      url: `https://music.apple.com/library/playlist/${entry.id}`
    };
  }
  return { name: entry.name || "", url: "" };
}

function openUrl(url) {
  chrome.runtime.sendMessage({ type: "open-url", url });
}

function openTrackInPlaylist(item) {
  const playlist = pickPlaylistForTrack(item);
  const fallbackList =
    normalizeLibraryListUrl(item.libraryUrl) ||
    normalizeLibraryListUrl(resolveTrackUrl(item)) ||
    "https://music.apple.com/library/songs";
  if (!playlist?.url) {
    chrome.runtime.sendMessage({
      type: "open-playlist-track",
      playlistUrl: fallbackList,
      track: {
        name: item.name,
        artist: item.artist,
        album: item.album
      }
    });
    return;
  }
  let playlistUrl = playlist.url;
  if (playlist.id === "__library__" || playlist.name === "No playlist") {
    playlistUrl = normalizeLibraryListUrl(playlistUrl) || fallbackList;
  }
  chrome.runtime.sendMessage({
    type: "open-playlist-track",
    playlistUrl,
    track: {
      name: item.name,
      artist: item.artist,
      album: item.album
    }
  });
}

function pickPlaylistForTrack(item) {
  if (!item?.playlists?.length) return null;
  const normalized = item.playlists.map(normalizePlaylist);
  const needle = normalizeText(playlistFilterEl.value || "");
  if (needle) {
    const match = normalized.find((p) => normalizeText(p.name).includes(needle));
    if (match) return match;
  }
  return normalized[0];
}

function normalizeText(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeLibraryListUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((part) => part === "library");
    if (idx >= 0 && parts[idx + 1] === "songs") {
      const baseParts = parts.slice(0, idx + 2);
      parsed.pathname = `/${baseParts.join("/")}`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }
  } catch {
    // ignore
  }
  return "";
}

const debouncedSearch = debounce(requestSearch, 200);

indexBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "request-auth" });
  chrome.runtime.sendMessage({ type: "start-index" });
  setStatus("Indexing started. Keep this panel open.");
});

clearBtn.addEventListener("click", () => {
  queryEl.value = "";
  requestSearch();
});

queryEl.addEventListener("input", debouncedSearch);
playlistFilterEl.addEventListener("input", debouncedSearch);
fieldFilterEl.addEventListener("change", debouncedSearch);

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === "index-reset-skipped") {
    renderSkipped(null);
  }

  if (msg.type === "index-status" && msg.message) {
    setStatus(msg.message);
  }

  if (msg.type === "index-progress") {
    lastProgress = msg.progress;
    const total = lastProgress?.total || 0;
    const done = lastProgress?.done || 0;
    const skipped = lastProgress?.skipped || 0;
    if (total > 0) {
      const skippedText = skipped ? ` · ${skipped} skipped` : "";
      setStatus(`Indexing ${done}/${total} playlists${skippedText}...`);
    } else {
      setStatus("Indexing playlists...");
    }
  }

  if (msg.type === "index-complete") {
    lastMeta = msg.meta;
    setStatus(formatMeta(lastMeta));
    renderSkipped(lastMeta);
  }

  if (msg.type === "index-error") {
    setStatus(`Index failed: ${msg.error}`);
  }
});

chrome.runtime.sendMessage({ type: "get-state" }, (response) => {
  if (chrome.runtime.lastError) return;
  if (response?.indexing) {
    setStatus("Indexing... Keep this panel open.");
    return;
  }
  if (response?.meta?.builtAt) {
    lastMeta = response.meta;
    setStatus(formatMeta(lastMeta));
    renderSkipped(lastMeta);
  } else {
    if (response?.auth) {
      setStatus("Auth captured. Click Index Library to build search.");
    } else {
      setStatus("Not indexed yet. Open music.apple.com and sign in.");
    }
    renderSkipped(null);
  }
});

chrome.runtime.sendMessage({ type: "request-auth" });

renderEmpty("Type a song name to search your playlists.");
