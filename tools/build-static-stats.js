#!/usr/bin/env node
// 검색엔진용 정적 페이지 생성기. lotto-data.json 으로 표를 미리 그려 HTML 에 넣는다.
//
// 왜 필요한가: 홈의 통계는 브라우저에서 JS 로 그린다. 네이버 검색 로봇은 JS 를 거의
// 실행하지 않고, 구글도 늦게 실행한다. 그래서 검색에 걸릴 본문이 비어 있었다.
// 데이터가 바뀌는 주마다 이 스크립트가 같이 돌아 표·제목·설명을 최신 회차로 다시 쓴다
// (.github/workflows/update-lotto-data.yml).
//
// 제목과 표현은 구글·네이버 자동완성에서 실제로 많이 쓰이는 말로 골랐다.
// 예: "번호별 출현 횟수"보다 "많이 나온 번호 순위", "미출현"보다 "미출수",
// "함께 나온 쌍"보다 "궁합수", "회차별 당첨번호 조회", "로또 1241회 당첨번호".
//
// 만드는 것
//   statistics-*.html 12개   통계별 착지 페이지
//   round/<회차>.html        회차별 당첨번호 페이지 (전 회차)
//   draws.html               회차별 당첨번호 전체 조회
//   probability.html         등수별 당첨 확률
//   index.html · tax.html · top-prize.html   <!-- seo:... --> 표식 사이만 고친다
//   blog/                    블로그 목록과 글 (tools/build-blog.js 를 불러 만든다)
//   sitemap.xml
//
// 결제로 열리는 상세 분석(연속 회차 목록, 번호별 궁합수, 20회 당첨금 추이)은 싣지 않는다.
// 회차 페이지에는 그 회차 하나의 1등 당첨금만 적는다 — 동행복권이 공개하는 값이고,
// "로또 N회 당첨금"을 찾는 사람이 가장 먼저 보려는 값이다.
//
// 회차 페이지는 최신 회차에 따라 바뀌는 내용을 넣지 않는다. 그래야 매주 새 회차 한 쪽과
// 직전 회차 한 쪽만 바뀌고, 나머지 천여 쪽은 그대로 남는다.
//
// 사용: node tools/build-static-stats.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://www.lottodraw.kr';
// 공유 미리보기 이미지(1200x630). 정적 파일이라 회차와 무관하다.
const OG_IMAGE = `${SITE}/img/og-default.png`;
const LottoStats = require(path.join(ROOT, 'js', 'lotto-stats.js'));
// Cloudflare Web Analytics 비콘. DNS only(프록시 꺼짐)라 자동 주입이 안 되어 직접 심는다.
// 손으로 관리하는 페이지(index, about 등)의 </head> 앞에도 같은 줄이 들어 있다.
const CF_BEACON = `<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "91c08d8a39d944e69c10024f2314b955"}'></script><!-- End Cloudflare Web Analytics -->`;

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// 내용이 같으면 쓰지 않는다 — 수정 시각만 바뀌는 일을 막는다
function write(f, s) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === s) return false;
    if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p));   // round/ 한 단계뿐이다
    fs.writeFileSync(p, s);
    return true;
}

/* ───── 계산 준비 ───── */

const data = JSON.parse(read('lotto-data.json'));
const draws = data.draws.slice().sort((a, b) => b.round - a.round);
if (!draws.length) throw new Error('lotto-data.json 에 회차가 없다');

const stats = LottoStats.compute(draws, { pairTop: 20, trendTop: 10 });
const N = stats.rounds;
const LATEST = draws[0];
const UPDATED = LATEST.date;
const RANGE = `1~${N}회`;
const PERIOD = `${stats.oldestDate} ~ ${stats.latestDate}`;

const TOTAL = 8145060;                              // C(45,6)
const comb = (n, k) => {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return Math.round(r);
};

// 한국어 문장 옆에 영문을 같이 싣는다. 화면의 KO/EN 단추가 이 속성을 읽어 바꿔 끼운다.
// 회차마다 값이 달라지는 문장이라 사전(js/i18n-dict.js)에 키로 둘 수 없다.
// "186회" 처럼 자주 나오는 꼴은 도우미로 묶는다
const labEn = r => (r.labelEn ? `<span data-i18n-en="${esc(r.labelEn)}">${esc(r.label)}</span>` : esc(r.label));
const rank = i => `<span data-i18n-en="#${i}">${i}위</span>`;
const times = n => `<span data-i18n-en="${n}×">${n}회</span>`;
const en = (ko, english) => `<span data-i18n-en="${esc(english)}">${ko}</span>`;
const pEn = (ko, english, cls) => `<p${cls ? ` class="${cls}"` : ''} data-i18n-en="${esc(english)}">${ko}</p>`;
const h2En = (ko, english) => `<h2 data-i18n-en="${esc(english)}">${ko}</h2>`;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) : '0.0') + '%';
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
const asc = (a, b) => a - b;
const numsText = rows => rows.slice(0, 4).map(r => r.number).join('·') + '번'
    + (rows.length > 4 ? ` 외 ${rows.length - 4}개` : '');
const extremesOf = rows => {
    const counts = rows.map(r => r.count);
    const max = Math.max.apply(null, counts);
    const min = Math.min.apply(null, counts);
    return { max, min, top: rows.filter(r => r.count === max), bottom: rows.filter(r => r.count === min) };
};
const topBy = rows => rows.slice().sort((a, b) => b.count - a.count)[0];
const ball = n => `<span class="mball" data-band="${LottoStats.bandOf(n)}">${n}</span>`;
const bigBall = n => `<span class="ball filled" data-band="${LottoStats.bandOf(n)}">${n}</span>`;

// 1,628,391,980 → "16억 2,839만 원"
// 영문은 억·만 대신 bn/m 으로 적는다
function wonEn(amount) {
    if (!amount) return '0';
    return amount >= 1e9 ? (amount / 1e9).toFixed(2) + ' bn KRW' : Math.round(amount / 1e6) + 'm KRW';
}
function won(amount) {
    if (!amount) return '0원';
    const eok = Math.floor(amount / 1e8);
    const man = Math.floor((amount % 1e8) / 1e4);
    if (!eok) return `${fmt(man)}만 원`;
    return man ? `${fmt(eok)}억 ${fmt(man)}만 원` : `${fmt(eok)}억 원`;
}

// 복권 당첨금 세금 (소득세법 제129조). 구입비 1,000원을 뺀 금액에
// 3억 원까지 22%, 3억 원을 넘는 부분에만 33%. 200만 원 이하는 비과세.
// tax.html 의 계산기와 같은 식이다.
function lottoTax(prize) {
    if (prize <= 2000000) return 0;
    const base = Math.max(0, prize - 1000);
    return Math.floor(Math.min(base, 3e8) * 0.22 + Math.max(0, base - 3e8) * 0.33);
}

function runsOf(numbers) {
    const nums = numbers.slice().sort(asc);
    const groups = [];
    let run = [nums[0]];
    for (let i = 1; i < nums.length; i++) {
        if (nums[i] === nums[i - 1] + 1) run.push(nums[i]);
        else { if (run.length > 1) groups.push(run); run = [nums[i]]; }
    }
    if (run.length > 1) groups.push(run);
    return groups;
}

function acValue(nums) {
    const diffs = {};
    for (let i = 0; i < nums.length; i++) {
        for (let j = i + 1; j < nums.length; j++) diffs[Math.abs(nums[i] - nums[j])] = true;
    }
    return Object.keys(diffs).length - (nums.length - 1);
}

const tailSum = nums => nums.reduce((a, n) => a + n % 10, 0);

function table(head, rows, cls) {
    return [
        '<div class="table-scroll">',
        `<table class="data-table${cls ? ' ' + cls : ''}">`,
        '<thead><tr>' + head.map(h => Array.isArray(h)
            ? `<th scope="col" data-i18n-en="${esc(h[1])}">${esc(h[0])}</th>`
            : `<th scope="col">${esc(h)}</th>`).join('') + '</tr></thead>',
        '<tbody>',
        rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('\n'),
        '</tbody>',
        '</table>',
        '</div>',
    ].join('\n');
}

function rankList(rows, label) {
    return '<ol class="ball-list">' + rows.map((r, i) =>
        `<li><span class="lead" data-i18n-en="#${i + 1}">${i + 1}위</span>${ball(r.number)}<span class="tail">${label(r)}</span></li>`
    ).join('') + '</ol>';
}

/* ───── 공통 틀 ───── */

const NAV = [
    ['index.html', '생성기 · 통계', 'nav.index'],
    ['draws.html', '당첨번호', 'nav.draws'],
    ['statistics.html', '5개월 통계', 'nav.statistics'],
    ['top-prize.html', 'TOP 50 당첨금', 'nav.topPrize'],
    ['tax.html', '실수령액 계산', 'nav.tax'],
    ['blog/index.html', '블로그', 'nav.blog'],
    ['about.html', 'ABOUT', 'nav.about'],
];

// 언어 전환 단추. 사전과 엔진은 js/i18n-dict.js · js/i18n.js 에 있다.
const langSwitch = `<div class="lang-switch" role="group" aria-label="Language">
                <button type="button" data-lang-btn="ko">KO</button><button type="button" data-lang-btn="en">EN</button>
            </div>`;

const latestCallout = `제${LATEST.round}회 ${LATEST.numbers.join(' ')} <span class="bonus-sep">+</span> ${LATEST.bonus}`;
const latestCalloutEn = `Draw ${LATEST.round}: ${LATEST.numbers.join(' ')} <span class="bonus-sep">+</span> ${LATEST.bonus}`;

