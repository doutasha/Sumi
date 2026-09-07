# Endpoints verificados (Suwayomi-Server v2.3.2243, 2026-09-07, instância local)

Base: `{baseUrl}/api/v1` (`{baseUrl}` default `http://127.0.0.1:4567`).
Fonte: `MangaAPI.kt`, `SourceController.kt`, `ExtensionController.kt`,
`ExtensionStoreMutation.kt`, `JavalinSetup.kt` + teste funcional real
(extensão Manga Ball PT-BR instalada via WebUI).

| Método | Rota | Uso nosso | Status |
|---|---|---|---|
| `GET` | `/source/list` | Ping/health + catálogo de fontes | ✅ 200, 40+ fontes, sem auth |
| `GET` | `/source/{id}` | Detalhe da fonte | código ✅, funcional ⏳ 4b |
| `GET` | `/source/{id}/popular/{page}` | `browse()` | ✅ 200 + `hasNextPage` |
| `GET` | `/source/{id}/latest/{page}` | `getLatest()` | código ✅, funcional ⏳ 4b |
| `GET` | `/source/{id}/search?searchTerm=&pageNum=` | `search()` (+ `quick-search` POST p/ filtros na 4d) | código ✅, funcional ⏳ 4b |
| `GET` | `/source/{id}/filters` | Filtros da extensão | 4d |
| `GET` | `/manga/{id}` e `/manga/{id}/full` | `getMangaDetails()` | ✅ 200 (título, autor, status, gêneros) |
| `GET` | `/manga/{id}/chapters` | `getChapters()` | ✅ 200, 104 capítulos |
| `GET` | `/manga/{id}/chapter/{index}` | Retrieve (traz `pageCount`) — chamar antes de paginar | ✅ 200, `pageCount: 39` |
| `GET` | `/manga/{id}/chapter/{index}/page/{i}` | `getChapterPages()` — **retorna bytes da imagem, não JSON** | ✅ 200, WEBP real |
| `GET` | `/manga/{id}/thumbnail` | Capa com headers corretos (mata hotlink/Referer) | ✅ 200, 48 KB |
| `GET` | `/extension/icon/{pkg}` | Ícone da extensão | código ✅ |
| `GET` | `/extension/install/{pkg}`, `/update/{pkg}`, `/uninstall/{pkg}` | Gestão de extensões | 4c |
| `POST` | `/api/graphql` `addExtensionStore({indexUrl})` | Adicionar repo (ex. Keiyoushi `index.json`) | código ✅, via API ⏳ 4c |

Notas:

- IDs de fonte são strings numéricas longas (ex. `35546023386335815`); id de mangá é int do servidor.
- Sem auth em servidor zerado. Com `BASIC_AUTH` ligado, mandar header `Authorization`.
- CORS reflete a origem (`JavalinSetup`); no Tauri é irrelevante (fetch nativo).
- GraphQL restante (filtros, store list) só na 4c/4d; REST cobre toda a v1 do adapter.
