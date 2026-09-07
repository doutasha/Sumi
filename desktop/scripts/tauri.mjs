#!/usr/bin/env node
/**
 * Wrapper do Tauri CLI que garante o `cargo` no PATH antes de rodar.
 *
 * Por que existe: no Windows, terminais/IDEs abertos ANTES da instalacao do
 * Rust nao herdam o `%USERPROFILE%\.cargo\bin` no PATH, e o Tauri CLI falha
 * com "failed to run 'cargo metadata' ... program not found". Este script
 * adiciona os locais padrao do cargo ao PATH em tempo de execucao, entao
 * `npm run tauri:dev` funciona mesmo nesses terminais "velhos".
 *
 * Uso (via package.json): node desktop/scripts/tauri.mjs dev|build [...]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const candidates = [];
if (process.env.CARGO_HOME) candidates.push(path.join(process.env.CARGO_HOME, 'bin'));
if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, '.cargo', 'bin'));
const home = process.env.HOME || os.homedir();
if (home) candidates.push(path.join(home, '.cargo', 'bin'));
candidates.push('/usr/local/cargo/bin');

const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
const parts = String(process.env[pathKey] || '')
  .split(path.delimiter)
  .filter(Boolean);
for (const dir of candidates) {
  try {
    if (
      fs.existsSync(dir) &&
      !parts.some((p) => p.toLowerCase() === dir.toLowerCase())
    ) {
      parts.unshift(dir);
    }
  } catch {
    // ignora entradas problematicas e segue
  }
}
process.env[pathKey] = parts.join(path.delimiter);

// Roda o Tauri CLI a partir de desktop/ para ele encontrar src-tauri/.
// O binario local (@tauri-apps/cli) e resolvido por caminho absoluto para
// nao depender do PATH — so cai para `tauri` global se o local nao existir.
const desktopDir = new URL('..', import.meta.url);
const localCli = new URL('../node_modules/@tauri-apps/cli/tauri.js', desktopDir);
const args = process.argv.slice(2);
if (args.length === 0) args.push('--help');

let res;
if (fs.existsSync(localCli)) {
  res = spawnSync(process.execPath, [fileURLToPath(localCli), ...args], {
    stdio: 'inherit',
    cwd: desktopDir,
    env: process.env,
  });
} else {
  res = spawnSync('tauri', args, {
    stdio: 'inherit',
    cwd: desktopDir,
    shell: process.platform === 'win32',
    env: process.env,
  });
}

process.exit(res.status ?? 1);
