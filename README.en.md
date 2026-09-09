# Sumi 墨

*[Leia em português](./README.md).*

Local manga reader (EN/PT): MangaDex as built-in source + embedded
extension engine (local Suwayomi-Server). The app ships **empty** — you
add the extension repositories you want.

## How it works

- **Desktop (recommended):** Windows installer with the engine as a
  sidecar. On first launch, the app downloads JRE + server (~220MB, with
  progress and SHA-256 check) and runs everything by itself, hidden:
  autostart, health with auto-relaunch and kill on close.
- **Browser:** light mode (MangaDex) or pointing at a local engine on
  `http://127.0.0.1:4567`.
- **Optional WebView (desktop):** off by default; enable in Settings for
  Cloudflare sites (downloads Chromium on first use).
- **Updates:** automatic in-app updates with changelog and progress.

## Features

- Library with shelves (drag to move), filter, sorting, chapter badge;
  **Updates** tab with new chapters per day
- Local history, read/unread, JSON backup/restore
- Import library from Mihon (`.tachibk`): favorites with installed
  source, read chapters and categories, straight into the engine
- Guided tour on first boot; Portuguese and English UI
- Global search with language filter; per-source browsing
- Built-in maintenance: clear caches, erase all data

## Install (Windows)

Download `Sumi_*_x64-setup.exe` from
[Releases](../../releases) and install. On first launch: pick a language,
download the engine in Settings → done.

## Development

```bash
npm install
npm run dev        # web on http://localhost:5173/
npm test           # unit tests
npm run lint       # eslint
```

Desktop lives in [`desktop/`](./desktop/) (Tauri 2, same frontend).
Details in [`desktop/README.md`](./desktop/README.md).

```bash
npm run tauri:dev    # Sumi window with hot-reload
npm run tauri:build  # build the installer
```

Desktop prerequisites: stable Rust + WebView2 (Windows).

## Legal

No bundled content — sources and extensions are added by the user.
License: [MIT](./LICENSE). Third parties and content stance:
[THIRD-PARTY-NOTICES](./THIRD-PARTY-NOTICES.md).
