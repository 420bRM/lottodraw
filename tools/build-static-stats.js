#!/usr/bin/env node
// 정적 통계 페이지 생성기. lotto-data.json 으로 통계 12종을 HTML 표로 미리 그려 둔다.
//
// 왜 필요한가: 홈의 통계는 브라우저에서 JS 로 그린다. 네이버 검색 로봇은 JS 를 거의
// 실행하지 않고, 구글도 늦게 실행한다. 그래서 "로또 통계" 같은 검색에 걸릴 본문이
// 비어 있었다. 데이터가 바뀌는 주마다 이 스크립트가 같이 돌아 표·제목·설명을 최신
// 회차로 다시 쓴다 (.github/workflows/update-lotto-data.yml).
//
// 만드는 것
//   statistics-*.html 12개  통계별 검색 착지 페이지. 옛 주소 9개는 그대로 이어 쓴다.
//   index.html              <!-- seo:... --> 표식 사이의 제목·설명·구조화 데이터·통계 링크
//   sitemap.xml             통계 페이지를 넣고, 매주 바뀌는 페이지의 lastmod 를 최신 추첨일로
//
// 결제로 열리는 상세 분석(연속 회차 목록, 번호별 동반 출현, 당첨금 추이)은 싣지 않는다.
// 홈에서 무료로 보이는 통계만 표로 옮긴다.
//
// 사용: node tools/build-static-stats.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://www.lottodraw.kr';
const LottoStats = require(path.join(ROOT, 'js', 'lotto-stats.js'));

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

/* ───── 계산 준비 ───── */

const data = JSON.parse(read('lotto-data.json'));
const draws = data.draws.slice().sort((a, b) => b.round - a.round);
if (!draws.length) throw new Error('lotto-data.json 에 회차가 없다');

const stats = LottoStats.compute(draws, { pairTop: 20, trendTop: 10 });
const N = stats.rounds;
const LATEST = draws[0];
const UPDATED = LATEST.date;                       // lastmod · dateModified 기준
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
const numsText = rows => rows.slice(0, 4).map(r => r.number).join('·') + '번'
    + (rows.length > 4 ? ` 외 ${rows.length - 4}개` : '');
const extremesOf = rows => {
    const counts = rows.map(r => r.count);
    const max = Math.max.apply(null, counts);
    const min = Math.min.apply(null, counts);
    return {
        max: max, min: min,
        top: rows.filter(r => r.count === max),
        bottom: rows.filter(r => r.count === min),
    };
};
const topBy = rows => rows.slice().sort((a, b) => b.count - a.count)[0];
const ball = n => `<span class="mball" data-band="${LottoStats.bandOf(n)}">${n}</span>`;

