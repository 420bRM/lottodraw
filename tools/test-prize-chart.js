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
check('이용권이 있으면 처음 켜 둔 이동평균은 20회 · 240회', JSON.stringify(P.DEFAULT_IND) === JSON.stringify({ ma20: true, ma240: true }), JSON.stringify(P.DEFAULT_IND));
check('이용권이 없으면 240회 이동평균만 보인다', JSON.stringify(P.FREE_IND) === JSON.stringify({ ma240: true }), JSON.stringify(P.FREE_IND));
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

// 휠 · 두 손가락: 커서 자리 칸이 화면 같은 자리에 머문다
const va = P.viewAround(1244, 100, 600, 0.25);
check('커서 자리(1/4 지점)에 그 칸이 온다', va.e - va.s + 1 === 100 && Math.abs((600 - va.s) / 99 - 0.25) < 0.01, JSON.stringify(va));
check('왼쪽 끝 너머로는 안 간다', same(P.viewAround(1244, 100, 5, 0.9), { s: 0, e: 99 }), JSON.stringify(P.viewAround(1244, 100, 5, 0.9)));
check('오른쪽 끝 너머로는 안 간다', P.viewAround(1244, 100, 1243, 0).e === 1243);
check('최소 폭 아래로는 안 좁힌다', (() => { const v = P.viewAround(1244, 3, 500, 0.5); return v.e - v.s + 1 === P.MIN_VIEW; })());
check('휠 위로 = 확대(폭이 준다)', P.wheelWidth(1244, -100) < 1244 && P.wheelWidth(1244, -100) > 900, P.wheelWidth(1244, -100));
check('휠 아래로 = 축소(폭이 는다)', P.wheelWidth(100, 100) > 100, P.wheelWidth(100, 100));
check('아주 작은 휠도 한 칸은 바뀐다', P.wheelWidth(12, -1) === 11 && P.wheelWidth(12, 1) === 13);
check('터치패드 벌리기(ctrl)는 더 크게', P.wheelWidth(1000, -10, true) < P.wheelWidth(1000, -10));

// 봉: 기간마다 시가(첫 회차) · 고가 · 저가 · 종가(마지막 회차), 빈 값(이월)은 건너뛴다
const cd = P.candles(['2003-01-04', '2003-01-11', '2003-02-01', '2003-04-05', '2004-01-03'], [10, null, 30, 5, 8], 'y');
check('연봉은 해마다 하나', cd.length === 2 && cd[0].key === '2003' && cd[1].key === '2004', JSON.stringify(cd.map(c => c.key)));
check('시가 · 고가 · 저가 · 종가', cd[0].o === 10 && cd[0].h === 30 && cd[0].l === 5 && cd[0].c === 5, JSON.stringify(cd[0]));
check('봉이 차지하는 회차 칸', cd[0].s === 0 && cd[0].e === 3 && cd[1].s === 4 && cd[1].e === 4);
check('분기봉 이름', P.candles(['2003-04-05', '2003-12-27'], [1, 2], 'q').map(c => c.key).join() === '2003-Q2,2003-Q4');
check('월봉 이름', P.candles(['2003-04-05', '2003-04-12', '2003-05-03'], [1, 2, 3], 'm').length === 2);
check('값이 하나도 없는 기간은 시가가 null', P.candles(['2003-01-04'], [null], 'y')[0].o === null);
const real = P.candles(data.draws.slice().sort((a, b) => a.round - b.round).map(d => d.date), data.draws.slice().sort((a, b) => a.round - b.round).map(d => d.firstPrizeWinners > 0 ? d.firstPrizeAmount * d.firstPrizeWinners : null), 'y');
check('2003년 연봉: 고가 836억 (19회)', Math.round(real.find(c => c.key === '2003').h / 1e8) === 836, real.find(c => c.key === '2003').h);

// 세후 실수령액 (tax.html 과 같은 계산)
check('200만 원 이하는 세금 없음', P.afterTax(2000000) === 2000000);
check('20억 → 약 13억 7,300만 (3억까지 22%, 넘는 부분 33%)', Math.round(P.afterTax(2e9) / 1e5) === 13730, P.afterTax(2e9));
check('5억 → 약 3억 6,800만', Math.round(P.afterTax(5e8) / 1e6) === 368, P.afterTax(5e8));
check('빈 값은 그대로', P.afterTax(null) === null);
// 서울 아파트 평균가: 그 회차 달, 아직 없는 달은 마지막 달, 추정 구간 표시
const apt = { latest: '2026-09', estimatedBefore: '2008-12', monthly: { '2005-03': 4e8, '2008-12': 5.25e8, '2026-09': 1.62e9 } };
check('그 달 값', P.aptAt(apt, '2008-12-06').v === 5.25e8 && !P.aptAt(apt, '2008-12-06').est);
check('추정 구간 표시', P.aptAt(apt, '2005-03-12').est === true);
check('아직 안 나온 달은 마지막 달', P.aptAt(apt, '2026-10-03').ym === '2026-09');
check('값이 없는 달은 null', P.aptAt(apt, '2010-01-02') === null);

