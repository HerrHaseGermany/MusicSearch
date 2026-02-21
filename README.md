# MusicSearch (Chrome Extension)

Advanced search for your Apple Music library, with playlist-aware results.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open `https://music.apple.com` and sign in.
5. Open the extension side panel and click **Index Library**.

## How it works

MusicSearch reuses the same authenticated session and tokens that the Apple Music web app already uses. It does not require your own API tokens.

## Notes

- Indexing time depends on how many playlists and tracks you have.
- Your data stays local in the extension cache (no external servers).
- Library-only songs appear under **No playlist**.
