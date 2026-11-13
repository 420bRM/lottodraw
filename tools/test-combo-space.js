// 사용: node tools/test-combo-space.js
// 조합 공간(js/combo-space.js)이 홈 생성기(index.html 의 patternHit · acOf)와 같은 판정을 하는지, 815만 조합 전수의 수가 맞는지,
// 구매자 선호도 모델(tools/popularity.js)이 실제 데이터에서 앞뒤가 맞는지 확인한다. 전수를 몇 번 훑어 10초 남짓 걸린다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const CS = require(path.join(ROOT, 'js', 'combo-space.js'));

let failed = 0;
function check(name, ok, extra) {
    console.log((ok ? '  통과  ' : '  실패  ') + name + (ok || extra === undefined ? '' : ' → ' + extra));
    if (!ok) failed++;
}

// index.html 의 판정 함수를 그대로 꺼내 돌린다 — 둘 중 하나만 고치면 여기서 걸린다
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const grab = (start, end) => {
    const i = html.indexOf(start), j = html.indexOf(end, i);
    if (i < 0 || j < 0) throw new Error('index.html 에서 찾지 못했다: ' + start);
    return html.slice(i, j);
};
const box = {};
vm.runInNewContext(grab('    const PATTERN_COUNT = ', '    function setPatterns(')
    + grab('    function isPrime(n) {', '    // checkedPatternIds 는')
    + grab('    const SQUARES = [', '    function checkInvalidPattern(')
    + grab('    function acOf(sorted) {', '    function paintAc() {')
    + 'this.patternHit = patternHit; this.acOf = acOf; this.patsOf = patsOf; this.PATTERN_COUNT = PATTERN_COUNT; this.DEFAULT_PATTERNS = DEFAULT_PATTERNS;', box);
const ALL_IDS = Array.from({ length: box.PATTERN_COUNT }, (_, i) => i + 1);
const ALL_MASK = 2 ** box.PATTERN_COUNT - 1;
const maskByPage = s => ALL_IDS.reduce((m, id) => (box.patternHit(s, new Set([id])) ? m | (1 << (id - 1)) : m), 0);
const runOf = s => { let run = 1, best = 1; for (let i = 1; i < 6; i++) { if (s[i] === s[i - 1] + 1) { run++; best = Math.max(best, run); } else run = 1; } return best; };

// 1) 조합 하나 판정: 무작위 20만 개 + 경계에 걸리는 조합들
const edge = [[1, 2, 3, 4, 5, 6], [40, 41, 42, 43, 44, 45], [2, 3, 5, 7, 11, 13], [1, 4, 9, 16, 25, 36], [3, 6, 9, 12, 15, 18], [31, 33, 35, 37, 39, 41],
    [10, 11, 13, 15, 17, 19], [1, 2, 3, 4, 5, 34], [4, 8, 12, 16, 20, 24], [5, 10, 15, 20, 25, 30], [1, 2, 4, 8, 16, 32], [20, 30, 31, 40, 44, 45],
    [3, 10, 20, 26, 36, 43], [1, 5, 11, 15, 21, 25], [1, 2, 3, 5, 8, 13], [1, 3, 6, 10, 15, 21], [16, 18, 20, 22, 24, 26], [1, 2, 3, 4, 5, 6],
    [30, 31, 32, 35, 36, 37], [40, 41, 42, 43, 44, 45], [1, 2, 3, 4, 5, 54 - 54 + 7], [36, 37, 38, 39, 40, 17]].map(a => a.sort((x, y) => x - y));
let bad = 0, n = 0;
const rnd = () => { const a = []; while (a.length < 6) { const x = 1 + Math.floor(Math.random() * 45); if (!a.includes(x)) a.push(x); } return a.sort((x, y) => x - y); };
for (const s of edge.concat(Array.from({ length: 200000 }, rnd))) {
    const c = CS.classify(s, null, null);
    n++;
    if (c.mask !== maskByPage(s) || c.ac !== box.acOf(s) || c.run !== runOf(s)) { if (bad++ < 3) console.log('    다름:', s.join(','), c, maskByPage(s), box.acOf(s)); }
}
check(`조합 ${n.toLocaleString()}개: 패턴 ${box.PATTERN_COUNT}개 · AC값 · 가장 긴 연속이 홈 생성기와 같다`, bad === 0, bad + '개 다름');

