# Sumi Desktop (Tauri 2.0)

Wrapper desktop do Sumi para Windows, macOS e Linux. O frontend é o **mesmo React/Vite da versão web** — nada foi duplicado: o Tauri só empacota `../dist` e libera rede nativa sem CORS.

```
repo/
├── src/                 → frontend web (React + Vite, inalterado)
├── dist/                → build empacotado pelo Tauri (gerado)
└── desktop/             → TUDO do app desktop mora aqui
    ├── src-tauri/       → backend Rust + config do Tauri 2
    │   ├── tauri.conf.json
    │   ├── capabilities/default.json
    │   ├── Cargo.toml / build.rs / src/main.rs
    │   └── icons/       → gerados via `npm run tauri:icon`
    ├── assets/icon.svg  → arte-fonte do ícone
    └── frontend-integration/
        └── tauri-env.js → ponte web↔desktop (detecção + fetch nativo)
```

## Pré-requisitos

1. **Node 20+** (este repo usa npm).
2. **Rust estável** via [rustup](https://rustup.rs/):
   - Windows: instale também o **Visual Studio Build Tools** com a carga “Desktop development with C++” + **WebView2** (já vem no Windows 10/11 atualizado).
   - macOS: `xcode-select --install`.
   - Linux (Debian/Ubuntu): `build-essential`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`.
3. Dependências do repo já instaladas (`npm install` na raiz — inclui `@tauri-apps/cli@2`).

> Nesta máquina o Rust ainda **não** está instalado (`rustc`/`cargo` não encontrados) — por isso `cargo check`/`tauri build` ainda não foram executados aqui. Instale o rustup e siga abaixo.

## Rodar em desenvolvimento

```bash
# na raiz do repo
npm run tauri:dev
```

Isso sobe o Vite (`http://localhost:5173`) e abre a janela do Sumi apontando para ele, com hot-reload.

## Gerar instalador

```bash
# na raiz do repo
npm run build        # gera dist/ (o Tauri também roda isso sozinho)
npm run tauri:build  # gera o instalador em desktop/src-tauri/target/release/bundle/
```

## Trocar o ícone

Edite `desktop/assets/icon.svg` (1024×1024 de preferência) e rode:

```bash
npm run tauri:icon
```

## Como a rede funciona no desktop

| Chamada | Web (navegador) | Desktop (Tauri) |
|---|---|---|
| HTML das fontes (`proxyFetch`) | proxy local do Vite em dev, `corsproxy.io` e fallbacks em prod | **fetch nativo no Rust** (`@tauri-apps/plugin-http`), sem CORS e sem proxy público |
| API MangaDex (`mangadex.js`) | `/mdx-api` em dev, `corsproxy.io` em prod | **URL direta** `https://api.mangadex.org` (a API já é CORS-friendly) |
| Imagens (`proxyImageUrl`) | proxy local / `corsproxy.io` | mantido como na web (tags `<img>` não sofrem CORS para exibição) |

A detecção é automática via `isTauriRuntime()` (`desktop/frontend-integration/tauri-env.js`): fora do Tauri nada muda.

## Arquivos de config importantes

- `desktop/src-tauri/tauri.conf.json` — `productName: Sumi`, `identifier: com.sumi.reader`, `version` lida de `../../package.json` (versão única), `frontendDist: ../../dist`, janela `main` 1280×800.
- `desktop/src-tauri/capabilities/default.json` — permissões da janela `main`: `core:default`, `http:default`, `opener:default`, `dialog:default`.
- `desktop/src-tauri/Cargo.toml` — `tauri = "2"`, plugins `http`, `opener`, `dialog`.

## Solução de problemas

- **`failed to run 'cargo metadata' ... program not found`**: o terminal foi aberto antes da instalação do Rust e não tem o cargo no PATH. Os scripts `tauri:dev`/`tauri:build` já passam por `desktop/scripts/tauri.mjs`, que injeta o cargo no PATH sozinho — mas, por garantia, **feche e reabra o terminal/IDE** após instalar o Rust.
- **`tauri dev` diz que a porta está em uso**: o `vite.config.js` usa `strictPort` quando detecta o Tauri — libere a 5173 ou mate o `vite` anterior.
- **Tela branca no `tauri build`**: confira se `dist/index.html` existe (`npm run build`).
- **Erro de permissão `http:default`/`opener:default`**: confira se o plugin está em `Cargo.toml`, registrado no `main.rs` e listado na capability.
