// 사용: node tools/test-prize-chart.js
// TOP 50 페이지 회차별 그래프(js/prize-chart.js)의 계산을 브라우저 없이 확인한다.
// 화면은 실제 브라우저로 봐야 하지만, 숫자가 틀리면 그림이 맞아 보여도 틀린 것이다.
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = require(path.join(ROOT, 'js', 'prize-chart.js'));
const data = require(path.join(ROOT, 'lotto-data.json'));

let failed = 0;
function check(name, ok, extra) {
    console.log((ok ? '  통과  ' : '  실패  ') + name + (ok || extra === undefined ? '' : ' → ' + extra));
    if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 이동평균: 창 안의 빈 값(이월)은 빼고, 창이 차기 전에는 null
check('이동평균 기본', same(P.movingAverage([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]));
check('이동평균은 빈 값을 건너뛴다', same(P.movingAverage([1, null, 3, 4, 5], 2), [null, 1, 3, 3.5, 4.5]));
check('창이 전부 비면 null', same(P.movingAverage([null, null, 6], 2), [null, null, 6]));

// 눈금
check('사람 수 눈금은 정수', same(P.linearTicks(63, 5, true).ticks, [0, 20, 40, 60, 80]));
check('작은 사람 수도 1 단위 아래로 안 간다', P.linearTicks(3, 5, true).ticks.every(Number.isInteger), JSON.stringify(P.linearTicks(3, 5, true)));
check('금액 눈금은 맨 위 값을 덮는다', P.linearTicks(40722959400, 5, false).max >= 40722959400);
const lg = P.logTicks(4e8, 4.07e10);
check('로그 눈금이 범위를 덮는다', lg.min <= 4e8 && lg.max >= 4.07e10, JSON.stringify(lg));
check('로그 눈금은 7개 이하', lg.ticks.length <= 7, lg.ticks.length);
const one = P.logTicks(2e9, 2e9);
check('값이 하나뿐이어도 로그 위아래가 다르다', one.max > one.min, JSON.stringify(one));

// 처음 보이는 지표 · 선 굵기 · 확대
check('처음 보이는 지표는 총 1등 당첨금', P.METRICS[0].id === 'total', P.METRICS[0].id);
check('점이 드물면 선이 굵다(2px)', P.lineWidth(50, 1000) === 2, P.lineWidth(50, 1000));
check('전체 기간(1,244회·1,100px)은 1px 이하', P.lineWidth(1244, 1100) <= 1, P.lineWidth(1244, 1100));
check('휴대폰 전체 기간은 더 가늘다', P.lineWidth(1244, 300) < P.lineWidth(1244, 1100));
check('구간은 전체 안에 맞춘다', same(P.clampView(1244, -50, 99), { s: 0, e: 149 }), JSON.stringify(P.clampView(1244, -50, 99)));
check('구간은 끝을 넘지 않는다', same(P.clampView(1244, 1200, 1300), { s: 1143, e: 1243 }), JSON.stringify(P.clampView(1244, 1200, 1300)));
check('구간은 최소 폭 이상', P.clampView(1244, 500, 501).e - P.clampView(1244, 500, 501).s + 1 === P.MIN_VIEW);
const full = { s: 0, e: 1243 };
const zin = P.zoomView(1244, full, 0.5);
check('전체에서 확대하면 가운데 절반', zin.e - zin.s + 1 === 622 && zin.s === 311, JSON.stringify(zin));
check('짚은 회차가 제자리에 머문다', (() => { const v = P.zoomView(1244, full, 0.5, 1000); return Math.abs((1000 - v.s) / (v.e - v.s) - 1000 / 1243) < 0.01; })());
check('최대로 축소하면 전체', same(P.zoomView(1244, zin, 4), full), JSON.stringify(P.zoomView(1244, zin, 4)));
check('계속 확대해도 최소 폭에서 멈춘다', (() => { let v = full; for (let k = 0; k < 20; k++) v = P.zoomView(1244, v, 0.5); return v.e - v.s + 1 === P.MIN_VIEW; })());

// 실제 데이터로 요약
const draws = data.draws.slice().sort((a, b) => a.round - b.round);
check('회차가 1부터 빠짐없이 이어진다 (그래프가 회차로 칸을 찾는다)', draws.every((d, i) => d.round === i + 1));
const each = P.METRICS.find(m => m.id === 'each');
const winners = P.METRICS.find(m => m.id === 'winners');
const total = P.METRICS.find(m => m.id === 'total');
const eachVals = draws.map(each.value);
const all = P.summarize(draws, eachVals, 0, draws.length - 1);
const rolls = draws.filter(d => d.firstPrizeWinners === 0).length;
check('이월 회차 수가 데이터와 같다', all.rollovers === rolls, `${all.rollovers} vs ${rolls}`);
check('이월 회차는 1인당 금액이 빈칸', draws.every((d, i) => d.firstPrizeWinners !== 0 || eachVals[i] === null));
const top = draws.reduce((a, b) => (b.firstPrizeAmount > a.firstPrizeAmount ? b : a));
check('전체 최고 1인당 금액이 TOP 50 1위와 같다', draws[all.hi].round === top.round, `${draws[all.hi].round} vs ${top.round}`);
const avgPaid = draws.filter(d => d.firstPrizeWinners > 0).reduce((s, d) => s + d.firstPrizeAmount, 0) / (draws.length - rolls);
check('평균은 이월 회차를 뺀 평균', Math.abs(all.avg - avgPaid) < 1, `${all.avg} vs ${avgPaid}`);
const w = P.summarize(draws, draws.map(winners.value), 0, draws.length - 1);
check('당첨자 수 최저는 0명(이월)', draws.map(winners.value)[w.lo] === 0);
const d = draws[draws.length - 1];
check('총 당첨금 = 1인당 × 인원', total.value(d) === d.firstPrizeAmount * d.firstPrizeWinners);

// 글자 (I18N 이 없으면 한국어)
check('금액 긴 표기 (만 원 아래 버림, 홈 상세 분석과 같다)', P.wonLong(1604686625) === '16억 468만 원', P.wonLong(1604686625));
check('금액 긴 표기 (억 딱 떨어짐)', P.wonLong(3000000000) === '30억 원', P.wonLong(3000000000));
check('금액 눈금 표기', P.wonShort(2.5e8) === '2.5억' && P.wonShort(5e7) === '5,000만' && P.wonShort(0) === '0',
    [P.wonShort(2.5e8), P.wonShort(5e7), P.wonShort(0)].join(' '));

console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
process.exit(failed ? 1 : 0);