// 물가 반영: 금액 × 지수(기준 달) ÷ 지수(그 달)
const cpi = { latest: '2026-08', monthly: { '2002-12': 50, '2014-03': 80, '2026-08': 120 } };
check('물가 배수 = 기준 달 ÷ 그 달', Math.abs(P.realFactor(cpi, '2002-12-07') - 2.4) < 1e-9, P.realFactor(cpi, '2002-12-07'));
check('기준 달 회차는 1배', P.realFactor(cpi, '2026-08-29') === 1);
check('지수가 아직 없는 최근 달은 1배', P.realFactor(cpi, '2026-10-03') === 1);
check('지수가 빠진 달은 계산하지 않는다', P.realFactor(cpi, '2010-05-01') === null);
check('물가 자료가 없으면 계산하지 않는다', P.realFactor(null, '2010-05-01') === null);

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

// 2·3등 1게임당 (top-prize.html 이 prize-data.json 의 a2 · a3 · w2 · w3 를 회차에 붙인다)
const second = P.METRICS.find(m => m.id === 'second');
const third = P.METRICS.find(m => m.id === 'third');
check('2·3등 지표가 있고 금액 지표다', !!(second && third && second.tier && third.tier && second.unit === 'won' && third.unit === 'won'));
check('1등 지표는 2·3등 묶음이 아니다', P.METRICS.filter(m => !m.tier).map(m => m.id).join() === 'total,winners,each');
check('2등 금액', second.value({ w2: 80, a2: 60175749 }) === 60175749);
check('3등 금액', third.value({ w3: 3731, a3: 1290287 }) === 1290287);
check('2등 당첨이 없던 회차(3 · 5회)는 빈칸', second.value({ w2: 0, a2: 0 }) === null);
check('2·3등 자료가 아직 없는 회차는 집계 전(undefined — 당첨 없음 null 과 다르다)', second.value({ round: 1 }) === undefined && third.value({ round: 1 }) === undefined);
const prize = require(path.join(ROOT, 'prize-data.json'));
const tierBy = {};
prize.draws.forEach(p => { tierBy[p.round] = p; });
const merged = draws.map(x => Object.assign({}, x, tierBy[x.round] ? { w2: tierBy[x.round].w2, a2: tierBy[x.round].a2, w3: tierBy[x.round].w3, a3: tierBy[x.round].a3 } : {}));
const s2 = P.summarize(merged, merged.map(second.value), 0, merged.length - 1);
const best2 = prize.draws.filter(p => p.w2 > 0).reduce((a, b) => (b.a2 > a.a2 ? b : a));
check('2등 전체 최고가 자료의 최고 회차와 같다', merged[s2.hi].round === best2.round, `${merged[s2.hi].round} vs ${best2.round}`);

// 글자 (I18N 이 없으면 한국어)
check('금액 긴 표기 (만 원 아래 버림, 홈 상세 분석과 같다)', P.wonLong(1604686625) === '16억 468만 원', P.wonLong(1604686625));
check('금액 긴 표기 (억 딱 떨어짐)', P.wonLong(3000000000) === '30억 원', P.wonLong(3000000000));
check('금액 눈금 표기', P.wonShort(2.5e8) === '2.5억' && P.wonShort(5e7) === '5,000만' && P.wonShort(0) === '0',
    [P.wonShort(2.5e8), P.wonShort(5e7), P.wonShort(0)].join(' '));
// 영문: 3등(100만 원대)이 "1m" 으로 뭉개지지 않게
globalThis.I18N = { lang: 'en', t: k => k, f: k => k };
const enLong = [1604686625, 56947382, 1449581, 627634].map(P.wonLong);
check('영문 긴 표기 (1등 · 2등 · 3등 · 3등 최저)', enLong.join(' / ') === '1.60 bn KRW / 57m KRW / 1.45m KRW / 627,634 KRW', enLong.join(' / '));
const enShort = [2.5e9, 5e7, 1.4e6, 6e5].map(P.wonShort);
check('영문 눈금 표기', enShort.join(' ') === '2.5bn 50m 1.4m 600k', enShort.join(' '));
delete globalThis.I18N;

console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
process.exit(failed ? 1 : 0);