// 2) 전수: 홈 "보렐의 법칙" 카드 · AC값 통계 페이지 · 연속번호 통계와 같은 수
const t0 = Date.now();
const h = CS.scan({});
check('전체 8,145,060개', h.total === 8145060, h.total);
// 2026-11-13 개편: 특수 패턴 12개(기본) 27,597개 · 20개 모두 357,760개가 빠진다
const SPECIAL_MASK = box.DEFAULT_PATTERNS.reduce((m, id) => m | (1 << (id - 1)), 0);
check('기본(특수 패턴 12개)이면 27,597개 빠진다', CS.count(h, { pat: SPECIAL_MASK }).ok === 8145060 - 27597, 8145060 - CS.count(h, { pat: SPECIAL_MASK }).ok);
check('20개 모두 켜면 357,760개 빠진다', CS.count(h, { pat: ALL_MASK }).ok === 8145060 - 357760, 8145060 - CS.count(h, { pat: ALL_MASK }).ok);
check('홈 보렐 카드의 숫자가 이 수와 같다', ['27,597', '8,117,463', '357,760', '7,787,300'].every(x => html.includes(x)));
const ONE = [1600, 180, 3003, 5005, 462, 84, 11350, 1540, 4480, 28, 84, 1, 5005, 5005, 5005, 715, 100947, 74613, 78525, 78525];
check('패턴 하나씩 거르는 수', ONE.every((v, i) => 8145060 - CS.count(h, { pat: 1 << i }).ok === v), ONE.map((v, i) => 8145060 - CS.count(h, { pat: 1 << i }).ok).join(','));
// 개편 전(16개 번호)으로 저장된 회원 설정 옮기기
check('예전 기본값(1·2·3·5·6·7·9·10·11·12·15·16)을 새 번호로', JSON.stringify(box.patsOf({ pat: [1, 2, 3, 5, 6, 7, 9, 10, 11, 12, 15, 16] }).sort((a, b) => a - b)) === JSON.stringify([1, 3, 4, 5, 6, 7, 13, 16, 17, 18]));
check('예전 합계 두 구간은 양극단 둘로 · 새 판(pv 2)은 그대로', JSON.stringify(box.patsOf({ pat: [13] }).sort()) === '[19,20]' && JSON.stringify(box.patsOf({ pat: [20], pv: 2 })) === '[20]');
const AC_COMBOS = [180, 858, 7873, 26292, 103461, 239998, 823318, 1148170, 2675680, 1609174, 1510056];   // tools/build-static-stats.js
check('AC값 1~10 별 조합 수(AC값 통계 페이지)', AC_COMBOS.every((v, ac) => !ac || CS.count(h, { acMin: ac, acExact: true }).ok === v));
const RUNS = [3838380, 3848260, 425620, 31200, 1560, 40];
check('가장 긴 연속 1~6 별 조합 수', RUNS.every((v, i) => CS.count(h, { run: i + 1 }).ok === v));
check('3개 연속 + AC값 10 은 0개(화면이 막대 하나를 맞춘다)', CS.count(h, { run: 3, acMin: 10 }).ok === 0);
check('2개 연속 + AC값 10 은 있다', CS.count(h, { run: 2, acMin: 10 }).ok === 881464);
check('빠진 수를 조건별로 나눠 세면 합이 맞다', (() => { const r = CS.count(h, { pat: ALL_MASK, acMin: 8, run: 2 }); return r.ok + r.pat + r.ac + r.run + r.band === r.total; })());
console.log(`    (전수 한 번 ${Date.now() - t0}ms)`);

