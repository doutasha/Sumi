# Sumi 墨

*[Read in English](./README.en.md).*

Leitor local de mangás (PT/EN): MangaDex como fonte nativa + motor de
extensões embutido (Suwayomi-Server local). O app sai **vazio** — você
adiciona os repositórios de extensões que quiser.

## Como funciona

- **Desktop (recomendado):** instalador Windows com o motor embutido como
  sidecar. Na primeira abertura, o app baixa JRE + servidor (~220MB, com
  progresso e verificação SHA-256) e sobe tudo sozinho, oculto:
  autostart, health com relançamento automático e kill ao fechar.
- **Navegador:** funciona em modo leve (MangaDex) ou apontando para um
  motor local em `http://127.0.0.1:4567`.
- **WebView opcional (desktop):** desligado por padrão; ligue no Config
  para sites com Cloudflare (baixa o Chromium no primeiro uso).
- **Atualizações:** automáticas dentro do app, com changelog e progresso.

## Recursos

- Biblioteca com estantes (arrastar pra mover), filtro, ordenação e badge
  de capítulos; aba **Novidades** com capítulos novos por dia
- Histórico local, lidos/não-lidos, backup/restauração JSON
- Importa biblioteca do Mihon (`.tachibk`): favoritos com fonte instalada,
  capítulos lidos e categorias, direto no motor
- Tour guiado no primeiro boot; interface em português e inglês
- Busca global com filtro de idioma; navegação por fonte
- Manutenção embutida: limpar caches, apagar todos os dados

## Instalar (Windows)

Baixe o `Sumi_*_x64-setup.exe` na aba
[Releases](../../releases) e instale. Na primeira abertura: escolha o
idioma, baixe o motor no Config → pronto.

## Desenvolvimento

```bash
npm install
npm run dev        # web em http://localhost:5173/
npm test           # testes unitários
npm run lint       # eslint
```

Tudo do desktop mora em [`desktop/`](./desktop/) (Tauri 2, mesmo
frontend). Detalhes em [`desktop/README.md`](./desktop/README.md).

```bash
npm run tauri:dev    # janela do Sumi com hot-reload
npm run tauri:build  # gera o instalador
```

Pré-requisitos desktop: Rust stable + WebView2 (Windows).

## Legal

Sem conteúdo embutido — fontes e extensões são adicionadas pelo usuário.
Licença: [MIT](./LICENSE). Terceiros e posição sobre conteúdo:
[THIRD-PARTY-NOTICES](./THIRD-PARTY-NOTICES.md).
