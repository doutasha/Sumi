import {
  findCalls,
  firstBlockContent,
  functionSource,
  readFirstStringLiteral,
  readStringLiterals,
} from "./ast.js";

function extractOverrideStringProperty(ast, propName) {
  return ast.getOverrideProperty(propName)?.stringValue ?? null;
}

function extractSelector(ast, fnName, seen = new Set()) {
  if (seen.has(fnName)) return null;
  seen.add(fnName);

  const fn = ast.getFunction(fnName);
  if (!fn) return null;

  const expressionString = fn.expression
    ? readFirstStringLiteral(fn.expression)
    : null;
  if (expressionString && fn.expression.trim().startsWith('"')) {
    return expressionString;
  }

  const delegate = fn.expression
    ?.trim()
    .match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\s*\)$/);
  if (delegate) return extractSelector(ast, delegate[1], seen);

  const selectorCall = findCalls(functionSource(fn), ["select", "selectFirst"])[0];
  return selectorCall?.args[0]?.stringValue ?? null;
}

function extractFunctionBody(ast, fnName) {
  const fn = ast.getFunction(fnName);
  if (!fn) return null;
  if (fn.body != null) return fn.body;
  return fn.expression ? firstBlockContent(fn.expression) : null;
}

function extractFunctionSource(ast, fnName) {
  return functionSource(ast.getFunction(fnName));
}

function extractAllSelectors(ast, fnName) {
  const source = extractFunctionBody(ast, fnName);
  if (!source) return [];

  return findCalls(source, ["select", "selectFirst"])
    .map((call) => call.args[0]?.stringValue)
    .filter(Boolean);
}

function extractDocumentSelect(ast, fnName) {
  const source = extractFunctionBody(ast, fnName);
  if (!source) return null;

  const call = findCalls(source, ["select"])
    .find((item) => item.callee === "document.select");
  return call?.args[0]?.stringValue ?? null;
}

function extractDocumentSelectFirst(ast, fnName) {
  const source = extractFunctionBody(ast, fnName);
  if (!source) return null;

  const call = findCalls(source, ["selectFirst"])
    .find((item) => item.callee === "document.selectFirst");
  return call?.args[0]?.stringValue ?? null;
}

function normalizeRequestPath(value) {
  if (!value) return null;

  let path = value
    .replace(/\$\{?\s*baseUrl\s*\}?/g, "")
    .replace(/\$\{\s*page\s*\}/g, "{{PAGE}}")
    .replace(/\$page\b/g, "{{PAGE}}")
    .replace(/\$\{\s*query(?:\.[^}]*)?\s*\}/g, "{{QUERY}}")
    .replace(/\$query\b/g, "{{QUERY}}")
    .trim();

  if (!path) return "/";
  if (!path.startsWith("/") && !path.startsWith("?")) path = `/${path}`;
  return path;
}

function normalizeQueryValue(valueCode) {
  const value = valueCode.trim();
  const literal = value.match(/^"([^"]*)"$/);
  if (literal) return encodeURIComponent(literal[1]);
  if (/\bpage\b/.test(value)) return "{{PAGE}}";
  if (/\bquery\b/.test(value)) return "{{QUERY}}";
  return null;
}

function appendQueryParameters(path, source) {
  const params = [];

  for (const call of findCalls(source, ["addQueryParameter"])) {
    const key = call.args[0]?.stringValue;
    const rawValue = call.args[1]?.raw;
    if (!key || !rawValue) continue;

    const value = normalizeQueryValue(rawValue);
    if (value) params.push(`${encodeURIComponent(key)}=${value}`);
  }

  if (params.length === 0) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${params.join("&")}`;
}

function extractRequestPath(ast, fnName) {
  const source = extractFunctionSource(ast, fnName);
  if (!source) return null;

  const directGet = findCalls(source, ["GET"])
    .find((call) => call.args[0]?.stringValue?.includes("baseUrl"));
  if (directGet) return normalizeRequestPath(directGet.args[0].stringValue);

  const toHttpUrl = readStringLiterals(source)
    .find((string) => (
      string.value.includes("baseUrl") &&
      source.slice(string.end, string.end + 24).includes(".toHttpUrl")
    ));
  if (toHttpUrl) {
    return appendQueryParameters(normalizeRequestPath(toHttpUrl.value), source);
  }

  const assignedUrl = source.match(
    /(?:val|var)\s+\w+\s*=\s*"([^"]*\$baseUrl[^"]*)"/,
  );
  if (assignedUrl) return normalizeRequestPath(assignedUrl[1]);

  return null;
}

function absoluteUrlFromPath(baseUrl, path) {
  if (!baseUrl || !path) return null;
  try {
    return new URL(
      path,
      baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
    ).toString();
  } catch {
    return null;
  }
}

function extractAttr(ast, fnName) {
  const source = extractFunctionBody(ast, fnName);
  if (!source) return [];

  return findCalls(source, ["attr"])
    .map((call) => call.args[0]?.stringValue)
    .filter(Boolean);
}

function extractHeaderOverrides(ast) {
  const allowed = new Set(["Accept", "Accept-Language", "X-Requested-With"]);
  const headers = {};

  for (const call of findCalls(ast.code, ["add"])) {
    const key = call.args[0]?.stringValue;
    const value = call.args[1]?.stringValue;
    if (key && value && allowed.has(key)) headers[key] = value;
    if (key === "X-Requested-With" && call.args[1]?.raw === "randomValue") {
      headers[key] = "org.chromium.chrome";
    }
  }

  return Object.keys(headers).length > 0 ? headers : null;
}

function extractReferer(ast, baseUrl) {
  const referer = findCalls(ast.code, ["add"])
    .find((call) => call.args[0]?.stringValue === "Referer");
  const value = referer?.args[1]?.stringValue;
  if (value) return value.replace(/\$\{?baseUrl\}?/g, baseUrl);

  return ast.code.includes("headersBuilder") ? `${baseUrl}/` : null;
}

function extractSearchUrlFallback(ast, baseUrl) {
  const hasDefaultSearch = ast.strings.some((string) => (
    string.value === "$baseUrl/search" ||
    string.value === "${baseUrl}/search"
  ));
  if (hasDefaultSearch) return `${baseUrl}/search`;

  const searchReq = extractFunctionBody(ast, "searchMangaRequest");
  if (!searchReq) return null;

  const pathString = readStringLiterals(searchReq)
    .find((string) => string.value.startsWith("$baseUrl/"));
  return pathString
    ? `${baseUrl}/${pathString.value.replace(/^\$baseUrl\//, "")}`
    : null;
}

export {
  absoluteUrlFromPath,
  extractAllSelectors,
  extractAttr,
  extractDocumentSelect,
  extractDocumentSelectFirst,
  extractFunctionBody,
  extractFunctionSource,
  extractHeaderOverrides,
  extractOverrideStringProperty,
  extractReferer,
  extractRequestPath,
  extractSearchUrlFallback,
  extractSelector,
};
