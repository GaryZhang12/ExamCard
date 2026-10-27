#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/*
 * ExamCard public build staging.
 * Builds a clean public staging tree for ExamCard 1.0.0.
 * This does NOT push, publish, or create a GitHub Release.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, '.public-build');
const nodeModules = path.join(root, 'node_modules');
const dirMode = process.argv.includes('--dir');

function copy(src, dst, filter) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (filter && !filter(src, name)) continue;
      copy(path.join(src, name), path.join(dst, name), filter);
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

for (const f of ['electron-main.js', 'preload.js', 'desktop-enhance.js', 'icon.ico', 'icon.png', 'README.md', 'LICENSE', 'NOTICE', 'SECURITY.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', 'OPEN_SOURCE_AUDIT.md', 'DAILY_PLAN_SCHEMA.md', 'DAILY_PLAN_CHATGPT_PROMPT.md']) {
  if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(staging, f));
}
copy(path.join(root, 'app'), path.join(staging, 'app'));
for (const f of ['schemas','templates','licenses']) { if (fs.existsSync(path.join(root,f))) copy(path.join(root,f), path.join(staging,f)); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
pkg.name = 'examcard-public-staging';
pkg.private = true;
pkg.license = 'Apache-2.0';
pkg.packageManager = 'pnpm@10.0.0';
pkg.build = pkg.build || {};
pkg.build.appId = 'com.gary.gdexam.public';
pkg.build.productName = 'ExamCard';
pkg.build.directories = { buildResources: '.', output: 'dist-public' };
pkg.build.files = ['electron-main.js', 'preload.js', 'desktop-enhance.js', 'app/**', 'icon.ico', 'package.json', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'licenses/**'];
pkg.build.publish = null;
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(pkg, null, 2));
if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) fs.copyFileSync(path.join(root, 'pnpm-lock.yaml'), path.join(staging, 'pnpm-lock.yaml'));

if (!fs.existsSync(nodeModules)) throw new Error('node_modules 不存在，请先 pnpm install');
const link = path.join(staging, 'node_modules');
try { fs.symlinkSync(nodeModules, link, 'junction'); } catch (e) { copy(nodeModules, link); }

const builder = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const args = [builder, '--win', ...(dirMode ? ['dir'] : ['portable'])];
const r = spawnSync(process.execPath, args, {
  cwd: staging,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { CSC_IDENTITY_AUTO_DISCOVERY: 'false', PATH: path.dirname(process.execPath) + ';' + path.join(root, '..', 'v3_bin') + ';' + process.env.PATH })
});
if (r.status !== 0) process.exit(r.status || 1);
console.log('Public staging build complete:', path.join(staging, 'dist-public'));
