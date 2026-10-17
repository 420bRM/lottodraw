#!/usr/bin/env node
/* 손으로 관리하는 페이지의 css/js 주소 끝에 내용 지문(?v=앞 8자리)을 붙인다 (2026-10-14).
 *
 * GitHub Pages 는 파일을 10분(max-age=600) 동안 브라우저에 쥐어 둔다. 배포 직후 새 index.html 이 옛 js/i18n-dict.js · css/site.css 와
 * 만나면 번역 키("gen.acValN")가 그대로 보이거나 배치가 어긋났다. 파일 내용이 바뀌면 주소도 바뀌게 해 새 파일을 받게 한다.
 *
 * - tools/build-static-stats.js 가 끝에 부른다(따로 `node tools/asset-version.js` 로도 된다).
 * - 생성 페이지(통계 · 회차 · 블로그)는 건드리지 않는다 — 1,300쪽이 css 한 줄 고칠 때마다 바뀌면 여러 작업이 서로 부딪힌다.
 * - 스크립트가 불러오는 파일(i18n.js → account.js → chat.js 등)은 여기서 다루지 않는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html', 'statistics.html',
    'tax.html', 'top-prize.html', 'mypage.html', 'ranking.html', 'admin.html', 'data.html'];
const REF = /((?:src|href)=")((?:js|css)\/[\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]*)?(")/g;

function run() {
    const memo = new Map();
    const stamp = rel => {
        if (!memo.has(rel)) {
            const file = path.join(ROOT, rel);
            memo.set(rel, fs.existsSync(file) ? crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8) : null);
        }
        return memo.get(rel);
    };
    let pages = 0;
    for (const page of PAGES) {
        const file = path.join(ROOT, page);
        if (!fs.existsSync(file)) continue;
        const before = fs.readFileSync(file, 'utf8');
        const after = before.replace(REF, (m, head, rel, tail) => {
            const v = stamp(rel);
            return v ? `${head}${rel}?v=${v}${tail}` : m;
        });
        if (after !== before) { fs.writeFileSync(file, after); pages++; }
    }
    return pages;
}

module.exports = run;
if (require.main === module) console.log(`css · js 지문을 바꾼 손 관리 페이지: ${run()}쪽`);
