// 판매점별 판매량 추정 — statistics-stores.html "판매량 추정"에 쓴다 (tools/build-static-stats.js 가 부른다)
//
// 판매점별 판매액은 공개되지 않는다. 공개되는 것은 판매점마다 1 · 2등이 몇 게임 나왔는지다(stores-data.json).
// 한 게임이 1등 또는 2등이 될 확률은 7/8,145,060 이고 자동 · 수동 · 어느 판매점이든 같다. 그래서
// 1 · 2등 한 번은 평균 8,145,060/7 ≈ 116만 게임(11.6억 원)이 팔렸다는 뜻이고, 판매점의 1 · 2등 수는
// "팔린 게임 수 × 7/8,145,060"을 평균으로 하는 포아송 분포를 따른다.
//
// 오차범위: 1 · 2등이 적은 곳을 그대로 나누면 범위가 쓸모없이 넓고(0번 → 0~15억), 운 좋게 많이 나온 곳은
// 부풀려진다(평균 회귀). 그래서 전국 판매점의 판매량 분포(로그정규)를 먼저 자료로 맞추고, 그 분포에서 출발해
// 판매점마다 자기 1 · 2등 수로 고친다(경험적 베이즈). 범위는 그 결과의 2.5% ~ 97.5% 지점이다.
//
// 검증(check): 같은 기간을 홀수 · 짝수 회차로 나눠, 홀수 회차만으로 맞춘 범위에 짝수 회차의 실제 1 · 2등 수가
// 들어가는지 센다. 판매량이 기간 안에서 바뀌어도 홀짝은 함께 바뀌므로 "그 기간의 평균 판매량"을 시험하는 셈이다.
// 앞 기간으로 뒤 기간을 맞히는 시험(drift)도 한다 — 판매량이 해마다 바뀌어 덜 맞는다. 그래서 범위는 지난 기간의
// 평균일 뿐, 앞으로의 판매량이 아니다.
//
// 같은 사람이 같은 번호를 여러 장 사면 한 사람의 운이 여러 게임으로 불어난다(1057회 한 판매점 2등 103게임 중
// 100장이 한 사람). 그래서 한 판매점 · 한 회차에서 수동 1등은 1게임으로, 2등은 3게임까지만 센다.
// 인터넷 판매는 판매점과 성격이 달라 분포에서 빼고 따로 센다.
//
// 시험: node tools/test-store-sales.js
'use strict';

const TOTAL = 8145060;                  // C(45,6)
const GAME_PRICE = 1000;                // 88회부터 1게임 1,000원
const PER_HIT = GAME_PRICE * TOTAL / 7; // 1 · 2등 한 번 = 평균 판매액(원)
const NET = '51100000';                 // 동행복권 인터넷 판매
const CAP2 = 3;                         // 한 판매점 · 한 회차 2등은 이만큼까지
const WEEKS = 52;                       // 1년 = 52회

// 회차 하나의 판매점별 1 · 2등 수(같은 번호 여러 장은 줄여서)
function roundHits(rec) {
    const h = new Map();
    const add = (id, n) => h.set(id, (h.get(id) || 0) + n);
    const manual = new Set();
    for (const [id, how] of rec.w1 || []) {
        if (how === 'M') {
            if (manual.has(id)) continue;
            manual.add(id);
        }
        add(id, 1);
    }
    const c2 = new Map();
    for (const id of rec.w2 || []) c2.set(id, (c2.get(id) || 0) + 1);
    for (const [id, n] of c2) add(id, Math.min(n, CAP2));
    return h;
}

function sumHits(d, rounds) {
    const h = new Map();
    for (const r of rounds) for (const [id, n] of roundHits(d.rounds[r])) h.set(id, (h.get(id) || 0) + n);
    return h;
}

// μ(기간 동안 기대 1 · 2등 수) 격자. 로그 간격이라 작은 판매점과 큰 판매점을 같은 해상도로 본다
const GRID_N = 400;
const LOG_LO = Math.log(0.002), LOG_HI = Math.log(2000);
const LG = Array.from({ length: GRID_N }, (_, k) => LOG_LO + k * (LOG_HI - LOG_LO) / (GRID_N - 1));
const G = LG.map(Math.exp);

const logFact = [0];
const lf = x => { while (logFact.length <= x) logFact.push(logFact[logFact.length - 1] + Math.log(logFact.length)); return logFact[x]; };
const pois = (x, m) => Math.exp(-m + x * Math.log(m) - lf(x));
const likRow = x => G.map(m => pois(x, m));

function normalWeights(mu, sd) {
    const w = LG.map(l => Math.exp(-((l - mu) ** 2) / (2 * sd * sd)));
    const z = w.reduce((a, b) => a + b, 0);
    return w.map(v => v / z);
}