// base: 하위 폴더 페이지에서 쓰는 경로 앞머리 ('' 또는 '../')
// mainClass: 본문에 더 붙일 클래스 (블로그의 'blog-index' · 'blog-post')
// note: 맨 위 주석을 바꿀 때 (블로그는 원고에서 만든다)
function shell(o) {
    const base = o.base || '';
    const title = `${o.title} | lottodraw.kr`;
    const crumbs = [['index.html', '홈', 'crumb.home']].concat(o.crumbs || []);
    // 마지막 조각은 그 페이지 이름이다. 영문은 en: 으로 같이 받아 data-i18n-en 에 싣는다.
    const crumbHtml = crumbs.map(([href, name, key, en], i) => {
        const i18n = key ? ` data-i18n="${key}"` : (en ? ` data-i18n-en="${esc(en)}"` : '');
        return i === crumbs.length - 1 && !href
            ? `<span${i18n}>${esc(name)}</span>`
            : `<a href="${base}${href}"${i18n}>${esc(name)}</a>`;
    }).join(' › ');
    const ld = {
        '@context': 'https://schema.org',
        '@graph': [].concat(o.ld || [], [{
            '@type': 'BreadcrumbList',
            itemListElement: crumbs.map(([href, name], i) => ({
                '@type': 'ListItem', position: i + 1, name: name,
                item: href ? `${SITE}/${href === 'index.html' ? '' : href}` : `${SITE}/${o.file}`,
            })),
        }]),
    };
    return `<!DOCTYPE html>
<!-- ${o.note || '이 파일은 tools/build-static-stats.js 가 매주 다시 만든다. 직접 고치면 덮어쓰인다.'} -->
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(o.desc)}">
    <link rel="canonical" href="${SITE}/${o.file}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(o.desc)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${SITE}/${o.file}">
    <meta property="og:site_name" content="lottodraw.kr">
    <meta property="og:image" content="${OG_IMAGE}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(o.desc)}">
    <meta name="twitter:image" content="${OG_IMAGE}">
    <meta name="google-adsense-account" content="ca-pub-9372871176021283">
    <link rel="stylesheet" href="${base}css/site.css">
    <script src="${base}js/i18n-dict.js"></script>
    <script src="${base}js/i18n.js"></script>
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
    ${CF_BEACON}
</head>
<body>
<div class="page">
    <header class="banner">
        <a class="brand" href="${base}index.html">
            <span class="brand-name">LOTTODRAW.KR</span>
            <span class="brand-tag" data-i18n="brand.tag">특수 패턴을 걸러내는 로또 6/45 번호 생성기</span>
        </a>
        <div class="banner-right">
${o.callout === false ? '' : `            <p class="latest-callout" data-i18n-en="${esc(latestCalloutEn)}">${latestCallout}</p>
`}            <a class="sticker" href="${base}statistics.html" data-i18n-html="header.sticker">최근 <b>5개월</b> 통계</a>
            ${langSwitch}
        </div>
    </header>

    <nav class="nav" aria-label="주 메뉴" data-i18n-attr="aria-label:nav.aria">
        <ul>
${NAV.map(([href, name, key]) => `            <li><a href="${base}${href}"${href === o.navCurrent ? ' aria-current="page"' : ''} data-i18n="${key}">${name}</a></li>`).join('\n')}
        </ul>
    </nav>

    <main class="prose stat-page${o.mainClass ? ' ' + o.mainClass : ''}">
        <nav class="breadcrumb" aria-label="현재 위치" data-i18n-attr="aria-label:crumb.aria">${crumbHtml}</nav>
        <h1${o.h1En ? ` data-i18n-en="${esc(o.h1En)}"` : ''}>${esc(o.h1)}</h1>
${o.scope ? `        <p class="stat-scope">${o.scope}</p>\n` : ''}${o.lead ? `        <p class="stat-lead">${o.lead}</p>\n` : ''}
${o.body.filter(Boolean).join('\n\n')}

        <p class="page-disclaimer" data-i18n="disclaimer.page">지난 추첨 기록을 정리한 것이며 다음 회차를 예측하지 않습니다. 어떤 6개를 고르든 1등 확률은 1/8,145,060으로 같습니다. 당첨번호 출처: 동행복권.</p>
    </main>

    <footer class="footer">
        <ul class="footer-nav">
            <li><a href="${base}index.html" data-i18n="footer.home">HOME</a></li>
            <li><a href="${base}draws.html" data-i18n="nav.draws">당첨번호</a></li>
            <li><a href="${base}statistics.html" data-i18n="nav.statistics">5개월 통계</a></li>
            <li><a href="${base}top-prize.html" data-i18n="footer.top">TOP 50</a></li>
            <li><a href="${base}tax.html" data-i18n="footer.tax">실수령액</a></li>
            <li><a href="${base}blog/index.html" data-i18n="nav.blog">블로그</a></li>
            <li><a href="${base}about.html" data-i18n="nav.about">ABOUT</a></li>
        </ul>
        <p><a href="${base}privacy.html" data-i18n="footer.privacy">개인정보 처리방침</a> · <a href="${base}terms.html" data-i18n="footer.terms">이용약관</a> · <a href="${base}contact.html" data-i18n="footer.contact">문의</a></p>
        <p data-i18n-html="footer.copy">&copy; 2026 lottodraw.kr · 당첨번호 출처: 동행복권</p>
    </footer>
</div>
${o.script ? `<script>\n${o.script}\n</script>\n` : ''}<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9372871176021283" crossorigin="anonymous"></script>
</body>
</html>
`;
}

/* ───── 통계 12종 ───── */

const EXP_NUM = N * 6 / 45;
const SD_NUM = Math.sqrt(N * (6 / 45) * (39 / 45));
const EXP_BONUS = N / 45;
const PAIR_EXP = N * 123410 / TOTAL;               // C(43,4)/C(45,6)
const CONSEC_P = 1 - comb(40, 6) / TOTAL;

// sd 를 주면 기대에서 몇 표준편차 떨어졌는지 한 칸 더 적는다
function numberTable(rows, expected, sd) {
    const signed = v => (v >= 0 ? '+' : '') + v;
    return table([['번호', 'Number'], ['출현 횟수', 'Appearances'], ['회차 대비', 'Share of draws'], ['기대보다', 'vs expected']]
        .concat(sd ? [['표준편차', 'Std. deviations']] : []), rows.map(r => {
        const diff = r.count - expected;
        const row = [ball(r.number), times(fmt(r.count)), pct(r.count, N), signed(f1(diff))];
        return sd ? row.concat([signed((diff / sd).toFixed(2)) + 'σ']) : row;
    }));
}

/* ───── 정규분포 그래프 ───── */
// 홈 카드와 달리 여기서는 SVG 를 미리 그려 넣는다 — JS 없이도 보이고 검색 로봇도 읽는다.

// 표준정규 누적분포. Abramowitz–Stegun 7.1.26 근사, 오차 1.5e-7
function normCdf(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
const normPdf = z => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);

function niceStep(max, want) {
    const raw = max / want;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 5, 10].map(k => k * mag).find(s => s >= raw);
}

// 정수값 히스토그램 + 이론 정규곡선 + 평균±1σ 음영.
// o.bins: [{ lo, hi, count, numbers? }] — lo~hi 는 정수 구간(양끝 포함), 폭이 모두 같아야 한다.
// numbers 가 있으면 막대 대신 번호 공을 쌓는다.
function normalChart(o) {
    const L = 40, R = 12, T = 22, B = 40;
    const width = o.bins[0].hi - o.bins[0].lo + 1;
    const x0 = o.bins[0].lo - 0.5;
    const x1 = o.bins[o.bins.length - 1].hi + 0.5;
    // 곡선 높이 = 구간 하나에 기대되는 개수
    const curveAt = v => o.total * width * normPdf((v - o.mean) / o.sd) / o.sd;
    const peak = Math.max(curveAt(o.mean), ...o.bins.map(b => b.count));
    const step = o.numbers ? 1 : niceStep(peak, 5);
    const yMax = Math.ceil(peak * 1.08 / step) * step;
    // 공을 쌓는 그래프는 공 한 칸 높이가 먼저 정해져야 번호가 읽힌다
    const W = o.numbers ? 560 : 680;
    const H = o.numbers ? T + B + yMax * 24 : 300;
    const X = v => L + (v - x0) / (x1 - x0) * (W - L - R);
    const Y = v => H - B - v / yMax * (H - T - B);
    const r2 = v => Math.round(v * 10) / 10;
    const out = [];

    const lo1 = Math.max(x0, o.mean - o.sd);
    const hi1 = Math.min(x1, o.mean + o.sd);
    out.push(`<rect class="dist-band" x="${r2(X(lo1))}" y="${T}" width="${r2(X(hi1) - X(lo1))}" height="${H - T - B}"/>`);
    out.push(`<line class="dist-mean" x1="${r2(X(o.mean))}" x2="${r2(X(o.mean))}" y1="${T}" y2="${H - B}"/>`);

    const yStep = o.numbers ? Math.max(1, niceStep(yMax, 5)) : step;
    for (let v = 0; v <= yMax; v += yStep) {
        out.push(`<line class="dist-grid" x1="${L}" x2="${W - R}" y1="${r2(Y(v))}" y2="${r2(Y(v))}"/>`);
        out.push(`<text class="dist-tick" x="${L - 6}" y="${r2(Y(v) + 4)}" text-anchor="end">${fmt(v)}</text>`);
    }

    // 공은 곡선 위에 얹어 번호가 가려지지 않게, 막대는 곡선 아래에 둔다
    const pts = [];
    for (let i = 0; i <= 120; i++) {
        const v = x0 + (x1 - x0) * i / 120;
        pts.push(`${r2(X(v))},${r2(Y(curveAt(v)))}`);
    }
    const curve = `<polyline class="dist-curve" points="${pts.join(' ')}"/>`;
    if (o.numbers) out.push(curve);

    const bw = X(width) - X(0);
    o.bins.forEach(b => {
        const left = X(b.lo - 0.5);
        const range = b.lo === b.hi ? `${b.lo}` : `${b.lo}~${b.hi}`;
        if (o.numbers) {
            const size = Math.min(bw - 4, Y(0) - Y(1) - 2);
            b.numbers.forEach((n, i) => {
                const cy = Y(i + 0.5);
                out.push(`<g class="dist-ball" data-band="${LottoStats.bandOf(n)}"><title>${n}번: ${fmt(b.counts[i])}회</title>`
                    + `<circle cx="${r2(left + bw / 2)}" cy="${r2(cy)}" r="${r2(size / 2)}"/>`
                    + `<text x="${r2(left + bw / 2)}" y="${r2(cy + 4)}" text-anchor="middle">${n}</text></g>`);
            });
        } else if (b.count) {
            out.push(`<rect class="dist-bar" x="${r2(left + 1)}" y="${r2(Y(b.count))}" width="${r2(bw - 2)}" height="${r2(Y(0) - Y(b.count))}"><title>${range}: ${fmt(b.count)}${o.unit} (${pct(b.count, o.total)})</title></rect>`);
        }
    });
    if (!o.numbers) out.push(curve);
    [[o.mean - o.sd, '−1σ', '−1σ'], [o.mean, '평균', 'mean'], [o.mean + o.sd, '+1σ', '+1σ']].forEach(([v, name, nameEn]) => {
        if (v < x0 || v > x1) return;
        out.push(`<text class="dist-mark" x="${r2(X(v))}" y="${T - 7}" text-anchor="middle" data-i18n-en="${nameEn} ${f1(v)}">${name} ${f1(v)}</text>`);
    });

    out.push(`<line class="dist-axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`);
    const every = Math.max(1, Math.ceil(o.bins.length / 12));
    o.bins.forEach((b, i) => {
        if (i % every) return;
        out.push(`<text class="dist-tick" x="${r2(X(b.lo - 0.5))}" y="${H - B + 16}" text-anchor="middle">${b.lo}</text>`);
    });
    out.push(`<text class="dist-tick" x="${r2(X(x1))}" y="${H - B + 16}" text-anchor="end">${o.bins[o.bins.length - 1].hi + 1}</text>`);
    out.push(`<text class="dist-label" x="${r2((L + W - R) / 2)}" y="${H - 4}" text-anchor="middle"${o.xLabelEn ? ` data-i18n-en="${esc(o.xLabelEn)}"` : ''}>${esc(o.xLabel)}</text>`);

    return [
        `<figure class="dist-figure${o.numbers ? ' is-dots' : ''}">`,
        `<svg class="dist-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">`,
        out.join('\n'),
        '</svg>',
        '<figcaption class="dist-legend">',
        `<span><i class="key-bar${o.numbers ? ' key-ball' : ''}"></i><span${o.barLabelEn ? ` data-i18n-en="${esc(o.barLabelEn)}"` : ''}>${esc(o.barLabel)}</span></span>`,
        '<span><i class="key-curve"></i><span data-i18n-en="theoretical normal curve">이론 정규분포</span></span>',
        '<span><i class="key-band"></i><span data-i18n-en="mean ±1σ (about 68%)">평균 ±1σ (약 68%)</span></span>',
        '</figcaption>',
        '</figure>',
    ].join('\n');
}

// 값 목록을 폭 width 인 정수 구간으로 나눈다. 시작은 width 의 배수.
function binsOf(values, width) {
    const lo = Math.floor(Math.min(...values) / width) * width;
    const hi = Math.floor(Math.max(...values) / width) * width;
    const bins = [];
    for (let s = lo; s <= hi; s += width) bins.push({ lo: s, hi: s + width - 1, count: 0 });
    values.forEach(v => bins[Math.floor((v - lo) / width)].count++);
    return bins;
}

