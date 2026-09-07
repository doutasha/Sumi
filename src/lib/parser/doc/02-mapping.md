# Mapeamento servidor → interface Sumi

Nossa interface (a mesma de `mangadex.js`/`dynamicSource.js`):
`browse/search/getLatest → {results, total, page, hasMore}`,
`getMangaDetails → {id, title, description, coverUrl, author, status, tags}`,
`getChapters → [{id, chapter, title, language, pages, publishAt, group}]`,
`getChapterPages → [urls]`.

## Espelho (nosso módulo ↔ classe deles)

| Nosso | Deles | Conversor |
|---|---|---|
| `sources.js` | `impl/Source.kt` + `SourceDataClass` | `fromSourceDataClass` |
| `manga.js` popular/latest | `impl/MangaList.kt` + `PagedMangaListDataClass` | `fromPagedMangaList` |
| `manga.js` search | `impl/Search.kt` | `fromPagedMangaList` |
| `manga.js` details | `impl/Manga.kt` + `MangaDataClass` | `fromMangaDataClass` |
| `manga.js` chapters | `impl/Chapter.kt` + `ChapterDataClass` | `fromChapterDataClass` |
| `manga.js` pages | `impl/Page.kt` + `PageDataClass` (bytes!) | URLs, sem conversor |
| `images.js` | `impl/ThumbnailDownloadHelper` + `pageRetrieve` | builders absolutos |

Semânticas herdadas sem reinventar: capítulo `index` 1-based, `hasNextPage`
puro, enum `MangaStatus` convertido só na borda (`mapMangaStatus`).

## Lista → resultados

`{mangaList: [{id, title, thumbnailUrl, ...}], hasNextPage}` → results com
`id: 'suwayomi:<serverMangaId>'`, `coverUrl` via `images.js` (`/manga/{id}/thumbnail`).

## Detalhes (`MangaDataClass`)

| Servidor | Nosso |
|---|---|
| `title` | `title` |
| `author` (+ `artist` como fallback) | `author` (join `', '`) |
| `description` | `description` |
| `genre: []` | `tags` |
| `status` (`MangaStatus`: UNKNOWN/ONGOING/COMPLETED/CANCELLED/ON_HIATUS/…) | minúsculo; `LICENSED`/`PUBLISHING_FINISHED` → `completed` |
| `thumbnailUrl` (path relativo) | resolvido p/ URL absoluta do servidor |

## Capítulos (`ChapterDataClass`)

`name` → `title`, `chapterNumber` (float) → `chapter` (string),
`uploadDate` (epoch ms) → `publishAt` (ISO), `scanlator` → `group`,
`index` (1-based) → embutido no nosso id: `suwayomi:<mangaId>:<index>`.
**Sempre chamar `chapterRetrieve` antes de paginar** (inicializa `pageCount`;
página antes disso pode vir vazia — observado no teste real).

## Páginas

Endpoint retorna **bytes** (não JSON): `getChapterPages` devolve as URLs
(`/manga/{id}/chapter/{index}/page/{i}`, `i` em `0..pageCount-1`) e o leitor
carrega direto — sem proxy, sem Referer manual, sem hotlink.
