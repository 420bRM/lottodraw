#!/usr/bin/env node
/* 글자 · 행간 · 회색 · 간격 규칙 점검(2026-11-20) — 규칙은 docs/design.md.
 *   node tools/ui_check.cjs          어긋난 곳을 모두 보이고, 하나라도 있으면 1 로 끝난다
 *   node tools/ui_check.cjs --stat   종류별 개수만
 *
 * 보는 곳: css/*.css, 맨 위 · blog/ 의 *.html 안 <style>, tools/build-*.js 가 찍는 <style>.
 * 규칙:
 *   글자 크기  font-size · font 줄임의 크기는 var(--fs-1~5) 또는 입력칸 var(--fs-input) · inherit
 *   행간       var(--lh-tight) · var(--lh-body) · 1(기호 · 공 · 고정 상자) · inherit · normal
 *   간격       margin · padding · gap · min-height 의 px 은 4 의 배수(0 · 음수는 통과)
 *   회색       color 가 --muted · --faint(또는 같은 회색 hex)인 규칙에 --fs-1~3 이 같이 있으면 안 된다
 * 예외: 선언 바로 뒤에 주석 "/* 예외: 이유 *​/" 를 달면 그 선언은 센다(목록에 예외로) — 어긋남으로 치지 않는다.
 * 인쇄(@media print · pt 단위)는 보지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const STAT = process.argv.includes('--stat');

function sources() {
    const out = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'css'))) if (f.endsWith('.css')) out.push({ file: 'css/' + f, css: fs.readFileSync(path.join(ROOT, 'css', f), 'utf8'), base: 0 });
    const html = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).concat(fs.readdirSync(path.join(ROOT, 'blog')).filter(f => f.endsWith('.html')).map(f => 'blog/' + f));
    const tools = fs.readdirSync(path.join(ROOT, 'tools')).filter(f => /^build-.*\.js$/.test(f)).map(f => 'tools/' + f);
    for (const f of html.concat(tools)) {
        const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const m of t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) out.push({ file: f, css: m[1], base: t.slice(0, m.index).split('\n').length - 1 });
        // 생성 도구 안의 CSS 상수(const ACC_STYLE = `…`)
        if (f.startsWith('tools/')) for (const m of t.matchAll(/const \w*STYLE\w* = `([\s\S]*?)`/g)) out.push({ file: f, css: m[1], base: t.slice(0, m.index).split('\n').length - 1 });
    }
    return out;
}

const GRAY = /(?:^|;|\s)color:\s*(?:var\(--(?:muted|faint)\b[^)]*\)|#(?:555|666|667|777|888|999|6b7280|8d97a8)\b)/i;
const bad = [], exempt = [];
const kinds = {};
function hit(list, kind, src, line, sel, decl, why) {
    list.push({ kind, at: `${src.file}:${src.base + line}`, sel: sel.replace(/\s+/g, ' ').slice(-60), decl: decl.trim().slice(0, 80), why });
    if (list === bad) kinds[kind] = (kinds[kind] || 0) + 1;
}

for (const src of sources()) {
    let css = src.css;
    // @media print 덩어리는 건너뛴다(인쇄는 pt)
    css = css.replace(/@media print\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, m => m.replace(/[^\n]/g, ' '));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (/^@(font-face|keyframes)|^(from|to|\d+%)/.test(sel)) continue;
        const body = m[2];
        const bodyStart = m.index + m[1].length + 1;
        // 선언 나누기 — 주석은 앞 선언에 붙인다
        const decls = [];
        const dre = /([a-z-]+)\s*:\s*((?:[^;{}"']|"[^"]*"|'[^']*')*?)\s*(;|$)\s*(\/\*([\s\S]*?)\*\/)?/gy;
        let pos = 0;
        const clean = body;
        while (pos < clean.length) {
            const ws = /\s*(\/\*[\s\S]*?\*\/\s*)*/y; ws.lastIndex = pos; ws.exec(clean); pos = ws.lastIndex;
            if (pos >= clean.length) break;
            dre.lastIndex = pos;
            const d = dre.exec(clean);
            if (!d || d[0] === '') { pos++; continue; }
            decls.push({ prop: d[1], val: d[2], note: d[5] || '', off: pos });
            pos = dre.lastIndex;
        }
        const lineOf = off => css.slice(0, bodyStart + off).split('\n').length;
        const gray = decls.some(d => d.prop === 'color' && GRAY.test('color: ' + d.val));
        let bigInRule = null;
        for (const d of decls) {
            const isEx = /^\s*예외/.test(d.note);
            const line = lineOf(d.off);
            const text = `${d.prop}: ${d.val}`;
            const flag = (kind, why) => hit(isEx ? exempt : bad, kind, src, line, sel, text, isEx ? d.note.trim() : why);
            if (d.prop === 'font-size') {
                if (!/^(var\(--fs-(?:[1-5]|input)\)|inherit)(\s*!important)?$/.test(d.val)) flag('글자 크기', '--fs-1~5 가 아님');
                else if (/--fs-[123]\b/.test(d.val)) bigInRule = d;
            } else if (d.prop === 'font') {
                if (/^(inherit|unset|initial)$/.test(d.val)) continue;
                const sz = d.val.match(/(var\(--fs-[^)]+\)|[0-9.]+(?:px|em|rem|%|pt))(?:\/(\S+))?/);
                if (!sz || !/^var\(--fs-(?:[1-5]|input)\)$/.test(sz[1])) flag('글자 크기', 'font 줄임의 크기가 --fs-1~5 가 아님');
                else if (/--fs-[123]\b/.test(sz[1])) bigInRule = d;
                if (sz && sz[2] && !/^(var\(--lh-(?:tight|body)\)|1)$/.test(sz[2])) flag('행간', 'font 줄임의 행간이 --lh-* · 1 이 아님');
            } else if (d.prop === 'line-height') {
                if (!/^(var\(--lh-(?:tight|body)\)|1|inherit|normal)(\s*!important)?$/.test(d.val)) flag('행간', '--lh-tight · --lh-body · 1 이 아님');
            } else if (/^(margin|padding)(-[a-z]+)*$|^(row-|column-)?gap$|^min-height$/.test(d.prop)) {
                const nums = [...d.val.matchAll(/(^|[^\w.-])(-?)(\d*\.?\d+)(px|em|rem)\b/g)];
                for (const n of nums) {
                    if (n[2] === '-') continue;
                    if (n[4] !== 'px') { if (d.prop !== 'min-height') flag('간격', `${n[3]}${n[4]} — px(4의 배수)로`); continue; }
                    if (+n[3] % 4 !== 0) { flag('간격', `${n[3]}px 은 4 의 배수가 아님`); break; }
                }
            }
        }
        if (gray && bigInRule) hit(/^\s*예외/.test(bigInRule.note) ? exempt : bad, '회색', src, lineOf(bigInRule.off), sel, `${bigInRule.prop}: ${bigInRule.val} + 회색`, '회색 글자는 --fs-4 · --fs-5 에서만');
    }
}

if (!STAT) {
    for (const b of bad) console.log(`✗ [${b.kind}] ${b.at}  ${b.sel} { ${b.decl} } — ${b.why}`);
    if (process.argv.includes('--exempt')) for (const e of exempt) console.log(`· [예외] ${e.at}  ${e.sel} { ${e.decl} } — ${e.why}`);
}
const k = Object.entries(kinds).map(([a, n]) => `${a} ${n}`).join(' · ') || '없음';
console.log(`\n어긋남 ${bad.length}곳 (${k}) · 예외 ${exempt.length}곳`);
process.exit(bad.length ? 1 : 0);