const within = (values, mean, sd, k) => values.filter(v => Math.abs(v - mean) <= k * sd).length;

const STATS = [];

(() => {
    const e = extremesOf(stats.frequency);
    const ranked = stats.frequency.slice().sort((a, b) => b.count - a.count || a.number - b.number);

    // 번호 45개가 각자 몇 번 나왔는지를 하나의 분포로 본다. 공 하나가 번호 하나다.
    const counts = stats.frequency.map(r => r.count);
    const bins = binsOf(counts, 5);
    bins.forEach(b => {
        const inBin = stats.frequency.filter(r => r.count >= b.lo && r.count <= b.hi).sort((p, q) => p.count - q.count || p.number - q.number);
        b.numbers = inBin.map(r => r.number);
        b.counts = inBin.map(r => r.count);
    });
    const actualMean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const actualSd = Math.sqrt(counts.reduce((a, c) => a + (c - actualMean) ** 2, 0) / (counts.length - 1));
    const in1 = within(counts, EXP_NUM, SD_NUM, 1);
    const in2 = within(counts, EXP_NUM, SD_NUM, 2);
    const distBlock = [
        pEn(`번호 하나가 한 회차에 뽑힐 확률은 6/45입니다. ${fmt(N)}회를 추첨하면 번호마다 출현 횟수는 평균 ${f1(EXP_NUM)}회, 표준편차 ${f1(SD_NUM)}회인 정규분포에 가깝게 흩어져야 합니다. 아래 공 하나가 번호 하나입니다.`,
            `A given number has a 6-in-45 chance of being drawn. Over ${fmt(N)} draws, the counts should scatter close to a normal distribution with a mean of ${f1(EXP_NUM)} and a standard deviation of ${f1(SD_NUM)}. Each ball below is one number.`),
        normalChart({
            bins, numbers: true, total: 45, mean: EXP_NUM, sd: SD_NUM, unit: '개',
            xLabel: '출현 횟수 (5회 단위)', xLabelEn: 'Appearances (bands of 5)',
            barLabel: '번호 (공 1개 = 번호 1개)', barLabelEn: 'numbers (one ball = one number)',
            aria: `번호 45개의 출현 횟수 분포. 이론 평균 ${f1(EXP_NUM)}회, 표준편차 ${f1(SD_NUM)}회`,
        }),
        table([['항목', 'Measure'], ['이론 (정규분포)', 'Theory (normal)'], [`실제 (${RANGE})`, `Actual (draws 1–${N})`]], [
            [en('평균', 'Mean'), times(f1(EXP_NUM)), times(f1(actualMean))],
            [en('표준편차', 'Standard deviation'), times(f1(SD_NUM)), times(f1(actualSd))],
            [en(`평균 ±1σ (${f1(EXP_NUM - SD_NUM)}~${f1(EXP_NUM + SD_NUM)}회)`, `Within ±1σ (${f1(EXP_NUM - SD_NUM)}–${f1(EXP_NUM + SD_NUM)})`),
                en('68.3% · 약 31개', '68.3% · about 31 numbers'), en(`${pct(in1, 45)} · ${in1}개`, `${pct(in1, 45)} · ${in1} numbers`)],
            [en(`평균 ±2σ (${f1(EXP_NUM - 2 * SD_NUM)}~${f1(EXP_NUM + 2 * SD_NUM)}회)`, `Within ±2σ (${f1(EXP_NUM - 2 * SD_NUM)}–${f1(EXP_NUM + 2 * SD_NUM)})`),
                en('95.4% · 약 43개', '95.4% · about 43 numbers'), en(`${pct(in2, 45)} · ${in2}개`, `${pct(in2, 45)} · ${in2} numbers`)],
        ], 'kv-table'),
        pEn(`${in2 === 45 ? '45개 번호가 모두' : `45개 중 ${in2}개가`} 평균 ±2σ 안에 있습니다. "많이 나온 번호"도 우연으로 충분히 나올 만큼만 많이 나왔다는 뜻입니다.`,
            `${in2 === 45 ? 'All 45 numbers sit' : `${in2} of the 45 numbers sit`} within ±2σ of the mean. In other words, even the "frequent" numbers are only as frequent as chance alone would produce.`),
    ].join('\n');

    STATS.push({
        file: 'statistics-frequency.html', anchor: 'stat-frequency', short: '많이 나온 번호 순위', shortEn: 'Most frequent numbers',
        title: `로또 많이 나온 번호 순위 · 번호별 출현 횟수 (${RANGE})`,
        h1: '로또 많이 나온 번호 순위', h1En: 'Most Frequent Lotto Numbers',
        desc: `로또 역대 ${RANGE} 가장 많이 나온 번호 순위와 1~45번 번호별 출현 횟수. 제일 많이 나온 번호는 ${numsText(e.top)} ${e.max}회, 가장 적게 나온 번호는 ${numsText(e.bottom)} ${e.min}회.`,
        fact: `1위 ${numsText(e.top)} ${e.max}회 · 최소 ${numsText(e.bottom)} ${e.min}회`,
        factEn: `top ${e.top.map(r => r.number).join('·')} ${e.max}× · lowest ${e.bottom.map(r => r.number).join('·')} ${e.min}×`,
        lead: `역대 ${RANGE} 동안 제일 많이 나온 번호는 <strong>${numsText(e.top)}(${e.max}회)</strong>, 가장 적게 나온 번호는 <strong>${numsText(e.bottom)}(${e.min}회)</strong>입니다. 한 회차에 6개를 뽑으므로 번호 하나의 기대 출현은 ${f1(EXP_NUM)}회입니다.`,
        leadEn: `Across draws 1–${N}, the number drawn most often is <strong>${e.top.map(r => r.number).join('·')} (${e.max} times)</strong> and the one drawn least often is <strong>${e.bottom.map(r => r.number).join('·')} (${e.min} times)</strong>. Six numbers are drawn each time, so a single number is expected to appear ${f1(EXP_NUM)} times.`,
        body: [
            h2En('많이 나온 번호 순위 Top 10', 'Top 10 most frequent numbers'),
            rankList(ranked.slice(0, 10), r => times(fmt(r.count))),
            h2En('적게 나온 번호 Top 10', 'Top 10 least frequent numbers'),
            rankList(ranked.slice(-10).reverse(), r => times(fmt(r.count))),
            h2En('출현 횟수의 정규분포', 'How the counts are distributed'),
            distBlock,
            h2En('1~45번 번호별 출현 횟수', 'Appearances for every number, 1 to 45'),
            numberTable(stats.frequency, EXP_NUM, SD_NUM),
            pEn(`표준편차는 약 ${f1(SD_NUM)}회입니다. 1위 번호는 기대보다 ${f1(e.max - EXP_NUM)}회(+${f1((e.max - EXP_NUM) / SD_NUM)} 표준편차), 최소 번호는 ${f1(EXP_NUM - e.min)}회(-${f1((EXP_NUM - e.min) / SD_NUM)} 표준편차) 벗어나 있습니다. 번호 45개를 한꺼번에 보면 공평한 추첨에서도 양 끝이 이 정도로 벌어집니다.`,
                `The standard deviation is about ${f1(SD_NUM)}. The top number sits ${f1(e.max - EXP_NUM)} above expectation (+${f1((e.max - EXP_NUM) / SD_NUM)} SD) and the lowest sits ${f1(EXP_NUM - e.min)} below it (−${f1((EXP_NUM - e.min) / SD_NUM)} SD). Looking at all 45 numbers together, a perfectly fair draw spreads its extremes about this far apart.`),
        ],
    });
})();

(() => {
    const e = extremesOf(stats.bonus);
    const ranked = stats.bonus.slice().sort((a, b) => b.count - a.count || a.number - b.number);
    STATS.push({
        file: 'statistics-bonus.html', anchor: 'stat-bonus', short: '보너스 번호', shortEn: 'Bonus ball',
        title: `로또 보너스 번호란? 역대 보너스 번호 통계 (${RANGE})`,
        h1: '로또 보너스 번호 통계', h1En: 'Bonus Ball Statistics',
        desc: `로또 보너스 번호의 의미(2등 판정)와 역대 ${RANGE} 보너스 번호별 출현 횟수. 가장 많이 나온 보너스 번호는 ${numsText(e.top)} ${e.max}회.`,
        fact: `최다 ${numsText(e.top)} ${e.max}회 · 최소 ${numsText(e.bottom)} ${e.min}회`,
        factEn: `most ${e.top.map(r => r.number).join('·')} ${e.max}× · fewest ${e.bottom.map(r => r.number).join('·')} ${e.min}×`,
        lead: `보너스 번호는 당첨번호 6개를 뽑은 뒤 하나 더 뽑는 번호입니다. 한 회차에 하나뿐이라 번호 하나의 기대 출현은 ${f1(EXP_BONUS)}회이고, 역대 가장 많이 나온 보너스 번호는 <strong>${numsText(e.top)}(${e.max}회)</strong>입니다.`,
        leadEn: `The bonus ball is drawn after the six winning numbers. Only one is drawn each time, so a given number is expected to appear ${f1(EXP_BONUS)} times; the most frequent bonus ball so far is <strong>${e.top.map(r => r.number).join('·')} (${e.max} times)</strong>.`,
        body: [
            h2En('보너스 번호는 언제 쓰이나', 'When the bonus ball matters'),
            table([['맞힌 개수', 'Numbers matched'], ['보너스 번호', 'Bonus ball'], ['등수', 'Prize tier']], [
                [en('6개', '6 numbers'), en('상관없음', 'not used'), en('1등', '1st prize')],
                [en('5개', '5 numbers'), en('<strong>일치</strong>', '<strong>matched</strong>'), en('2등', '2nd prize')],
                [en('5개', '5 numbers'), en('불일치', 'not matched'), en('3등', '3rd prize')],
                [en('4개', '4 numbers'), en('상관없음', 'not used'), en('4등', '4th prize')],
                [en('3개', '3 numbers'), en('상관없음', 'not used'), en('5등', '5th prize')],
            ]),
            pEn('보너스 번호는 2등과 3등을 가를 때만 봅니다. 당첨번호 4개에 보너스 번호가 맞아도 4등이고, 3개에 보너스가 맞아도 5등입니다.',
                'The bonus ball only separates second prize from third. Matching four numbers plus the bonus is still fourth prize, and three plus the bonus is still fifth.'),
            h2En('많이 나온 보너스 번호 Top 10', 'Top 10 bonus balls'),
            rankList(ranked.slice(0, 10), r => times(fmt(r.count))),
            h2En('보너스 번호별 전체 표', 'Every bonus ball in one table'),
            numberTable(stats.bonus, EXP_BONUS),
        ],
    });
})();

