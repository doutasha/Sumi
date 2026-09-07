# parser/ — visão geral

Frontend estático (Sumi) + motor local (Suwayomi-Server) via HTTP em
`localhost`. O Sumi **nunca** executa extensão: só faz JSON/bytes por REST.

## Módulos (um assunto por arquivo)

| Arquivo | Responsabilidade | Fase |
|---|---|---|
| `client.js` | Único ponto HTTP: timeout, retry, auth, erro normalizado (`SuwayomiError`) | 4a ✅ |
| `connection.js` | Config (`sumi.suwayomi.config`) + health-check (`/source/list` como ping) | 4a ✅ |
| `sources.js` | Lista/filtra fontes do servidor → formato do registry | 4b |
| `manga.js` | browse/search/details/chapters/pages → nossa interface de source | 4b |
| `images.js` | URLs de thumb/page via servidor (bytes com headers corretos) | 4b |
| `extensions.js` | install/update/uninstall + add repo (GraphQL) | 4c |

## Decisões travadas

1. **Zero dependências npm novas** — só `fetch`/`btoa` nativos. Nada pra conflitar no bundle.
2. **Nenhum módulo além de `client.js` faz fetch.** Timeout/retry central, sem comportamento espalhado.
3. **IDs com namespace** `suwayomi:<...>` — nunca colidem com `mangadex` ou `keiyoushi-*`.
4. **localStorage próprio**: `sumi.suwayomi.*` (config, sources, extensions, disabled).
   Biblioteca/histórico continuam nossos.
5. **Servidor é opcional em runtime**: `connection.enabled=false` ou offline → modo leve
   (MangaDex). A UI alterna por `checkHealth()`, nunca assume servidor.
6. **Legado estático removido na 4c** ✅ (`kotlinParser.js`, `kotlin/`, `dynamicSource.js`
   genérico, Comix builtin — extensão se instala pelo repo).

## Ciclo de vida do motor (4d)

- **Desktop (Tauri):** sidecar invisível — sobe junto (ou no 1º uso de extensão),
  data-dir fixo fora do Temp, kill-on-close. Nada fica rodando depois.
- **Browser:** processo separado (instalado ou launcher próprio). Fecha a aba, ele continua.