function table(head, rows) {
    return [
        '<div class="table-scroll">',
        '<table class="data-table">',
        '<thead><tr>' + head.map(h => `<th scope="col">${esc(h)}</th>`).join('') + '</tr></thead>',
        '<tbody>',
        rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('\n'),
        '</tbody>',
        '</table>',
        '</div>',
    ].join('\n');
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

function rankList(rows, label) {
    return '<ol class="ball-list">' + rows.map((r, i) =>
        `<li><span class="lead">${i + 1}위</span>${ball(r.number)}<span class="tail">${label(r)}</span></li>`
    ).join('') + '</ol>';
}

const PAGES = [];

// 1. 번호별 출현 횟수
(() => {
    const e = extremesOf(stats.frequency);
    const ranked = stats.frequency.slice().sort((a, b) => b.count - a.count || a.number - b.number);
    PAGES.push({
        file: 'statistics-frequency.html', anchor: 'stat-frequency', short: '번호별 출현 횟수',
        title: `로또 번호별 출현 횟수 통계 (${RANGE})`,
        h1: '로또 번호별 출현 횟수',
        desc: `로또 6/45 ${RANGE} 전 회차에서 1~45번이 각각 몇 번 나왔는지 정리했습니다. 최다 ${numsText(e.top)} ${e.max}회, 최소 ${numsText(e.bottom)} ${e.min}회.`,
        fact: `최다 ${numsText(e.top)} ${e.max}회 · 최소 ${numsText(e.bottom)} ${e.min}회`,
        lead: `${RANGE} 동안 가장 많이 나온 번호는 <strong>${numsText(e.top)}(${e.max}회)</strong>, 가장 적게 나온 번호는 <strong>${numsText(e.bottom)}(${e.min}회)</strong>입니다. 한 회차에 6개를 뽑으므로 번호 하나의 기대 출현은 ${f1(EXP_NUM)}회입니다.`,
        body: [
            '<h2>많이 나온 번호 Top 10</h2>',
            rankList(ranked.slice(0, 10), r => fmt(r.count) + '회'),
            '<h2>번호별 전체 표</h2>',
            numberTable(stats.frequency, EXP_NUM),
            `<p>표준편차는 약 ${f1(SD_NUM)}회입니다. 최다 번호는 기대보다 ${f1(e.max - EXP_NUM)}회(+${f1((e.max - EXP_NUM) / SD_NUM)} 표준편차), 최소 번호는 ${f1(EXP_NUM - e.min)}회(-${f1((EXP_NUM - e.min) / SD_NUM)} 표준편차) 벗어나 있습니다. 번호 45개를 한꺼번에 보면 공평한 추첨에서도 양 끝이 이 정도로 벌어집니다.</p>`,
        ],
    });
})();

// 2. 보너스 번호
(() => {
    const e = extremesOf(stats.bonus);
    const ranked = stats.bonus.slice().sort((a, b) => b.count - a.count || a.number - b.number);
    PAGES.push({
        file: 'statistics-bonus.html', anchor: 'stat-bonus', short: '보너스 번호',
        title: `로또 보너스 번호 통계 (${RANGE})`,
        h1: '로또 보너스 번호 출현 횟수',
        desc: `로또 6/45 ${RANGE} 보너스 번호가 번호별로 몇 번 나왔는지 정리했습니다. 최다 ${numsText(e.top)} ${e.max}회, 최소 ${numsText(e.bottom)} ${e.min}회.`,
        fact: `최다 ${numsText(e.top)} ${e.max}회 · 최소 ${numsText(e.bottom)} ${e.min}회`,
        lead: `보너스 번호는 한 회차에 하나만 뽑으므로 번호 하나의 기대 출현은 ${f1(EXP_BONUS)}회입니다. ${RANGE} 동안 가장 많이 나온 보너스 번호는 <strong>${numsText(e.top)}(${e.max}회)</strong>, 가장 적게 나온 번호는 <strong>${numsText(e.bottom)}(${e.min}회)</strong>입니다.`,
        body: [
            '<h2>많이 나온 보너스 번호 Top 10</h2>',
            rankList(ranked.slice(0, 10), r => fmt(r.count) + '회'),
            '<h2>보너스 번호별 전체 표</h2>',
            numberTable(stats.bonus, EXP_BONUS),
            '<p>보너스 번호는 2등을 가를 때만 쓰입니다. 회차당 하나라 표본이 본 번호의 6분의 1이고, 그만큼 번호 사이 차이가 크게 보입니다.</p>',
        ],
    });
})();

// 3. 홀짝
(() => {
    const top = topBy(stats.oddEven);
    const rows = stats.oddEven.map(r => {
        const odd = Number(r.label.match(/\d/)[0]);
        const theory = comb(23, odd) * comb(22, 6 - odd) / TOTAL;
        return [esc(r.label), fmt(r.count) + '회', pct(r.count, N), (theory * 100).toFixed(1) + '%'];
    });
    PAGES.push({
        file: 'statistics-even-odd.html', anchor: 'stat-even-odd', short: '홀짝 비율',
        title: `로또 홀짝 비율 통계 (${RANGE})`,
        h1: '로또 홀짝 비율',
        desc: `로또 6/45 ${RANGE} 당첨번호 6개의 홀수·짝수 조합을 이론 확률과 나란히 정리했습니다. 가장 많은 형태는 ${top.label}(${pct(top.count, N)}).`,
        fact: `최다 ${top.label} ${pct(top.count, N)}`,
        lead: `${RANGE} 중 가장 많이 나온 형태는 <strong>${esc(top.label)}</strong>로 ${fmt(top.count)}회(${pct(top.count, N)})입니다. 1~45에는 홀수 23개, 짝수 22개가 있어 이론상으로도 홀3 짝3이 가장 흔합니다.`,
        body: [
            table(['형태', '나온 횟수', '비율', '이론 확률'], rows),
            '<p>이론 확률은 45개 중 6개를 뽑을 때 해당 형태가 나올 확률입니다. 실제 비율이 이론값에 가까울수록 추첨이 고르게 이뤄졌다는 뜻입니다.</p>',
        ],
    });
})();

// 4. 저고
(() => {
    const top = topBy(stats.lowHigh);
    const rows = stats.lowHigh.map(r => {
        const low = Number(r.label.match(/\d/)[0]);
        const theory = comb(22, low) * comb(23, 6 - low) / TOTAL;
        return [esc(r.label), fmt(r.count) + '회', pct(r.count, N), (theory * 100).toFixed(1) + '%'];
    });
    PAGES.push({
        file: 'statistics-low-high.html', anchor: 'stat-low-high', short: '저고 비율',
        title: `로또 저고(고저) 비율 통계 (${RANGE})`,
        h1: '로또 저고 비율',
        desc: `로또 6/45 ${RANGE} 당첨번호의 낮은 번호(1~22)와 높은 번호(23~45) 조합을 이론 확률과 함께 정리했습니다. 최다 형태 ${top.label}.`,
        fact: `최다 ${top.label} ${pct(top.count, N)}`,
        lead: `1~22를 저번호, 23~45를 고번호로 나눴습니다. ${RANGE} 중 가장 많은 형태는 <strong>${esc(top.label)}</strong>로 ${fmt(top.count)}회(${pct(top.count, N)})입니다.`,
        body: [
            table(['형태', '나온 횟수', '비율', '이론 확률'], rows),
            '<p>저번호 22개, 고번호 23개라 이론상 저3 고3이 가장 흔하고, 한쪽으로 6개가 몰리는 경우는 드뭅니다.</p>',
        ],
    });
})();

// 5. 연속번호
(() => {
    const none = stats.consecutive[0].count;
    const withRun = N - none;
    const rows = stats.consecutive.map(r => [esc(r.label), fmt(r.count) + '회', pct(r.count, N)]);
    PAGES.push({
        file: 'statistics-consecutive.html', anchor: 'stat-consecutive', short: '연속번호',
        title: `로또 연속번호 통계 (${RANGE})`,
        h1: '로또 연속번호 통계',
        desc: `로또 6/45 ${RANGE} 중 연속번호가 포함된 회차는 ${fmt(withRun)}회(${pct(withRun, N)})입니다. 2연속·3연속 이상 비율을 이론값과 함께 정리했습니다.`,
        fact: `연속번호 포함 ${pct(withRun, N)} (이론 ${(CONSEC_P * 100).toFixed(1)}%)`,
        lead: `${RANGE} 중 <strong>${fmt(withRun)}회(${pct(withRun, N)})</strong>에서 이어지는 번호가 하나 이상 나왔습니다. 6개를 무작위로 뽑을 때 연속번호가 하나라도 섞일 이론 확률은 ${(CONSEC_P * 100).toFixed(1)}%로, 절반이 넘습니다.`,
        body: [
            table(['가장 긴 연속', '나온 횟수', '비율'], rows),
            '<p>한 회차에서 가장 길게 이어진 묶음을 기준으로 셉니다. 예를 들어 3·4·5와 20·21이 함께 나오면 3연속으로 셉니다.</p>',
        ],
    });
})();

// 6. 번호 합계
(() => {
    const top = topBy(stats.sum);
    const sums = draws.map(d => d.numbers.reduce((a, b) => a + b, 0));
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
    const rows = stats.sum.map(r => [esc(r.label), fmt(r.count) + '회', pct(r.count, N)]);
    PAGES.push({
        file: 'statistics-sum.html', anchor: 'stat-sum', short: '번호 합계',
        title: `로또 번호 합계 분포 통계 (${RANGE})`,
        h1: '로또 당첨번호 합계 분포',
        desc: `로또 6/45 ${RANGE} 당첨번호 6개의 합계 분포입니다. 평균 ${f1(avg)}, 가장 많은 구간은 ${top.label}(${pct(top.count, N)}).`,
        fact: `평균 ${f1(avg)} · 최다 구간 ${top.label}`,
        lead: `${RANGE} 당첨번호 합계의 평균은 <strong>${f1(avg)}</strong>이고, 가장 많이 나온 구간은 <strong>${esc(top.label)}</strong>(${pct(top.count, N)})입니다. 이론 평균은 138입니다.`,
        body: [
            table(['합계 구간', '나온 횟수', '비율'], rows),
            `<p>가장 작은 합계는 ${Math.min.apply(null, sums)}, 가장 큰 합계는 ${Math.max.apply(null, sums)}였습니다. 합계는 가운데로 몰리는 값이라 양 끝 구간은 드물게 나옵니다.</p>`,
        ],
    });
})();

// 7. 1등 당첨자 수
(() => {
    const zero = stats.winners[0].count;
    const top = topBy(stats.winners);
    const known = draws.filter(d => typeof d.firstPrizeWinners === 'number');
    const avg = known.reduce((a, d) => a + d.firstPrizeWinners, 0) / Math.max(1, known.length);
    const most = known.slice().sort((a, b) => b.firstPrizeWinners - a.firstPrizeWinners)[0];
    const rows = stats.winners.map(r => [esc(r.label), fmt(r.count) + '회', pct(r.count, N)]);
    PAGES.push({
        file: 'statistics-prize.html', anchor: 'stat-prize', short: '1등 당첨자 수',
        title: `로또 1등 당첨자 수 통계 (${RANGE})`,
        h1: '로또 1등 당첨자 수 통계',
        desc: `로또 6/45 ${RANGE} 회차별 1등 당첨자 수 분포입니다. 1등이 없어 이월된 회차 ${zero}회, 평균 ${f1(avg)}명.`,
        fact: `이월 ${zero}회 · 평균 ${f1(avg)}명`,
        lead: `${RANGE} 동안 1등 당첨자는 회차당 평균 <strong>${f1(avg)}명</strong>이었습니다. 1등이 한 명도 없어 당첨금이 이월된 회차는 <strong>${zero}회</strong>입니다. 가장 흔한 구간은 ${esc(top.label)}입니다.`,
        body: [
            table(['1등 당첨자 수', '회차 수', '비율'], rows),
            most ? `<p>1등이 가장 많이 나온 회차는 ${most.round}회(${most.date})로 ${most.firstPrizeWinners}명이었습니다. 당첨자가 많을수록 1인당 당첨금은 줄어듭니다. 역대 1인당 당첨금 순위는 <a href="top-prize.html">TOP 50 당첨금</a>에서 볼 수 있습니다.</p>` : '',
        ],
    });
})();

// 8. 최근 50회 많이·적게
(() => {
    const t = stats.trend;
    const rows = list => list.map((r, i) => [`${i + 1}위`, ball(r.number), fmt(r.recent) + '회', fmt(r.overall) + '회']);
    PAGES.push({
        file: 'statistics-trend.html', anchor: 'stat-trend', short: `최근 ${t.window}회 많이·적게`,
        title: `로또 최근 ${t.window}회 많이 나온 번호 · 적게 나온 번호`,
        h1: `로또 최근 ${t.window}회 많이 나온 번호와 적게 나온 번호`,
        desc: `로또 6/45 최근 ${t.window}회(${stats.latestRound - t.window + 1}~${stats.latestRound}회) 동안 많이 나온 번호와 적게 나온 번호 Top 10. 최다 ${t.hot[0].number}번 ${t.hot[0].recent}회.`,
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

// 9. 함께 나온 번호 쌍
(() => {
    const p = stats.pairs;
    const rows = p.map((r, i) => [`${i + 1}위`, ball(r.a) + ' ' + ball(r.b), fmt(r.count) + '회']);
    PAGES.push({
        file: 'statistics-pair.html', anchor: 'stat-pair', short: '함께 나온 번호 쌍',
        title: `로또 함께 나온 번호 쌍 통계 Top ${p.length} (${RANGE})`,
        h1: `로또 함께 나온 번호 쌍 Top ${p.length}`,
        desc: `로또 6/45 ${RANGE} 한 회차에 같이 나온 번호 쌍 순위입니다. 1위 ${p[0].a}·${p[0].b}번 ${p[0].count}회.`,
        fact: `1위 ${p[0].a}·${p[0].b}번 ${p[0].count}회`,
        lead: `${RANGE} 동안 한 회차에 가장 자주 같이 나온 쌍은 <strong>${p[0].a}번과 ${p[0].b}번(${p[0].count}회)</strong>입니다. 특정 두 번호가 한 회차에 함께 나올 기대 횟수는 ${f1(PAIR_EXP)}회입니다.`,
        body: [
            table(['순위', '번호 쌍', '함께 나온 횟수'], rows),
            '<p>쌍은 모두 990가지라 그중 가장 많은 쌍은 기대값보다 꽤 높게 나오는 게 보통입니다.</p>',
        ],
    });
})();

// 10. 오래 안 나온 번호
(() => {
    const g = stats.gaps.slice(0, 15);
    const lastSeen = n => {
        const d = draws.find(x => x.numbers.indexOf(n) !== -1);
        return d ? `${d.round}회 (${d.date})` : '없음';
    };
    const rows = g.map((r, i) => [`${i + 1}위`, ball(r.number), r.gap === 0 ? '지난 회차' : `${r.gap}회차 전`, lastSeen(r.number)]);
    PAGES.push({
        file: 'statistics-gap.html', anchor: 'stat-gap', short: '오래 안 나온 번호',
        title: `로또 오래 안 나온 번호 (미출현 번호) · ${stats.latestRound}회 기준`,
        h1: '로또 오래 안 나온 번호',
        desc: `로또 6/45 ${stats.latestRound}회 기준으로 가장 오래 나오지 않은 번호 순위입니다. 1위 ${g[0].number}번(${g[0].gap}회차 전 마지막 출현).`,
        fact: `1위 ${g[0].number}번 · ${g[0].gap}회차째 미출현`,
        lead: `${stats.latestRound}회 기준으로 가장 오래 나오지 않은 번호는 <strong>${g[0].number}번</strong>으로, ${g[0].gap}회차 전에 마지막으로 나왔습니다.`,
        body: [
            table(['순위', '번호', '마지막 출현', '마지막으로 나온 회차'], rows),
            '<p>매 회차 번호가 뽑힐 확률은 이전 결과와 상관없이 같습니다. 오래 쉬었다고 다음에 나올 확률이 올라가지는 않습니다.</p>',
        ],
    });
})();

// 11. AC값
(() => {
    const top = topBy(stats.ac.slice(0));
    const rows = stats.ac.map(r => [esc(r.label), fmt(r.count) + '회', pct(r.count, N)]);
    PAGES.push({
        file: 'statistics-ac.html', anchor: 'stat-ac', short: 'AC값',
        title: `로또 AC값 분포 통계 (${RANGE})`,
        h1: '로또 AC값(산술적 복잡도) 분포',
        desc: `로또 6/45 ${RANGE} 당첨번호의 AC값 분포입니다. 가장 많은 값은 ${top.label}(${pct(top.count, N)}). AC값 계산 방법도 함께 설명합니다.`,
        fact: `최다 ${top.label} ${pct(top.count, N)}`,
        lead: `AC값은 번호 6개를 두 개씩 뺀 차이 15개 중 서로 다른 값의 개수에서 5를 뺀 값입니다. 0~10 사이이고, 높을수록 번호가 고르게 흩어진 조합입니다. ${RANGE} 중 가장 많은 값은 <strong>${esc(top.label)}</strong>(${pct(top.count, N)})입니다.`,
        body: [
            table(['AC값', '나온 횟수', '비율'], rows),
            '<p>예를 들어 1·2·3·4·5·6은 차이가 1~5뿐이라 AC값이 0입니다. 무작위로 뽑은 조합 대부분은 AC 7 이상입니다.</p>',
        ],
    });
})();

// 12. 끝자리
(() => {
    const best = stats.tail.slice().sort((a, b) => b.per - a.per)[0];
    const rows = stats.tail.map(r => [esc(r.label), r.candidates + '개', fmt(r.count) + '회', '평균 ' + f1(r.per) + '회']);
    PAGES.push({
        file: 'statistics-tail.html', anchor: 'stat-tail', short: '끝자리(끝수)',
        title: `로또 끝수(끝자리) 통계 (${RANGE})`,
        h1: '로또 끝수(끝자리) 통계',
        desc: `로또 6/45 ${RANGE} 당첨번호 끝자리 0~9별 출현 횟수와 번호 1개당 평균입니다. 번호당 평균이 가장 높은 끝수는 ${best.digit}.`,
        fact: `번호당 평균 최고 끝수 ${best.digit} (${f1(best.per)}회)`,
        lead: `끝자리 1~5에는 번호가 5개(예: 1·11·21·31·41), 0과 6~9에는 4개씩 있습니다. 그래서 총 횟수 대신 <strong>번호 1개당 평균</strong>으로 비교합니다. ${RANGE} 기준으로 번호당 평균이 가장 높은 끝수는 <strong>${best.digit}</strong>(${f1(best.per)}회)입니다.`,
        body: [
            table(['끝자리', '해당 번호 수', '출현 합계', '번호 1개당'], rows),
            '<p>총 횟수만 보면 끝수 1~5가 늘 많아 보입니다. 해당하는 번호가 하나 더 있기 때문이지 더 잘 나와서가 아닙니다.</p>',
        ],
    });
})();

/* ───── 페이지 틀 ───── */

const latestCallout = `제${LATEST.round}회 ${LATEST.numbers.join(' ')} <span class="bonus-sep">+</span> ${LATEST.bonus}`;

function relatedLinks(current) {
    return '<ul class="stat-links">' + PAGES.filter(p => p.file !== current).map(p =>
        `<li><a href="${p.file}">${esc(p.short)}</a><span>${esc(p.fact)}</span></li>`
    ).join('') + '</ul>';
}

function jsonLd(p) {
    return JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Dataset',
                name: p.title,
                description: p.desc,
                url: `${SITE}/${p.file}`,
                isAccessibleForFree: true,
                dateModified: UPDATED,
                temporalCoverage: `${stats.oldestDate}/${stats.latestDate}`,
                creator: { '@type': 'Organization', name: 'lottodraw.kr', url: SITE + '/' },
                keywords: ['로또 통계', '로또 6/45', p.short],
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: '홈', item: SITE + '/' },
                    { '@type': 'ListItem', position: 2, name: '로또 통계', item: SITE + '/#sec-stats' },
                    { '@type': 'ListItem', position: 3, name: p.short, item: `${SITE}/${p.file}` },
                ],
            },
        ],
    });
}

