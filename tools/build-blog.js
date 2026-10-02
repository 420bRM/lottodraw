#!/usr/bin/env node
// 블로그 생성기. 원고(content/blog/*.md)로 blog/index.html(목록)과 blog/<slug>.html(글)을 만든다.
//
// 머리글·메뉴·꼬리말은 다른 생성 페이지와 같은 틀(build-static-stats.js 의 shell)을 쓴다.
// 그래서 따로 돌지 않고 build-static-stats.js 가 마지막에 불러 쓴다. 머리글의 최신 회차가
// 매주 바뀌므로 블로그 페이지도 매주 다시 써지고, 사이트맵에도 같이 들어간다.
//
// 원고 쓰는 법 (자세한 설명은 README 4-3)
//   content/blog/NN-slug.md        한국어. 머리말 아래에 본문
//     ---
//     title: 제목
//     slug: 주소 (blog/<slug>.html). 빼면 파일 이름에서 번호를 뗀 것
//     category: 당첨 이후 | 통계 읽기 | 번호 고르기 | 확률 기초
//     description: 목록과 검색 결과에 나오는 요약
//     date: 2026-10-01
//     related: [frequency, tax]    글 끝 "이어지는 페이지" — 아래 RELATED 의 이름
//     updated: 2026-11-01          (선택) 크게 고친 날. 사이트맵·검색엔진에 갱신일로 간다
//     ---
//   content/blog/en/NN-slug.md     영어. 파일 이름이 같고, 머리말은 title 과 description 만
//
// 본문 문법: ## 소제목, 문단(줄을 바꾸면 <br>), - 목록, 1. 목록, > 인용, | 표 |,
// **굵게**, `코드`, [링크](/tax.html). 링크는 사이트 뿌리 기준으로 쓰면 알아서 고쳐 단다.
//
// 영문은 한국어와 블록마다 짝이 맞아야 한다 — 소제목·문단·목록 항목·표 칸·인용의 수와
// 순서가 같아야 한다. 어긋나면 그 글의 영어만 빼고 경고를 찍는다. 빌드를 멈추지 않는
// 이유는 매주 도는 자동 갱신이 원고 하나 때문에 서면 안 되기 때문이다.
//
// 사용: node tools/build-static-stats.js   (이 파일을 직접 돌려도 같은 일을 한다)
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'blog');
const SRC_EN = path.join(SRC, 'en');
const OUT = 'blog';

// 이 순서대로 목록 위 단추가 놓인다. band 는 공 색(css 의 --ball-N)을 빌려 쓴다.
// 여기 없는 카테고리를 쓰면 회색 점으로 맨 뒤에 붙는다.
const CATEGORIES = [
    { name: '당첨 이후', en: 'After a win', band: 1 },
    { name: '통계 읽기', en: 'Reading the stats', band: 2 },
    { name: '번호 고르기', en: 'Picking numbers', band: 3 },
    { name: '확률 기초', en: 'Probability basics', band: 5 },
];

// 머리말 related: [...] 에 쓰는 이름 → [주소, 이름, 영문, 설명, 영문 설명]
const RELATED = {
    frequency:     ['statistics-frequency.html', '많이 나온 번호 순위', 'Most drawn numbers', '번호별 출현 횟수와 표준편차', 'Count per number with standard deviations'],
    gap:           ['statistics-gap.html', '미출수 (장기 미출현)', 'Cold numbers', '몇 회차째 안 나왔는지 순위', 'How many draws each number has been absent'],
    pair:          ['statistics-pair.html', '궁합수 순위', 'Pair numbers', '함께 나온 번호 쌍 Top 20', 'Top 20 pairs drawn together'],
    ac:            ['statistics-ac.html', 'AC값 통계 · 계산기', 'AC value stats & calculator', '역대 AC값 분포와 계산기', 'Past AC values and a calculator'],
    sum:           ['statistics-sum.html', '번호 합계 분포', 'Sum of numbers', '실제 합계와 이론 정규분포', 'Actual sums against the normal curve'],
    'even-odd':    ['statistics-even-odd.html', '홀짝 비율', 'Odd/even split', '실제 비율과 이론 확률', 'Actual splits against theory'],
    'low-high':    ['statistics-low-high.html', '저고 비율', 'Low/high split', '낮은 번호와 높은 번호의 비율', 'Low (1–22) and high (23–45) numbers'],
    consecutive:   ['statistics-consecutive.html', '연속번호 통계', 'Consecutive numbers', '연속번호가 나온 회차 비율', 'Share of draws with consecutive numbers'],
    'prize-stats': ['statistics-prize.html', '1등 당첨자 수 통계', '1st-prize winners per draw', '회차별 당첨자 수 분포와 이월 횟수', 'How many winners each draw had, and rollovers'],
    probability:   ['probability.html', '로또 확률', 'Lotto odds', '등수별 당첨 확률과 계산 방법', 'Odds for each prize tier and how they are worked out'],
    tax:           ['tax.html', '실수령액 계산기', 'After-tax calculator', '당첨금을 넣으면 세금과 실수령액', 'Enter a prize to see the tax and take-home amount'],
    'top-prize':   ['top-prize.html', '역대 1등 당첨금 TOP 50', 'Top 50 jackpots', '1인당 당첨금이 컸던 회차', 'Draws with the largest prize per winner'],
    generator:     ['index.html#sec-generator', '번호 생성기', 'Number generator', '고정수·제외수와 특수 패턴 16가지', 'Fixed and excluded numbers, 16 special patterns'],
};

