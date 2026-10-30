// 사용: node tools/test-store-sales.js
// 판매점별 판매량 추정(tools/store-sales.js)의 계산을 확인한다. 범위가 "95%"라고 말하려면
// 정답을 아는 가짜 판매점에서 실제로 95% 가까이 맞아야 하고, 실제 자료의 홀짝 검증도 그래야 한다.
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const S = require(path.join(ROOT, 'tools', 'store-sales.js'));

let failed = 0;
function check(name, ok, extra) {
    console.log((ok ? '  통과  ' : '  실패  ') + name + (ok || extra === undefined ? '' : ' → ' + extra));
    if (!ok) failed++;
}

// 1 · 2등 한 번 = 8,145,060/7 게임 × 1,000원
check('1 · 2등 한 번은 약 11.6억 원', Math.abs(S.PER_HIT - 1163580000) < 1, S.PER_HIT);

// 같은 판매점 · 같은 회차: 수동 1등은 한 번만, 자동은 그대로, 2등은 CAP2 까지
const h = S.roundHits({ w1: [['a', 'M'], ['a', 'M'], ['a', 'A'], ['b', 'M']], w2: ['a', 'c', 'c', 'c', 'c', 'c'] });
check('수동 1등 중복은 1게임', h.get('b') === 1);
check('자동 1등은 따로 센다', h.get('a') === 1 + 1 + 1, h.get('a'));   // 수동 1 + 자동 1 + 2등 1
check('2등은 한 회차에 CAP2 까지', h.get('c') === S.CAP2, h.get('c'));

// 가짜 판매점: log μ ~ N(0, 1), 홀 · 짝 회차에 μ/2 씩 포아송
let seed = 7;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const normal = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
const poisson = m => { const L = Math.exp(-m); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const ids = [], odd = new Map(), even = new Map(), whole = new Map(), truth = new Map();
for (let i = 0; i < 6000; i++) {
    const id = 'f' + i, mu = Math.exp(normal());
    const a = poisson(mu / 2), b = poisson(mu / 2);
    ids.push(id); odd.set(id, a); even.set(id, b); whole.set(id, a + b); truth.set(id, mu);
}
const prior = S.fitPrior(ids.map(id => whole.get(id)));
check('분포를 되찾는다 (가운데 0)', Math.abs(prior.mu) < 0.1, prior.mu);
check('분포를 되찾는다 (퍼짐 1)', Math.abs(prior.sd - 1) < 0.1, prior.sd);

// 정답 μ 가 95% 범위 안에 드는 비율
let inside = 0;
const cache = new Map();
for (const id of ids) {
    const x = whole.get(id);
    if (!cache.has(x)) { const post = S.posterior(prior, x); cache.set(x, [S.quantile(post, 0.025), S.quantile(post, 0.975)]); }
    const [lo, hi] = cache.get(x);
    if (truth.get(id) >= lo && truth.get(id) <= hi) inside++;
}
check('가짜 판매점: 정답이 95% 범위에 드는 비율 93~97%', inside / ids.length > 0.93 && inside / ids.length < 0.97, (inside / ids.length * 100).toFixed(1) + '%');

const cov = S.coverage(ids, odd, even, [0.95]);
check('가짜 판매점: 홀짝 검증 95% 이상', cov.all[0.95] >= 0.95, cov.all[0.95]);

// 사후 범위는 1 · 2등 수가 많을수록 오른쪽으로
const mids = [0, 1, 2, 5, 10, 30].map(x => S.quantile(S.posterior(prior, x), 0.5));
check('가운데 값은 1 · 2등 수와 함께 커진다', mids.every((v, i) => i === 0 || v > mids[i - 1]), mids.map(v => v.toFixed(2)).join(' '));

// 실제 자료
let d, all, prize;
try {
    d = require(path.join(ROOT, 'stores-data.json'));
    all = require(path.join(ROOT, 'shops-all.json'));
    prize = require(path.join(ROOT, 'prize-data.json')).draws;
} catch (e) { /* 자료가 없으면 건너뛴다 */ }
if (d && all && prize) {
    const E = S.estimate(d, all, prize);
    check('실제 자료: 추정이 나온다', !!E);
    if (E) {
        check('실제 판매액 ÷ 1 · 2등 수가 이론값과 5% 안', Math.abs(E.observedPerHit / E.perHit - 1) < 0.05, (E.observedPerHit / 1e8).toFixed(2) + '억');
        check('표의 범위는 아래 < 가운데 < 위', E.rows.every(r => r.lo < r.mid && r.mid < r.hi));
        check('상위 판매점은 1 · 2등 수 차례', E.top.every((t, i) => i === 0 || t.x <= E.top[i - 1].x));
        check('인터넷은 판매점 분포에 없다', !E.top.some(t => t.id === '51100000' || t.sido === '인터넷'));
        check('홀짝 검증: 95% 범위가 95% 이상 맞는다', E.check.all[0.95] >= 0.95, E.check.all[0.95]);
        check('홀짝 검증: 5번 이상인 곳도 93% 이상', E.check.big[0.95] >= 0.93, E.check.big[0.95]);
        check('평균 회귀: 이 방식이 그대로 옮긴 값보다 실제에 가깝다', !E.check.reg || Math.abs(E.check.reg.model - E.check.reg.actual) < Math.abs(E.check.reg.naive - E.check.reg.actual), JSON.stringify(E.check.reg));
    }
}

console.log(failed ? `\n실패 ${failed}개` : '\n모두 통과');
process.exit(failed ? 1 : 0);