(() => {
    const top = topBy(stats.oddEven);
    const rows = stats.oddEven.map(r => {
        const odd = Number(r.label.match(/\d/)[0]);
        const theory = comb(23, odd) * comb(22, 6 - odd) / TOTAL;
        return [labEn(r), times(fmt(r.count)), pct(r.count, N), (theory * 100).toFixed(1) + '%'];
    });
    STATS.push({
        file: 'statistics-even-odd.html', anchor: 'stat-even-odd', short: '홀짝 비율', shortEn: 'Odd / even split',
        title: `로또 홀짝 비율 통계 · 홀짝 분석 (${RANGE})`,
        h1: '로또 홀짝 비율', h1En: 'Odd / Even Split',
        desc: `로또 ${RANGE} 당첨번호 6개의 홀수·짝수 비율을 이론 확률과 나란히 분석했습니다. 가장 많은 형태는 ${top.label}(${pct(top.count, N)}).`,
        fact: `최다 ${top.label} ${pct(top.count, N)}`,
        factEn: `most common ${top.labelEn || top.label} ${pct(top.count, N)}`,
        lead: `${RANGE} 중 가장 많이 나온 형태는 <strong>${esc(top.label)}</strong>로 ${fmt(top.count)}회(${pct(top.count, N)})입니다. 1~45에는 홀수 23개, 짝수 22개가 있어 이론상으로도 홀3 짝3이 가장 흔합니다.`,
        leadEn: `The most common shape across draws 1–${N} is <strong>${esc(top.labelEn || top.label)}</strong>, seen ${fmt(top.count)} times (${pct(top.count, N)}). Of the numbers 1–45, 23 are odd and 22 are even, so three odd and three even is also the most likely shape in theory.`,
        body: [
            table([['형태', 'Shape'], ['나온 횟수', 'Draws'], ['비율', 'Share'], ['이론 확률', 'Theoretical']], rows),
            pEn('이론 확률은 45개 중 6개를 뽑을 때 해당 형태가 나올 확률입니다. 실제 비율이 이론값에 가까울수록 추첨이 고르게 이뤄졌다는 뜻입니다.',
                'The theoretical figure is the chance of that shape when six numbers are drawn from 45. The closer the actual share sits to it, the more even the draws have been.'),
        ],
    });
})();

(() => {
    const top = topBy(stats.lowHigh);
    const rows = stats.lowHigh.map(r => {
        const low = Number(r.label.match(/\d/)[0]);
        const theory = comb(22, low) * comb(23, 6 - low) / TOTAL;
        return [labEn(r), times(fmt(r.count)), pct(r.count, N), (theory * 100).toFixed(1) + '%'];
    });
    STATS.push({
        file: 'statistics-low-high.html', anchor: 'stat-low-high', short: '저고 비율', shortEn: 'Low / high split',
        title: `로또 저고(고저) 비율 통계 (${RANGE})`,
        h1: '로또 저고 비율', h1En: 'Low / High Split',
        desc: `로또 ${RANGE} 당첨번호의 낮은 번호(1~22)와 높은 번호(23~45) 비율을 이론 확률과 함께 정리했습니다. 최다 형태 ${top.label}.`,
        fact: `최다 ${top.label} ${pct(top.count, N)}`,
        factEn: `most common ${top.labelEn || top.label} ${pct(top.count, N)}`,
        lead: `1~22를 저번호, 23~45를 고번호로 나눴습니다. ${RANGE} 중 가장 많은 형태는 <strong>${esc(top.label)}</strong>로 ${fmt(top.count)}회(${pct(top.count, N)})입니다.`,
        leadEn: `Numbers 1–22 count as low and 23–45 as high. The most common shape across draws 1–${N} is <strong>${esc(top.labelEn || top.label)}</strong>, seen ${fmt(top.count)} times (${pct(top.count, N)}).`,
        body: [
            table([['형태', 'Shape'], ['나온 횟수', 'Draws'], ['비율', 'Share'], ['이론 확률', 'Theoretical']], rows),
            pEn('저번호 22개, 고번호 23개라 이론상 저3 고3이 가장 흔하고, 한쪽으로 6개가 몰리는 경우는 드뭅니다.',
                'There are 22 low numbers and 23 high ones, so three of each is the most likely shape in theory, and all six falling on one side is rare.'),
        ],
    });
})();

(() => {
    const withRun = N - stats.consecutive[0].count;
    const rows = stats.consecutive.map(r => [labEn(r), times(fmt(r.count)), pct(r.count, N)]);
    STATS.push({
        file: 'statistics-consecutive.html', anchor: 'stat-consecutive', short: '연속번호', shortEn: 'Consecutive numbers',
        title: `로또 연속번호 통계 · 연속번호 확률 (${RANGE})`,
        h1: '로또 연속번호 통계', h1En: 'Consecutive Numbers',
        desc: `로또 ${RANGE} 중 연속번호가 포함된 회차는 ${fmt(withRun)}회(${pct(withRun, N)})입니다. 연속번호 확률과 2연속·3연속 이상 비율을 정리했습니다.`,
        fact: `연속번호 포함 ${pct(withRun, N)} (이론 ${(CONSEC_P * 100).toFixed(1)}%)`,
        factEn: `with a run ${pct(withRun, N)} (theory ${(CONSEC_P * 100).toFixed(1)}%)`,
        lead: `${RANGE} 중 <strong>${fmt(withRun)}회(${pct(withRun, N)})</strong>에서 이어지는 번호가 하나 이상 나왔습니다. 6개를 무작위로 뽑을 때 연속번호가 하나라도 섞일 확률은 ${(CONSEC_P * 100).toFixed(1)}%로, 절반이 넘습니다.`,
        leadEn: `In <strong>${fmt(withRun)} of draws 1–${N} (${pct(withRun, N)})</strong> at least one pair of consecutive numbers came up. Drawing six numbers at random, the chance of any run appearing is ${(CONSEC_P * 100).toFixed(1)}% \u2014 more than half the time.`,
        body: [
            table([['가장 긴 연속', 'Longest run'], ['나온 횟수', 'Draws'], ['비율', 'Share']], rows),
            pEn('한 회차에서 가장 길게 이어진 묶음을 기준으로 셉니다. 예를 들어 3·4·5와 20·21이 함께 나오면 3연속으로 셉니다. 각 회차에 어떤 번호가 이어졌는지는 <a href="draws.html">회차별 당첨번호</a>에서 회차를 눌러 볼 수 있습니다.',
                'Each draw is counted by its longest run. If 3·4·5 and 20·21 both appear, the draw counts as a run of three. To see which numbers ran consecutively in a given draw, open it from <a href="draws.html">the list of past draws</a>.'),
        ],
    });
})();

(() => {
    const top = topBy(stats.sum);
    const sums = draws.map(d => d.numbers.reduce((a, b) => a + b, 0));
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
    const rows = stats.sum.map(r => [labEn(r), times(fmt(r.count)), pct(r.count, N)]);

    // 1~45 에서 6개를 뽑은 합: 평균 6×23, 분산 6·(45²−1)/12·(45−6)/(45−1) (비복원 추출)
    const MEAN = 6 * 23;
    const SD = Math.sqrt(6 * (45 * 45 - 1) / 12 * 39 / 44);
    const sd = Math.sqrt(sums.reduce((a, s) => a + (s - avg) ** 2, 0) / (sums.length - 1));
    const in1 = within(sums, MEAN, SD, 1);
    const in2 = within(sums, MEAN, SD, 2);
    const lo1 = Math.ceil(MEAN - SD), hi1 = Math.floor(MEAN + SD);
    const lo2 = Math.ceil(MEAN - 2 * SD), hi2 = Math.floor(MEAN + 2 * SD);
    const theory = (a, b) => normCdf((b + 0.5 - MEAN) / SD) - normCdf((a - 0.5 - MEAN) / SD);
    const distBlock = [
        h2En('합계는 정규분포를 따른다', 'The sum follows a normal distribution'),
        pEn(`번호 6개를 더한 값은 여러 수를 더한 값이라 가운데로 모이고 좌우가 대칭인 정규분포에 가까워집니다. 1~45에서 6개를 뽑으면 이론상 평균 ${MEAN}, 표준편차 ${f1(SD)}입니다. 막대는 실제 ${RANGE}의 합계를 10 단위로 센 것이고, 곡선은 이론 정규분포입니다.`,
            `Adding six numbers together pulls the result toward the middle, giving a roughly symmetrical, normal-looking distribution. Drawing six numbers from 1–45 gives a theoretical mean of ${MEAN} and a standard deviation of ${f1(SD)}. The bars count the actual sums from draws 1–${N} in steps of 10; the curve is the theoretical distribution.`),
        normalChart({
            bins: binsOf(sums, 10), total: N, mean: MEAN, sd: SD, unit: '회',
            xLabel: '당첨번호 6개의 합계 (10 단위)', xLabelEn: 'Sum of the six numbers (bands of 10)',
            barLabel: `실제 ${RANGE}`, barLabelEn: `actual, draws 1–${N}`,
            aria: `당첨번호 합계 분포. 실제 평균 ${f1(avg)}, 이론 평균 ${MEAN}, 표준편차 ${f1(SD)}`,
        }),
        table([['항목', 'Measure'], ['이론 (정규분포)', 'Theory (normal)'], [`실제 (${RANGE})`, `Actual (draws 1–${N})`]], [
            [en('평균', 'Mean'), String(MEAN), f1(avg)],
            [en('표준편차', 'Standard deviation'), f1(SD), f1(sd)],
            [en(`합계 ${lo1}~${hi1} (평균 ±1σ)`, `Sum ${lo1}–${hi1} (±1σ)`), pct(theory(lo1, hi1), 1),
                en(`${pct(in1, N)} · ${fmt(in1)}회`, `${pct(in1, N)} · ${fmt(in1)} draws`)],
            [en(`합계 ${lo2}~${hi2} (평균 ±2σ)`, `Sum ${lo2}–${hi2} (±2σ)`), pct(theory(lo2, hi2), 1),
                en(`${pct(in2, N)} · ${fmt(in2)}회`, `${pct(in2, N)} · ${fmt(in2)} draws`)],
        ], 'kv-table'),
        pEn(`당첨번호의 약 3분의 2는 합계가 <strong>${lo1}~${hi1}</strong> 사이였고, ${lo2}보다 작거나 ${hi2}보다 큰 합계는 ${fmt(N - in2)}회(${pct(N - in2, N)})뿐이었습니다. 다만 합계가 가운데인 조합은 그만큼 <em>개수가 많을</em> 뿐, 조합 하나하나의 1등 확률은 모두 같습니다.`,
            `About two thirds of all draws summed to between <strong>${lo1} and ${hi1}</strong>, and only ${fmt(N - in2)} draws (${pct(N - in2, N)}) fell below ${lo2} or above ${hi2}. Note that a middling sum is common only because <em>more combinations</em> add up to it — each individual combination still has exactly the same chance.`),
    ].join('\n');

    STATS.push({
        file: 'statistics-sum.html', anchor: 'stat-sum', short: '번호 합계', shortEn: 'Sum of numbers',
        title: `로또 번호 합계 분포 통계 (${RANGE})`,
        h1: '로또 당첨번호 합계 분포', h1En: 'Distribution of the Sum of Winning Numbers',
        desc: `로또 ${RANGE} 당첨번호 6개의 합계 분포입니다. 평균 ${f1(avg)}, 가장 많은 구간은 ${top.label}(${pct(top.count, N)}).`,
        fact: `평균 ${f1(avg)} · 최다 구간 ${top.label}`,
        factEn: `average ${f1(avg)} · most common band ${top.label}`,
        lead: `${RANGE} 당첨번호 합계의 평균은 <strong>${f1(avg)}</strong>이고, 가장 많이 나온 구간은 <strong>${esc(top.label)}</strong>(${pct(top.count, N)})입니다. 이론 평균은 138입니다.`,
        leadEn: `Across draws 1–${N} the winning numbers add up to <strong>${f1(avg)}</strong> on average, and the most common band is <strong>${esc(top.label)}</strong> (${pct(top.count, N)}). The theoretical average is 138.`,
        body: [
            distBlock,
            h2En('합계 구간별 나온 횟수', 'How often each sum band came up'),
            table([['합계 구간', 'Sum band'], ['나온 횟수', 'Draws'], ['비율', 'Share']], rows),
            pEn(`가장 작은 합계는 ${Math.min.apply(null, sums)}, 가장 큰 합계는 ${Math.max.apply(null, sums)}였습니다. 합계는 가운데로 몰리는 값이라 양 끝 구간은 드물게 나옵니다.`,
                `The smallest sum was ${Math.min.apply(null, sums)} and the largest ${Math.max.apply(null, sums)}. Sums cluster in the middle, so the bands at either end come up rarely.`),
        ],
    });
})();

