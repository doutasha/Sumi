const KNOWN_MULTISRC = {
  MadTheme: "madtheme",
  Madara: "madara",
  MangaThemesia: "mangathemesia",
  MangaBox: "mangabox",
  Mangabox: "mangabox",
  FoolSlide: "foolslide",
  WPMangaReader: "wpmangareader",
  GroupLe: "grouple",
  GalleryAdults: "galleryadults",
  HeanCms: "heancms",
  Keyoapp: "keyoapp",
  Libgroup: "libgroup",
  Luscious: "luscious",
  MangaHub: "mangahub",
  Masonry: "masonry",
  NepNep: "nepnep",
  ParsedHttpSource: "parsed",
  HttpSource: "http",
};

function detectMultisrc(ast) {
  const superCall = ast.classes.find((item) => item.superCall)?.superCall;
  const parentClass = superCall?.name ?? null;

  return parentClass && KNOWN_MULTISRC[parentClass]
    ? { type: KNOWN_MULTISRC[parentClass], parentClass }
    : { type: "unknown", parentClass: null };
}

function extractMultisrcMetadata(ast) {
  const superCall = ast.classes.find((item) => item.superCall)?.superCall;
  if (!superCall) return {};

  const name = superCall.args[0]?.stringValue ?? null;
  const secondArg = superCall.args[1];
  const lang = superCall.args[2]?.stringValue ?? null;

  if (secondArg?.strings?.length > 1 || /(?:arrayOf|listOf)\s*\(/.test(secondArg?.raw ?? "")) {
    const mirrors = (secondArg.strings ?? []).map(
      (mirror) => `https://${mirror.replace(/^https?:\/\//, "")}`,
    );
    return {
      name,
      baseUrl: mirrors[0] ?? null,
      lang,
      mirrors,
    };
  }

  return {
    name,
    baseUrl: secondArg?.stringValue ?? null,
    lang,
    mirrors: null,
  };
}

function getMultisrcDefaults(type) {
  switch (type) {
    case "madtheme":
      return {
        searchMangaSelector: ".book-detailed-item",
        searchMangaNextPageSelector:
          ".paginator > a.active + a:not([rel=next])",
        mangaFromElement: {
          titleSelector: "a",
          titleAttr: "title",
          urlSelector: "a",
          urlAttr: "href",
          thumbnailSelector: "img",
          thumbnailAttr: "data-src",
        },
        mangaDetails: {
          titleSelector: ".detail h1",
          authorSelector: ".detail .meta > p > strong:contains(Authors) ~ a",
          descriptionSelector: ".summary .content",
          genreSelector: ".detail .meta > p > strong:contains(Genres) ~ a",
          statusSelector: ".detail .meta > p > strong:contains(Status) ~ a",
          thumbnailSelector: "#cover img",
          thumbnailAttr: "data-src",
        },
        chapterListSelector: "#chapter-list > li",
        chapterFromElement: {
          urlSelector: "a",
          urlAttr: "href",
          nameSelector: ".chapter-title",
          dateSelector: ".chapter-update",
        },
        pageListSelector: "#chapter-images img, .chapter-image[data-src]",
        pageImageAttr: "data-src",
        _chapImagesPattern: true,
      };

    case "madara":
      return {
        searchMangaSelector: ".c-tabs-item__content, .page-item-detail",
        searchMangaNextPageSelector:
          ".nav-previous a, .wp-pagenavi .nextpostslink",
        mangaFromElement: {
          titleSelector: ".post-title a, .item-summary .post-title a",
          titleAttr: null,
          urlSelector: ".post-title a, .item-summary .post-title a",
          urlAttr: "href",
          thumbnailSelector: "img",
          thumbnailAttr: "data-src",
        },
        mangaDetails: {
          titleSelector: ".post-title h1",
          authorSelector: ".author-content a",
          descriptionSelector:
            ".description-summary .summary__content, div.summary_content .post-content_item:contains(Summary) .summary-content",
          genreSelector: ".genres-content a",
          statusSelector:
            ".post-content_item:contains(Status) .summary-content",
          thumbnailSelector: ".summary_image img",
          thumbnailAttr: "data-src",
        },
        chapterListSelector: "li.wp-manga-chapter",
        chapterFromElement: {
          urlSelector: "a",
          urlAttr: "href",
          nameSelector: "a",
          dateSelector: ".chapter-release-date, span.chapter-release-date i",
        },
        pageListSelector: ".reading-content img, .page-break img",
        pageImageAttr: "data-src",
      };

    case "mangathemesia":
      return {
        searchMangaSelector:
          ".utao .uta .imgu, .listupd .bs .bsx, .serieslist ul li",
        searchMangaNextPageSelector: ".hpage a.r, .pagination .next",
        mangaFromElement: {
          titleSelector: "a",
          titleAttr: "title",
          urlSelector: "a",
          urlAttr: "href",
          thumbnailSelector: "img",
          thumbnailAttr: "src",
        },
        mangaDetails: {
          titleSelector: "h1.entry-title",
          authorSelector:
            ".imptdt:contains(Author) i, .fmed b:contains(Author)+span, span:contains(Author)",
          descriptionSelector:
            ".entry-content[itemprop=description], .desc, .entry-content.entry-content-single",
          genreSelector: ".mgen a, .seriestugenre a",
          statusSelector: ".imptdt:contains(Status) i",
          thumbnailSelector: ".thumb img, .infmanga > div[itemprop=image] img",
          thumbnailAttr: "src",
        },
        chapterListSelector: "#chapterlist ul li, .eplister ul li",
        chapterFromElement: {
          urlSelector: "a",
          urlAttr: "href",
          nameSelector: ".chapternum, .epl-num",
          dateSelector: ".chapterdate, .epl-date",
        },
        pageListSelector: "#readerarea img",
        pageImageAttr: "src",
      };

    case "mangabox":
      return {
        searchMangaSelector:
          "div.truyen-list > div.list-truyen-item-wrap, div.comic-list > .list-comic-item-wrap, .panel_story_list .story_item",
        searchMangaNextPageSelector:
          "div.group_page, div.group-page a:not([href]) + a:not(:contains(Last)), a.page_select + a:not(.page_last), a.page-select + a:not(.page-last)",
        mangaFromElement: {
          titleSelector: "h3 a, a",
          titleAttr: null,
          urlSelector: "h3 a, a",
          urlAttr: "href",
          thumbnailSelector: "img",
          thumbnailAttr: "src",
        },
        mangaDetails: {
          titleSelector:
            "div.manga-info-top h1, div.manga-info-top h2, div.panel-story-info h1, div.panel-story-info h2",
          authorSelector:
            "li:contains(author) a, td:containsOwn(author) + td a",
          descriptionSelector:
            "div#noidungm, div#panel-story-info-description, div#contentBox",
          genreSelector:
            "div.manga-info-top li:contains(genres) a, td:containsOwn(genres) + td a",
          statusSelector: "li:contains(status), td:containsOwn(status) + td",
          thumbnailSelector: "div.manga-info-pic img, span.info-image img",
          thumbnailAttr: "src",
        },
        chapterListSelector:
          "ul.row-content-chapter li, div.chapter-list .row, .panel-story-chapter-list li",
        chapterFromElement: {
          urlSelector: "a",
          urlAttr: "href",
          nameSelector: "a",
          dateSelector: "span",
        },
        pageListSelector: ".container-chapter-reader img, .reading-detail img",
        pageImageAttr: "src",
      };

    case "grouple":
      return {
        searchMangaSelector: "div.tile",
        searchMangaNextPageSelector: "a.nextLink",
        mangaFromElement: {
          titleSelector: "h3 > a",
          titleAttr: "title",
          urlSelector: "h3 > a",
          urlAttr: "href",
          thumbnailSelector: "img.lazy, img",
          thumbnailAttr: "data-original",
        },
        mangaDetails: {
          titleSelector: ".cr-hero-names__main, meta[itemprop=name]",
          authorSelector:
            ".cr-main-person-item__name a, .cr-main-person-item__name",
          descriptionSelector: ".cr-description, .text-content, .cr-info",
          genreSelector: ".cr-hero-short-details a, .cr-info-details a",
          statusSelector:
            ".cr-info-details-item__title:contains(Release) + .cr-info-details-item__status",
          thumbnailSelector: '.cr-hero-cover img, meta[property="og:image"]',
          thumbnailAttr: "data-original",
        },
        chapterListSelector: "tr.item-row:has(td > a)",
        chapterFromElement: {
          urlSelector: "a.chapter-link, td > a",
          urlAttr: "href",
          nameSelector: "a.chapter-link, td.item-title",
          dateSelector: "td.d-none, td.date",
        },
        pageListSelector:
          ".reader-container img, .chapter-reader img, .page img",
        pageImageAttr: "data-src",
      };

    case "masonry":
      return {
        searchMangaSelector: ".list-gallery:not(.static) figure",
        searchMangaNextPageSelector:
          ".pagination-a li.next, .pagination-a a.next",
        mangaFromElement: {
          titleSelector: "a",
          titleAttr: "title",
          urlSelector: "a",
          urlAttr: "href",
          thumbnailSelector: "img",
          thumbnailAttr: "srcset",
        },
        mangaDetails: {
          titleSelector: "h1, .gallery-title",
          authorSelector:
            'p.link-btn a[href*="/model/"], p.link-btn a:first-child',
          descriptionSelector: "#content > p",
          genreSelector: 'p.link-btn a[href*="/tag/"]',
          statusSelector: null,
          thumbnailSelector: '.list-gallery img, meta[property="og:image"]',
          thumbnailAttr: "srcset",
        },
        chapterListSelector: null,
        chapterFromElement: {
          urlSelector: null,
          urlAttr: "href",
          nameSelector: null,
          dateSelector: null,
        },
        pageListSelector: '.list-gallery a[href^="https://cdn."]',
        pageImageAttr: "href",
        _singleChapter: true,
      };

    default:
      return null;
  }
}

function mergeWithDefaults(parsed) {
  const defaults = getMultisrcDefaults(parsed.multisrc);
  if (!defaults) return parsed;

  const merged = { ...parsed };

  for (const key of [
    "searchMangaSelector",
    "searchMangaNextPageSelector",
    "chapterListSelector",
    "pageListSelector",
    "pageImageAttr",
  ]) {
    if (!merged[key] && defaults[key]) merged[key] = defaults[key];
  }

  for (const key of [
    "mangaFromElement",
    "mangaDetails",
    "chapterFromElement",
  ]) {
    if (defaults[key]) {
      merged[key] = {
        ...defaults[key],
        ...Object.fromEntries(
          Object.entries(merged[key] || {}).filter(([, v]) => v != null),
        ),
      };
    }
  }

  if (defaults._chapImagesPattern) merged._chapImagesPattern = true;
  if (defaults._singleChapter) merged._singleChapter = true;

  return merged;
}

export {
  detectMultisrc,
  extractMultisrcMetadata,
  getMultisrcDefaults,
  mergeWithDefaults,
};