// 판매점들의 1 · 2등 수(xs)로 로그정규 분포 log μ ~ N(mu, sd²)를 맞춘다 — 주변 우도 최대(격자 탐색 → 좁혀서 한 번 더)
function fitPrior(xs) {
    const hist = new Map();
    for (const x of xs) hist.set(x, (hist.get(x) || 0) + 1);
    const rows = [...hist].map(([x, c]) => ({ c, L: likRow(x) }));
    const ll = (mu, sd) => {
        const w = normalWeights(mu, sd);
        let s = 0;
        for (const { c, L } of rows) {
            let p = 0;
            for (let k = 0; k < GRID_N; k++) p += w[k] * L[k];
            s += c * Math.log(p || 1e-300);
        }
        return s;
    };
    let best = { ll: -Infinity };
    const search = (mus, sds) => { for (const mu of mus) for (const sd of sds) { const v = ll(mu, sd); if (v > best.ll) best = { ll: v, mu, sd }; } };
    const steps = (a, b, h) => Array.from({ length: Math.round((b - a) / h) + 1 }, (_, i) => a + i * h);
    search(steps(-5, 4, 0.1), steps(0.1, 3, 0.1));
    search(steps(best.mu - 0.1, best.mu + 0.1, 0.01), steps(Math.max(0.05, best.sd - 0.1), best.sd + 0.1, 0.01));
    return { mu: best.mu, sd: best.sd, ll: best.ll, w: normalWeights(best.mu, best.sd), n: xs.length };
}

// 1 · 2등 x번인 판매점의 μ 분포(사후)
function posterior(prior, x) {
    const L = likRow(x);
    const p = prior.w.map((w, k) => w * L[k]);
    const z = p.reduce((a, b) => a + b, 0);
    return p.map(v => v / z);
}

// 사후 분포의 q 지점(μ). 격자 사이는 로그로 잇는다
function quantile(post, q) {
    let c = 0;
    for (let k = 0; k < GRID_N; k++) {
        const next = c + post[k];
        if (next >= q) {
            if (k === 0) return G[0];
            const t = post[k] ? (q - c) / post[k] : 0;
            return Math.exp(LG[k - 1] + t * (LG[k] - LG[k - 1]));
        }
        c = next;
    }
    return G[GRID_N - 1];
}

const above = (post, m) => post.reduce((s, p, k) => s + (G[k] > m ? p : 0), 0);
const postMean = post => post.reduce((s, p, k) => s + p * G[k], 0);

// x번 나온 판매점이 다른 기간(기대값이 scale 배)에 몇 번 나올지 — 가운데 level 만큼의 범위 [lo, hi]
function predictInterval(prior, x, scale, level) {
    const post = posterior(prior, x);
    const a = (1 - level) / 2;
    let c = 0, lo = null;
    for (let y = 0; y < 5000; y++) {
        let p = 0;
        for (let k = 0; k < GRID_N; k++) if (post[k] > 1e-12) p += post[k] * pois(y, scale * G[k]);
        c += p;
        if (lo === null && c >= a) lo = y;
        if (c >= 1 - a) return [lo, y];
    }
    return [lo || 0, Infinity];
}

// 앞 자료(from)로 맞춘 분포에서, 뒤 자료(to)의 실제 수가 범위에 드는 비율
function coverage(ids, from, to, levels) {
    const xs = ids.map(id => from.get(id) || 0);
    const prior = fitPrior(xs);
    const scale = ids.reduce((s, id) => s + (to.get(id) || 0), 0) / Math.max(1, xs.reduce((a, b) => a + b, 0));
    const cache = new Map();
    const iv = (x, lv) => { const key = x + '|' + lv; if (!cache.has(key)) cache.set(key, predictInterval(prior, x, scale, lv)); return cache.get(key); };
    const out = { prior, scale, all: {}, big: {}, nBig: 0 };
    const BIG = 5;
    for (const lv of levels) { out.all[lv] = 0; out.big[lv] = 0; }
    // 평균 회귀: 앞에서 많이 나온 곳(10번 이상)이 뒤에 몇 번 나왔나 — 그대로 늘린 예상 · 이 방식의 예상 · 실제
    const reg = { n: 0, naive: 0, model: 0, actual: 0 };
    for (const id of ids) {
        const x = from.get(id) || 0, y = to.get(id) || 0;
        for (const lv of levels) {
            const [lo, hi] = iv(x, lv);
            if (y >= lo && y <= hi) { out.all[lv]++; if (x >= BIG) out.big[lv]++; }
        }
        if (x >= BIG) out.nBig++;
        if (x >= 10) { reg.n++; reg.naive += x * scale; reg.model += postMean(posterior(prior, x)) * scale; reg.actual += y; }
    }
    for (const lv of levels) { out.all[lv] /= ids.length; out.big[lv] = out.nBig ? out.big[lv] / out.nBig : null; }
    out.n = ids.length;
    out.bigMin = BIG;
    out.reg = reg.n ? { n: reg.n, naive: reg.naive / reg.n, model: reg.model / reg.n, actual: reg.actual / reg.n } : null;
    return out;
}

/* 전체 추정
 *   d      stores-data.json        (판매점 → [상호, 시도, 시군구, 폐점…], 회차 → { w1, w2 })
 *   all    shops-all.json          (지금 로또를 파는 곳 — 1 · 2등이 0번인 곳도 분포에 넣으려고)
 *   prize  prize-data.json 의 draws (회차 판매액)
 * 판매액 단위는 원, "연"은 52회.
 */
