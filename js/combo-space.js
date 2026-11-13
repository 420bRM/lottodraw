// 조합 공간: 815만 조합(C(45,6) = 8,145,060)을 한 번 훑어 특수 패턴 · AC값 · 가장 긴 연속 · 인기도 구간별로 센다.
// 홈 생성기의 "남은 조합" 숫자와, 조건이 좁아 랜덤 시도로 못 찾을 때 전부 훑어 고르기(정확 표집)에 쓴다.
// 한 파일이 세 군데서 돈다: 홈 페이지(<script> — 센 표로 다시 세기 · 조합 하나 분류), 웹 워커(new Worker 로 이 파일 —
// 무거운 전수 훑기), Node(tools/build-static-stats.js 의 인기도 구간 · tools/test-combo-space.js).
// 특수 패턴 번호 1~16 은 index.html 의 patternHit 과 같다 — 하나를 바꾸면 다른 하나도 바꾸고 tools/test-combo-space.js 를 돌린다.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LottoComboSpace = api;
    // 워커로 불렸으면 메시지를 받는다(창이 없고 importScripts 가 있으면 워커다)
    if (typeof document === 'undefined' && typeof importScripts === 'function' && typeof self !== 'undefined') {
        self.onmessage = e => {
            const m = e.data || {};
            try {
                if (m.op === 'scan') self.postMessage({ id: m.id, hist: api.scan(m) });
                else if (m.op === 'sample') self.postMessage({ id: m.id, result: api.sample(m) });
            } catch (err) {
                self.postMessage({ id: m.id, error: String(err && err.message || err) });
            }
        };
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const TOTAL = 8145060;
    // 표 칸: (AC값 0~10) × (가장 긴 연속 0~6) × (인기도 구간 0~3)
    //   인기도 구간 0 = 많이 팔리는 절반, 1 = 덜 팔리는 50% 안, 2 = 20% 안, 3 = 5% 안 (cuts 가 없으면 모두 0)
    const BANDS = 4;
    const CELLS = 11 * 7 * BANDS;
    const cellOf = (ac, run, band) => (ac * 7 + run) * BANDS + band;

    // 번호마다 성질 비트 — "모두 ~" 패턴은 6개의 비트를 AND 해서 본다
    //   0: 15 이하 · 1: 20 이하 · 2: 31 이하 · 3: 3의 배수 · 4: 4의 배수 · 5: 5의 배수 · 6: 31 이상 · 7: 소수 · 8: 홀수 · 9: 짝수
    const isPrime = n => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
    const PROP = new Int32Array(46);
    const SQ = new Int32Array(46);
    for (let n = 1; n <= 45; n++) {
        PROP[n] = (n <= 15 ? 1 : 0) | (n <= 20 ? 2 : 0) | (n <= 31 ? 4 : 0) | (n % 3 === 0 ? 8 : 0) | (n % 4 === 0 ? 16 : 0)
            | (n % 5 === 0 ? 32 : 0) | (n >= 31 ? 64 : 0) | (isPrime(n) ? 128 : 0) | (n % 2 ? 256 : 0) | (n % 2 ? 0 : 512);
    }
    [1, 4, 9, 16, 25, 36].forEach(n => { SQ[n] = 1; });
    const ALL = 1023;

    // 6개(오름차순)의 성질 → 특수 패턴 비트(패턴 k 는 1 << (k - 1))
    function maskOf(p, sum, sq, run, lo, hi) {
        let m = 0;
        if (run === 6) m |= 1;
        if (p & 1) m |= 2;
        if (p & 2) m |= 4;
        if (p & 4) m |= 8;
        if (p & 8) m |= 16;
        if (p & 16) m |= 32;
        if (p & 32) m |= 64;
        if (p & 64) m |= 128;
        if (((lo / 10) | 0) === ((hi / 10) | 0)) m |= 256;
        if (p & 128) m |= 512;
        if (p & 256) m |= 1024;
        if (p & 512) m |= 2048;
        if (sum < 50 || sum > 200) m |= 4096;
        if ((sum >= 50 && sum <= 69) || (sum >= 181 && sum <= 200)) m |= 8192;
        if (sq >= 4) m |= 16384;
        if (sq >= 5) m |= 32768;
        return m;
    }
    function popcount(x) {
        x = x - ((x >>> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
        return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
    }
    // 인기 점수 → 구간. cuts = [50%, 20%, 5% 경계] (점수가 낮을수록 덜 팔린다)
    function bandOf(score, cuts) {
        if (!cuts) return 0;
        if (score <= cuts[2]) return 3;
        if (score <= cuts[1]) return 2;
        if (score <= cuts[0]) return 1;
        return 0;
    }

    // 조합 하나(오름차순 6개) 분류: { mask, ac, run, band, score }. w: 번호별 인기 무게(길이 46, 없으면 null)
    function classify(sorted, w, cuts) {
        let p = ALL, sum = 0, sq = 0, score = 0, run = 1, best = 1;
        const diffs = new Set();
        for (let i = 0; i < 6; i++) {
            const n = sorted[i];
            p &= PROP[n]; sum += n; sq += SQ[n];
            if (w) score += w[n];
            if (i) { if (n === sorted[i - 1] + 1) { run++; if (run > best) best = run; } else run = 1; }
            for (let j = 0; j < i; j++) diffs.add(n - sorted[j]);
        }
        return { mask: maskOf(p, sum, sq, best, sorted[0], sorted[5]), ac: diffs.size - 5, run: best, band: w ? bandOf(score, cuts) : 0, score: score };
    }

    // 조건: { pat: 켠 패턴 비트, acMin, acExact, run(0 = 상관없음 · 2 · 3 = 가장 긴 연속이 정확히 그만큼), band(0 = 끔 · 1~3 = 그 구간 이상) }
    // 걸러지는 차례는 생성기와 같다: 특수 패턴 → AC값 → 연속번호 → 인기도. 처음 걸린 조건 하나로만 센다
    function failOf(mask, ac, run, band, c) {
        if (c.pat && (mask & c.pat)) return 'pat';
        if (c.acMin && (c.acExact ? ac !== c.acMin : ac < c.acMin)) return 'ac';
        if (c.run && run !== c.run) return 'run';
        if (c.band && band < c.band) return 'band';
        return '';
    }

    // 전수 훑기: include(꼭 넣을 번호) · exclude(뺄 번호)로 만들 수 있는 조합을 모두 돌며 visit(mask, ac, run, band, nums, score) 을 부른다.
    // 단계마다 성질 AND · 합계 · 제곱수 · 인기 점수 · 차이 비트(1~31 은 lo, 32~44 는 hi)를 쌓아 끝에서 덧셈만 한다 — 815만 개가 PC 에서 1초 안팎
    function walk(o, visit) {
        const inc = (o.include || []).slice().sort((a, b) => a - b);
        const excl = new Set(o.exclude || []);
        const w = o.w || null;
        const cuts = o.cuts || null;
        const free = [];
        for (let n = 1; n <= 45; n++) if (!excl.has(n) && !inc.includes(n)) free.push(n);
        const need = 6 - inc.length;
        if (need < 0 || free.length < need) return 0;
        let p0 = ALL, s0 = 0, q0 = 0, w0 = 0, lo0 = 0, hi0 = 0;
        for (let i = 0; i < inc.length; i++) {
            const n = inc[i];
            p0 &= PROP[n]; s0 += n; q0 += SQ[n]; if (w) w0 += w[n];
            for (let j = 0; j < i; j++) { const d = n - inc[j]; if (d < 32) lo0 |= 1 << d; else hi0 |= 1 << (d - 32); }
        }
        // 깊이마다 상태
        const P = new Int32Array(7), S = new Int32Array(7), Q = new Int32Array(7), LO = new Int32Array(7), HI = new Int32Array(7);
        const W = new Float64Array(7);
        const pick = new Int32Array(6);
        const nums = new Array(6);
        P[0] = p0; S[0] = s0; Q[0] = q0; W[0] = w0; LO[0] = lo0; HI[0] = hi0;
        let count = 0;
        const F = free.length;
        function leaf() {
            // 고정수와 고른 수를 합쳐 오름차순으로
            let a = 0, b = 0;
            for (let k = 0; k < 6; k++) nums[k] = (b >= need || (a < inc.length && inc[a] < pick[b])) ? inc[a++] : pick[b++];
            let run = 1, best = 1;
            for (let k = 1; k < 6; k++) { if (nums[k] === nums[k - 1] + 1) { run++; if (run > best) best = run; } else run = 1; }
            const ac = popcount(LO[need]) + popcount(HI[need]) - 5;
            const score = W[need];
            visit(maskOf(P[need], S[need], Q[need], best, nums[0], nums[5]), ac, best, w ? bandOf(score, cuts) : 0, nums, score);
            count++;
        }
        (function rec(depth, start) {
            if (depth === need) { leaf(); return; }
            const last = F - (need - depth);
            for (let i = start; i <= last; i++) {
                const n = free[i];
                pick[depth] = n;
                P[depth + 1] = P[depth] & PROP[n];
                S[depth + 1] = S[depth] + n;
                Q[depth + 1] = Q[depth] + SQ[n];
                if (w) W[depth + 1] = W[depth] + w[n];
                let lo = LO[depth], hi = HI[depth];
                for (let j = 0; j < inc.length; j++) { const d = n > inc[j] ? n - inc[j] : inc[j] - n; if (d < 32) lo |= 1 << d; else hi |= 1 << (d - 32); }
                for (let j = 0; j < depth; j++) { const d = n - pick[j]; if (d < 32) lo |= 1 << d; else hi |= 1 << (d - 32); }
                LO[depth + 1] = lo; HI[depth + 1] = hi;
                rec(depth + 1, i + 1);
            }
        })(0, 0);
        return count;
    }

    // 센 표: { total, zero: 패턴에 하나도 안 걸리는 조합의 칸별 수, masked: [[패턴 비트, 칸, 수], …] }
    function scan(o) {
        const zero = new Array(CELLS).fill(0);
        const other = new Map();
        const total = walk(o, (mask, ac, run, band) => {
            const cell = cellOf(ac, run, band);
            if (!mask) zero[cell]++;
            else { const k = mask * CELLS + cell; other.set(k, (other.get(k) || 0) + 1); }
        });
        const masked = [];
        other.forEach((v, k) => masked.push([Math.floor(k / CELLS), k % CELLS, v]));
        return { total: total, zero: zero, masked: masked };
    }

    // 센 표로 조건에 맞는 수를 다시 센다(칸 수백 개라 바로 끝난다). 빠진 수도 조건별로 돌려준다
    function count(hist, c) {
        const out = { total: hist.total, ok: 0, pat: 0, ac: 0, run: 0, band: 0 };
        const add = (mask, cell, v) => {
            const band = cell % BANDS, rest = (cell - band) / BANDS, run = rest % 7, ac = (rest - run) / 7;
            const why = failOf(mask, ac, run, band, c);
            if (why) out[why] += v; else out.ok += v;
        };
        for (let cell = 0; cell < CELLS; cell++) if (hist.zero[cell]) add(0, cell, hist.zero[cell]);
        for (const [mask, cell, v] of hist.masked) add(mask, cell, v);
        return out;
    }

    // 전부 훑어 조건에 맞는 조합 중 k 개를 고르게 뽑는다(저수지 표집 — 다 들고 있지 않아도 어느 조합이든 뽑힐 확률이 같다).
    // past: 뺄 지난 당첨 조합 { '1,5,8,16,28,33': 회차 }
    function sample(o) {
        const c = o.cond || {};
        const past = o.past || {};
        const k = o.k || 1;
        const hasPast = Object.keys(past).length > 0;
        const res = [];
        const out = { total: 0, ok: 0, pat: 0, ac: 0, run: 0, band: 0, past: 0, pastRounds: [] };
        out.total = walk(o, (mask, ac, run, band, nums) => {
            const why = failOf(mask, ac, run, band, c);
            if (why) { out[why]++; return; }
            if (hasPast) {
                const round = past[nums.join(',')];
                if (round) { out.past++; out.pastRounds.push(round); return; }
            }
            out.ok++;
            if (res.length < k) res.push(nums.slice());
            else { const j = Math.floor(Math.random() * out.ok); if (j < k) res[j] = nums.slice(); }
        });
        for (let i = res.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [res[i], res[j]] = [res[j], res[i]]; }
        out.picks = res;
        return out;
    }

    return { TOTAL: TOTAL, scan: scan, count: count, sample: sample, classify: classify, failOf: failOf, walk: walk, bandOf: bandOf };
}));