function render(p) {
    const title = `${p.title} | lottodraw.kr`;
    return `<!DOCTYPE html>
<!-- 이 파일은 tools/build-static-stats.js 가 매주 다시 만든다. 직접 고치면 덮어쓰인다. -->
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(p.desc)}">
    <link rel="canonical" href="${SITE}/${p.file}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(p.desc)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${SITE}/${p.file}">
    <meta property="og:site_name" content="lottodraw.kr">
    <meta name="google-adsense-account" content="ca-pub-9372871176021283">
    <link rel="stylesheet" href="css/site.css">
    <script type="application/ld+json">${jsonLd(p)}</script>
</head>
<body>
<div class="page">
    <header class="banner">
        <a class="brand" href="index.html">
            <span class="brand-name">LOTTODRAW.KR</span>
            <span class="brand-tag">특수 패턴을 걸러내는 로또 6/45 번호 생성기</span>
        </a>
        <div class="banner-right">
            <p class="latest-callout">${latestCallout}</p>
            <a class="sticker" href="statistics.html">최근 <b>5개월</b> 통계</a>
        </div>
    </header>

    <nav class="nav" aria-label="주 메뉴">
        <ul>
            <li><a href="index.html">생성기 · 통계</a></li>
            <li><a href="statistics.html">5개월 통계</a></li>
            <li><a href="top-prize.html">TOP 50 당첨금</a></li>
            <li><a href="tax.html">실수령액 계산</a></li>
            <li><a href="about.html">ABOUT</a></li>
        </ul>
    </nav>

    <main class="prose stat-page">
        <nav class="breadcrumb" aria-label="현재 위치">
            <a href="index.html">홈</a> › <a href="index.html#sec-stats">로또 통계</a> › <span>${esc(p.short)}</span>
        </nav>
        <h1>${esc(p.h1)}</h1>
        <p class="stat-scope">${RANGE} · ${PERIOD} · 매주 추첨 후 자동 갱신 (마지막 갱신 ${UPDATED})</p>
        <p class="stat-lead">${p.lead}</p>

${p.body.filter(Boolean).join('\n\n')}

        <p><a class="btn" href="index.html#${p.anchor}">홈에서 그래프로 보기</a></p>

        <h2>다른 로또 통계</h2>
        ${relatedLinks(p.file)}

        <p class="page-disclaimer">지난 추첨 기록을 정리한 것이며 다음 회차를 예측하지 않습니다. 어떤 6개를 고르든 1등 확률은 1/8,145,060으로 같습니다. 당첨번호 출처: 동행복권.</p>
    </main>

    <footer class="footer">
        <ul class="footer-nav">
            <li><a href="index.html">HOME</a></li>
            <li><a href="statistics.html">5개월 통계</a></li>
            <li><a href="top-prize.html">TOP 50</a></li>
            <li><a href="tax.html">실수령액</a></li>
            <li><a href="about.html">ABOUT</a></li>
        </ul>
        <p><a href="privacy.html">개인정보 처리방침</a> · <a href="terms.html">이용약관</a> · <a href="contact.html">문의</a></p>
        <p>&copy; 2026 lottodraw.kr · 당첨번호 출처: 동행복권</p>
    </footer>
</div>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9372871176021283" crossorigin="anonymous"></script>
</body>
</html>
`;
}

