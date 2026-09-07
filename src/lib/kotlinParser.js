/**
 * Parses Keiyoushi Kotlin extension files into the scraper config consumed by
 * dynamicSource.js.
 *
 * The Kotlin-specific parsing lives in src/lib/kotlin/*. This file only maps
 * the parsed AST to the app's source config shape.
 */

import { parseKotlinAst } from "./kotlin/ast.js";
import {
  absoluteUrlFromPath,
  extractDocumentSelect,
  extractDocumentSelectFirst,
  extractFunctionBody,
  extractHeaderOverrides,
  extractOverrideStringProperty,
  extractReferer,
  extractRequestPath,
  extractSearchUrlFallback,
  extractSelector,
} from "./kotlin/extractors.js";
import {
  detectMultisrc,
  extractMultisrcMetadata,
} from "./kotlin/multisrc.js";

export {
  getMultisrcDefaults,
  mergeWithDefaults,
} from "./kotlin/multisrc.js";

function firstFunctionBody(ast, names) {
  for (const name of names) {
    const body = extractFunctionBody(ast, name);
    if (body) return body;
  }
  return null;
}

function createBaseConfig({
  ast,
  baseUrl,
  extName,
  latestPath,
  msMetadata,
  multisrc,
  popularPath,
  rawLang,
  rawName,
  searchPath,
}) {
  return {
    name: rawName || msMetadata.name || extName,
    baseUrl,
    mirrors: msMetadata.mirrors ?? null,
    lang: rawLang || msMetadata.lang || "en",
    multisrc: multisrc.type,
    version: null,
    headers: extractHeaderOverrides(ast),

    searchUrl:
      searchPath && !searchPath.includes("{{")
        ? absoluteUrlFromPath(baseUrl, searchPath)
        : null,
    _popularPath: popularPath,
    _latestPath: latestPath,
    _searchPath: searchPath,
    searchMangaSelector:
      extractSelector(ast, "searchMangaSelector") ||
      extractSelector(ast, "latestUpdatesSelector") ||
      extractSelector(ast, "popularMangaSelector") ||
      extractDocumentSelect(ast, "searchMangaParse") ||
      extractDocumentSelect(ast, "latestUpdatesParse") ||
      extractDocumentSelect(ast, "popularMangaParse"),
    searchMangaNextPageSelector:
      extractSelector(ast, "searchMangaNextPageSelector") ||
      extractSelector(ast, "latestUpdatesNextPageSelector") ||
      extractDocumentSelectFirst(ast, "searchMangaParse") ||
      extractDocumentSelectFirst(ast, "latestUpdatesParse") ||
      extractDocumentSelectFirst(ast, "popularMangaParse"),

    mangaFromElement: {
      titleSelector: null,
      titleAttr: null,
      urlSelector: null,
      urlAttr: "href",
      thumbnailSelector: null,
      thumbnailAttr: "data-src",
    },

    mangaDetails: {
      titleSelector: null,
      authorSelector: null,
      descriptionSelector: null,
      genreSelector: null,
      statusSelector: null,
      thumbnailSelector: null,
      thumbnailAttr: "data-src",
    },

    chapterListSelector:
      extractSelector(ast, "chapterListSelector") ||
      extractDocumentSelect(ast, "chapterListParse"),
    chapterFromElement: {
      urlSelector: null,
      urlAttr: "href",
      nameSelector: null,
      dateSelector: null,
    },

    pageListSelector: null,
    pageImageAttr: "data-src",
    referer: null,
  };
}

function applyMangaListParse(config, body) {
  if (!body) return;

  const titleSel =
    body.match(/title\s*=\s*element\.(?:selectFirst|select)\("([^"]+)"\)/) ||
    body.match(/title\s*=\s*selectFirst\("([^"]+)"\)/);
  if (titleSel) config.mangaFromElement.titleSelector = titleSel[1];

  const thumbSel = body.match(
    /thumbnail_url\s*=\s*element\.selectFirst\("([^"]+)"\)/,
  );
  if (thumbSel) config.mangaFromElement.thumbnailSelector = thumbSel[1];

  const thumbAttr = body.match(/thumbnail_url[^.]*\.attr\("([^"]+)"\)/);
  if (thumbAttr) config.mangaFromElement.thumbnailAttr = thumbAttr[1];

  const urlSel = body.match(
    /setUrlWithoutDomain\(element\.selectFirst\("([^"]+)"\)/,
  );
  if (urlSel) {
    config.mangaFromElement.urlSelector = urlSel[1];
    return;
  }

  const urlSelFromAttr = body.match(
    /selectFirst\("([^"]*a[^"]*)"\)[^.]*\.attr\("href"\)/,
  );
  if (urlSelFromAttr) config.mangaFromElement.urlSelector = urlSelFromAttr[1];
}

