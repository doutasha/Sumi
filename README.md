# Sumi

Leitor local de mangás: MangaDex como fonte nativa + motor de extensões
embutido (Suwayomi-Server local). O app sai **vazio** — você adiciona os
repositórios de extensões que quiser.

## Como funciona

- **Desktop (recomendado):** instalador Windows com o motor embutido como
  sidecar. Na primeira abertura, o app baixa JRE + servidor (~220MB, com
  progresso e verificação SHA-256) e sobe tudo sozinho, oculto:
  autostart, health com relançamento automático e kill ao fechar.
- **Navegador:** funciona em modo leve (MangaDex) ou apontando para um
  motor local em `http://127.0.0.1:4567`.
- **WebView opcional (desktop):** desligado por padrão; ligue no Config
  para sites com Cloudflare (baixa ~260MB de Chromium no primeiro uso).
- **Atualizações:** automáticas dentro do app (a partir da v1.1).

## Recursos

- MangaDex nativo; catálogo/instalação/atualização de extensões via repos
- Biblioteca local, histórico, lidos/não-lidos, backup/restauração JSON
- Busca global com filtro de idioma; navegação por fonte
- Sem importar backups do Mihon/Tachiyomi

## Instalar (Windows)

Baixe o `Sumi_*_x64-setup.exe` na aba
[Releases](../../releases) e instale. Na primeira abertura: Config →
baixar o motor → pronto.

## Desenvolvimento

```bash
npm install
npm run dev        # web em http://localhost:5173/
```

Tudo do desktop mora em [`desktop/`](./desktop/) (Tauri 2, mesmo
frontend). Detalhes em [`desktop/README.md`](./desktop/README.md).

```bash
npm run tauri:dev    # janela do Sumi com hot-reload
npm run tauri:build  # gera o instalador
```

Pré-requisitos desktop: Rust stable + WebView2 (Windows).

## Estado

Ativo e em evolução: motor embutido funcional; updater e assinatura de
releases a caminho. Sem conteúdo embutido por respeito a copyright —
fontes e extensões são adicionadas pelo usuário.
