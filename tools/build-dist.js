#!/usr/bin/env node
/* 사이트로 내보낼 파일만 dist/ 에 모은다 (2026-11-16 — GitHub Pages → Cloudflare Workers 정적 파일로 옮기는 준비).
 *
 * GitHub Pages(Jekyll)는 _config.yml 의 exclude 와 Jekyll 기본 규칙(점 · 밑줄 · # · ~ 로 시작하는 이름은 빼기)으로
 * README · 생성기(tools) · 결제 서버(worker) · 원고(content) · 미리보기(preview)를 사이트에서 뺀다.
 * Cloudflare 는 폴더를 그대로 올리므로, 같은 규칙으로 dist/ 를 만들어 그것만 올린다(site-worker/wrangler.jsonc 의 assets.directory).
 * 빠뜨리면 내부 파일이 사이트로 공개되므로 exclude 를 고칠 때는 _config.yml 과 함께 고친다.
 *
 * 끝에 site-worker/_headers 를 dist/_headers 로 넣고, Cloudflare 무료 한도(파일 2만 개 · 한 파일 25MiB)를 넘으면 멈춘다.
 *   node tools/build-dist.js            # dist/ 를 새로 만든다
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// 맨 위에서 뺄 것: _config.yml exclude(CNAME · content · README.md · tools · worker · preview) + 배포 도구 · 저장소 파일
const TOP_EXCLUDE = new Set([
    'CNAME', 'content', 'README.md', 'tools', 'worker', 'preview', 'docs', 'CLAUDE.md',
    'dist', 'site-worker', 'node_modules', 'package.json', 'package-lock.json',
]);
// 아래쪽에서 뺄 것(경로 그대로): _config.yml exclude 의 ads/README.md
const PATH_EXCLUDE = new Set(['ads/README.md']);
// Jekyll 이 기본으로 빼는 이름: 점 · 밑줄 · # · ~ 로 시작(.git · .github · _config.yml …)
const hidden = name => /^[._#~]/.test(name);

const MAX_FILES = 20000, MAX_BYTES = 25 * 1024 * 1024;

function copyTree(rel) {
    let n = 0;
    for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const r = rel ? rel + '/' + ent.name : ent.name;
        if (hidden(ent.name) || (!rel && TOP_EXCLUDE.has(ent.name)) || PATH_EXCLUDE.has(r)) continue;
        if (ent.isDirectory()) { n += copyTree(r); continue; }
        if (!ent.isFile()) continue;
        const src = path.join(ROOT, r), size = fs.statSync(src).size;
        if (size > MAX_BYTES) throw new Error(`${r}: ${size} 바이트 — Cloudflare 한 파일 한도(25MiB)를 넘는다`);
        fs.mkdirSync(path.dirname(path.join(OUT, r)), { recursive: true });
        fs.copyFileSync(src, path.join(OUT, r));
        n++;
    }
    return n;
}

function run() {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT);
    const n = copyTree('');
    if (n > MAX_FILES) throw new Error(`파일 ${n}개 — Cloudflare 무료 한도(2만 개)를 넘는다`);
    for (const must of ['index.html', '404.html', 'sitemap.xml', 'robots.txt']) {
        if (!fs.existsSync(path.join(OUT, must))) throw new Error(`dist/${must} 가 없다`);
    }
    fs.copyFileSync(path.join(ROOT, 'site-worker', '_headers'), path.join(OUT, '_headers'));
    console.log(`dist/: 파일 ${n}개 (+ _headers)`);
}

if (require.main === module) {
    try { run(); } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { run, TOP_EXCLUDE, PATH_EXCLUDE };