(() => {
    const zero = stats.winners[0].count;
    const top = topBy(stats.winners);
    const known = draws.filter(d => typeof d.firstPrizeWinners === 'number');
    const avg = known.reduce((a, d) => a + d.firstPrizeWinners, 0) / Math.max(1, known.length);
    const most = known.slice().sort((a, b) => b.firstPrizeWinners - a.firstPrizeWinners)[0];
    const rows = stats.winners.map(r => [labEn(r), times(fmt(r.count)), pct(r.count, N)]);
    STATS.push({
        file: 'statistics-prize.html', anchor: 'stat-prize', short: '1등 당첨자 수', shortEn: 'First-prize winners',
        title: `로또 1등 당첨자 수 통계 · 이월 횟수 (${RANGE})`,
        h1: '로또 1등 당첨자 수 통계', h1En: 'Number of First-Prize Winners',
        desc: `로또 ${RANGE} 회차별 1등 당첨자 수 분포입니다. 1등이 없어 이월된 회차 ${zero}회, 회차당 평균 ${f1(avg)}명.`,
        fact: `이월 ${zero}회 · 평균 ${f1(avg)}명`,
        factEn: `${zero} rollovers · ${f1(avg)} winners on average`,
        lead: `${RANGE} 동안 1등 당첨자는 회차당 평균 <strong>${f1(avg)}명</strong>이었습니다. 1등이 한 명도 없어 당첨금이 이월된 회차는 <strong>${zero}회</strong>입니다. 가장 흔한 구간은 ${esc(top.label)}입니다.`,
        leadEn: `Across draws 1–${N} there were <strong>${f1(avg)} first-prize winners</strong> per draw on average. In <strong>${zero} draws</strong> nobody won first prize and the money rolled over. The most common band is ${esc(top.labelEn || top.label)}.`,
        body: [
            table([['1등 당첨자 수', 'First-prize winners'], ['회차 수', 'Draws'], ['비율', 'Share']], rows),
            most ? pEn(`1등이 가장 많이 나온 회차는 <a href="round/${most.round}.html">${most.round}회</a>(${most.date})로 ${most.firstPrizeWinners}명이었습니다. 당첨자가 많을수록 1인당 당첨금은 줄어듭니다. 역대 1인당 당첨금 순위는 <a href="top-prize.html" data-i18n-en="the Top 50 jackpots">1등 당첨금 TOP 50</a>에서 볼 수 있습니다.`,
                `The draw with the most first-prize winners was <a href="round/${most.round}.html">draw ${most.round}</a> (${most.date}), with ${most.firstPrizeWinners} of them. The more winners there are, the smaller each share. The largest individual payouts are listed in <a href="top-prize.html">the Top 50 jackpots</a>.`) : '',
        ],
    });
})();

(() => {
    const t = stats.trend;
    const rows = list => list.map((r, i) => [rank(i + 1), ball(r.number), times(fmt(r.recent)), times(fmt(r.overall))]);
    STATS.push({
        file: 'statistics-trend.html', anchor: 'stat-trend', short: `최근 ${t.window}회 많이·적게`, shortEn: `Hot and cold, last ${t.window} draws`,
        title: `로또 최근 ${t.window}회 많이 나온 번호 · 적게 나온 번호`,
        h1: `로또 최근 ${t.window}회 많이 나온 번호와 적게 나온 번호`,
        desc: `로또 최근 ${t.window}회(${stats.latestRound - t.window + 1}~${stats.latestRound}회) 동안 많이 나온 번호와 적게 나온 번호 Top 10. 최다 ${t.hot[0].number}번 ${t.hot[0].recent}회.`,
        fact: `최다 ${t.hot[0].number}번 ${t.hot[0].recent}회 · 최소 ${t.cold[0].number}번 ${t.cold[0].recent}회`,
        factEn: `most ${t.hot[0].number} (${t.hot[0].recent}×) · fewest ${t.cold[0].number} (${t.cold[0].recent}×)`,
        lead: `${stats.latestRound - t.window + 1}~${stats.latestRound}회 ${t.window}회 동안 가장 많이 나온 번호는 <strong>${t.hot[0].number}번(${t.hot[0].recent}회)</strong>, 가장 적게 나온 번호는 <strong>${t.cold[0].number}번(${t.cold[0].recent}회)</strong>입니다. ${t.window}회 동안 한 번호의 기대 출현은 ${f1(t.window * 6 / 45)}회입니다.`,
        leadEn: `Over draws ${stats.latestRound - t.window + 1}\u2013${stats.latestRound} (${t.window} draws), the most frequent number is <strong>${t.hot[0].number} (${t.hot[0].recent} times)</strong> and the least frequent is <strong>${t.cold[0].number} (${t.cold[0].recent} times)</strong>. Over ${t.window} draws a number is expected to appear ${f1(t.window * 6 / 45)} times.`,
        body: [
            h2En('많이 나온 번호', 'Most frequent numbers'),
            table([['순위', 'Rank'], ['번호', 'Number'], [`최근 ${t.window}회`, `Last ${t.window} draws`], ['전 회차', 'All draws']], rows(t.hot)),
            h2En('적게 나온 번호', 'Least frequent numbers'),
            table([['순위', 'Rank'], ['번호', 'Number'], [`최근 ${t.window}회`, `Last ${t.window} draws`], ['전 회차', 'All draws']], rows(t.cold)),
            pEn('최근 기간은 표본이 작아 순위가 매주 크게 바뀝니다. 전 회차 열과 함께 보면 일시적인 쏠림인지 알 수 있습니다.',
                'A short window is a small sample, so this ranking moves a lot from week to week. Reading it beside the all-draws column shows whether a lead is only temporary.'),
        ],
    });
})();

(() => {
    const p = stats.pairs;
    const rows = p.map((r, i) => [rank(i + 1), ball(r.a) + ' ' + ball(r.b), times(fmt(r.count))]);
    STATS.push({
        file: 'statistics-pair.html', anchor: 'stat-pair', short: '궁합수 순위', shortEn: 'Number pairs',
        title: `로또 궁합수 순위 · 함께 나온 번호 Top ${p.length} (${RANGE})`,
        h1: '로또 궁합수 (함께 나온 번호) 순위', h1En: 'Numbers That Appear Together',
        desc: `로또 ${RANGE} 한 회차에 같이 나온 번호 쌍, 궁합수 순위 Top ${p.length}. 1위 ${p[0].a}·${p[0].b}번 ${p[0].count}회.`,
        fact: `1위 ${p[0].a}·${p[0].b}번 ${p[0].count}회`,
        factEn: `top pair ${p[0].a}\u00b7${p[0].b}, ${p[0].count}×`,
        lead: `궁합수는 한 회차에 자주 같이 나온 번호 쌍입니다. ${RANGE} 동안 가장 자주 같이 나온 쌍은 <strong>${p[0].a}번과 ${p[0].b}번(${p[0].count}회)</strong>입니다. 특정 두 번호가 한 회차에 함께 나올 기대 횟수는 ${f1(PAIR_EXP)}회입니다.`,
        leadEn: `These are the pairs of numbers that have come up together most often. Across draws 1–${N} the most frequent pair is <strong>${p[0].a} and ${p[0].b} (${p[0].count} times)</strong>. Any given pair is expected to appear together ${f1(PAIR_EXP)} times.`,
        body: [
            table([['순위', 'Rank'], ['번호 쌍', 'Pair'], ['함께 나온 횟수', 'Times together']], rows),
            pEn('쌍은 모두 990가지라 그중 가장 많은 쌍은 기대값보다 꽤 높게 나오는 게 보통입니다. 번호 하나를 골라 그 번호의 궁합수를 보는 기능은 <a href="index.html#detail-head">홈의 상세 분석</a>(이용권)에 있습니다.',
                'There are 990 possible pairs, so the busiest one normally sits well above the expected count. To pick a number and see the numbers drawn with it, use <a href="index.html#detail-head">the detailed analysis on the home page</a> (paid).'),
        ],
    });
})();

(() => {
    const g = stats.gaps.slice(0, 15);
    const lastSeen = n => {
        const d = draws.find(x => x.numbers.indexOf(n) !== -1);
        return d ? `<a href="round/${d.round}.html" data-i18n-en="Draw ${d.round}">${d.round}회</a> (${d.date})` : en('없음', 'never');
    };
    const rows = g.map((r, i) => [rank(i + 1), ball(r.number),
        r.gap === 0 ? en('지난 회차', 'the last draw') : en(`${r.gap}회차째`, `${r.gap} draws`), lastSeen(r.number)]);
    STATS.push({
        file: 'statistics-gap.html', anchor: 'stat-gap', short: '미출수 (장기 미출현)', shortEn: 'Longest absences',
        title: `로또 미출수 · 장기 미출현 번호 순위 (${stats.latestRound}회 기준)`,
        h1: '로또 미출수 (오래 안 나온 번호)', h1En: 'Numbers Absent the Longest',
        desc: `로또 ${stats.latestRound}회 기준 장기 미출수, 가장 오래 안 나온 번호 순위입니다. 1위 ${g[0].number}번은 ${g[0].gap}회차째 나오지 않았습니다.`,
        fact: `1위 ${g[0].number}번 · ${g[0].gap}회차째 미출현`,
        factEn: `${g[0].number} \u2014 absent for ${g[0].gap} draws`,
        lead: `미출수는 최근에 나오지 않은 번호입니다. ${stats.latestRound}회 기준으로 가장 오래 안 나온 번호는 <strong>${g[0].number}번</strong>으로, ${g[0].gap}회차째 나오지 않았습니다.`,
        leadEn: `These are the numbers that have not come up recently. As of draw ${stats.latestRound}, the longest absence belongs to <strong>${g[0].number}</strong>, which has not appeared for ${g[0].gap} draws.`,
        body: [
            table([['순위', 'Rank'], ['번호', 'Number'], ['안 나온 기간', 'Absent for'], ['마지막으로 나온 회차', 'Last seen in draw']], rows),
            pEn('매 회차 번호가 뽑힐 확률은 이전 결과와 상관없이 같습니다. 오래 쉬었다고 다음에 나올 확률이 올라가지는 않습니다.',
                'Each draw is independent of the ones before it. A long absence does not make a number any more likely to appear next.'),
        ],
    });
})();

