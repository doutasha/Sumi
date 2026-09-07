import {
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
} from "./scanner.js";

const DECLARATION_MODIFIERS = new Set([
  "actual",
  "abstract",
  "final",
  "internal",
  "open",
  "override",
  "private",
  "protected",
  "public",
]);

function normalizeKotlinStringValue(value) {
  return value?.replace(/\$\{?\s*baseUrl\s*\}?/g, "{{BASE_URL}}") ?? null;
}

function declarationPrefix(source, keywordIndex) {
  const lineStart = Math.max(
    source.lastIndexOf("\n", keywordIndex - 1),
    source.lastIndexOf(";", keywordIndex - 1),
    source.lastIndexOf("{", keywordIndex - 1),
  ) + 1;
  return source.slice(lineStart, keywordIndex).trim();
}

function readModifiers(source, keywordIndex) {
  return declarationPrefix(source, keywordIndex)
    .split(/\s+/)
    .filter((part) => DECLARATION_MODIFIERS.has(part));
}

function findDeclarationEnd(source, start) {
  let i = start;
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
    else if (char === "}") {
      if (brace === 0 && paren === 0 && bracket === 0) return i;
      brace--;
    } else if (
      (char === "\n" || char === ";") &&
      paren === 0 &&
      bracket === 0 &&
      brace === 0
    ) {
      return i;
    }

    i++;
  }

  return source.length;
}

function readExpression(source, start) {
  const expressionStart = skipWhitespace(source, start);
  const end = findDeclarationEnd(source, expressionStart);
  return {
    raw: source.slice(expressionStart, end).trim(),
    start: expressionStart,
    end,
  };
}

function skipReturnType(source, start) {
  let i = start;
  let paren = 0;
  let bracket = 0;
  let angle = 0;

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
    else if (char === "<") angle++;
    else if (char === ">" && angle > 0) angle--;
    else if (
      (char === "=" || char === "{") &&
      paren === 0 &&
      bracket === 0 &&
      angle === 0
    ) {
      return i;
    }
    i++;
  }

  return i;
}

