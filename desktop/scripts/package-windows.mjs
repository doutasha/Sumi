#!/usr/bin/env node
/**
 * Copia os artefatos Windows prontos (exe + instaladores) de
 * desktop/src-tauri/target/release/ para build/windows/.
 *
 * Uso: npm run package:windows  (= tauri:build + esta copia)
 * Depois disso, `cargo clean` pode apagar o target/ sem medo:
 * o que importa fica preservado em build/ (ignorado pelo git).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const release = path.join(root, 'desktop', 'src-tauri', 'target', 'release');
const outDir = path.join(root, 'build', 'windows');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version ?? '0.0.0';

const files = [
  'sumi.exe',
  path.join('bundle', 'nsis', `Sumi_${version}_x64-setup.exe`),
  path.join('bundle', 'msi', `Sumi_${version}_x64_en-US.msi`),
];

fs.mkdirSync(outDir, { recursive: true });

let missing = 0;
for (const rel of files) {
  const src = path.join(release, rel);
  const dest = path.join(outDir, path.basename(rel));
  if (!fs.existsSync(src)) {
    console.error(`[package:windows] ausente: ${src} (rode o build antes)`);
    missing++;
    continue;
  }
  fs.copyFileSync(src, dest);
  const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
  console.log(`[package:windows] ${path.basename(rel)} -> build/windows/ (${mb} MB)`);
}

if (missing > 0) process.exit(1);
console.log('[package:windows] ok — pode rodar `cargo clean` sem perder o exe.');
