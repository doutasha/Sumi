# Sumi

Sumi is a local online manga reader built around MangaDex and Keiyoushi extensions.

The app runs in the browser with Vite, stores library/progress data locally, and lets users install compatible Keiyoushi sources without importing Mihon/Tachiyomi backup files.

## Features

- MangaDex as a built-in source
- Keiyoushi extension catalog, install, uninstall, update, and browse
- Source compatibility checks for manga list, details, chapters, and reading pages
- Local library, reading history, read/unread chapter status, and JSON backup/restore
- Local CORS proxy for development scraping requests

## Development

```bash
npm install
npm run dev
```

The dev server uses the Vite port from [vite.config.js](./vite.config.js), usually `http://127.0.0.1:5173/`.

## Build

```bash
npm run build
```

The production build is written to `dist/`.

## Desktop (Tauri 2.0)

Tudo do app desktop mora em [`desktop/`](./desktop/) — mesmo frontend, empacotado para Windows/macOS/Linux, com rede nativa sem CORS. Detalhes e pré-requisitos (Rust, WebView2) em [`desktop/README.md`](./desktop/README.md).

```bash
npm run tauri:dev    # dev com hot-reload na janela do Sumi
npm run tauri:build  # gera o instalador
```