// 3) 고정수 · 제외수: 홈 생성기의 판정으로 직접 센 것과 같다
const inc = [3, 10, 20], exc = [1, 2, 45];
const free = []; for (let x = 1; x <= 45; x++) if (!inc.includes(x) && !exc.includes(x)) free.push(x);
let direct = 0, directTotal = 0;
for (let a = 0; a < free.length; a++) for (let b = a + 1; b < free.length; b++) for (let c = b + 1; c < free.length; c++) {
    const s = inc.concat([free[a], free[b], free[c]]).sort((x, y) => x - y);
    directTotal++;
    if (!box.patternHit(s, new Set(ALL_IDS)) && box.acOf(s) >= 7 && runOf(s) === 2) direct++;
}
const hi = CS.scan({ include: inc, exclude: exc });
check(`고정수 3·10·20 · 제외수 1·2·45: 전체 ${directTotal.toLocaleString()}개`, hi.total === directTotal, hi.total);
check('같은 조건(패턴 20개 · AC 7 이상 · 2개 연속)의 남은 수가 직접 센 것과 같다', CS.count(hi, { pat: ALL_MASK, acMin: 7, run: 2 }).ok === direct, CS.count(hi, { pat: ALL_MASK, acMin: 7, run: 2 }).ok + ' vs ' + direct);

// 4) 정확 표집: 뽑힌 조합이 조건을 지키고, 지난 당첨 조합은 빼고, 겹치지 않는다
const past = { '1,2,3,4,5,6': 9999 };
const sm = CS.sample({ include: [7], exclude: [], cond: { pat: ALL_MASK, acMin: 9, acExact: true, run: 3 }, past, k: 5 });
check('표집: 5개 · 모두 조건에 맞고 고정수를 품는다', sm.picks.length === 5 && sm.picks.every(s => {
    const c = CS.classify(s, null, null);
    return s.includes(7) && !CS.failOf(c.mask, c.ac, c.run, c.band, { pat: ALL_MASK, acMin: 9, acExact: true, run: 3 });
}));
check('표집: 서로 다른 조합', new Set(sm.picks.map(s => s.join(','))).size === 5);
check('표집: 센 수가 표로 센 수와 같다', sm.ok === CS.count(CS.scan({ include: [7] }), { pat: ALL_MASK, acMin: 9, acExact: true, run: 3 }).ok);

// 5) 선호도 모델: 실제 데이터로 앞뒤가 맞는지
const { fitPopularity } = require(path.join(__dirname, 'popularity.js'));
const draws = require(path.join(ROOT, 'lotto-data.json')).draws.slice().sort((a, b) => b.round - a.round);
const prizes = require(path.join(ROOT, 'prize-data.json')).draws;
const P = fitPopularity({ draws, prizes, comboSpace: CS, latest: draws[0] });
check('번호 45개 · 순위가 1~45 한 번씩', P.numbers.length === 45 && new Set(P.numbers.map(x => x.rank)).size === 45);
check('번호 몫 평균 0', Math.abs(P.b.reduce((s, v) => s + v, 0)) < 1e-9);
check('4등으로 따로 맞춘 몫과 상관 0.95 넘음', P.check.tier4 > 0.95, P.check.tier4);
check('홀수 · 짝수 회차로 나눠 맞춘 몫의 상관 0.9 넘음', P.check.halves > 0.9, P.check.halves);
check('1등 기울기가 0보다 확실히 크다(95% 범위가 0을 넘지 않음)', P.firstPrize.c - 1.96 * P.firstPrize.seC > 0, P.firstPrize.c);
check('구간 경계: 50% > 20% > 5%', P.cuts[0] > P.cuts[1] && P.cuts[1] > P.cuts[2]);
check('덜 팔리는 구간일수록 1등 공동 당첨이 적다', P.bands[1] < 1 && P.bands[2] < P.bands[1] && P.bands[3] < P.bands[2]);
const hp = CS.scan({ w: P.w, cuts: P.cuts });
const share = k => CS.count(hp, { band: k }).ok / 8145060;
check('구간에 드는 조합이 50 · 20 · 5% 근처', Math.abs(share(1) - 0.5) < 0.01 && Math.abs(share(2) - 0.2) < 0.01 && Math.abs(share(3) - 0.05) < 0.01,
    [share(1), share(2), share(3)].map(v => v.toFixed(4)).join(' · '));

console.log(failed ? `\n실패 ${failed}개` : '\n모두 통과');
process.exitCode = failed ? 1 : 0;