(() => {
    const top = topBy(stats.ac);
    const rows = stats.ac.map(r => [labEn(r), times(fmt(r.count)), pct(r.count, N)]);
    STATS.push({
        file: 'statistics-ac.html', anchor: 'stat-ac', short: 'AC값', shortEn: 'AC value',
        title: `로또 AC값 통계 · AC값 계산기 (${RANGE})`,
        h1: '로또 AC값 통계와 계산기', h1En: 'AC Values, with a Calculator',
        desc: `로또 AC값(산술적 복잡도) 계산 방법과 계산기, 역대 ${RANGE} AC값 분포. 가장 많은 값은 ${top.label}(${pct(top.count, N)}).`,
        fact: `최다 ${top.label} ${pct(top.count, N)}`,
        factEn: `most common ${top.label} ${pct(top.count, N)}`,
        lead: `AC값은 번호 6개를 두 개씩 뺀 차이 15개 중 서로 다른 값의 개수에서 5를 뺀 값입니다. 0~10 사이이고, 높을수록 번호가 고르게 흩어진 조합입니다. ${RANGE} 중 가장 많은 값은 <strong>${esc(top.label)}</strong>(${pct(top.count, N)})입니다.`,
        leadEn: `The AC value counts the distinct differences among the 15 pairs formed from six numbers, minus 5. It runs from 0 to 10, and the higher it is, the more spread out the numbers are. Across draws 1–${N} the most common value is <strong>${esc(top.label)}</strong> (${pct(top.count, N)}).`,
        body: [
            h2En('AC값 계산기', 'AC value calculator'),
            [
                '<div class="calc-form">',
                '    <label for="ac-input">번호 6개</label>',
                '    <input type="text" id="ac-input" inputmode="numeric" autocomplete="off" placeholder="예: 7 13 16 23 24 43">',
                '    <button type="button" class="btn" id="ac-btn">계산하기</button>',
                '</div>',
                '<p class="calc-result" id="ac-out" role="status" aria-live="polite"></p>',
            ].join('\n'),
            h2En('역대 AC값 분포', 'AC values across all draws'),
            table([['AC값', 'AC value'], ['나온 횟수', 'Draws'], ['비율', 'Share']], rows),
            pEn('예를 들어 1·2·3·4·5·6은 차이가 1~5뿐이라 AC값이 0입니다. 무작위로 뽑은 조합 대부분은 AC 7 이상입니다.',
                'For example, 1·2·3·4·5·6 yields only the differences 1 to 5, so its AC value is 0. Most randomly drawn combinations come out at AC 7 or above.'),
        ],
        script: [
            '(function () {',
            "    var input = document.getElementById('ac-input');",
            "    var out = document.getElementById('ac-out');",
            '    function run() {',
            "        var nums = (input.value.match(/[0-9]+/g) || []).map(Number);",
            '        var uniq = nums.filter(function (v, i, a) { return a.indexOf(v) === i; });',
            '        if (uniq.length !== 6 || uniq.some(function (n) { return n < 1 || n > 45; })) {',
            "            out.textContent = (window.I18N && I18N.lang === 'en') ? 'Enter six different numbers between 1 and 45.' : '1~45 사이의 서로 다른 번호 6개를 넣어 주세요.';",
            '            return;',
            '        }',
            '        var diffs = {};',
            '        for (var i = 0; i < 6; i++) for (var j = i + 1; j < 6; j++) diffs[Math.abs(uniq[i] - uniq[j])] = true;',
            '        var ac = Object.keys(diffs).length - 5;',
            "        var joined = uniq.sort(function (a, b) { return a - b; }).join(', ');",
            "        out.textContent = (window.I18N && I18N.lang === 'en') ? ('AC value of ' + joined + ' is ' + ac + '.') : (joined + ' 의 AC값은 ' + ac + '입니다.');",
            '    }',
            "    document.getElementById('ac-btn').addEventListener('click', run);",
            "    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });",
            '}());',
        ].join('\n'),
    });
})();

(() => {
    const best = stats.tail.slice().sort((a, b) => b.per - a.per)[0];
    const rows = stats.tail.map(r => [labEn(r), en(`${r.candidates}개`, `${r.candidates}`),
        times(fmt(r.count)), en(`평균 ${f1(r.per)}회`, `${f1(r.per)} on average`)]);
    const sums = draws.map(d => tailSum(d.numbers));
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
    const bins = [[0, 14], [15, 19], [20, 24], [25, 29], [30, 34], [35, 54]];
    const counted = bins.map(([lo, hi]) => ({
        label: lo === 0 ? `${hi} 이하` : hi === 54 ? `${lo} 이상` : `${lo}~${hi}`,
        labelEn: lo === 0 ? `${hi} or less` : hi === 54 ? `${lo} or more` : `${lo}–${hi}`,
        count: sums.filter(s => s >= lo && s <= hi).length,
    }));
    const topBin = topBy(counted).label;
    STATS.push({
        file: 'statistics-tail.html', anchor: 'stat-tail', short: '끝수 · 끝수합', shortEn: 'Last digits',
        title: `로또 끝수 통계 · 끝수합 분포 (${RANGE})`,
        h1: '로또 끝수 통계와 끝수합', h1En: 'Last Digits and Their Sum',
        desc: `로또 ${RANGE} 끝수(끝자리) 0~9별 출현 횟수와 번호당 평균, 끝수합 분포(평균 ${f1(avg)}). 번호당 평균이 가장 높은 끝수는 ${best.digit}.`,
        fact: `끝수합 평균 ${f1(avg)} · 끝수 ${best.digit} 최다`,
        factEn: `last-digit sum averages ${f1(avg)} · digit ${best.digit} most frequent`,
        lead: `끝수는 번호의 일의 자리입니다. 끝자리 1~5에는 번호가 5개(예: 1·11·21·31·41), 0과 6~9에는 4개씩 있어서 <strong>번호 1개당 평균</strong>으로 비교합니다. ${RANGE} 기준으로 번호당 평균이 가장 높은 끝수는 <strong>${best.digit}</strong>(${f1(best.per)}회)입니다.`,
        leadEn: `The last digit is the ones place of a number. Digits 1\u20135 have five numbers each (1\u00b711\u00b721\u00b731\u00b741), while 0 and 6\u20139 have four, so the comparison is made <strong>per number</strong>. Across draws 1–${N} the highest average belongs to digit <strong>${best.digit}</strong> (${f1(best.per)} times).`,
        body: [
            h2En('끝수별 출현 횟수', 'Appearances by last digit'),
            table([['끝수', 'Last digit'], ['해당 번호 수', 'Numbers with it'], ['출현 합계', 'Total appearances'], ['번호 1개당', 'Per number']], rows),
            pEn('총 횟수만 보면 끝수 1~5가 늘 많아 보입니다. 해당하는 번호가 하나 더 있기 때문이지 더 잘 나와서가 아닙니다.',
                'Raw totals always make digits 1–5 look busier. That is because one more number ends in each of them, not because they come up more readily.'),
            h2En('끝수합 분포', 'Distribution of the last-digit sum'),
            pEn(`끝수합은 당첨번호 6개의 끝자리를 모두 더한 값입니다. 예를 들어 7·13·16·23·24·43의 끝수합은 7+3+6+3+4+3 = 26입니다. ${RANGE} 평균은 <strong>${f1(avg)}</strong>, 가장 많은 구간은 <strong>${topBin}</strong>입니다.`,
                `The last-digit sum adds the ones place of all six numbers. For 7·13·16·23·24·43 that is 7+3+6+3+4+3 = 26. Across draws 1–${N} the average is <strong>${f1(avg)}</strong>, and the most common band is <strong>${topBin}</strong>.`),
            table([['끝수합', 'Sum of last digits'], ['나온 횟수', 'Draws'], ['비율', 'Share']], counted.map(c => [labEn(c), times(fmt(c.count)), pct(c.count, N)])),
        ],
    });
})();

/* ───── 회차별 당첨번호 ───── */

// 이 회차까지의 누적 출현 횟수. 최신 회차에 따라 바뀌지 않도록 회차마다 따로 센다.
const cumulative = {};
(() => {
    const counts = new Array(46).fill(0);
    draws.slice().sort((a, b) => a.round - b.round).forEach(d => {
        d.numbers.forEach(n => { counts[n]++; });
        cumulative[d.round] = counts.slice();
    });
})();

const byRound = {};
draws.forEach(d => { byRound[d.round] = d; });

function roundPage(d) {
    const nums = d.numbers.slice().sort(asc);
    const odd = nums.filter(n => n % 2).length;
    const low = nums.filter(n => n <= 22).length;
    const sum = nums.reduce((a, b) => a + b, 0);
    const runs = runsOf(nums);
    const winners = typeof d.firstPrizeWinners === 'number' ? d.firstPrizeWinners : null;
    const amount = d.firstPrizeAmount || 0;
    const prev = byRound[d.round - 1];
    const next = byRound[d.round + 1];
    const bands = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 45]]
        .map(([lo, hi]) => `${lo}~${hi}: ${nums.filter(n => n >= lo && n <= hi).length}`).join(' · ');

    const prizeText = winners === 0
        ? en('1등 당첨자가 없어 당첨금이 다음 회차로 이월됐습니다.', 'Nobody won first prize, so the money rolled over to the next draw.')
        : winners
            ? en(`1등 ${winners}명, 1인당 ${won(amount)}${amount ? ` (세후 약 ${won(amount - lottoTax(amount))})` : ''}`,
                `${winners} first-prize winners, ${wonEn(amount)} each${amount ? ` (about ${wonEn(amount - lottoTax(amount))} after tax)` : ''}`)
            : en('1등 당첨 정보가 아직 없습니다.', 'First-prize details are not available yet.');
    const descPrize = winners === 0 ? '1등 없음(이월)' : winners ? `1등 ${winners}명 · 1인당 ${won(amount)}` : '1등 정보 확인 중';

    const cum = cumulative[d.round];
    return shell({
        file: `round/${d.round}.html`,
        base: '../',
        callout: false,
        navCurrent: 'draws.html',
        crumbs: [['draws.html', '회차별 당첨번호', null, 'All draws'], [null, `${d.round}회`, null, `Draw ${d.round}`]],
        title: `로또 ${d.round}회 당첨번호 (${d.date}) ${nums.join(' ')} + ${d.bonus}`,
        h1: `로또 ${d.round}회 당첨번호`, h1En: `Lotto Draw ${d.round}`,
        desc: `로또 6/45 제${d.round}회(${d.date}) 당첨번호는 ${nums.join(', ')}, 보너스 ${d.bonus}. ${descPrize}. 홀짝·합계·연속번호·AC값 분석.`,
        scope: en(`${d.date} 추첨`, `Drawn on ${d.date}`),
        body: [
            `<div class="round-balls" aria-label="당첨번호 ${nums.join(', ')} 보너스 ${d.bonus}">${nums.map(bigBall).join('')}<span class="plus">+</span>${bigBall(d.bonus)}</div>`,
            `<p class="stat-lead">${prizeText}</p>`,   // prizeText 안에 영문이 같이 들어 있다
            h2En('이 회차 번호 분석', 'A look at this draw'),
            table([['항목', 'Item'], ['값', 'Value']], [
                [en('홀짝', 'Odd / even'), en(`홀${odd} 짝${6 - odd}`, `${odd} odd / ${6 - odd} even`)],
                [en('저고 (1~22 / 23~45)', 'Low / high (1–22 / 23–45)'), en(`저${low} 고${6 - low}`, `${low} low / ${6 - low} high`)],
                [en('번호 합계', 'Sum of numbers'), String(sum)],
                [en('연속번호', 'Consecutive runs'), runs.length ? runs.map(g => g.join('·')).join(', ') : en('없음', 'none')],
                [en('AC값', 'AC value'), String(acValue(nums))],
                [en('끝수합', 'Sum of last digits'), String(tailSum(nums))],
                [en('번호대', 'By band'), bands],
            ], 'kv-table'),
            h2En(`${d.round}회까지 번호별 누적 출현`, `Cumulative appearances through draw ${d.round}`),
            table([['번호', 'Number'], [`1~${d.round}회 출현`, `Appearances in draws 1–${d.round}`]], nums.map(n => [ball(n), times(fmt(cum[n]))])),
            [
                '<nav class="round-nav" aria-label="회차 이동">',
                prev ? `    <a class="btn btn-secondary" href="${prev.round}.html" data-i18n-en="← Draw ${prev.round}">← ${prev.round}회</a>` : '',
                '    <a class="btn btn-secondary" href="../draws.html" data-i18n-en="All draws">전체 회차</a>',
                next ? `    <a class="btn btn-secondary" href="${next.round}.html" data-i18n-en="Draw ${next.round} →">${next.round}회 →</a>` : '',
                '</nav>',
            ].filter(Boolean).join('\n'),
            pEn('세후 금액은 구입비 1,000원을 뺀 뒤 3억 원까지 22%, 초과분 33%를 적용한 추정치입니다. <a href="../tax.html">실수령액 계산기</a>에서 금액을 바꿔 계산해 볼 수 있습니다.',
                'The after-tax figure is an estimate: the 1,000 KRW ticket price is deducted, then 22% is applied up to 300m KRW and 33% to anything above. Try other amounts in <a href="../tax.html">the after-tax calculator</a>.'),
        ],
    });
}