function estimate(d, all, prize, opt) {
    const W = (opt && opt.window) || 156;
    const TOPN = (opt && opt.top) || 20;
    const rounds = Object.keys(d.rounds).map(Number).sort((a, b) => a - b);
    if (rounds.length < W) return null;
    const win = rounds.slice(-W);
    const prev = rounds.length >= 2 * W ? rounds.slice(-2 * W, -W) : null;
    const sales = new Map(prize.map(p => [p.round, p.sales]));
    const shopOf = id => d.shops[id] || (all.shops[id] ? [all.shops[id][0], all.shops[id][1], all.shops[id][2], 0] : ['(알 수 없음)', '', '', 0]);
    const isNet = id => id === NET || shopOf(id)[1] === '인터넷';

    const cur = sumHits(d, win);
    const ids = [...new Set(Object.keys(all.shops).concat([...cur.keys()]))].filter(id => !isNet(id)).sort();
    const xs = ids.map(id => cur.get(id) || 0);
    const prior = fitPrior(xs);
    const perYear = WEEKS / W;
    const toYear = m => m * PER_HIT * perYear;   // μ(기간 1 · 2등 기대 수) → 연 판매액(원)

    // 판매액 확인: 실제 기간 판매액 ÷ 실제 1 · 2등 게임 수(줄이지 않은 그대로) ≈ PER_HIT 인가
    let totalSales = 0, rawHits = 0, netRaw = 0, salesRounds = 0;
    for (const r of win) {
        const rec = d.rounds[r];
        if (sales.get(r)) { totalSales += sales.get(r); salesRounds++; rawHits += (rec.w1 || []).length + (rec.w2 || []).length; }
        netRaw += (rec.w1 || []).filter(([id]) => isNet(id)).length + (rec.w2 || []).filter(isNet).length;
    }

    const avgHits = xs.reduce((a, b) => a + b, 0) / xs.length;
    const avg = toYear(avgHits);
    const summarize = x => {
        const post = posterior(prior, x);
        return { x, lo: toYear(quantile(post, 0.025)), mid: toYear(quantile(post, 0.5)), hi: toYear(quantile(post, 0.975)), pAvg: above(post, avgHits) };
    };
    const maxX = Math.max(...xs);
    const rows = [0, 1, 2, 3, 5, 10, 20, 40, 80].filter(x => x <= maxX).map(summarize);
    const count = (lo, hi) => xs.filter(x => x >= lo && x <= hi).length;
    const buckets = { n0: count(0, 0), n1: count(1, 1), n2: count(2, 4), n5: count(5, 9), n10: count(10, Infinity) };

    const cache = new Map();
    const est = x => { if (!cache.has(x)) cache.set(x, summarize(x)); return cache.get(x); };
    const top = ids.filter(id => cur.get(id)).sort((a, b) => (cur.get(b) - cur.get(a)) || (a < b ? -1 : 1)).slice(0, TOPN)
        .map(id => { const s = shopOf(id); return Object.assign({ id, name: s[0], sido: s[1], gu: s[2], closed: !!s[3] }, est(cur.get(id))); });

    // 검증: 홀수 회차 → 짝수 회차
    const odd = sumHits(d, win.filter((_, i) => i % 2 === 1));
    const even = sumHits(d, win.filter((_, i) => i % 2 === 0));
    const check = coverage(ids, odd, even, [0.95, 0.8]);
    // 앞 기간 → 이 기간 (판매량이 바뀌는 만큼 덜 맞는다)
    const drift = prev ? coverage(ids, sumHits(d, prev), cur, [0.95]) : null;

    return {
        window: { first: win[0], last: win[win.length - 1], n: W, years: W / WEEKS },
        prev: prev ? { first: prev[0], last: prev[prev.length - 1] } : null,
        perHit: PER_HIT, perHitYear: PER_HIT * perYear, cap2: CAP2,
        totalSales, salesRounds, rawHits, observedPerHit: rawHits ? totalSales / rawHits : null,
        net: { hits: netRaw, sales: netRaw * PER_HIT, share: totalSales ? netRaw * PER_HIT / totalSales : null,
            lo: totalSales ? Math.max(0, netRaw - 1.96 * Math.sqrt(netRaw)) * PER_HIT / totalSales : null,
            hi: totalSales ? (netRaw + 1.96 * Math.sqrt(netRaw)) * PER_HIT / totalSales : null },
        shops: ids.length, avg, prior, rows, buckets, top, check, drift,
        median: toYear(Math.exp(prior.mu)),
        p90: toYear(Math.exp(prior.mu + 1.2816 * prior.sd)),
        p99: toYear(Math.exp(prior.mu + 2.3263 * prior.sd)),
    };
}

module.exports = { PER_HIT, CAP2, roundHits, sumHits, fitPrior, posterior, quantile, predictInterval, coverage, estimate, G };
