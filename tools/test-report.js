// 사용: node tools/test-report.js
// 내 번호 성적표(js/report.js)의 계산을 실제 데이터(lotto-data.json · prize-data.json)로 확인한다.
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = require(path.join(ROOT, 'js', 'report.js'));
const draws = require(path.join(ROOT, 'lotto-data.json')).draws;
const prizes = require(path.join(ROOT, 'prize-data.json')).draws;

let failed = 0;
function check(name, ok, extra) {
    console.log((ok ? '  통과  ' : '  실패  ') + name + (ok || extra === undefined ? '' : ' → ' + extra));
    if (!ok) failed++;
}

const last = draws.reduce((a, b) => (b.round > a.round ? b : a));
const n = draws.length;

// 등수 규칙
check('6개 1등 · 5개+보너스 2등 · 5개 3등 · 4개 4등 · 3개 5등 · 2개 꽝',
    [[6, false], [5, true], [5, false], [4, true], [3, false], [2, true]].map(([h, b]) => R.rankOf(h, b)).join() === '1,2,3,4,5,0');
check('1게임 값: 87회 2,000원, 88회부터 1,000원', R.costOf(87) === 2000 && R.costOf(88) === 1000);

// 입력 다듬기
check('번호 뽑기: 쉼표 · 띄어쓰기 · 순서 상관없이', String(R.parsePicks('42, 3 11-19 27 34')) === '3,11,19,27,34,42');
check('번호 뽑기: 6개가 아니거나 겹치거나 범위 밖이면 null',
    R.parsePicks('1 2 3 4 5') === null && R.parsePicks('1 1 2 3 4 5') === null && R.parsePicks('0 1 2 3 4 5') === null && R.parsePicks('1 2 3 4 5 46') === null);

// 마지막 회차 당첨번호 그대로: 그 회차 1등(1인당 금액)
const r = R.compute(draws, prizes, last.numbers);
const spent = draws.reduce((s, d) => s + (d.round < 88 ? 2000 : 1000), 0);
check(`게임 수 = 회차 수 (${n})`, r.games === n);
check('쓴 돈 = 87회까지 2,000원 + 그 뒤 1,000원', r.spent === spent, r.spent + ' vs ' + spent);
check(`${last.round}회 1등`, r.wins.some(w => w.round === last.round && w.rank === 1));
check('1등 금액은 그 회차 1인당 당첨금', r.wins.find(w => w.round === last.round).amount === last.firstPrizeAmount);
check('가장 좋았던 회차 = 1등', r.best && r.best.rank === 1);
check('받은 돈 = 당첨 내역 합', r.won === r.wins.reduce((s, w) => s + w.amount, 0));
check('손익 = 받은 돈 - 쓴 돈', r.net === r.won - r.spent);
check('등수별 횟수 합 = 당첨 회차 수', r.ranks.slice(1).reduce((a, b) => a + b, 0) === r.wins.length);
check('연도별 합 = 전체', r.years.reduce((s, y) => s + y.spent, 0) === r.spent && r.years.reduce((s, y) => s + y.won, 0) === r.won && r.years.reduce((s, y) => s + y.games, 0) === n);
check('아까웠던 회차: 많이 맞힌 순 5개, 맨 위가 1등 회차', r.near.length === 5 && r.near[0].round === last.round && r.near.every((x, i, a) => !i || a[i - 1].hits >= x.hits));

// 2~5등 금액은 prize-data.json
const w = r.wins.find(x => x.rank >= 2);
if (w) check(`${w.round}회 ${w.rank}등 금액 = prize-data a${w.rank}`, w.amount === prizes.find(p => p.round === w.round)['a' + w.rank]);

// 1등이 없던(이월) 회차에 1등이면 금액을 알 수 없다
const carry = draws.find(d => d.firstPrizeWinners === 0);
const rc = R.compute(draws, prizes, carry.numbers);
check(`${carry.round}회(1등 없음)에 1등 → 금액 미상으로 따로 센다`, rc.unknown >= 1 && rc.wins.find(x => x.round === carry.round).amount === 0);

// 꽝 행진: 당첨이 없던 회차가 이어진 가장 긴 구간
const lens = [];
let run = 0;
draws.slice().sort((a, b) => a.round - b.round).forEach(d => {
    const rank = R.rankOf(d.numbers.filter(x => last.numbers.includes(x)).length, last.numbers.includes(d.bonus));
    if (rank) { lens.push(run); run = 0; } else run++;
});
lens.push(run);
check('가장 길었던 꽝 행진 = 직접 센 값', r.drought.len === Math.max(...lens), r.drought.len + ' vs ' + Math.max(...lens));
check('꽝 행진 구간 길이가 맞다', r.drought.to - r.drought.from + 1 === r.drought.len);

// 같은 번호 순서만 바뀌어도 같은 결과
const shuffled = R.compute(draws, prizes, last.numbers.slice().reverse());
check('번호 순서는 결과에 상관없다', shuffled.won === r.won && shuffled.wins.length === r.wins.length);

console.log(failed ? `\n실패 ${failed}` : '\n모두 통과');
process.exit(failed ? 1 : 0);
