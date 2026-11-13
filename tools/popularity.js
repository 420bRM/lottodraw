// 구매자 번호 선호도 모델 — 사람들이 어떤 번호를 많이 사는지를 2~5등 당첨 게임 수로 거꾸로 셈한다.
//
// 생각: 자동이든 수동이든 사람들이 산 조합의 분포가 고르면, k개 맞힌 게임 수는 판매 게임 수 × (k개 맞을 확률)이어야 한다.
// 실제 5등(3개 일치) 게임 수가 그보다 많은 회차는 당첨번호 셋과 같은 번호를 산 사람이 많았던 회차다. 5등은 회차마다
// 수백만 게임이라 우연에 의한 흔들림이 0.1%도 안 돼, 번호 하나에 1% 남짓한 차이도 잡힌다.
//
// 모델(최소제곱): ln(5등 게임 수 ÷ 기대 게임 수) = Σ(당첨번호 6개의 번호 효과 β) + 시기(3차식) + γ직전 × (지난 회차 번호 수)
//                + γ최다 × (그때까지 가장 많이 나온 번호 10개 중 든 수)
// 기대 게임 수 = 판매 게임 수 × C(6,3)·C(39,3) ÷ C(45,6). 88회부터(1게임 1,000원 — 판매액 ÷ 1,000 이 게임 수).
// 4등으로 따로 맞춰 번호 효과가 같은지, 홀수 · 짝수 회차로 나눠 맞춰 같은지, 앞뒤 시기로 나눠 같은지 본다.
// 1등: 홀수 회차로 배운 β 로 짝수 회차를(거꾸로도) 점수 매겨, 1등 당첨자 수 = 기대 × e^(a + c·점수) 를 포아송으로 맞춘다.
//
// 쓰는 곳: tools/build-static-stats.js(통계 페이지 · popularity.json · combo-space.json), 홈 생성기 · 마이페이지(회원)
'use strict';

const N6 = 8145060;
const EXP = { w5: 20 * 9139, w4: 15 * 741, w3: 6 * 38 };   // 무작위 한 게임이 정확히 3 · 4 · 5개(보너스 아님) 맞을 경우의 수
const FIRST_1000_WON = 88;
const HOT = 10;

// 대칭 양의 정부호 행렬 A(n×n, 배열의 배열)를 촐레스키로 풀어 A x = b. inv: true 면 역행렬의 대각도 돌려준다
function cholSolve(A, b, inv) {
    const n = A.length;
    const L = A.map(() => new Float64Array(n));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let s = A[i][j];
            for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
            if (i === j) {
                if (s <= 0) throw new Error('선호도 모델: 행렬이 양의 정부호가 아니다');
                L[i][i] = Math.sqrt(s);
            } else L[i][j] = s / L[j][j];
        }
    }
    const solve = rhs => {
        const y = new Float64Array(n);
        for (let i = 0; i < n; i++) { let s = rhs[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
        const x = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
        return x;
    };
    const x = solve(b);
    let diag = null;
    if (inv) {
        diag = new Float64Array(n);
        for (let i = 0; i < n; i++) { const e = new Float64Array(n); e[i] = 1; diag[i] = solve(e)[i]; }
    }
    return { x, diag };
}

// 최소제곱: 행마다 [특성…], 목표 y. 계수 · 잔차 표준편차 · 계수 표준오차
function lstsq(X, y, withSe) {
    const p = X[0].length;
    const A = Array.from({ length: p }, () => new Float64Array(p));
    const b = new Float64Array(p);
    for (let r = 0; r < X.length; r++) {
        const x = X[r];
        for (let i = 0; i < p; i++) {
            if (!x[i]) continue;
            b[i] += x[i] * y[r];
            for (let j = 0; j <= i; j++) A[i][j] += x[i] * x[j];
        }
    }
    for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) A[j][i] = A[i][j];
    const { x: beta, diag } = cholSolve(A, b, withSe);
    let ss = 0;
    for (let r = 0; r < X.length; r++) { let f = 0; for (let i = 0; i < p; i++) f += X[r][i] * beta[i]; ss += (y[r] - f) ** 2; }
    const sigma = Math.sqrt(ss / (X.length - p));
    return { beta, sigma, se: diag ? Array.from(diag, d => sigma * Math.sqrt(d)) : null };
}