function findFunctionParameterStart(source, start) {
  let i = start;
  let angle = 0;

  while (i < source.length) {
    const skipped = skipIgnored(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const char = source[i];
    if (char === "<") angle++;
    else if (char === ">" && angle > 0) angle--;
    else if (char === "(" && angle === 0) return i;
    else if (char === "\n" || char === "{") return -1;
    i++;
  }

  return -1;
}

function parseFunctions(source) {
  const functions = [];

  for (let i = 0; i < source.length;) {
    const skipped = skipIgnored(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    if (!matchesKeyword(source, i, "fun")) {
      i++;
      continue;
    }

    const modifiers = readModifiers(source, i);
    let cursor = skipWhitespace(source, i + 3);
    if (source[cursor] === "<") {
      const closeTypeParams = findMatching(source, cursor, "<", ">");
      cursor = closeTypeParams === -1
        ? cursor
        : skipWhitespace(source, closeTypeParams + 1);
    }

    const paramsStart = findFunctionParameterStart(source, cursor);
    if (paramsStart === -1) {
      i += 3;
      continue;
    }

    const signatureTarget = source.slice(cursor, paramsStart).trim();
    const signatureNames = [
      ...signatureTarget.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g),
    ];
    const name = signatureNames.at(-1)?.[0];
    if (!name) {
      i = paramsStart + 1;
      continue;
    }

    const paramsEnd = findMatching(source, paramsStart, "(", ")");
    if (paramsEnd === -1) {
      i = paramsStart + 1;
      continue;
    }

    let afterSignature = skipWhitespace(source, paramsEnd + 1);
    if (source[afterSignature] === ":") {
      afterSignature = skipWhitespace(
        source,
        skipReturnType(source, afterSignature + 1),
      );
    }

    const node = {
      type: "FunctionDeclaration",
      name,
      modifiers,
      signature: source.slice(i, afterSignature),
      params: source.slice(paramsStart + 1, paramsEnd),
      body: null,
      expression: null,
      raw: "",
      start: i,
      end: afterSignature,
    };

    if (source[afterSignature] === "{") {
      const bodyEnd = findMatching(source, afterSignature, "{", "}");
      if (bodyEnd === -1) {
        i = afterSignature + 1;
        continue;
      }
      node.body = source.slice(afterSignature + 1, bodyEnd);
      node.raw = source.slice(i, bodyEnd + 1);
      node.end = bodyEnd + 1;
      functions.push(node);
      i = node.end;
      continue;
    }

    if (source[afterSignature] === "=") {
      const expression = readExpression(source, afterSignature + 1);
      node.expression = expression.raw;
      node.raw = source.slice(i, expression.end);
      node.end = expression.end;
      functions.push(node);
      i = node.end;
      continue;
    }

    functions.push(node);
    i = afterSignature + 1;
  }

  return functions;
}

function parseProperties(source) {
  const properties = [];

  for (let i = 0; i < source.length;) {
    const skipped = skipIgnored(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const keyword = matchesKeyword(source, i, "val")
      ? "val"
      : matchesKeyword(source, i, "var")
        ? "var"
        : null;
    if (!keyword) {
      i++;
      continue;
    }

    const modifiers = readModifiers(source, i);
    let cursor = skipWhitespace(source, i + keyword.length);
    const name = readIdentifier(source, cursor);
    if (!name) {
      i += keyword.length;
      continue;
    }

    cursor = skipWhitespace(source, name.end);
    while (
      cursor < source.length &&
      source[cursor] !== "=" &&
      source[cursor] !== "\n" &&
      source[cursor] !== ";"
    ) {
      const skippedInner = skipIgnored(source, cursor);
      if (skippedInner !== cursor) {
        cursor = skippedInner;
        continue;
      }
      cursor++;
    }

    if (source[cursor] !== "=") {
      i = cursor + 1;
      continue;
    }

    const expression = readExpression(source, cursor + 1);
    properties.push({
      type: "PropertyDeclaration",
      kind: keyword,
      name: name.value,
      modifiers,
      expression: expression.raw,
      stringValue: normalizeKotlinStringValue(readFirstStringLiteral(expression.raw)),
      raw: source.slice(i, expression.end),
      start: i,
      end: expression.end,
    });
    i = expression.end;
  }

  return properties;
}

function findClassHeaderEnd(source, start) {
  let i = start;
  let paren = 0;
  let bracket = 0;

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
    else if (char === "{" && paren === 0 && bracket === 0) return i;
    else if (char === ";" && paren === 0 && bracket === 0) return i;
    i++;
  }

  return source.length;
}

function findTopLevelColon(source) {
  let paren = 0;
  let bracket = 0;
  let brace = 0;

  for (let i = 0; i < source.length;) {
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
    else if (char === ":" && paren === 0 && bracket === 0 && brace === 0) {
      return i;
    }
    i++;
  }

  return -1;
}

function parseSuperCall(header) {
  const colonIndex = findTopLevelColon(header);
  if (colonIndex === -1) return null;

  const expression = header.slice(colonIndex + 1).trim();
  const name = readIdentifierChain(expression, 0);
  if (!name) return null;

  const argsStart = skipWhitespace(expression, name.end);
  if (expression[argsStart] !== "(") {
    return {
      type: "SuperType",
      name: name.parts.at(-1),
      qualifiedName: name.value,
      args: [],
      raw: expression,
    };
  }

  const argsEnd = findMatching(expression, argsStart, "(", ")");
  return {
    type: "SuperCall",
    name: name.parts.at(-1),
    qualifiedName: name.value,
    args: argsEnd === -1
      ? []
      : parseTopLevelArgs(expression.slice(argsStart + 1, argsEnd)),
    raw: expression,
  };
}

function parseClasses(source) {
  const classes = [];

  for (let i = 0; i < source.length;) {
    const skipped = skipIgnored(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    if (!matchesKeyword(source, i, "class")) {
      i++;
      continue;
    }

    const modifiers = readModifiers(source, i);
    let cursor = skipWhitespace(source, i + 5);
    const name = readIdentifier(source, cursor);
    if (!name) {
      i += 5;
      continue;
    }

    const headerEnd = findClassHeaderEnd(source, name.end);
    const bodyStart = source[headerEnd] === "{" ? headerEnd : -1;
    const bodyEnd = bodyStart === -1
      ? -1
      : findMatching(source, bodyStart, "{", "}");
    const end = bodyEnd === -1 ? headerEnd : bodyEnd + 1;
    const header = source.slice(i, bodyStart === -1 ? headerEnd : bodyStart);

    classes.push({
      type: "ClassDeclaration",
      name: name.value,
      modifiers,
      header,
      superCall: parseSuperCall(header),
      body: bodyStart === -1 || bodyEnd === -1
        ? null
        : source.slice(bodyStart + 1, bodyEnd),
      raw: source.slice(i, end),
      start: i,
      end,
    });
    i = end;
  }

  return classes;
}

function firstBlockContent(source) {
  for (let i = 0; i < source.length;) {
    const skipped = skipIgnored(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    if (source[i] === "{") {
      const end = findMatching(source, i, "{", "}");
      return end === -1 ? null : source.slice(i + 1, end);
    }
    i++;
  }

  return null;
}

function functionSource(fn) {
  return fn?.body ?? fn?.expression ?? "";
}

function findCalls(source, names = null) {
  const allowed = names ? new Set(names) : null;
  const calls = [];

  for (let i = 0; i < source.length;) {
    const skipped = skipIgnored(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const startsWithDot = source[i] === "." && isIdentifierStart(source[i + 1]);
    const chain = startsWithDot
      ? readIdentifierChain(source, i + 1)
      : readIdentifierChain(source, i);

    if (!chain) {
      i++;
      continue;
    }

    let cursor = skipWhitespace(source, chain.end);
    if (source[cursor] === "<") {
      const typeArgEnd = findMatching(source, cursor, "<", ">");
      if (typeArgEnd !== -1) cursor = skipWhitespace(source, typeArgEnd + 1);
    }

    if (source[cursor] !== "(") {
      i = chain.end;
      continue;
    }

    const end = findMatching(source, cursor, "(", ")");
    if (end === -1) {
      i = cursor + 1;
      continue;
    }

    const callee = chain.value;
    const name = chain.parts.at(-1);
    if (!allowed || allowed.has(name)) {
      calls.push({
        type: "CallExpression",
        name,
        callee,
        receiver: chain.parts.length > 1
          ? chain.parts.slice(0, -1).join(".")
          : null,
        args: parseTopLevelArgs(source.slice(cursor + 1, end)),
        raw: source.slice(startsWithDot ? i : chain.start, end + 1),
        start: startsWithDot ? i : chain.start,
        end: end + 1,
      });
    }

    i = end + 1;
  }

  return calls;
}

function parseKotlinAst(code) {
  const functions = parseFunctions(code);
  const properties = parseProperties(code);
  const classes = parseClasses(code);
  const strings = readStringLiterals(code);

  return {
    type: "KotlinFile",
    code,
    classes,
    functions,
    properties,
    strings,
    getFunction(name) {
      return functions.find((fn) => fn.name === name) ?? null;
    },
    getOverrideProperty(name) {
      return properties.find((prop) => (
        prop.name === name &&
        prop.modifiers.includes("override") &&
        prop.stringValue
      )) ?? null;
    },
  };
}

export {
  findCalls,
  firstBlockContent,
  functionSource,
  parseKotlinAst,
  readFirstStringLiteral,
  readStringLiterals,
};