function applyDetailsParse(config, body) {
  if (!body) return;

  const titleSel = body.match(
    /(?:title\s*=\s*document\.selectFirst\("|\.select\(")([^"]+)"[^)]*\)[^.]*\.(?:text|ownText)\(\)/,
  );
  if (titleSel) config.mangaDetails.titleSelector = titleSel[1];

  const authorSel = body.match(/author\s*=\s*document\.select\("([^"]+)"\)/);
  if (authorSel) config.mangaDetails.authorSelector = authorSel[1];

  const descSel = body.match(
    /description\s*=\s*document\.select\("([^"]+)"\)/,
  );
  if (descSel) config.mangaDetails.descriptionSelector = descSel[1];

  const genreSel = body.match(
    /(?:genre|genres)[^=]*=.*?document\.select\("([^"]+)"\)/s,
  );
  if (genreSel) config.mangaDetails.genreSelector = genreSel[1];

  const statusSel = body.match(
    /(?:status|parseStatus)\(document\.select\("([^"]+)"\)/,
  );
  if (statusSel) config.mangaDetails.statusSelector = statusSel[1];

  const thumbSel = body.match(
    /thumbnail_url\s*=\s*document\.select\("([^"]+)"\)/,
  );
  if (thumbSel) config.mangaDetails.thumbnailSelector = thumbSel[1];

  const thumbAttr = body.match(/thumbnail_url[^.]*\.attr\("([^"]+)"\)/);
  if (thumbAttr) config.mangaDetails.thumbnailAttr = thumbAttr[1];
}

function applyChapterParse(config, body) {
  if (!body) return;

  const urlSel = body.match(
    /(?:setUrlWithoutDomain|url\s*=)[^"]*(?:selectFirst|select)\("([^"]+)"\)/,
  );
  if (urlSel) config.chapterFromElement.urlSelector = urlSel[1];

  const nameSel = body.match(
    /name\s*=\s*element\.(?:selectFirst|select)\("([^"]+)"\)/,
  );
  if (nameSel) config.chapterFromElement.nameSelector = nameSel[1];

  const dateSel = body.match(/date_upload[^"]*selectFirst?\("([^"]+)"\)/);
  if (dateSel) config.chapterFromElement.dateSelector = dateSel[1];
}

function applyPageParse(config, body) {
  if (!body) return;

  const pageSel = body.match(/document\.select\("([^"]+)"\)/);
  if (pageSel) config.pageListSelector = pageSel[1];

  const pageAttr = body.match(/\.attr\("([^"]+)"\)/);
  if (pageAttr) config.pageImageAttr = pageAttr[1];

  if (/script:containsData\(([^)]+)\)/.test(body)) {
    config._jsImageExtraction = true;
  }

  if (body.includes("chapImages") || body.includes("mainServer")) {
    config._chapImagesPattern = true;
  }
}

function applyFallbackUrls(config, ast) {
  config.referer = extractReferer(ast, config.baseUrl);

  if (!config.searchUrl) {
    config.searchUrl = extractSearchUrlFallback(ast, config.baseUrl);
  }
}

/**
 * Parse a Kotlin extension file and extract a scraper configuration.
 * @param {string} kotlinCode - Raw .kt file content
 * @param {string} extName - Extension name (e.g. "mangapill")
 * @returns {object} Parsed extension config
 */
export function parseKotlinExtension(kotlinCode, extName) {
  const ast = parseKotlinAst(kotlinCode);
  const multisrc = detectMultisrc(ast);
  const msMetadata = extractMultisrcMetadata(ast);

  const rawName = extractOverrideStringProperty(ast, "name");
  const rawBaseUrl = extractOverrideStringProperty(ast, "baseUrl");
  const rawLang = extractOverrideStringProperty(ast, "lang");
  const baseUrl = (rawBaseUrl || msMetadata.baseUrl || "").replace(
    /{{BASE_URL}}/g,
    "",
  );

  const popularPath = extractRequestPath(ast, "popularMangaRequest");
  const latestPath = extractRequestPath(ast, "latestUpdatesRequest");
  const searchPath = extractRequestPath(ast, "searchMangaRequest");

  const config = createBaseConfig({
    ast,
    baseUrl,
    extName,
    latestPath,
    msMetadata,
    multisrc,
    popularPath,
    rawLang,
    rawName,
    searchPath,
  });

  applyMangaListParse(
    config,
    firstFunctionBody(ast, [
      "latestUpdatesFromElement",
      "searchMangaFromElement",
      "popularMangaFromElement",
    ]),
  );
  applyDetailsParse(config, extractFunctionBody(ast, "mangaDetailsParse"));
  applyChapterParse(config, extractFunctionBody(ast, "chapterFromElement"));
  applyPageParse(config, extractFunctionBody(ast, "pageListParse"));
  applyFallbackUrls(config, ast);

  return config;
}