// 목록 카드의 미리보기: 본문 앞에서부터 블록을 담는다(표는 건너뛴다). 5개를 채우거나
// 글자 수가 420자를 넘으면 멈춘다. 그 아래는 CSS 가 흐리게 덮는다.
const PREVIEW_BLOCKS = 5;
const PREVIEW_CHARS = 420;
// 읽는 시간: 공백을 뺀 본문 글자 수를 분당 500자로 나눠 반올림한다
const CHARS_PER_MIN = 500;

const BLOG_TITLE = '로또 블로그 · 1등 수령·세금·통계·확률 해설';
const BLOG_LEAD = '당첨금 수령과 세금, 통계를 읽는 법, 확률의 기본 원리까지. 이 사이트의 회차 데이터로 직접 계산해서 씁니다.';
const BLOG_LEAD_EN = "Claiming a prize and paying tax, how to read the statistics, and the basic ideas of probability. Every figure is worked out from this site's draw data.";

/* ───── 원고 읽기 ───── */

function readDoc(file) {
    const raw = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    const m = raw.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    const meta = {};
    if (m) {
        m[1].split('\n').forEach(line => {
            const cut = line.indexOf(':');
            if (cut < 1) return;
            const key = line.slice(0, cut).trim();
            const val = line.slice(cut + 1).trim();
            meta[key] = /^\[.*\]$/.test(val)
                ? val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
                : val.replace(/^(['"])(.*)\1$/, '$2');
        });
    }
    return { meta, blocks: parseBlocks(m ? raw.slice(m[0].length) : raw) };
}

const isTable = line => /^\s*\|/.test(line);
const isQuote = line => /^>/.test(line);
const isUl = line => /^[-*]\s+/.test(line);
const isOl = line => /^\d+\.\s+/.test(line);
const isHead = line => /^#{2,}\s+/.test(line);
const startsBlock = line => isTable(line) || isQuote(line) || isUl(line) || isOl(line) || isHead(line);

// 블록: { type: 'h2' | 'p' | 'quote' | 'ul' | 'ol' | 'table', ... }
function parseBlocks(md) {
    const lines = md.split('\n');
    const blocks = [];
    let i = 0;
    const take = (test, strip) => {
        const out = [];
        while (i < lines.length && test(lines[i])) out.push(strip(lines[i++]).trim());
        return out;
    };
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }
        if (isHead(line)) {
            blocks.push({ type: 'h2', text: line.replace(/^#+\s+/, '').trim() });
            i++;
        } else if (isTable(line)) {
            const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
            const rows = take(isTable, s => s);
            // 둘째 줄 |---|---| 은 머리줄 구분선이다
            if (rows[1] && cells(rows[1]).every(c => /^:?-{3,}:?$/.test(c))) rows.splice(1, 1);
            blocks.push({ type: 'table', head: cells(rows[0]), rows: rows.slice(1).map(cells) });
        } else if (isQuote(line)) {
            blocks.push({ type: 'quote', lines: take(isQuote, s => s.replace(/^>\s?/, '')) });
        } else if (isUl(line)) {
            blocks.push({ type: 'ul', items: take(isUl, s => s.replace(/^[-*]\s+/, '')) });
        } else if (isOl(line)) {
            blocks.push({ type: 'ol', items: take(isOl, s => s.replace(/^\d+\.\s+/, '')) });
        } else {
            blocks.push({ type: 'p', lines: take(s => s.trim() && !startsBlock(s), s => s) });
        }
    }
    return blocks;
}

// 영문과 짝을 맞춰 볼 모양. 종류와 항목·칸 수가 같아야 한다
const shape = b => b.type
    + (b.items ? `(${b.items.length})` : '')
    + (b.head ? `(${b.head.length}|${b.rows.map(r => r.length).join(',')})` : '');

/* ───── 문장 안 표기 ───── */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 원고의 링크는 사이트 뿌리 기준(/tax.html, /blog/x.html)이다. 글은 blog/ 안에 있으니 고쳐 단다
function href(url) {
    if (/^(https?:|mailto:|#)/.test(url)) return url;
    if (url.startsWith('/blog/')) return url.slice('/blog/'.length);
    if (url.startsWith('/')) return '..' + url;
    return url;
}

// **굵게**, `코드`, [링크](주소). 코드와 링크 태그는 먼저 빼 두었다가 마지막에 되돌린다
function inline(src) {
    const kept = [];
    const hold = html => `\u0001${kept.push(html) - 1}\u0002`;
    const s = String(src)
        .replace(/`([^`]+)`/g, (m, code) => hold(`<code>${esc(code)}</code>`))
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => hold(`<a href="${esc(href(url))}">`) + text + hold('</a>'));
    return esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\u0001(\d+)\u0002/g, (m, n) => kept[n]);
}

const lines = ls => ls.map(inline).join('<br>');
const textOf = html => html.replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const unlink = html => html.replace(/<a [^>]*>|<\/a>/g, '');

// 영문을 다는 속성. 영문이 없으면(짝이 어긋난 글) 붙이지 않는다 — 그 자리는 한국어로 남는다
const tr = html => (html === undefined ? '' : ` data-i18n-en="${esc(html)}"`);

/* ───── 블록 그리기 ───── */

// e 는 같은 자리의 영문 블록 (없으면 undefined)
function renderBlock(b, e, id) {
    const pick = f => (e ? f(e) : undefined);
    switch (b.type) {
    case 'h2':
        return `<h2 id="${id}"${tr(pick(x => inline(x.text)))}>${inline(b.text)}</h2>`;
    case 'p':
        return `<p${tr(pick(x => lines(x.lines)))}>${lines(b.lines)}</p>`;
    case 'quote':
        return `<blockquote><p${tr(pick(x => lines(x.lines)))}>${lines(b.lines)}</p></blockquote>`;
    case 'ul':
    case 'ol':
        return `<${b.type}>` + b.items.map((it, j) => `<li${tr(pick(x => inline(x.items[j])))}>${inline(it)}</li>`).join('') + `</${b.type}>`;
    case 'table':
        return '<div class="table-scroll"><table class="data-table"><thead><tr>'
            + b.head.map((c, j) => `<th scope="col"${tr(pick(x => inline(x.head[j])))}>${inline(c)}</th>`).join('')
            + '</tr></thead><tbody>'
            + b.rows.map((r, i) => '<tr>' + r.map((c, j) => `<td${tr(pick(x => inline(x.rows[i][j])))}>${inline(c)}</td>`).join('') + '</tr>').join('')
            + '</tbody></table></div>';
    default:
        throw new Error('모르는 블록: ' + b.type);
    }
}

// 미리보기용. 속성 없이, 링크는 글자만 남긴다 (카드 전체가 하나의 링크라서)
function plainBlock(b) {
    switch (b.type) {
    case 'h2': return `<h2>${unlink(inline(b.text))}</h2>`;
    case 'p': return `<p>${unlink(lines(b.lines))}</p>`;
    case 'quote': return `<blockquote><p>${unlink(lines(b.lines))}</p></blockquote>`;
    case 'ul':
    case 'ol': return `<${b.type}>` + b.items.map(it => `<li>${unlink(inline(it))}</li>`).join('') + `</${b.type}>`;
    default: return '';
    }
}

function preview(post) {
    const ko = [];
    const en = [];
    let chars = 0;
    for (let i = 0; i < post.blocks.length && ko.length < PREVIEW_BLOCKS && chars < PREVIEW_CHARS; i++) {
        const b = post.blocks[i];
        if (b.type === 'table') continue;
        const html = plainBlock(b);
        ko.push(html);
        if (post.en) en.push(plainBlock(post.en.blocks[i]));
        chars += textOf(html).length;
    }
    return { ko: ko.join(''), en: post.en ? en.join('') : undefined };
}

/* ───── 페이지 ───── */

const catOf = name => CATEGORIES.find(c => c.name === name) || { name, en: undefined, band: undefined };
const catDot = c => `<span class="cat-dot"${c.band ? ` data-band="${c.band}"` : ''} aria-hidden="true"></span>`;
const catBadge = c => `<span class="post-cat">${catDot(c)}<span${tr(c.en && esc(c.en))}>${esc(c.name)}</span></span>`;
const metaLine = p => `<span data-i18n-en="${esc(`${p.date} · ${p.minutes} min read`)}">${esc(p.date)} · ${p.minutes}분 읽기</span>`;

module.exports = function buildBlog(ctx) {
    const { shell, write, SITE, OG_IMAGE } = ctx;
    const warn = msg => console.warn(`  ! 블로그: ${msg}`);

    if (!fs.existsSync(SRC)) {
        warn('content/blog/ 가 없어 블로그를 건너뛴다');
        return { posts: 0, changed: 0, sitemap: [] };
    }

    /* 원고 → 글 */
    const files = fs.readdirSync(SRC).filter(f => f.endsWith('.md')).sort();
    const posts = files.map((file, order) => {
        const doc = readDoc(path.join(SRC, file));
        const m = doc.meta;
        const slug = m.slug || file.replace(/\.md$/, '').replace(/^\d+-/, '');
        if (!m.title) warn(`${file} 에 title 이 없다`);
        if (!m.description) warn(`${file} 에 description 이 없다`);
        if (!m.date) warn(`${file} 에 date 가 없다`);
        const cat = catOf(m.category || '기타');
        if (!cat.band) warn(`${file} 의 category "${cat.name}" 는 CATEGORIES 에 없다 — 회색 점으로 붙인다`);

        // 영문은 모양이 한국어와 꼭 맞을 때만 쓴다
        let en;
        const enFile = path.join(SRC_EN, file);
        if (!fs.existsSync(enFile)) {
            warn(`${file} 의 영어 원고가 없다 — 영어 화면에서도 한국어로 보인다`);
        } else {
            const e = readDoc(enFile);
            const a = doc.blocks.map(shape);
            const b = e.blocks.map(shape);
            const at = a.findIndex((s, i) => s !== b[i]);
            if (!e.meta.title || !e.meta.description) {
                warn(`en/${file} 머리말에 title·description 이 없다 — 이 글의 영어는 뺀다`);
            } else if (at !== -1 || a.length !== b.length) {
                const k = at === -1 ? Math.min(a.length, b.length) : at;
                warn(`en/${file} 의 구조가 한국어와 다르다 — ${k + 1}번째 블록: 한국어 ${a[k] || '(없음)'}, 영어 ${b[k] || '(없음)'}. 이 글의 영어는 뺀다`);
            } else {
                en = { title: e.meta.title, description: e.meta.description, blocks: e.blocks };
            }
        }

        const related = [].concat(m.related || []).filter(k => {
            if (RELATED[k]) return true;
            warn(`${file} 의 related "${k}" 는 RELATED 에 없다`);
            return false;
        });

        return {
            file, order, slug, en, related,
            title: m.title || slug,
            description: m.description || '',
            date: m.date || '',
            updated: m.updated || m.date || '',
            category: cat,
            blocks: doc.blocks,
        };
    });

    // 주소가 겹치면 파일 번호가 앞선 원고만 쓴다
    const slugs = {};
    for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        if (!slugs[p.slug]) { slugs[p.slug] = p.file; continue; }
        warn(`${p.file} 의 slug "${p.slug}" 가 ${slugs[p.slug]} 와 겹친다 — 이 원고는 건너뛴다`);
        posts.splice(i--, 1);
    }
    // 최근 글이 위로. 날짜가 같으면 파일 번호 순서
    posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.order - b.order));

    /* 글마다 본문을 그린다 */
    posts.forEach(p => {
        let h = 0;
        p.heads = [];
        p.body = p.blocks.map((b, i) => {
            const e = p.en && p.en.blocks[i];
            if (b.type !== 'h2') return renderBlock(b, e);
            const id = `s${++h}`;
            p.heads.push({ id, ko: inline(b.text), en: e && inline(e.text) });
            return renderBlock(b, e, id);
        }).join('\n');
        p.minutes = Math.max(1, Math.round(textOf(p.body).replace(/\s/g, '').length / CHARS_PER_MIN));
    });

    const pages = {};
    let changed = 0;
    const put = (name, html) => {
        pages[name] = true;
        if (write(`${OUT}/${name}`, html)) changed++;
    };

    posts.forEach((p, i) => {
        const prev = posts[i - 1];
        const next = posts[i + 1];
        const url = `${SITE}/${OUT}/${p.slug}.html`;
        const toc = p.heads.length
            ? '<nav class="toc" aria-label="목차" data-i18n-attr="aria-label:blog.toc"><strong data-i18n="blog.toc">목차</strong><ol>'
                + p.heads.map(x => `<li><a href="#${x.id}"${tr(x.en)}>${x.ko}</a></li>`).join('') + '</ol></nav>'
            : '';
        const related = p.related.length
            ? '<section class="related"><h2 data-i18n="blog.related">이 글과 이어지는 페이지</h2><ul>'
                + p.related.map(k => {
                    const [page, name, nameEn, note, noteEn] = RELATED[k];
                    return `<li><a href="../${page}" data-i18n-en="${esc(nameEn + ' →')}">${esc(name + ' →')}</a><span data-i18n-en="${esc(noteEn)}">${esc(note)}</span></li>`;
                }).join('') + '</ul></section>'
            : '';
        const navLink = (q, key, label) => `<a href="${q.slug}.html"><small data-i18n="${key}">${label}</small><span${tr(q.en && esc(q.en.title))}>${esc(q.title)}</span></a>`;
        const postNav = prev || next
            ? '<nav class="post-nav" aria-label="이전 글과 다음 글" data-i18n-attr="aria-label:blog.prevNextAria">'
                + (prev ? navLink(prev, 'blog.prev', '이전 글') : '<span></span>')
                + (next ? navLink(next, 'blog.next', '다음 글') : '') + '</nav>'
            : '';

        put(`${p.slug}.html`, shell({
            file: `${OUT}/${p.slug}.html`,
            base: '../',
            mainClass: 'blog-post',
            navCurrent: `${OUT}/index.html`,
            note: '이 파일은 tools/build-blog.js 가 content/blog/ 원고로 다시 만든다. 직접 고치면 덮어쓰인다.',
            crumbs: [[`${OUT}/index.html`, '블로그', 'nav.blog'], [null, p.title, null, p.en && p.en.title]],
            title: p.title,
            h1: p.title,
            h1En: p.en && p.en.title,
            desc: p.description,
            scope: `${catBadge(p.category)} · ${metaLine(p)}`,
            lead: `<span${tr(p.en && esc(p.en.description))}>${esc(p.description)}</span>`,
            ld: [{
                '@type': 'BlogPosting',
                headline: p.title,
                description: p.description,
                datePublished: p.date,
                dateModified: p.updated,
                inLanguage: 'ko-KR',
                articleSection: p.category.name,
                url: url,
                mainEntityOfPage: url,
                image: OG_IMAGE,
                author: { '@type': 'Organization', name: 'lottodraw.kr', url: SITE + '/' },
                publisher: { '@type': 'Organization', name: 'lottodraw.kr', url: SITE + '/' },
            }],
            body: [toc, p.body, related, postNav],
        }));
    });

    /* 목록 */
    const cats = CATEGORIES.concat(posts.map(p => p.category).filter(c => !c.band))
        .filter((c, i, all) => all.findIndex(x => x.name === c.name) === i)
        .map(c => ({ c, n: posts.filter(p => p.category.name === c.name).length }))
        .filter(x => x.n);
    const chips = '<ul class="chips" role="group" aria-label="카테고리" data-i18n-attr="aria-label:blog.catAria">'
        + `<li><button type="button" class="chip-btn" data-cat="" aria-pressed="true"><span data-i18n="blog.all">전체</span> <span class="count">${posts.length}</span></button></li>`
        + cats.map(({ c, n }) => `<li><button type="button" class="chip-btn" data-cat="${esc(c.name)}" aria-pressed="false">${catDot(c)}<span${tr(c.en && esc(c.en))}>${esc(c.name)}</span> <span class="count">${n}</span></button></li>`).join('')
        + '</ul>';
    const cards = posts.map(p => {
        const pv = preview(p);
        return `<li class="post-card" data-cat="${esc(p.category.name)}">`
            + `<div class="post-head">${catBadge(p.category)}<span class="post-meta">${metaLine(p)}</span></div>`
            + `<h2 class="post-title"><a href="${p.slug}.html"${tr(p.en && esc(p.en.title))}>${esc(p.title)}</a></h2>`
            + `<p class="post-desc"${tr(p.en && esc(p.en.description))}>${esc(p.description)}</p>`
            + `<div class="post-preview" aria-hidden="true"${tr(pv.en)}>${pv.ko}</div>`
            + `<div class="read-more"><a href="${p.slug}.html" tabindex="-1" aria-hidden="true" data-i18n-html="blog.readMore">이어서 읽기 <span class="arrow">→</span></a></div>`
            + '</li>';
    });
    const newest = posts.reduce((a, p) => (p.updated > a ? p.updated : a), '');

    put('index.html', shell({
        file: `${OUT}/index.html`,
        base: '../',
        mainClass: 'blog-index',
        navCurrent: `${OUT}/index.html`,
        note: '이 파일은 tools/build-blog.js 가 content/blog/ 원고로 다시 만든다. 직접 고치면 덮어쓰인다.',
        crumbs: [[null, '블로그', 'nav.blog']],
        title: BLOG_TITLE,
        h1: '로또 블로그',
        h1En: 'Lotto Blog',
        desc: `로또 1등 수령 절차와 세금, 많이 나온 번호·미출수·궁합수를 읽는 법, 당첨 확률과 기대값까지. lottodraw.kr 회차 데이터로 직접 계산해 쓴 글 ${posts.length}편.`,
        scope: `<span data-i18n-en="${posts.length} articles">글 ${posts.length}편</span>`,
        lead: `<span data-i18n-en="${esc(BLOG_LEAD_EN)}">${esc(BLOG_LEAD)}</span>`,
        ld: [{
            '@type': 'Blog',
            name: '로또 블로그',
            description: BLOG_LEAD,
            url: `${SITE}/${OUT}/index.html`,
            inLanguage: 'ko-KR',
            publisher: { '@type': 'Organization', name: 'lottodraw.kr', url: SITE + '/' },
            blogPost: posts.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}/${OUT}/${p.slug}.html`, datePublished: p.date })),
        }],
        body: [chips, '<ol class="post-list">' + cards.join('\n') + '</ol>'],
        // 카테고리 단추. 고른 카테고리가 아닌 카드를 숨긴다
        script: [
            '(function () {',
            "    var chips = document.querySelectorAll('.chip-btn');",
            "    var cards = document.querySelectorAll('.post-card');",
            '    Array.prototype.forEach.call(chips, function (chip) {',
            "        chip.addEventListener('click', function () {",
            "            var cat = chip.getAttribute('data-cat');",
            "            Array.prototype.forEach.call(chips, function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });",
            "            Array.prototype.forEach.call(cards, function (card) { card.hidden = !!cat && card.getAttribute('data-cat') !== cat; });",
            '        });',
            '    });',
            '}());',
        ].join('\n'),
    }));

    // 원고를 지우거나 slug 를 바꾸면 남는 옛 페이지를 치운다
    if (posts.length && fs.existsSync(path.join(ROOT, OUT))) {
        fs.readdirSync(path.join(ROOT, OUT))
            .filter(f => f.endsWith('.html') && !pages[f])
            .forEach(f => {
                fs.unlinkSync(path.join(ROOT, OUT, f));
                changed++;
                console.log(`  블로그: 원고가 없어진 ${OUT}/${f} 를 지웠다`);
            });
    }

    return {
        posts: posts.length,
        changed,
        sitemap: [{ path: `/${OUT}/index.html`, lastmod: newest }]
            .concat(posts.map(p => ({ path: `/${OUT}/${p.slug}.html`, lastmod: p.updated }))),
    };
};

// 직접 돌리면 전체 생성기를 돌린다 — 틀과 사이트맵이 그쪽에 있다
if (require.main === module) require('./build-static-stats.js');