const corr = (a, b) => {
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb);
};
const median = v => { const s = v.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// 회차별 행 만들기. draws: lotto-data.json 의 draws, prizes: prize-data.json 의 draws
function rowsOf(draws, prizes) {
    const byRound = new Map(draws.map(d => [d.round, d]));
    const ordered = draws.slice().sort((a, b) => a.round - b.round);
    // 회차마다 "그 전까지 가장 많이 나온 번호 10개"(같으면 작은 번호 먼저)
    const freq = new Array(46).fill(0);
    const hotBefore = new Map();
    for (const d of ordered) {
        const order = [];
        for (let n = 1; n <= 45; n++) order.push(n);
        order.sort((a, b) => freq[b] - freq[a] || a - b);
        hotBefore.set(d.round, new Set(order.slice(0, HOT)));
        d.numbers.forEach(n => { freq[n]++; });
    }
    const rows = [];
    for (const p of prizes) {
        const d = byRound.get(p.round);
        if (!d || p.round < FIRST_1000_WON || !(p.sales > 0) || !(p.w5 > 0) || !(p.w4 > 0)) continue;
        const prev = byRound.get(p.round - 1);
        const games = p.sales / 1000;
        const hot = hotBefore.get(p.round);
        rows.push({
            round: p.round, nums: d.numbers.slice(), games,
            y5: Math.log(p.w5 / (games * EXP.w5 / N6)),
            y4: Math.log(p.w4 / (games * EXP.w4 / N6)),
            w1: d.firstPrizeWinners || 0, e1: games / N6,
            w2: p.w2, e2: games * 6 / N6,
            prev: prev ? d.numbers.filter(n => prev.numbers.includes(n)).length : 0,
            hot: d.numbers.filter(n => hot.has(n)).length,
        });
    }
    return rows.sort((a, b) => a.round - b.round);
}

// 한 등수로 맞추기 → 번호 효과 β(평균 0) · γ직전 · γ최다 · 표준오차
function fitTier(rows, key, t0, ts, withSe) {
    const X = rows.map(r => {
        const x = new Float64Array(50);
        r.nums.forEach(n => { x[n - 1] = 1; });
        const t = (r.round - t0) / ts;
        x[45] = t; x[46] = t * t; x[47] = t * t * t;
        x[48] = r.prev; x[49] = r.hot;
        return x;
    });
    const fit = lstsq(X, rows.map(r => r[key]), withSe);
    const raw = Array.from(fit.beta.slice(0, 45));
    const mean = raw.reduce((s, v) => s + v, 0) / 45;
    return {
        b: raw.map(v => v - mean),
        prev: fit.beta[48], hot: fit.beta[49],
        se: fit.se ? { b: fit.se.slice(0, 45), prev: fit.se[48], hot: fit.se[49] } : null,
        sigma: fit.sigma,
    };
}

// 포아송: E[y] = e·exp(a + c·s). 뉴턴법
function poisson(y, e, s) {
    let a = 0, c = 0, H = null;
    for (let it = 0; it < 60; it++) {
        let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
        for (let i = 0; i < y.length; i++) {
            const mu = e[i] * Math.exp(a + c * s[i]);
            g0 += y[i] - mu; g1 += (y[i] - mu) * s[i];
            h00 += mu; h01 += mu * s[i]; h11 += mu * s[i] * s[i];
        }
        const det = h00 * h11 - h01 * h01;
        const da = (h11 * g0 - h01 * g1) / det, dc = (h00 * g1 - h01 * g0) / det;
        a += da; c += dc; H = { h00, h01, h11, det };
        if (Math.abs(da) + Math.abs(dc) < 1e-10) break;
    }
    return { a, c, seC: Math.sqrt(H.h00 / H.det) };
}

/**
 * @param {object} o  draws(lotto-data), prizes(prize-data), comboSpace(js/combo-space.js), latest(최신 회차 draw)
 * @returns 모델 — 페이지 · JSON 에 그대로 쓴다
 */
function fitPopularity(o) {
    const rows = rowsOf(o.draws, o.prizes);
    if (rows.length < 200) return null;
    const rounds = rows.map(r => r.round);
    const t0 = rounds.reduce((s, v) => s + v, 0) / rounds.length;
    const ts = Math.sqrt(rounds.reduce((s, v) => s + (v - t0) ** 2, 0) / rounds.length);
    const main = fitTier(rows, 'y5', t0, ts, true);
    const four = fitTier(rows, 'y4', t0, ts, false);
    const odd = fitTier(rows.filter(r => r.round % 2), 'y5', t0, ts, false);
    const even = fitTier(rows.filter(r => !(r.round % 2)), 'y5', t0, ts, false);
    const mid = median(rounds);
    const early = fitTier(rows.filter(r => r.round < mid), 'y5', t0, ts, false);
    const late = fitTier(rows.filter(r => r.round >= mid), 'y5', t0, ts, false);

    // 1등 · 2등: 반대쪽 절반으로 배운 β 로 점수(교차 적합 — 같은 회차로 배우고 매기면 좋아 보이기만 한다)
    const cross = rows.map(r => {
        const b = r.round % 2 ? even.b : odd.b;
        return { r, s: r.nums.reduce((acc, n) => acc + b[n - 1], 0) };
    });
    const pz = poisson(cross.map(x => x.r.w1), cross.map(x => x.r.e1), cross.map(x => x.s));
    const sortedS = cross.map(x => x.s).sort((a, b) => a - b);
    const qcut = [0.2, 0.4, 0.6, 0.8].map(q => sortedS[Math.floor(q * sortedS.length)]);
    const quint = [0, 1, 2, 3, 4].map(k => {
        const sel = cross.filter(x => (k === 0 || x.s >= qcut[k - 1]) && (k === 4 || x.s < qcut[k]));
        const a1 = sel.reduce((s, x) => s + x.r.w1, 0), e1 = sel.reduce((s, x) => s + x.r.e1, 0);
        return { rounds: sel.length, first: a1 / e1, second: median(sel.map(x => x.r.w2 / x.r.e2)) };
    });

    const b = main.b;
    const pct = v => (Math.exp(v) - 1) * 100;
    const order = b.map((v, i) => i + 1).sort((x, y) => b[y - 1] - b[x - 1] || x - y);
    const rankOf = new Array(46);
    order.forEach((n, i) => { rankOf[n] = i + 1; });
    const numbers = [];
    for (let n = 1; n <= 45; n++) numbers.push({ n, pct: pct(b[n - 1]), se: main.se.b[n - 1] * 100, rank: rankOf[n] });

    // 다가오는 회차의 번호별 무게 = β + γ직전(지난 회차 번호면) + γ최다(지금 가장 많이 나온 10개면)
    const latest = o.latest;
    const freq = new Array(46).fill(0);
    o.draws.forEach(d => d.numbers.forEach(n => { freq[n]++; }));
    const hotNow = []; for (let n = 1; n <= 45; n++) hotNow.push(n);
    hotNow.sort((x, y) => freq[y] - freq[x] || x - y);
    const hot = hotNow.slice(0, HOT).sort((x, y) => x - y);
    const w = new Array(46).fill(0);
    for (let n = 1; n <= 45; n++) w[n] = b[n - 1] + (latest.numbers.includes(n) ? main.prev : 0) + (hot.includes(n) ? main.hot : 0);

    // 815만 조합의 점수 분포 → 50 · 20 · 5% 경계와 백분위 표(0~100%), 구간별 1등 공동당첨 배수(평균 조합 = 1)
    const CS = o.comboSpace;
    const scores = new Float64Array(N6);
    let k = 0;
    CS.walk({ w }, (mask, ac, run, band, nums, score) => { scores[k++] = score; });
    scores.sort();
    const q = p => scores[Math.min(N6 - 1, Math.floor(p * N6))];
    const cuts = [q(0.5), q(0.2), q(0.05)];
    const pctl = []; for (let i = 0; i <= 100; i++) pctl.push(q(i / 100));
    let mAll = 0;
    const bandSum = [0, 0, 0, 0], bandN = [0, 0, 0, 0];
    for (let i = 0; i < N6; i++) {
        const f = Math.exp(pz.c * scores[i]);
        mAll += f;
        const bd = CS.bandOf(scores[i], cuts);
        bandSum[bd] += f; bandN[bd]++;
    }
    mAll /= N6;
    // "하위 X%" = 그 구간과 더 덜 팔리는 구간을 합친 것
    const under = k2 => { let s = 0, n = 0; for (let j = k2; j < 4; j++) { s += bandSum[j]; n += bandN[j]; } return s / n / mAll; };
    const recent = rows.slice(-52);
    const lambda = recent.reduce((s, r) => s + r.e1, 0) / recent.length;

    return {
        first: rows[0].round, last: rows[rows.length - 1].round, rounds: rows.length,
        forRound: latest.round + 1,
        b, numbers, order,
        prev: { pct: pct(main.prev), se: main.se.prev * 100 },
        hotEffect: { pct: pct(main.hot), se: main.se.hot * 100 },
        hot, latestNumbers: latest.numbers.slice().sort((x, y) => x - y),
        check: { tier4: corr(main.b, four.b), halves: corr(odd.b, even.b), eras: corr(early.b, late.b), mid },
        firstPrize: { a: pz.a, c: pz.c, seC: pz.seC, quintiles: quint, lambda },
        w, cuts, pctl, meanFactor: mAll,
        bands: { 1: under(1), 2: under(2), 3: under(3) },
    };
}

module.exports = { fitPopularity, rowsOf };
