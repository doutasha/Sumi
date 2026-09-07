/**
 * tachibk.js — lê backup `.tachibk` / `.proto.gz` do Mihon (Fase 6).
 *
 * Formato: protobuf (kotlinx.serialization, proto2 — ver .proto
 * reconstruído em galpt/mk-bkconv `proto/mihon/backup.proto`), em geral
 * com gzip por fora (magic 1F 8B). Zero dependências: varint/wire
 * implementados à mão + `DecompressionStream` nativo.
 *
 * IDs int64 (ex.: source) viram **string** — passam de 2^53 (ex.:
 * 7537715367149829912), então number corromperia o match com as fontes.
 */

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** Descomprime se for gzip; senão devolve os bytes como estão. */
async function maybeGunzip(bytes) {
  if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Backup com gzip, mas este ambiente não tem DecompressionStream');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

function readVarint(u8, pos) {
  let result = 0n;
  let shift = 0n;
  let p = pos;
  for (let i = 0; i < 10; i++) {
    if (p >= u8.length) throw new Error('protobuf truncado (varint)');
    const b = BigInt(u8[p++]);
    result |= (b & 0x7fn) << shift;
    if ((b & 0x80n) === 0n) return { value: result, next: p };
    shift += 7n;
  }
  throw new Error('varint longo demais');
}

/**
 * Decodifica uma mensagem: Map<fieldNo, Array<{wire, value}>>.
 * value: BigInt p/ varint e fixed64, number p/ fixed32, Uint8Array p/ LEN.
 */
function decodeFields(u8, start = 0, end = u8.length) {
  const out = new Map();
  let p = start;
  const push = (field, wire, value) => {
    if (!out.has(field)) out.set(field, []);
    out.get(field).push({ wire, value });
  };
  while (p < end) {
    const tag = readVarint(u8, p);
    p = tag.next;
    const field = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (field <= 0) throw new Error('field 0 inválido');
    if (wire === 0) {
      const v = readVarint(u8, p);
      p = v.next;
      push(field, wire, v.value);
    } else if (wire === 1) {
      if (p + 8 > end) throw new Error('protobuf truncado (fixed64)');
      let v = 0n;
      for (let i = 0; i < 8; i++) v |= BigInt(u8[p + i]) << BigInt(8 * i);
      p += 8;
      push(field, wire, v);
    } else if (wire === 2) {
      const len = readVarint(u8, p);
      p = len.next;
      const n = Number(len.value);
      if (p + n > end) throw new Error('protobuf truncado (LEN)');
      push(field, wire, u8.slice(p, p + n));
      p += n;
    } else if (wire === 5) {
      if (p + 4 > end) throw new Error('protobuf truncado (fixed32)');
      const v = u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24);
      p += 4;
      push(field, wire, v >>> 0);
    } else {
      throw new Error(`wire type ${wire} não suportado (field ${field})`);
    }
  }
  return out;
}

const first = (map, field) => map.get(field)?.[0]?.value;
const all = (map, field) => map.get(field)?.map((e) => e.value) ?? [];

function getString(map, field) {
  const v = first(map, field);
  if (!(v instanceof Uint8Array)) return null;
  try {
    return new TextDecoder().decode(v);
  } catch {
    return null;
  }
}

function getBool(map, field) {
  const v = first(map, field);
  return typeof v === 'bigint' ? v !== 0n : null;
}

/** int64 → string decimal (sem perder precisão). Suporta packed e unpacked. */
function getInt64List(map, field) {
  const out = [];
  for (const entry of map.get(field) ?? []) {
    if (typeof entry.value === 'bigint') {
      // int64 negativo (raro aqui) sai em complemento de 2: normaliza.
      out.push((entry.value >= (1n << 63n) ? entry.value - (1n << 64n) : entry.value).toString());
    } else if (entry.value instanceof Uint8Array && entry.wire === 2) {
      // packed: sequência de varints dentro do LEN.
      const inner = entry.value;
      let p = 0;
      while (p < inner.length) {
        const v = readVarint(inner, p);
        p = v.next;
        out.push((v.value >= (1n << 63n) ? v.value - (1n << 64n) : v.value).toString());
      }
    }
  }
  return out;
}

const getInt64 = (map, field) => getInt64List(map, field)[0] ?? null;

function getFloat(map, field) {
  const v = first(map, field);
  if (typeof v !== 'number') return null;
  return new DataView(new Uint8Array([(v) & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]).buffer).getFloat32(0, true);
}

function parseChapter(bytes) {
  const m = decodeFields(bytes);
  return {
    url: getString(m, 1),
    name: getString(m, 2),
    scanlator: getString(m, 3),
    read: getBool(m, 4) === true,
    bookmark: getBool(m, 5) === true,
    lastPageRead: (() => {
      const v = first(m, 6);
      return typeof v === 'bigint' ? Number(v) : 0;
    })(),
    chapterNumber: getFloat(m, 9),
  };
}

function parseManga(bytes) {
  const m = decodeFields(bytes);
  const dateRaw = first(m, 13);
  return {
    source: getInt64(m, 1),
    url: getString(m, 2),
    title: getString(m, 3),
    dateAdded: typeof dateRaw === 'bigint' ? Number(dateRaw) : 0,
    chapters: all(m, 16)
      .filter((b) => b instanceof Uint8Array)
      .map(parseChapter),
    categories: getInt64List(m, 17),
    favorite: getBool(m, 100),
    history: all(m, 104)
      .filter((b) => b instanceof Uint8Array)
      .map((b) => {
        const h = decodeFields(b);
        return { url: getString(h, 1) };
      }),
  };
}

/**
 * @param {ArrayBuffer|Uint8Array} input conteúdo do .tachibk
 * @returns {Promise<{manga: Array, categories: Array<{name,order}>,
 *   sources: Array<{name,sourceId}>, stats: {bytes: number, gzipped: boolean}}>}
 */
export async function parseTachibk(input) {
  const raw = input instanceof Uint8Array ? input : new Uint8Array(input);
  const gzipped = raw.length >= 2 && raw[0] === GZIP_MAGIC_0 && raw[1] === GZIP_MAGIC_1;
  const bytes = await maybeGunzip(raw);
  const root = decodeFields(bytes);
  const manga = all(root, 1)
    .filter((b) => b instanceof Uint8Array)
    .map(parseManga)
    .filter((m) => m.source && m.url);
  const categories = all(root, 2)
    .filter((b) => b instanceof Uint8Array)
    .map((b) => {
      const c = decodeFields(b);
      const orderRaw = first(c, 2);
      const idRaw = first(c, 3);
      return {
        name: getString(c, 1),
        order: typeof orderRaw === 'bigint' ? Number(orderRaw) : 0,
        backendId: typeof idRaw === 'bigint' ? idRaw.toString() : null,
      };
    })
    .filter((c) => c.name);
  const sources = all(root, 101)
    .filter((b) => b instanceof Uint8Array)
    .map((b) => {
      const s = decodeFields(b);
      return { name: getString(s, 1), sourceId: getInt64(s, 2) };
    })
    .filter((s) => s.sourceId);
  return { manga, categories, sources, stats: { bytes: raw.length, gzipped } };
}