function drawsPage() {
    const rows = draws.map(d => {
        const nums = d.numbers.slice().sort(asc);
        const w = typeof d.firstPrizeWinners === 'number' ? d.firstPrizeWinners : null;
        return [
            `<a href="round/${d.round}.html" data-i18n-en="Draw ${d.round}">${d.round}회</a>`,
            d.date,
            `<span class="row-balls">${nums.map(ball).join('')}<span class="plus">+</span>${ball(d.bonus)}</span>`,
            w === 0 ? en('이월', 'rollover') : w === null ? '-' : en(`${w}명`, `${w}`),
            w ? en(won(d.firstPrizeAmount), wonEn(d.firstPrizeAmount)) : '-',
        ];
    });
    const latestNums = LATEST.numbers.slice().sort(asc);
    return shell({
        file: 'draws.html',
        navCurrent: 'draws.html',
        crumbs: [[null, '회차별 당첨번호', null, 'All winning numbers']],
        title: `로또 회차별 당첨번호 전체 조회 (${RANGE})`,
        h1: '로또 회차별 당첨번호 전체 조회', h1En: 'Every Winning Number, Draw by Draw',
        desc: `로또 6/45 ${RANGE} 회차별 당첨번호 전체 보기. 최신 ${LATEST.round}회(${LATEST.date}) 당첨번호 ${latestNums.join(', ')} + ${LATEST.bonus}. 회차별 1등 당첨자 수와 1인당 당첨금.`,
        scope: en(`${RANGE} · ${PERIOD} · 매주 추첨 후 자동 갱신`, `Draws 1–${N} · ${PERIOD} · updated automatically after each draw`),
        lead: en(`최신 <a href="round/${LATEST.round}.html"><strong>${LATEST.round}회</strong></a>(${LATEST.date}) 당첨번호는 <strong>${latestNums.join(', ')}</strong>, 보너스 <strong>${LATEST.bonus}</strong>입니다. 회차를 누르면 그 회차의 번호 분석을 볼 수 있습니다.`,
            `The latest draw, <a href="round/${LATEST.round}.html"><strong>${LATEST.round}</strong></a> (${LATEST.date}), came out <strong>${latestNums.join(', ')}</strong> with bonus <strong>${LATEST.bonus}</strong>. Open any draw to see how its numbers break down.`),
        body: [
            [
                '<form class="calc-form" id="round-go">',
                '    <label for="round-input">회차로 바로 가기</label>',
                `    <input type="number" id="round-input" min="1" max="${LATEST.round}" inputmode="numeric" placeholder="예: ${LATEST.round}">`,
                '    <button type="submit" class="btn">보기</button>',
                '</form>',
                '<p class="calc-error" id="round-error" role="alert"></p>',
            ].join('\n'),
            table([['회차', 'Draw'], ['추첨일', 'Date'], ['당첨번호 + 보너스', 'Winning numbers + bonus'], ['1등', 'First-prize winners'], ['1인당 1등 당첨금', 'First prize per winner']], rows, 'draws-table'),
        ],
        script: [
            '(function () {',
            `    var MAX = ${LATEST.round};`,
            "    document.getElementById('round-go').addEventListener('submit', function (e) {",
            '        e.preventDefault();',
            "        var n = Number(document.getElementById('round-input').value);",
            '        if (!n || n < 1 || n > MAX || Math.floor(n) !== n) {',
            "            document.getElementById('round-error').textContent = '1부터 ' + MAX + ' 사이의 회차를 넣어 주세요.';",
            '            return;',
            '        }',
            "        location.href = 'round/' + n + '.html';",
            '    });',
            '}());',
        ].join('\n'),
    });
}

function probabilityPage() {
    const ranks = [
        [en('1등', '1st'), en('6개 일치', 'all 6 matched'), 1],
        [en('2등', '2nd'), en('5개 + 보너스', '5 + bonus'), comb(6, 5)],
        [en('3등', '3rd'), en('5개 일치', '5 matched'), comb(6, 5) * comb(38, 1)],
        [en('4등', '4th'), en('4개 일치', '4 matched'), comb(6, 4) * comb(39, 2)],
        [en('5등', '5th'), en('3개 일치', '3 matched'), comb(6, 3) * comb(39, 3)],
    ];
    const any = ranks.reduce((a, r) => a + r[2], 0);
    const oneIn = ways => fmt(Math.round(TOTAL / ways));
    const percent = ways => {
        const v = ways / TOTAL * 100;
        return (v >= 0.01 ? v.toFixed(2) : v.toPrecision(2)) + '%';
    };
    const rows = ranks.map(([rank, cond, ways]) => [rank, cond, fmt(ways), `1 / ${oneIn(ways)}`, percent(ways)]);
    const years = Math.round(TOTAL / 52);
    return shell({
        file: 'probability.html',
        crumbs: [['index.html#sec-stats', '로또 통계', null, 'Lotto statistics'], [null, '로또 확률', null, 'Lotto odds']],
        title: '로또 확률 계산 · 1등부터 5등까지 등수별 당첨 확률',
        h1: '로또 확률 · 등수별 당첨 확률', h1En: 'Lotto Odds by Prize Tier',
        desc: `로또 6/45 1등 확률 1/${oneIn(1)}, 2등 1/${oneIn(6)}, 3등 1/${oneIn(228)}, 4등 1/${oneIn(11115)}, 5등 1/${oneIn(182780)}. 계산 공식과 자동·수동 확률 차이, 확률을 높이는 방법의 진실.`,
        scope: en('45개 번호 중 6개를 고르는 조합 수 C(45,6) = 8,145,060 기준', 'Based on C(45,6) = 8,145,060 possible combinations'),
        lead: en(`로또 6/45는 1~45 중 6개를 고르는 게임이라 가능한 조합이 <strong>8,145,060가지</strong>입니다. 한 게임(1,000원)으로 1등에 당첨될 확률은 <strong>8,145,060분의 1</strong>입니다.`,
            'Lotto 6/45 asks for six numbers out of 45, which makes <strong>8,145,060</strong> possible combinations. A single game (1,000 KRW) therefore has a <strong>1 in 8,145,060</strong> chance of the first prize.'),
        body: [
            h2En('등수별 당첨 확률', 'Odds by prize tier'),
            table([['등수', 'Tier'], ['조건', 'Condition'], ['해당 조합 수', 'Combinations'], ['확률', 'Odds'], ['백분율', 'Percent']], rows),
            pEn(`한 게임으로 5등 이상 무엇이든 당첨될 확률은 약 1 / ${f1(TOTAL / any)} 입니다.`,
                `The chance that a single game wins anything at all (fifth prize or better) is about 1 in ${f1(TOTAL / any)}.`),
            h2En('계산 방법', 'How these are calculated'),
            '<ul>',
            `<li data-i18n-en="${esc('<strong>1st prize</strong>: only one combination matches all six → 1 / C(45,6)')}"><strong>1등</strong>: 6개를 모두 맞히는 조합은 1가지 → 1 / C(45,6)</li>`,
            `<li data-i18n-en="${esc('<strong>2nd prize</strong>: five of the six winning numbers × the bonus ball = C(6,5) × 1 = 6')}"><strong>2등</strong>: 당첨번호 6개 중 5개 × 보너스 번호 1개 = C(6,5) × 1 = 6가지</li>`,
            `<li data-i18n-en="${esc('<strong>3rd prize</strong>: five winning numbers × one of the 38 others = 6 × 38 = 228')}"><strong>3등</strong>: 당첨번호 중 5개 × 당첨·보너스가 아닌 38개 중 1개 = 6 × 38 = 228가지</li>`,
            `<li data-i18n-en="${esc('<strong>4th prize</strong>: four winning numbers × two of the remaining 39 = 15 × 741 = 11,115')}"><strong>4등</strong>: 당첨번호 중 4개 × 나머지 39개 중 2개 = 15 × 741 = 11,115가지</li>`,
            `<li data-i18n-en="${esc('<strong>5th prize</strong>: three winning numbers × three of the remaining 39 = 20 × 9,139 = 182,780')}"><strong>5등</strong>: 당첨번호 중 3개 × 나머지 39개 중 3개 = 20 × 9,139 = 182,780가지</li>`,
            '</ul>',
            h2En('얼마나 드문 일일까', 'How rare is it, really'),
            pEn(`매주 한 게임씩 산다면 1등 조합 수만큼 사는 데 ${fmt(TOTAL)}주, 약 ${fmt(years)}년이 걸립니다.`,
                `Buying one game a week, covering every combination would take ${fmt(TOTAL)} weeks — roughly ${fmt(years)} years.`),
            h2En('자동과 수동, 확률이 다를까', 'Quick pick or self-pick: any difference?'),
            pEn('같습니다. 자동은 기계가 번호를 고르고 수동은 사람이 고를 뿐, 한 게임이 8,145,060개 조합 중 하나라는 점은 똑같습니다. 많이 나온 번호나 안 나온 번호를 골라도 확률은 달라지지 않습니다.',
                'They are the same. A quick pick lets the machine choose and a self-pick lets you choose, but either way one game is one of 8,145,060 combinations. Picking frequent or absent numbers does not change that.'),
            h2En('확률을 높이는 방법이 있을까', 'Is there any way to improve the odds?'),
            pEn('확률을 올리는 방법은 서로 다른 조합을 더 많이 사는 것뿐이고, 그만큼 비용도 늘어납니다. 다만 번호 선택은 <strong>당첨됐을 때 나눠 가질 사람 수</strong>에 영향을 줍니다. 1·2·3·4·5·6이나 생일 날짜(1~31)처럼 많은 사람이 고르는 조합은 당첨자가 여럿 나와 1인당 금액이 줄어듭니다. <a href="index.html" data-i18n-en="The number generator">번호 생성기</a>는 이런 특수 패턴을 걸러냅니다.',
                'The only way to raise the odds is to buy more distinct combinations, which costs proportionally more. What your choice does affect is <strong>how many people you would share a prize with</strong>. Combinations many people pick — 1·2·3·4·5·6, or dates from 1 to 31 — tend to produce several winners and a smaller share each. <a href="index.html">The number generator</a> filters out patterns like these.'),
            pEn('관련 통계: <a href="statistics-frequency.html" data-i18n-en="most frequent numbers">많이 나온 번호 순위</a> · <a href="statistics-prize.html" data-i18n-en="first-prize winners">1등 당첨자 수</a> · <a href="tax.html" data-i18n-en="after-tax calculator">실수령액 계산기</a>',
                'Related: <a href="statistics-frequency.html">most frequent numbers</a> · <a href="statistics-prize.html">first-prize winners</a> · <a href="tax.html">after-tax calculator</a>'),
        ],
    });
}

/* ───── 통계 페이지 렌더 ───── */

function relatedLinks(current) {
    return '<ul class="stat-links">' + STATS.filter(p => p.file !== current).map(p =>
        `<li><a href="${p.file}"${p.shortEn ? ` data-i18n-en="${esc(p.shortEn)}"` : ''}>${esc(p.short)}</a>` +
        `<span${p.factEn ? ` data-i18n-en="${esc(p.factEn)}"` : ''}>${esc(p.fact)}</span></li>`
    ).join('') + '</ul>';
}