/* ───── 홈: 표식 사이만 바꾼다 ───── */

function replaceBetween(src, name, content) {
    const start = `<!-- seo:${name}:start -->`;
    const end = `<!-- seo:${name}:end -->`;
    const a = src.indexOf(start);
    const b = src.indexOf(end);
    if (a === -1 || b === -1 || b < a) throw new Error(`index.html 에 ${start} … ${end} 표식이 없다`);
    return src.slice(0, a + start.length) + content + src.slice(b);
}

function updateHome() {
    const title = `로또 통계 · 번호 생성기 (${RANGE} 전 회차) | lottodraw.kr`;
    const desc = `로또 6/45 ${RANGE} 전 회차 당첨번호 통계 12종과 특수 패턴을 걸러내는 번호 생성기. 번호별 출현 횟수, 홀짝·저고 비율, 연속번호, 합계 분포를 매주 자동 갱신합니다.`;
    const ld = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: '로또 6/45 전 회차 당첨번호 통계',
        description: `동행복권 로또 6/45 ${RANGE} 회차별 당첨번호, 보너스 번호, 1등 당첨자 수로 계산한 통계 12종`,
        url: SITE + '/',
        isAccessibleForFree: true,
        dateModified: UPDATED,
        temporalCoverage: `${stats.oldestDate}/${stats.latestDate}`,
        keywords: '로또 통계, 로또 6/45, 당첨번호, 번호별 출현 횟수',
        hasPart: PAGES.map(p => ({ '@type': 'Dataset', name: p.title, url: `${SITE}/${p.file}` })),
    });
    const links = '\n' + [
        '            <nav class="stat-index" aria-label="통계별 자세히 보기">',
        '                <h3>통계별 자세히 보기</h3>',
        '                <ul class="stat-links">',
        PAGES.map(p => `                    <li><a href="${p.file}">${esc(p.short)}</a><span>${esc(p.fact)}</span></li>`).join('\n'),
        '                </ul>',
        '            </nav>',
        '            ',
    ].join('\n');

    let html = read('index.html');
    html = replaceBetween(html, 'head',
        `\n    <title>${esc(title)}</title>\n    <meta name="description" content="${esc(desc)}">`
        + `\n    <meta property="og:title" content="${esc(title)}">\n    <meta property="og:description" content="${esc(desc)}">\n    `);
    html = replaceBetween(html, 'ld', `\n    <script type="application/ld+json">${ld}</script>\n    `);
    html = replaceBetween(html, 'links', links);
    write('index.html', html);
}

