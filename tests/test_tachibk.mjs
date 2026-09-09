// Teste tachibk: monta Backup mínimo na mão (encoder próprio), gz инве e decodifica.
import { gzipSync } from 'node:zlib';

function varint(v) {
  let n = BigInt(v);
  const out = [];
  while (n >= 0x80n) { out.push(Number((n & 0x7fn) | 0x80n)); n >>= 7n; }
  out.push(Number(n));
  return Buffer.from(out);
}
const tag = (f, w) => varint((BigInt(f) << 3n) | BigInt(w));
const str = (f, s) => Buffer.concat([tag(f, 2), varint(Buffer.byteLength(s)), Buffer.from(s)]);
const i64 = (f, v) => Buffer.concat([tag(f, 0), varint(v)]);
const boolean = (f, v) => Buffer.concat([tag(f, 0), Buffer.from([v ? 1 : 0])]);
const msg = (f, b) => Buffer.concat([tag(f, 2), varint(b.length), b]);

const BIG = 7537715367149829912n; // > 2^53: pega corrupção de precisão
const chapter = Buffer.concat([
  str(1, '/manga/x/3.0'), str(2, 'Chapter 3'), boolean(4, true), boolean(5, false), i64(6, 12),
]);
const manga = Buffer.concat([
  i64(1, BIG), str(2, '/manga/x'), str(3, 'X Title'), msg(16, chapter),
  i64(17, 7), boolean(100, true),
]);
const cat = Buffer.concat([str(1, 'Lendo'), i64(2, 1), i64(3, 7)]);
const src = Buffer.concat([str(1, 'Comix'), i64(2, BIG)]);
const backup = Buffer.concat([msg(1, manga), msg(2, cat), msg(101, src)]);
const gz = gzipSync(backup);

const { parseTachibk } = await import('../src/lib/parser/tachibk.js');
const parsed = await parseTachibk(gz);
const m = parsed.manga[0];
const checks = [
  ['manga len', parsed.manga.length === 1],
  ['source BigInt ok', m.source === '7537715367149829912'],
  ['url', m.url === '/manga/x'],
  ['title', m.title === 'X Title'],
  ['favorite', m.favorite === true],
  ['categories', JSON.stringify(m.categories) === '["7"]'],
  ['chapter read', m.chapters[0]?.read === true],
  ['chapter lastPage', m.chapters[0]?.lastPageRead === 12],
  ['cat name', parsed.categories[0]?.name === 'Lendo'],
  ['cat backendId', parsed.categories[0]?.backendId === '7'],
  ['src name', parsed.sources[0]?.name === 'Comix'],
  ['gzipped', parsed.stats.gzipped === true],
];
let fail = 0;
for (const [name, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