function statPage(p) {
    return shell({
        file: p.file,
        crumbs: [['index.html#sec-stats', '로또 통계', null, 'Lotto statistics'], [null, p.short, null, p.shortEn]],
        title: p.title,
        h1: p.h1,
        h1En: p.h1En,
        desc: p.desc,
        scope: en(`${RANGE} · ${PERIOD} · 매주 추첨 후 자동 갱신 (마지막 갱신 ${UPDATED})`,
            `Draws 1–${N} · ${PERIOD} · updated automatically after each draw (last update ${UPDATED})`),
        lead: p.leadEn ? en(p.lead, p.leadEn) : p.lead,
        ld: [{
            '@type': 'Dataset',
            name: p.title,
            description: p.desc,
            url: `${SITE}/${p.file}`,
            isAccessibleForFree: true,
            dateModified: UPDATED,
            temporalCoverage: `${stats.oldestDate}/${stats.latestDate}`,
            creator: { '@type': 'Organization', name: 'lottodraw.kr', url: SITE + '/' },
            keywords: ['로또 통계', '로또 분석', p.short],
        }],
        body: p.body.concat([
            `<p><a class="btn" href="index.html#${p.anchor}" data-i18n-en="See the chart on the home page">홈에서 그래프로 보기</a></p>`,
            h2En('다른 로또 통계', 'Other statistics'),
            relatedLinks(p.file),
            `<p>${en('함께 보기:', 'See also:')} <a href="draws.html" data-i18n-en="All winning numbers by draw">회차별 당첨번호 전체 조회</a> · <a href="probability.html" data-i18n-en="Lotto probability">로또 확률</a></p>`,
        ]),
        script: p.script,
    });
}

/* ───── 표식 사이 교체 ───── */

function replaceBetween(file, src, name, content) {
    const start = `<!-- seo:${name}:start -->`;
    const end = `<!-- seo:${name}:end -->`;
    const a = src.indexOf(start);
    const b = src.indexOf(end);
    if (a === -1 || b === -1 || b < a) throw new Error(`${file} 에 ${start} … ${end} 표식이 없다`);
    return src.slice(0, a + start.length) + content + src.slice(b);
}

const headBlock = (title, desc) =>
    `\n    <title>${esc(title)}</title>\n    <meta name="description" content="${esc(desc)}">` +
    `\n    <meta property="og:title" content="${esc(title)}">\n    <meta property="og:description" content="${esc(desc)}">` +
    `\n    <meta property="og:image" content="${OG_IMAGE}">\n    <meta name="twitter:card" content="summary_large_image">` +
    `\n    <meta name="twitter:title" content="${esc(title)}">\n    <meta name="twitter:description" content="${esc(desc)}">` +
    `\n    <meta name="twitter:image" content="${OG_IMAGE}">\n    `;

function updateHome() {
    const title = `로또 통계 분석 · 번호 생성기 (${RANGE}) | lottodraw.kr`;
    const e = extremesOf(stats.frequency);
    const desc = `로또 역대 ${RANGE} 당첨번호 통계 분석 무료. 많이 나온 번호(1위 ${numsText(e.top)} ${e.max}회), 미출수, 궁합수, 홀짝·끝수 통계와 고정수·제외수를 넣는 번호 생성기. 매주 자동 갱신.`;
    const dataset = {
        '@type': 'Dataset',
        name: '로또 6/45 전 회차 당첨번호 통계',
        description: `동행복권 로또 6/45 ${RANGE} 회차별 당첨번호, 보너스 번호, 1등 당첨자 수로 계산한 통계 12종`,
        url: SITE + '/',
        isAccessibleForFree: true,
        dateModified: UPDATED,
        temporalCoverage: `${stats.oldestDate}/${stats.latestDate}`,
        keywords: '로또 통계, 로또 분석, 로또 많이 나온 번호, 로또 미출수, 로또 궁합수',
        // description 은 구글 데이터세트 필수 항목이다 — 빠지면 Search Console 이 오류로 잡는다
        hasPart: STATS.map(p => ({ '@type': 'Dataset', name: p.title, description: p.desc, url: `${SITE}/${p.file}` })),
    };
    const ld = JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
            { '@type': 'WebSite', '@id': SITE + '/#website', name: 'lottodraw.kr', alternateName: '로또드로우', url: SITE + '/', inLanguage: 'ko-KR' },
            { '@type': 'Organization', '@id': SITE + '/#org', name: 'lottodraw.kr', url: SITE + '/', email: 'contact@lottodraw.kr' },
            dataset,
        ],
    });
    const latestNums = LATEST.numbers.slice().sort(asc);
    const links = '\n' + [
        `            ${pEn(`로또 6/45 ${RANGE} 전 회차 통계입니다. 가장 많이 나온 번호는 ${numsText(e.top)}(${e.max}회), 가장 적게 나온 번호는 ${numsText(e.bottom)}(${e.min}회)이며, 회차별 당첨번호부터 미출수·궁합수·홀짝·AC값·끝수 통계까지 12종을 매주 추첨 후 갱신합니다.`,
            `Statistics for every Lotto 6/45 draw so far (1–${N}). The number drawn most often is ${e.top.map(r => r.number).join('·')} (${e.max} times) and the least often ${e.bottom.map(r => r.number).join('·')} (${e.min} times). Twelve sets of figures — past results, longest absences, pairs, odd/even, AC values, last digits — are refreshed after every draw.`, 'stat-lead')}`,
        '            <nav class="stat-index" aria-label="통계별 자세히 보기" data-i18n-attr="aria-label:stats.indexAria">',
        '                <h3 data-i18n-en="Each statistic in detail">통계별 자세히 보기</h3>',
        '                <ul class="stat-links">',
        STATS.map(p => `                    <li><a href="${p.file}"${p.shortEn ? ` data-i18n-en="${esc(p.shortEn)}"` : ''}>${esc(p.short)}</a>` +
            `<span${p.factEn ? ` data-i18n-en="${esc(p.factEn)}"` : ''}>${esc(p.fact)}</span></li>`).join('\n'),
        `                    <li><a href="draws.html" data-i18n-en="All winning numbers">회차별 당첨번호</a>` +
            `<span data-i18n-en="latest: draw ${LATEST.round}, ${latestNums.join(' ')} + ${LATEST.bonus}">최신 ${LATEST.round}회 ${latestNums.join(' ')} + ${LATEST.bonus}</span></li>`,
        '                    <li><a href="probability.html" data-i18n-en="Lotto odds">로또 확률</a><span data-i18n-en="1st 1/8,145,060 · 5th 1/45">1등 1/8,145,060 · 5등 1/45</span></li>',
        '                </ul>',
        '            </nav>',
        '            ',
    ].join('\n');

    let html = read('index.html');
    html = replaceBetween('index.html', html, 'head', headBlock(title, desc));
    html = replaceBetween('index.html', html, 'ld', `\n    <script type="application/ld+json">${ld}</script>\n    `);
    html = replaceBetween('index.html', html, 'links', links);
    write('index.html', html);
}

function updateTaxAndTop() {
    const known = draws.filter(d => d.firstPrizeAmount);
    const top = known.slice().sort((a, b) => b.firstPrizeAmount - a.firstPrizeAmount)[0];
    const avg = Math.round(known.reduce((a, d) => a + d.firstPrizeAmount, 0) / Math.max(1, known.length));

    let tax = read('tax.html');
    tax = replaceBetween('tax.html', tax, 'head', headBlock(
        '로또 실수령액 계산기 · 당첨금 세금 계산 (22%·33%) | lottodraw.kr',
        `로또 당첨금에서 세금을 뗀 실수령액 계산기. 200만 원 이하 비과세, 3억 원까지 22%, 3억 원 초과분만 33%. 역대 1등 평균 ${won(avg)}의 세후 금액은 약 ${won(avg - lottoTax(avg))}.`));
    write('tax.html', tax);

    let tp = read('top-prize.html');
    tp = replaceBetween('top-prize.html', tp, 'head', headBlock(
        '역대 로또 1등 당첨금 순위 TOP 50 (1인당) | lottodraw.kr',
        `로또 6/45 역대 1등 당첨금 1인당 금액 순위 TOP 50. 역대 최고는 ${top.round}회 ${won(top.firstPrizeAmount)}, ${RANGE} 1등 평균 당첨금은 ${won(avg)}.`));
    write('top-prize.html', tp);
}

/* ───── 사이트맵 ───── */

// blog: build-blog.js 가 돌려준 [{ path, lastmod }]. 글의 날짜를 그대로 lastmod 로 쓴다
function updateSitemap(blog) {
    const old = read('sitemap.xml');
    const keep = {};
    const re = /<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
    let m;
    while ((m = re.exec(old))) keep[m[1]] = m[2];

    const entry = (p, lastmod, freq, pri) => ({ loc: SITE + p, lastmod, changefreq: freq, priority: pri });
    const kept = p => keep[SITE + p] || UPDATED;
    const entries = [
        entry('/', UPDATED, 'weekly', '1.0'),
        entry('/draws.html', UPDATED, 'weekly', '0.9'),
    ].concat(
        STATS.map(p => entry('/' + p.file, UPDATED, 'weekly', '0.8')),
        [
            entry('/probability.html', kept('/probability.html'), 'yearly', '0.7'),
            entry('/statistics.html', UPDATED, 'weekly', '0.7'),
            entry('/top-prize.html', UPDATED, 'weekly', '0.7'),
            entry('/tax.html', kept('/tax.html'), 'yearly', '0.7'),
            entry('/about.html', kept('/about.html'), 'monthly', '0.5'),
            entry('/privacy.html', kept('/privacy.html'), 'yearly', '0.3'),
            entry('/terms.html', kept('/terms.html'), 'yearly', '0.3'),
            entry('/contact.html', kept('/contact.html'), 'yearly', '0.3'),
        ],
        (blog || []).map(b => entry(b.path, b.lastmod || kept(b.path), 'monthly', '0.6')),
        // 회차 페이지는 추첨 뒤 바뀌지 않는다. 직전 회차만 "다음 회차" 링크가 한 번 붙는다.
        draws.map((d, i) => entry(`/round/${d.round}.html`, i <= 1 ? UPDATED : d.date, i === 0 ? 'weekly' : 'yearly', i < 10 ? '0.8' : '0.5')),
    );

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        entries.map(e => [
            '    <url>',
            `        <loc>${e.loc}</loc>`,
            `        <lastmod>${e.lastmod}</lastmod>`,
            '    </url>',
        ].join('\n')).join('\n'),
        '</urlset>',
        '',
    ].join('\n');
    write('sitemap.xml', xml);
    return entries.length;
}

/* ───── 실행 ───── */

let changed = 0;
STATS.forEach(p => { if (write(p.file, statPage(p))) changed++; });
draws.forEach(d => { if (write(`round/${d.round}.html`, roundPage(d))) changed++; });
if (write('draws.html', drawsPage())) changed++;
if (write('probability.html', probabilityPage())) changed++;
// 블로그는 원고(content/blog/)로 만든다. 같은 틀을 쓰고 사이트맵에 같이 넣으려고 여기서 부른다
const blog = require(path.join(__dirname, 'build-blog.js'))({ shell, write, SITE, OG_IMAGE });
changed += blog.changed;
updateHome();
updateTaxAndTop();
const urls = updateSitemap(blog.sitemap);
console.log(`통계 ${STATS.length}쪽 · 회차 ${draws.length}쪽 · 전체 조회 · 확률 · 블로그 ${blog.posts}편 · 사이트맵 ${urls}개 (${RANGE}, 갱신일 ${UPDATED})`);
console.log(`바뀐 생성 페이지: ${changed}쪽`);