/* ───── 사이트맵 ───── */

function updateSitemap() {
    const old = read('sitemap.xml');
    const keep = {};
    const re = /<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>\s*<changefreq>([^<]+)<\/changefreq>\s*<priority>([^<]+)<\/priority>\s*<\/url>/g;
    let m;
    while ((m = re.exec(old))) keep[m[1]] = { lastmod: m[2], changefreq: m[3], priority: m[4] };

    const fixed = [
        ['/', 'weekly', '1.0', true],
        ['/statistics.html', 'weekly', '0.8', true],
        ['/top-prize.html', 'weekly', '0.7', true],
        ['/tax.html', 'monthly', '0.7', false],
        ['/about.html', 'monthly', '0.5', false],
        ['/privacy.html', 'yearly', '0.3', false],
        ['/terms.html', 'yearly', '0.3', false],
        ['/contact.html', 'yearly', '0.3', false],
    ];
    const entries = fixed.map(([p, freq, pri, weekly]) => {
        const loc = SITE + p;
        return { loc, changefreq: freq, priority: pri, lastmod: weekly ? UPDATED : ((keep[loc] && keep[loc].lastmod) || UPDATED) };
    });
    PAGES.forEach(p => entries.splice(1 + PAGES.indexOf(p), 0, {
        loc: `${SITE}/${p.file}`, changefreq: 'weekly', priority: '0.8', lastmod: UPDATED,
    }));

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
}

/* ───── 실행 ───── */

PAGES.forEach(p => write(p.file, render(p)));
updateHome();
updateSitemap();
console.log(`정적 통계 ${PAGES.length}쪽 생성 · ${RANGE} · 갱신일 ${UPDATED}`);
PAGES.forEach(p => console.log(`  ${p.file.padEnd(30)} ${p.title}`));
