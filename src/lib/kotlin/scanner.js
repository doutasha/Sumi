function isIdentifierStart(char) {
  return /[A-Za-z_$]/.test(char ?? "");
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char ?? "");
}

function startsWithAt(source, index, value) {
  return source.slice(index, index + value.length) === value;
}

function matchesKeyword(source, index, keyword) {
  return (
    startsWithAt(source, index, keyword) &&
    !isIdentifierPart(source[index - 1]) &&
    !isIdentifierPart(source[index + keyword.length])
  );
}

function skipWhitespace(source, index) {
  let i = index;
  while (i < source.length && /\s/.test(source[i])) i++;
  return i;
}

function skipLineComment(source, index) {
  const next = source.indexOf("\n", index + 2);
  return next === -1 ? source.length : next + 1;
}

function skipBlockComment(source, index) {
  let i = index + 2;
  let depth = 1;

  while (i < source.length && depth > 0) {
    if (startsWithAt(source, i, "/*")) {
      depth++;
      i += 2;
    } else if (startsWithAt(source, i, "*/")) {
      depth--;
      i += 2;
    } else {
      i++;
    }
  }

  return i;
}

function readStringAt(source, index) {
  if (source[index] !== '"') return null;

  if (startsWithAt(source, index, '"""')) {
    const end = source.indexOf('"""', index + 3);
    const close = end === -1 ? source.length : end;
    return {
      type: "StringLiteral",
      value: source.slice(index + 3, close),
      raw: source.slice(index, end === -1 ? source.length : end + 3),
      start: index,
      end: end === -1 ? source.length : end + 3,
    };
  }

  let i = index + 1;
  let value = "";

  while (i < source.length) {
    const char = source[i];
    if (char === "\\") {
      const next = source[i + 1];
      value += next ?? "";
      i += 2;
      continue;
    }
    if (char === '"') {
      return {
        type: "StringLiteral",
        value,
        raw: source.slice(index, i + 1),
        start: index,
        end: i + 1,
      };
    }
    value += char;
    i++;
  }

  return {
    type: "StringLiteral",
    value,
    raw: source.slice(index),
    start: index,
    end: source.length,
  };
}

function skipIgnored(source, index) {
  if (startsWithAt(source, index, "//")) return skipLineComment(source, index);
  if (startsWithAt(source, index, "/*")) return skipBlockComment(source, index);

  const string = readStringAt(source, index);
  if (string) return string.end;

  return index;
}

function readIdentifier(source, index) {
  if (!isIdentifierStart(source[index])) return null;

  let i = index + 1;
  while (i < source.length && isIdentifierPart(source[i])) i++;
  return { value: source.slice(index, i), start: index, end: i };
}

function readIdentifierChain(source, index) {
  const first = readIdentifier(source, index);
  if (!first) return null;

  const parts = [first.value];
  let i = first.end;

  while (source[i] === "." && isIdentifierStart(source[i + 1])) {
    const part = readIdentifier(source, i + 1);
    parts.push(part.value);
    i = part.end;
  }

  return { value: parts.join("."), parts, start: index, end: i };
}

function findMatching(source, openIndex, openChar, closeChar) {
  let depth = 1;
  let i = openIndex + 1;

  while (i < source.length && depth > 0) {
    const skipped = skipIgnored(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    if (source[i] === openChar) depth++;
    else if (source[i] === closeChar) depth--;
    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

function splitTopLevel(source, delimiter = ",") {
  const parts = [];
  let start = 0;
  let i = 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;

  while (i < source.length) {
    const skipped = skipIgnored(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const char = source[i];
    if (char === "(") paren++;
    else if (char === ")") paren--;
    else if (char === "[") bracket++;
    else if (char === "]") bracket--;
    else if (char === "{") brace++;
    else if (char === "}") brace--;
    else if (
      char === delimiter &&
      paren === 0 &&
      bracket === 0 &&
      brace === 0
    ) {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }

    i++;
  }

  const finalPart = source.slice(start).trim();
  if (finalPart) parts.push(finalPart);
  return parts;
}

function readStringLiterals(source) {
  const strings = [];

  for (let i = 0; i < source.length;) {
    if (startsWithAt(source, i, "//")) {
      i = skipLineComment(source, i);
      continue;
    }
    if (startsWithAt(source, i, "/*")) {
      i = skipBlockComment(source, i);
      continue;
    }

    const string = readStringAt(source, i);
    if (string) {
      strings.push(string);
      i = string.end;
      continue;
    }

    i++;
  }

  return strings;
}

function readFirstStringLiteral(source) {
  return readStringLiterals(source)[0]?.value ?? null;
}

function parseTopLevelArgs(source) {
  return splitTopLevel(source).map((raw) => ({
    type: "Argument",
    raw,
    stringValue: readFirstStringLiteral(raw),
    strings: readStringLiterals(raw).map((string) => string.value),
  }));
}

export {
  findMatching,
  isIdentifierStart,
  matchesKeyword,
  parseTopLevelArgs,
  readFirstStringLiteral,
  readIdentifier,
  readIdentifierChain,
  readStringLiterals,
  skipIgnored,
  skipWhitespace,
};
