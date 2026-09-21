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
const LottoStats = require(path.join(ROOT, 'js', 'lotto-stats.js'));

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
        '<thead><tr>' + head.map(h => `<th scope="col">${esc(h)}</th>`).join('') + '</tr></thead>',
        '<tbody>',
        rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('\n'),
        '</tbody>',
        '</table>',
        '</div>',
    ].join('\n');
}

function rankList(rows, label) {
    return '<ol class="ball-list">' + rows.map((r, i) =>
        `<li><span class="lead">${i + 1}위</span>${ball(r.number)}<span class="tail">${label(r)}</span></li>`
    ).join('') + '</ol>';
}

/* ───── 공통 틀 ───── */

const NAV = [
    ['index.html', '생성기 · 통계'],
    ['draws.html', '당첨번호'],
    ['statistics.html', '5개월 통계'],
    ['top-prize.html', 'TOP 50 당첨금'],
    ['tax.html', '실수령액 계산'],
    ['about.html', 'ABOUT'],
];

const latestCallout = `제${LATEST.round}회 ${LATEST.numbers.join(' ')} <span class="bonus-sep">+</span> ${LATEST.bonus}`;

// base: 하위 폴더 페이지에서 쓰는 경로 앞머리 ('' 또는 '../')
function shell(o) {
    const base = o.base || '';
    const title = `${o.title} | lottodraw.kr`;
    const crumbs = [['index.html', '홈']].concat(o.crumbs || []);
    const crumbHtml = crumbs.map(([href, name], i) => i === crumbs.length - 1 && !href
        ? `<span>${esc(name)}</span>`
        : `<a href="${base}${href}">${esc(name)}</a>`).join(' › ');
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
<!-- 이 파일은 tools/build-static-stats.js 가 매주 다시 만든다. 직접 고치면 덮어쓰인다. -->
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
    <meta name="google-adsense-account" content="ca-pub-9372871176021283">
    <link rel="stylesheet" href="${base}css/site.css">
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<div class="page">
    <header class="banner">
        <a class="brand" href="${base}index.html">
            <span class="brand-name">LOTTODRAW.KR</span>
            <span class="brand-tag">특수 패턴을 걸러내는 로또 6/45 번호 생성기</span>
        </a>
        <div class="banner-right">
${o.callout === false ? '' : `            <p class="latest-callout">${latestCallout}</p>\n`}            <a class="sticker" href="${base}statistics.html">최근 <b>5개월</b> 통계</a>
        </div>
    </header>

    <nav class="nav" aria-label="주 메뉴">
        <ul>
${NAV.map(([href, name]) => `            <li><a href="${base}${href}"${href === o.navCurrent ? ' aria-current="page"' : ''}>${name}</a></li>`).join('\n')}
        </ul>
    </nav>

    <main class="prose stat-page">
        <nav class="breadcrumb" aria-label="현재 위치">${crumbHtml}</nav>
        <h1>${esc(o.h1)}</h1>
${o.scope ? `        <p class="stat-scope">${o.scope}</p>\n` : ''}${o.lead ? `        <p class="stat-lead">${o.lead}</p>\n` : ''}
${o.body.filter(Boolean).join('\n\n')}

        <p class="page-disclaimer">지난 추첨 기록을 정리한 것이며 다음 회차를 예측하지 않습니다. 어떤 6개를 고르든 1등 확률은 1/8,145,060으로 같습니다. 당첨번호 출처: 동행복권.</p>
    </main>

    <footer class="footer">
        <ul class="footer-nav">
            <li><a href="${base}index.html">HOME</a></li>
            <li><a href="${base}draws.html">당첨번호</a></li>
            <li><a href="${base}statistics.html">5개월 통계</a></li>
            <li><a href="${base}top-prize.html">TOP 50</a></li>
            <li><a href="${base}tax.html">실수령액</a></li>
            <li><a href="${base}about.html">ABOUT</a></li>
        </ul>
        <p><a href="${base}privacy.html">개인정보 처리방침</a> · <a href="${base}terms.html">이용약관</a> · <a href="${base}contact.html">문의</a></p>
        <p>&copy; 2026 lottodraw.kr · 당첨번호 출처: 동행복권</p>
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

function numberTable(rows, expected) {
    return table(['번호', '출현 횟수', '회차 대비', '기대보다'], rows.map(r => {
        const diff = r.count - expected;
        return [ball(r.number), fmt(r.count) + '회', pct(r.count, N), (diff >= 0 ? '+' : '') + f1(diff)];
    }));
}

const STATS = [];

(() => {
    const e = extremesOf(stats.frequency);
    const ranked = stats.frequency.slice().sort((a, b) => b.count - a.count || a.number - b.number);
    STATS.push({
        file: 'statistics-frequency.html', anchor: 'stat-frequency', short: '많이 나온 번호 순위',
        title: `로또 많이 나온 번호 순위 · 번호별 출현 횟수 (${RANGE})`,
        h1: '로또 많이 나온 번호 순위',
        desc: `로또 역대 ${RANGE} 가장 많이 나온 번호 순위와 1~45번 번호별 출현 횟수. 제일 많이 나온 번호는 ${numsText(e.top)} ${e.max}회, 가장 적게 나온 번호는 ${numsText(e.bottom)} ${e.min}회.`,
        fact: `1위 ${numsText(e.top)} ${e.max}회 · 최소 ${numsText(e.bottom)} ${e.min}회`,
        lead: `역대 ${RANGE} 동안 제일 많이 나온 번호는 <strong>${numsText(e.top)}(${e.max}회)</strong>, 가장 적게 나온 번호는 <strong>${numsText(e.bottom)}(${e.min}회)</strong>입니다. 한 회차에 6개를 뽑으므로 번호 하나의 기대 출현은 ${f1(EXP_NUM)}회입니다.`,
        body: [
            '<h2>많이 나온 번호 순위 Top 10</h2>',
            rankList(ranked.slice(0, 10), r => fmt(r.count) + '회'),
            '<h2>적게 나온 번호 Top 10</h2>',
            rankList(ranked.slice(-10).reverse(), r => fmt(r.count) + '회'),
            '<h2>1~45번 번호별 출현 횟수</h2>',
            numberTable(stats.frequency, EXP_NUM),
            `<p>표준편차는 약 ${f1(SD_NUM)}회입니다. 1위 번호는 기대보다 ${f1(e.max - EXP_NUM)}회(+${f1((e.max - EXP_NUM) / SD_NUM)} 표준편차), 최소 번호는 ${f1(EXP_NUM - e.min)}회(-${f1((EXP_NUM - e.min) / SD_NUM)} 표준편차) 벗어나 있습니다. 번호 45개를 한꺼번에 보면 공평한 추첨에서도 양 끝이 이 정도로 벌어집니다.</p>`,
        ],
    });
})();

(() => {
    const e = extremesOf(stats.bonus);
    const ranked = stats.bonus.slice().sort((a, b) => b.count - a.count || a.number - b.number);
    STATS.push({
        file: 'statistics-bonus.html', anchor: 'stat-bonus', short: '보너스 번호',
        title: `로또 보너스 번호란? 역대 보너스 번호 통계 (${RANGE})`,
        h1: '로또 보너스 번호 통계',
        desc: `로또 보너스 번호의 의미(2등 판정)와 역대 ${RANGE} 보너스 번호별 출현 횟수. 가장 많이 나온 보너스 번호는 ${numsText(e.top)} ${e.max}회.`,
        fact: `최다 ${numsText(e.top)} ${e.max}회 · 최소 ${numsText(e.bottom)} ${e.min}회`,
        lead: `보너스 번호는 당첨번호 6개를 뽑은 뒤 하나 더 뽑는 번호입니다. 한 회차에 하나뿐이라 번호 하나의 기대 출현은 ${f1(EXP_BONUS)}회이고, 역대 가장 많이 나온 보너스 번호는 <strong>${numsText(e.top)}(${e.max}회)</strong>입니다.`,
        body: [
            '<h2>보너스 번호는 언제 쓰이나</h2>',
            table(['맞힌 개수', '보너스 번호', '등수'], [
                ['6개', '상관없음', '1등'],
                ['5개', '<strong>일치</strong>', '2등'],
                ['5개', '불일치', '3등'],
                ['4개', '상관없음', '4등'],
                ['3개', '상관없음', '5등'],
            ]),
            '<p>보너스 번호는 2등과 3등을 가를 때만 봅니다. 당첨번호 4개에 보너스 번호가 맞아도 4등이고, 3개에 보너스가 맞아도 5등입니다.</p>',
            '<h2>많이 나온 보너스 번호 Top 10</h2>',
            rankList(ranked.slice(0, 10), r => fmt(r.count) + '회'),
            '<h2>보너스 번호별 전체 표</h2>',
            numberTable(stats.bonus, EXP_BONUS),
        ],
    });
})();

(() => {
    const top = topBy(stats.oddEven);
    const rows = stats.oddEven.map(r => {
        const odd = Number(r.label.match(/\d/)[0]);
        const theory = comb(23, odd) * comb(22, 6 - odd) / TOTAL;
        return [esc(r.label), fmt(r.count) + '회', pct(r.count, N), (theory * 100).toFixed(1) + '%'];
    });
    STATS.push({
        file: 'statistics-even-odd.html', anchor: 'stat-even-odd', short: '홀짝 비율',
        title: `로또 홀짝 비율 통계 · 홀짝 분석 (${RANGE})`,
        h1: '로또 홀짝 비율',
        desc: `로또 ${RANGE} 당첨번호 6개의 홀수·짝수 비율을 이론 확률과 나란히 분석했습니다. 가장 많은 형태는 ${top.label}(${pct(top.count, N)}).`,
        fact: `최다 ${top.label} ${pct(top.count, N)}`,
        lead: `${RANGE} 중 가장 많이 나온 형태는 <strong>${esc(top.label)}</strong>로 ${fmt(top.count)}회(${pct(top.count, N)})입니다. 1~45에는 홀수 23개, 짝수 22개가 있어 이론상으로도 홀3 짝3이 가장 흔합니다.`,
        body: [
            table(['형태', '나온 횟수', '비율', '이론 확률'], rows),
            '<p>이론 확률은 45개 중 6개를 뽑을 때 해당 형태가 나올 확률입니다. 실제 비율이 이론값에 가까울수록 추첨이 고르게 이뤄졌다는 뜻입니다.</p>',
        ],
    });
})();

(() => {
    const top = topBy(stats.lowHigh);
    const rows = stats.lowHigh.map(r => {
        const low = Number(r.label.match(/\d/)[0]);
        const theory = comb(22, low) * comb(23, 6 - low) / TOTAL;
        return [esc(r.label), fmt(r.count) + '회', pct(r.count, N), (theory * 100).toFixed(1) + '%'];
    });
    STATS.push({
        file: 'statistics-low-high.html', anchor: 'stat-low-high', short: '저고 비율',
        title: `로또 저고(고저) 비율 통계 (${RANGE})`,
        h1: '로또 저고 비율',
        desc: `로또 ${RANGE} 당첨번호의 낮은 번호(1~22)와 높은 번호(23~45) 비율을 이론 확률과 함께 정리했습니다. 최다 형태 ${top.label}.`,
        fact: `최다 ${top.label} ${pct(top.count, N)}`,
        lead: `1~22를 저번호, 23~45를 고번호로 나눴습니다. ${RANGE} 중 가장 많은 형태는 <strong>${esc(top.label)}</strong>로 ${fmt(top.count)}회(${pct(top.count, N)})입니다.`,
        body: [
            table(['형태', '나온 횟수', '비율', '이론 확률'], rows),
            '<p>저번호 22개, 고번호 23개라 이론상 저3 고3이 가장 흔하고, 한쪽으로 6개가 몰리는 경우는 드뭅니다.</p>',
        ],
    });
})();

(() => {
    const withRun = N - stats.consecutive[0].count;
    const rows = stats.consecutive.map(r => [esc(r.label), fmt(r.count) + '회', pct(r.count, N)]);
    STATS.push({
        file: 'statistics-consecutive.html', anchor: 'stat-consecutive', short: '연속번호',
        title: `로또 연속번호 통계 · 연속번호 확률 (${RANGE})`,
        h1: '로또 연속번호 통계',
        desc: `로또 ${RANGE} 중 연속번호가 포함된 회차는 ${fmt(withRun)}회(${pct(withRun, N)})입니다. 연속번호 확률과 2연속·3연속 이상 비율을 정리했습니다.`,
        fact: `연속번호 포함 ${pct(withRun, N)} (이론 ${(CONSEC_P * 100).toFixed(1)}%)`,
        lead: `${RANGE} 중 <strong>${fmt(withRun)}회(${pct(withRun, N)})</strong>에서 이어지는 번호가 하나 이상 나왔습니다. 6개를 무작위로 뽑을 때 연속번호가 하나라도 섞일 확률은 ${(CONSEC_P * 100).toFixed(1)}%로, 절반이 넘습니다.`,
        body: [
            table(['가장 긴 연속', '나온 횟수', '비율'], rows),
            '<p>한 회차에서 가장 길게 이어진 묶음을 기준으로 셉니다. 예를 들어 3·4·5와 20·21이 함께 나오면 3연속으로 셉니다. 각 회차에 어떤 번호가 이어졌는지는 <a href="draws.html">회차별 당첨번호</a>에서 회차를 눌러 볼 수 있습니다.</p>',
        ],
    });
})();

(() => {
    const top = topBy(stats.sum);
    const sums = draws.map(d => d.numbers.reduce((a, b) => a + b, 0));
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
    const rows = stats.sum.map(r => [esc(r.label), fmt(r.count) + '회', pct(r.count, N)]);
    STATS.push({
        file: 'statistics-sum.html', anchor: 'stat-sum', short: '번호 합계',
        title: `로또 번호 합계 분포 통계 (${RANGE})`,
        h1: '로또 당첨번호 합계 분포',
        desc: `로또 ${RANGE} 당첨번호 6개의 합계 분포입니다. 평균 ${f1(avg)}, 가장 많은 구간은 ${top.label}(${pct(top.count, N)}).`,
        fact: `평균 ${f1(avg)} · 최다 구간 ${top.label}`,
        lead: `${RANGE} 당첨번호 합계의 평균은 <strong>${f1(avg)}</strong>이고, 가장 많이 나온 구간은 <strong>${esc(top.label)}</strong>(${pct(top.count, N)})입니다. 이론 평균은 138입니다.`,
        body: [
            table(['합계 구간', '나온 횟수', '비율'], rows),
            `<p>가장 작은 합계는 ${Math.min.apply(null, sums)}, 가장 큰 합계는 ${Math.max.apply(null, sums)}였습니다. 합계는 가운데로 몰리는 값이라 양 끝 구간은 드물게 나옵니다.</p>`,
        ],
    });
})();

(() => {
    const zero = stats.winners[0].count;
    const top = topBy(stats.winners);
    const known = draws.filter(d => typeof d.firstPrizeWinners === 'number');
    const avg = known.reduce((a, d) => a + d.firstPrizeWinners, 0) / Math.max(1, known.length);
    const most = known.slice().sort((a, b) => b.firstPrizeWinners - a.firstPrizeWinners)[0];
    const rows = stats.winners.map(r => [esc(r.label), fmt(r.count) + '회', pct(r.count, N)]);
    STATS.push({
        file: 'statistics-prize.html', anchor: 'stat-prize', short: '1등 당첨자 수',
        title: `로또 1등 당첨자 수 통계 · 이월 횟수 (${RANGE})`,
        h1: '로또 1등 당첨자 수 통계',
        desc: `로또 ${RANGE} 회차별 1등 당첨자 수 분포입니다. 1등이 없어 이월된 회차 ${zero}회, 회차당 평균 ${f1(avg)}명.`,
        fact: `이월 ${zero}회 · 평균 ${f1(avg)}명`,
        lead: `${RANGE} 동안 1등 당첨자는 회차당 평균 <strong>${f1(avg)}명</strong>이었습니다. 1등이 한 명도 없어 당첨금이 이월된 회차는 <strong>${zero}회</strong>입니다. 가장 흔한 구간은 ${esc(top.label)}입니다.`,
        body: [
            table(['1등 당첨자 수', '회차 수', '비율'], rows),
            most ? `<p>1등이 가장 많이 나온 회차는 <a href="round/${most.round}.html">${most.round}회</a>(${most.date})로 ${most.firstPrizeWinners}명이었습니다. 당첨자가 많을수록 1인당 당첨금은 줄어듭니다. 역대 1인당 당첨금 순위는 <a href="top-prize.html">1등 당첨금 TOP 50</a>에서 볼 수 있습니다.</p>` : '',
        ],
    });
})();

(() => {
    const t = stats.trend;
    const rows = list => list.map((r, i) => [`${i + 1}위`, ball(r.number), fmt(r.recent) + '회', fmt(r.overall) + '회']);
    STATS.push({
        file: 'statistics-trend.html', anchor: 'stat-trend', short: `최근 ${t.window}회 많이·적게`,
        title: `로또 최근 ${t.window}회 많이 나온 번호 · 적게 나온 번호`,
        h1: `로또 최근 ${t.window}회 많이 나온 번호와 적게 나온 번호`,
        desc: `로또 최근 ${t.window}회(${stats.latestRound - t.window + 1}~${stats.latestRound}회) 동안 많이 나온 번호와 적게 나온 번호 Top 10. 최다 ${t.hot[0].number}번 ${t.hot[0].recent}회.`,
        fact: `최다 ${t.hot[0].number}번 ${t.hot[0].recent}회 · 최소 ${t.cold[0].number}번 ${t.cold[0].recent}회`,
        lead: `${stats.latestRound - t.window + 1}~${stats.latestRound}회 ${t.window}회 동안 가장 많이 나온 번호는 <strong>${t.hot[0].number}번(${t.hot[0].recent}회)</strong>, 가장 적게 나온 번호는 <strong>${t.cold[0].number}번(${t.cold[0].recent}회)</strong>입니다. ${t.window}회 동안 한 번호의 기대 출현은 ${f1(t.window * 6 / 45)}회입니다.`,
        body: [
            '<h2>많이 나온 번호</h2>',
            table(['순위', '번호', `최근 ${t.window}회`, '전 회차'], rows(t.hot)),
            '<h2>적게 나온 번호</h2>',
            table(['순위', '번호', `최근 ${t.window}회`, '전 회차'], rows(t.cold)),
            '<p>최근 기간은 표본이 작아 순위가 매주 크게 바뀝니다. 전 회차 열과 함께 보면 일시적인 쏠림인지 알 수 있습니다.</p>',
        ],
    });
})();

(() => {
    const p = stats.pairs;
    const rows = p.map((r, i) => [`${i + 1}위`, ball(r.a) + ' ' + ball(r.b), fmt(r.count) + '회']);
    STATS.push({
        file: 'statistics-pair.html', anchor: 'stat-pair', short: '궁합수 순위',
        title: `로또 궁합수 순위 · 함께 나온 번호 Top ${p.length} (${RANGE})`,
        h1: '로또 궁합수 (함께 나온 번호) 순위',
        desc: `로또 ${RANGE} 한 회차에 같이 나온 번호 쌍, 궁합수 순위 Top ${p.length}. 1위 ${p[0].a}·${p[0].b}번 ${p[0].count}회.`,
        fact: `1위 ${p[0].a}·${p[0].b}번 ${p[0].count}회`,
        lead: `궁합수는 한 회차에 자주 같이 나온 번호 쌍입니다. ${RANGE} 동안 가장 자주 같이 나온 쌍은 <strong>${p[0].a}번과 ${p[0].b}번(${p[0].count}회)</strong>입니다. 특정 두 번호가 한 회차에 함께 나올 기대 횟수는 ${f1(PAIR_EXP)}회입니다.`,
        body: [
            table(['순위', '번호 쌍', '함께 나온 횟수'], rows),
            '<p>쌍은 모두 990가지라 그중 가장 많은 쌍은 기대값보다 꽤 높게 나오는 게 보통입니다. 번호 하나를 골라 그 번호의 궁합수를 보는 기능은 <a href="index.html#detail-head">홈의 상세 분석</a>(이용권)에 있습니다.</p>',
        ],
    });
})();

(() => {
    const g = stats.gaps.slice(0, 15);
    const lastSeen = n => {
        const d = draws.find(x => x.numbers.indexOf(n) !== -1);
        return d ? `<a href="round/${d.round}.html">${d.round}회</a> (${d.date})` : '없음';
    };
    const rows = g.map((r, i) => [`${i + 1}위`, ball(r.number), r.gap === 0 ? '지난 회차' : `${r.gap}회차째`, lastSeen(r.number)]);
    STATS.push({
        file: 'statistics-gap.html', anchor: 'stat-gap', short: '미출수 (장기 미출현)',
        title: `로또 미출수 · 장기 미출현 번호 순위 (${stats.latestRound}회 기준)`,
        h1: '로또 미출수 (오래 안 나온 번호)',
        desc: `로또 ${stats.latestRound}회 기준 장기 미출수, 가장 오래 안 나온 번호 순위입니다. 1위 ${g[0].number}번은 ${g[0].gap}회차째 나오지 않았습니다.`,
        fact: `1위 ${g[0].number}번 · ${g[0].gap}회차째 미출현`,
        lead: `미출수는 최근에 나오지 않은 번호입니다. ${stats.latestRound}회 기준으로 가장 오래 안 나온 번호는 <strong>${g[0].number}번</strong>으로, ${g[0].gap}회차째 나오지 않았습니다.`,
        body: [
            table(['순위', '번호', '안 나온 기간', '마지막으로 나온 회차'], rows),
            '<p>매 회차 번호가 뽑힐 확률은 이전 결과와 상관없이 같습니다. 오래 쉬었다고 다음에 나올 확률이 올라가지는 않습니다.</p>',
        ],
    });
})();

(() => {
    const top = topBy(stats.ac);
    const rows = stats.ac.map(r => [esc(r.label), fmt(r.count) + '회', pct(r.count, N)]);
    STATS.push({
        file: 'statistics-ac.html', anchor: 'stat-ac', short: 'AC값',
        title: `로또 AC값 통계 · AC값 계산기 (${RANGE})`,
        h1: '로또 AC값 통계와 계산기',
        desc: `로또 AC값(산술적 복잡도) 계산 방법과 계산기, 역대 ${RANGE} AC값 분포. 가장 많은 값은 ${top.label}(${pct(top.count, N)}).`,
        fact: `최다 ${top.label} ${pct(top.count, N)}`,
        lead: `AC값은 번호 6개를 두 개씩 뺀 차이 15개 중 서로 다른 값의 개수에서 5를 뺀 값입니다. 0~10 사이이고, 높을수록 번호가 고르게 흩어진 조합입니다. ${RANGE} 중 가장 많은 값은 <strong>${esc(top.label)}</strong>(${pct(top.count, N)})입니다.`,
        body: [
            '<h2>AC값 계산기</h2>',
            [
                '<div class="calc-form">',
                '    <label for="ac-input">번호 6개</label>',
                '    <input type="text" id="ac-input" inputmode="numeric" autocomplete="off" placeholder="예: 7 13 16 23 24 43">',
                '    <button type="button" class="btn" id="ac-btn">계산하기</button>',
                '</div>',
                '<p class="calc-result" id="ac-out" role="status" aria-live="polite"></p>',
            ].join('\n'),
            '<h2>역대 AC값 분포</h2>',
            table(['AC값', '나온 횟수', '비율'], rows),
            '<p>예를 들어 1·2·3·4·5·6은 차이가 1~5뿐이라 AC값이 0입니다. 무작위로 뽑은 조합 대부분은 AC 7 이상입니다.</p>',
        ],
        script: [
            '(function () {',
            "    var input = document.getElementById('ac-input');",
            "    var out = document.getElementById('ac-out');",
            '    function run() {',
            "        var nums = (input.value.match(/[0-9]+/g) || []).map(Number);",
            '        var uniq = nums.filter(function (v, i, a) { return a.indexOf(v) === i; });',
            '        if (uniq.length !== 6 || uniq.some(function (n) { return n < 1 || n > 45; })) {',
            "            out.textContent = '1~45 사이의 서로 다른 번호 6개를 넣어 주세요.';",
            '            return;',
            '        }',
            '        var diffs = {};',
            '        for (var i = 0; i < 6; i++) for (var j = i + 1; j < 6; j++) diffs[Math.abs(uniq[i] - uniq[j])] = true;',
            '        var ac = Object.keys(diffs).length - 5;',
            "        out.textContent = uniq.sort(function (a, b) { return a - b; }).join(', ') + ' 의 AC값은 ' + ac + '입니다.';",
            '    }',
            "    document.getElementById('ac-btn').addEventListener('click', run);",
            "    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });",
            '}());',
        ].join('\n'),
    });
})();

(() => {
    const best = stats.tail.slice().sort((a, b) => b.per - a.per)[0];
    const rows = stats.tail.map(r => [esc(r.label), r.candidates + '개', fmt(r.count) + '회', '평균 ' + f1(r.per) + '회']);
    const sums = draws.map(d => tailSum(d.numbers));
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
    const bins = [[0, 14], [15, 19], [20, 24], [25, 29], [30, 34], [35, 54]];
    const counted = bins.map(([lo, hi]) => ({
        label: lo === 0 ? `${hi} 이하` : hi === 54 ? `${lo} 이상` : `${lo}~${hi}`,
        count: sums.filter(s => s >= lo && s <= hi).length,
    }));
    const topBin = topBy(counted).label;
    STATS.push({
        file: 'statistics-tail.html', anchor: 'stat-tail', short: '끝수 · 끝수합',
        title: `로또 끝수 통계 · 끝수합 분포 (${RANGE})`,
        h1: '로또 끝수 통계와 끝수합',
        desc: `로또 ${RANGE} 끝수(끝자리) 0~9별 출현 횟수와 번호당 평균, 끝수합 분포(평균 ${f1(avg)}). 번호당 평균이 가장 높은 끝수는 ${best.digit}.`,
        fact: `끝수합 평균 ${f1(avg)} · 끝수 ${best.digit} 최다`,
        lead: `끝수는 번호의 일의 자리입니다. 끝자리 1~5에는 번호가 5개(예: 1·11·21·31·41), 0과 6~9에는 4개씩 있어서 <strong>번호 1개당 평균</strong>으로 비교합니다. ${RANGE} 기준으로 번호당 평균이 가장 높은 끝수는 <strong>${best.digit}</strong>(${f1(best.per)}회)입니다.`,
        body: [
            '<h2>끝수별 출현 횟수</h2>',
            table(['끝수', '해당 번호 수', '출현 합계', '번호 1개당'], rows),
            '<p>총 횟수만 보면 끝수 1~5가 늘 많아 보입니다. 해당하는 번호가 하나 더 있기 때문이지 더 잘 나와서가 아닙니다.</p>',
            '<h2>끝수합 분포</h2>',
            `<p>끝수합은 당첨번호 6개의 끝자리를 모두 더한 값입니다. 예를 들어 7·13·16·23·24·43의 끝수합은 7+3+6+3+4+3 = 26입니다. ${RANGE} 평균은 <strong>${f1(avg)}</strong>, 가장 많은 구간은 <strong>${topBin}</strong>입니다.</p>`,
            table(['끝수합', '나온 횟수', '비율'], counted.map(c => [c.label, fmt(c.count) + '회', pct(c.count, N)])),
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
        .map(([lo, hi]) => `${lo}~${hi}: ${nums.filter(n => n >= lo && n <= hi).length}개`).join(' · ');

    const prizeText = winners === 0
        ? '1등 당첨자가 없어 당첨금이 다음 회차로 이월됐습니다.'
        : winners
            ? `1등 ${winners}명, 1인당 ${won(amount)}${amount ? ` (세후 약 ${won(amount - lottoTax(amount))})` : ''}`
            : '1등 당첨 정보가 아직 없습니다.';
    const descPrize = winners === 0 ? '1등 없음(이월)' : winners ? `1등 ${winners}명 · 1인당 ${won(amount)}` : '1등 정보 확인 중';

    const cum = cumulative[d.round];
    return shell({
        file: `round/${d.round}.html`,
        base: '../',
        callout: false,
        navCurrent: 'draws.html',
        crumbs: [['draws.html', '회차별 당첨번호'], [null, `${d.round}회`]],
        title: `로또 ${d.round}회 당첨번호 (${d.date}) ${nums.join(' ')} + ${d.bonus}`,
        h1: `로또 ${d.round}회 당첨번호`,
        desc: `로또 6/45 제${d.round}회(${d.date}) 당첨번호는 ${nums.join(', ')}, 보너스 ${d.bonus}. ${descPrize}. 홀짝·합계·연속번호·AC값 분석.`,
        scope: `${d.date} 추첨`,
        body: [
            `<div class="round-balls" aria-label="당첨번호 ${nums.join(', ')} 보너스 ${d.bonus}">${nums.map(bigBall).join('')}<span class="plus">+</span>${bigBall(d.bonus)}</div>`,
            `<p class="stat-lead">${prizeText}</p>`,
            '<h2>이 회차 번호 분석</h2>',
            table(['항목', '값'], [
                ['홀짝', `홀${odd} 짝${6 - odd}`],
                ['저고 (1~22 / 23~45)', `저${low} 고${6 - low}`],
                ['번호 합계', String(sum)],
                ['연속번호', runs.length ? runs.map(g => g.join('·')).join(', ') : '없음'],
                ['AC값', String(acValue(nums))],
                ['끝수합', String(tailSum(nums))],
                ['번호대', bands],
            ], 'kv-table'),
            `<h2>${d.round}회까지 번호별 누적 출현</h2>`,
            table(['번호', `1~${d.round}회 출현`], nums.map(n => [ball(n), fmt(cum[n]) + '회'])),
            [
                '<nav class="round-nav" aria-label="회차 이동">',
                prev ? `    <a class="btn btn-secondary" href="${prev.round}.html">← ${prev.round}회</a>` : '',
                '    <a class="btn btn-secondary" href="../draws.html">전체 회차</a>',
                next ? `    <a class="btn btn-secondary" href="${next.round}.html">${next.round}회 →</a>` : '',
                '</nav>',
            ].filter(Boolean).join('\n'),
            '<p>세후 금액은 구입비 1,000원을 뺀 뒤 3억 원까지 22%, 초과분 33%를 적용한 추정치입니다. <a href="../tax.html">실수령액 계산기</a>에서 금액을 바꿔 계산해 볼 수 있습니다.</p>',
        ],
    });
}

function drawsPage() {
    const rows = draws.map(d => {
        const nums = d.numbers.slice().sort(asc);
        const w = typeof d.firstPrizeWinners === 'number' ? d.firstPrizeWinners : null;
        return [
            `<a href="round/${d.round}.html">${d.round}회</a>`,
            d.date,
            `<span class="row-balls">${nums.map(ball).join('')}<span class="plus">+</span>${ball(d.bonus)}</span>`,
            w === 0 ? '이월' : w === null ? '-' : `${w}명`,
            w ? won(d.firstPrizeAmount) : '-',
        ];
    });
    const latestNums = LATEST.numbers.slice().sort(asc);
    return shell({
        file: 'draws.html',
        navCurrent: 'draws.html',
        crumbs: [[null, '회차별 당첨번호']],
        title: `로또 회차별 당첨번호 전체 조회 (${RANGE})`,
        h1: '로또 회차별 당첨번호 전체 조회',
        desc: `로또 6/45 ${RANGE} 회차별 당첨번호 전체 보기. 최신 ${LATEST.round}회(${LATEST.date}) 당첨번호 ${latestNums.join(', ')} + ${LATEST.bonus}. 회차별 1등 당첨자 수와 1인당 당첨금.`,
        scope: `${RANGE} · ${PERIOD} · 매주 추첨 후 자동 갱신`,
        lead: `최신 <a href="round/${LATEST.round}.html"><strong>${LATEST.round}회</strong></a>(${LATEST.date}) 당첨번호는 <strong>${latestNums.join(', ')}</strong>, 보너스 <strong>${LATEST.bonus}</strong>입니다. 회차를 누르면 그 회차의 번호 분석을 볼 수 있습니다.`,
        body: [
            [
                '<form class="calc-form" id="round-go">',
                '    <label for="round-input">회차로 바로 가기</label>',
                `    <input type="number" id="round-input" min="1" max="${LATEST.round}" inputmode="numeric" placeholder="예: ${LATEST.round}">`,
                '    <button type="submit" class="btn">보기</button>',
                '</form>',
                '<p class="calc-error" id="round-error" role="alert"></p>',
            ].join('\n'),
            table(['회차', '추첨일', '당첨번호 + 보너스', '1등', '1인당 1등 당첨금'], rows, 'draws-table'),
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
        ['1등', '6개 일치', 1],
        ['2등', '5개 + 보너스', comb(6, 5)],
        ['3등', '5개 일치', comb(6, 5) * comb(38, 1)],
        ['4등', '4개 일치', comb(6, 4) * comb(39, 2)],
        ['5등', '3개 일치', comb(6, 3) * comb(39, 3)],
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
        crumbs: [['index.html#sec-stats', '로또 통계'], [null, '로또 확률']],
        title: '로또 확률 계산 · 1등부터 5등까지 등수별 당첨 확률',
        h1: '로또 확률 · 등수별 당첨 확률',
        desc: `로또 6/45 1등 확률 1/${oneIn(1)}, 2등 1/${oneIn(6)}, 3등 1/${oneIn(228)}, 4등 1/${oneIn(11115)}, 5등 1/${oneIn(182780)}. 계산 공식과 자동·수동 확률 차이, 확률을 높이는 방법의 진실.`,
        scope: '45개 번호 중 6개를 고르는 조합 수 C(45,6) = 8,145,060 기준',
        lead: `로또 6/45는 1~45 중 6개를 고르는 게임이라 가능한 조합이 <strong>8,145,060가지</strong>입니다. 한 게임(1,000원)으로 1등에 당첨될 확률은 <strong>8,145,060분의 1</strong>입니다.`,
        body: [
            '<h2>등수별 당첨 확률</h2>',
            table(['등수', '조건', '해당 조합 수', '확률', '백분율'], rows),
            `<p>한 게임으로 5등 이상 무엇이든 당첨될 확률은 약 1 / ${f1(TOTAL / any)} 입니다.</p>`,
            '<h2>계산 방법</h2>',
            '<ul>',
            '<li><strong>1등</strong>: 6개를 모두 맞히는 조합은 1가지 → 1 / C(45,6)</li>',
            '<li><strong>2등</strong>: 당첨번호 6개 중 5개 × 보너스 번호 1개 = C(6,5) × 1 = 6가지</li>',
            '<li><strong>3등</strong>: 당첨번호 중 5개 × 당첨·보너스가 아닌 38개 중 1개 = 6 × 38 = 228가지</li>',
            '<li><strong>4등</strong>: 당첨번호 중 4개 × 나머지 39개 중 2개 = 15 × 741 = 11,115가지</li>',
            '<li><strong>5등</strong>: 당첨번호 중 3개 × 나머지 39개 중 3개 = 20 × 9,139 = 182,780가지</li>',
            '</ul>',
            '<h2>얼마나 드문 일일까</h2>',
            `<p>매주 한 게임씩 산다면 1등 조합 수만큼 사는 데 ${fmt(TOTAL)}주, 약 ${fmt(years)}년이 걸립니다.</p>`,
            '<h2>자동과 수동, 확률이 다를까</h2>',
            '<p>같습니다. 자동은 기계가 번호를 고르고 수동은 사람이 고를 뿐, 한 게임이 8,145,060개 조합 중 하나라는 점은 똑같습니다. 많이 나온 번호나 안 나온 번호를 골라도 확률은 달라지지 않습니다.</p>',
            '<h2>확률을 높이는 방법이 있을까</h2>',
            '<p>확률을 올리는 방법은 서로 다른 조합을 더 많이 사는 것뿐이고, 그만큼 비용도 늘어납니다. 다만 번호 선택은 <strong>당첨됐을 때 나눠 가질 사람 수</strong>에 영향을 줍니다. 1·2·3·4·5·6이나 생일 날짜(1~31)처럼 많은 사람이 고르는 조합은 당첨자가 여럿 나와 1인당 금액이 줄어듭니다. <a href="index.html">번호 생성기</a>는 이런 특수 패턴을 걸러냅니다.</p>',
            '<p>관련 통계: <a href="statistics-frequency.html">많이 나온 번호 순위</a> · <a href="statistics-prize.html">1등 당첨자 수</a> · <a href="tax.html">실수령액 계산기</a></p>',
        ],
    });
}

/* ───── 통계 페이지 렌더 ───── */

function relatedLinks(current) {
    return '<ul class="stat-links">' + STATS.filter(p => p.file !== current).map(p =>
        `<li><a href="${p.file}">${esc(p.short)}</a><span>${esc(p.fact)}</span></li>`
    ).join('') + '</ul>';
}

function statPage(p) {
    return shell({
        file: p.file,
        crumbs: [['index.html#sec-stats', '로또 통계'], [null, p.short]],
        title: p.title,
        h1: p.h1,
        desc: p.desc,
        scope: `${RANGE} · ${PERIOD} · 매주 추첨 후 자동 갱신 (마지막 갱신 ${UPDATED})`,
        lead: p.lead,
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
            `<p><a class="btn" href="index.html#${p.anchor}">홈에서 그래프로 보기</a></p>`,
            '<h2>다른 로또 통계</h2>',
            relatedLinks(p.file),
            '<p>함께 보기: <a href="draws.html">회차별 당첨번호 전체 조회</a> · <a href="probability.html">로또 확률</a></p>',
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
    `\n    <meta property="og:title" content="${esc(title)}">\n    <meta property="og:description" content="${esc(desc)}">\n    `;

function updateHome() {
    const title = `로또 통계 분석 · 번호 생성기 (${RANGE}) | lottodraw.kr`;
    const e = extremesOf(stats.frequency);
    const desc = `로또 역대 ${RANGE} 당첨번호 통계 분석 무료. 많이 나온 번호(1위 ${numsText(e.top)} ${e.max}회), 미출수, 궁합수, 홀짝·끝수 통계와 고정수·제외수를 넣는 번호 생성기. 매주 자동 갱신.`;
    const ld = JSON.stringify({
        '@context': 'https://schema.org',
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
    });
    const latestNums = LATEST.numbers.slice().sort(asc);
    const links = '\n' + [
        '            <nav class="stat-index" aria-label="통계별 자세히 보기">',
        '                <h3>통계별 자세히 보기</h3>',
        '                <ul class="stat-links">',
        STATS.map(p => `                    <li><a href="${p.file}">${esc(p.short)}</a><span>${esc(p.fact)}</span></li>`).join('\n'),
        `                    <li><a href="draws.html">회차별 당첨번호</a><span>최신 ${LATEST.round}회 ${latestNums.join(' ')} + ${LATEST.bonus}</span></li>`,
        '                    <li><a href="probability.html">로또 확률</a><span>1등 1/8,145,060 · 5등 1/45</span></li>',
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

function updateSitemap() {
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
            `        <changefreq>${e.changefreq}</changefreq>`,
            `        <priority>${e.priority}</priority>`,
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
updateHome();
updateTaxAndTop();
const urls = updateSitemap();
console.log(`통계 ${STATS.length}쪽 · 회차 ${draws.length}쪽 · 전체 조회 · 확률 · 사이트맵 ${urls}개 (${RANGE}, 갱신일 ${UPDATED})`);
console.log(`바뀐 생성 페이지: ${changed}쪽`);
