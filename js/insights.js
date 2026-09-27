// 결제 페이지 전용. 이번 기간 기록을 문장으로 요약하고, 그 기록으로 조합을 고르는
// 방식을 번호까지 보여준다.
//
// 중요한 전제: 어떤 방식도 당첨 확률을 바꾸지 않는다. 어떤 6개를 고르든 1/8,145,060 이다.
// 그래서 근거가 된 기록과 "확률은 그대로"라는 사실을 같은 카드 안에 적는다. 재미를
// 주되 예측으로 읽히게 두지 않는다.
//
// 표시는 데이터가 바뀌면 같이 바뀌고, 같은 기간 안에서는 새로고침해도 같다 (최신 회차를
// 시드로 쓴다). 볼 때마다 번호가 달라지면 "오늘의 추천"처럼 읽히기 때문이다.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LottoInsights = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const P = 6 / 45;                          // 한 번호가 한 회차에 나올 확률
    const PAIR_P = 123410 / 8145060;           // 한 쌍이 함께 나올 확률 = C(43,4)/C(45,6)
    const CONSEC_P = 1 - 3838380 / 8145060;    // 연속한 번호가 하나라도 있을 확률
    const PAIR_COUNT = 45 * 44 / 2;            // 쌍의 가짓수 990
    const SUM_MEAN = 138;                      // 6개 합계의 이론 평균
    // 정규분포 45개의 최댓값 기댓값. 번호를 한꺼번에 놓고 보면 최다 번호는 평균적으로
    // 이만큼 튀어 있다 — 이걸 모르면 "+2 표준편차"를 이상 신호로 오해한다.
    const EXPECTED_MAX_Z = 2.12;

    const asc = (a, b) => a - b;
    const fmt1 = v => (Math.round(v * 10) / 10).toFixed(1);
    const bandOf = n => n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5;
    const isOdd = n => n % 2 === 1;
    const isLow = n => n <= 22;
    const sumOf = nums => nums.reduce((a, b) => a + b, 0);

    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(k => {
                if (k === 'text') node.textContent = attrs[k];
                else if (k === 'className') node.className = attrs[k];
                else if (k === 'dataset') Object.keys(attrs[k]).forEach(d => { node.dataset[d] = attrs[k][d]; });
                else node.setAttribute(k, attrs[k]);
            });
        }
        (children || []).forEach(c => {
            if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    const ball = n => el('span', { className: 'mball', dataset: { band: bandOf(n) }, text: String(n) });
    const balls = nums => el('span', { className: 'strategy-nums' }, nums.slice().sort(asc).map(ball));
    const T = (k, v) => (v ? I18N.f(k, v) : I18N.t(k));
    const lab = r => (I18N.lang === 'en' && r.labelEn) ? r.labelEn : r.label;
    const listNums = rows => rows.length > 4
        ? T('in.numsMore', { nums: rows.slice(0, 4).map(r => r.number).join('·'), n: rows.length - 4 })
        : T('in.nums', { nums: rows.slice(0, 4).map(r => r.number).join('·') });

    function acValue(nums) {
        const diffs = {};
        for (let i = 0; i < nums.length; i++) {
            for (let j = i + 1; j < nums.length; j++) diffs[Math.abs(nums[i] - nums[j])] = true;
        }
        return Object.keys(diffs).length - (nums.length - 1);
    }

    // 같은 기간이면 늘 같은 조합이 나오도록 최신 회차를 시드로 쓴다
    function rng(seed) {
        let s = (seed || 1) >>> 0;
        return () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    /* ───── 이번 기간 리뷰 ───── */
    function review(stats, draws) {
        const rounds = stats.rounds;
        const mean = rounds * P;
        const sd = Math.sqrt(rounds * P * (1 - P));
        const counts = stats.frequency.map(r => r.count);
        const max = Math.max.apply(null, counts);
        const min = Math.min.apply(null, counts);
        const top = stats.frequency.filter(r => r.count === max);
        const bottom = stats.frequency.filter(r => r.count === min);
        const zMax = (max - mean) / sd;
        const zMin = (mean - min) / sd;
        const lines = [];

        lines.push({
            head: T('in.hot.h'),
            body: T('in.hot.b', { nums: listNums(top), max: max, rounds: rounds, mean: fmt1(mean), diff: fmt1(max - mean), z: fmt1(zMax) }),
            note: zMax <= EXPECTED_MAX_Z + 0.6
                ? T('in.hot.n1', { z: EXPECTED_MAX_Z })
                : T('in.hot.n2', { z: EXPECTED_MAX_Z, rounds: rounds }),
        });

        lines.push({
            head: T('in.cold.h'),
            body: T('in.cold.b', { nums: listNums(bottom), min: min, diff: fmt1(mean - min), z: fmt1(zMin) }),
            note: T('in.cold.n', { z: EXPECTED_MAX_Z }),
        });

        const missing = stats.frequency.filter(r => r.count === 0).length;
        const missingExpected = 45 * Math.pow(1 - P, rounds);
        lines.push({
            head: T('in.missing.h'),
            body: T('in.missing.b', { n: missing, rounds: rounds, exp: fmt1(missingExpected) }),
            note: missing > missingExpected ? T('in.missing.n1') : T('in.missing.n2'),
        });

        const best = rows => rows.slice().sort((a, b) => b.count - a.count)[0];
        const oddTop = best(stats.oddEven);
        lines.push({
            head: T('in.odd.h'),
            body: T('in.odd.b', { label: lab(oddTop), n: oddTop.count, pct: fmt1(oddTop.count / rounds * 100) }),
            note: T('in.odd.n'),
        });

        const lowTop = best(stats.lowHigh);
        lines.push({
            head: T('in.low.h'),
            body: T('in.low.b', { label: lab(lowTop), n: lowTop.count }),
            note: T('in.low.n'),
        });

        if (draws && draws.length) {
            const avg = draws.reduce((a, d) => a + sumOf(d.numbers), 0) / draws.length;
            lines.push({
                head: T('in.sum.h'),
                body: T('in.sum.b', { avg: fmt1(avg) }),
                note: T('in.sum.n', { mean: SUM_MEAN }),
            });
        }

        const withStreak = rounds - stats.consecutive[0].count;
        lines.push({
            head: T('in.consec.h'),
            body: T('in.consec.b', { n: withStreak, pct: fmt1(withStreak / rounds * 100) }),
            note: T('in.consec.n', { pct: fmt1(CONSEC_P * 100) }),
        });

        const pair = stats.pairs[0];
        if (pair) {
            lines.push({
                head: T('in.pair.h'),
                body: T('in.pair.b', { a: pair.a, b: pair.b, n: pair.count, exp: fmt1(rounds * PAIR_P) }),
                note: T('in.pair.n', { total: PAIR_COUNT }),
            });
        }
        return lines;
    }

    /* ───── 이번 주 전략 ───── */
    function strategies(stats) {
        const gapOf = {};
        stats.gaps.forEach(g => { gapOf[g.number] = g.gap; });
        const hot = stats.frequency.slice().sort((a, b) => b.count - a.count || a.number - b.number);
        const cold = stats.frequency.slice().sort((a, b) =>
            a.count - b.count || gapOf[b.number] - gapOf[a.number] || a.number - b.number);
        const nums = rows => rows.map(r => r.number);
        const rand = rng(stats.latestRound || 1);
        const out = [];

        out.push({
            title: T('in.s.hot'),
            basis: T('in.s.hotBasis', { list: hot.slice(0, 6).map(r => T('in.numCount', { n: r.number, c: r.count })).join(', ') }),
            picks: nums(hot.slice(0, 6)),
        });

        out.push({
            title: T('in.s.cold'),
            basis: T('in.s.coldBasis', { list: cold.slice(0, 6).map(r => T('in.numCount', { n: r.number, c: r.count })).join(', ') }),
            picks: nums(cold.slice(0, 6)),
        });

        const topPairs = stats.pairs.slice(0, 3);
        const pairPick = [];
        topPairs.forEach(p => {
            if (pairPick.indexOf(p.a) === -1) pairPick.push(p.a);
            if (pairPick.indexOf(p.b) === -1) pairPick.push(p.b);
        });
        for (let i = 0; pairPick.length < 6 && i < hot.length; i++) {
            if (pairPick.indexOf(hot[i].number) === -1) pairPick.push(hot[i].number);
        }
        out.push({
            title: T('in.s.pair'),
            basis: T('in.s.pairBasis', { list: topPairs.map(p => T('in.pairCount', { a: p.a, b: p.b, c: p.count })).join(', ') }),
            pairs: topPairs,
            picks: pairPick.slice(0, 6),
        });

        // 이번 기간에 가장 잦았던 홀짝·저고 형태에 합계와 AC 범위를 맞춘 조합
        const oddTop = stats.oddEven.slice().sort((a, b) => b.count - a.count)[0];
        const lowTop = stats.lowHigh.slice().sort((a, b) => b.count - a.count)[0];
        const shaped = shapePick(rand, digitOf(oddTop.label), digitOf(lowTop.label));
        out.push({
            title: T('in.s.shape'),
            basis: T('in.s.shapeBasis', { odd: lab(oddTop), low: lab(lowTop), sum: sumOf(shaped), ac: acValue(shaped) }),
            picks: shaped,
        });

        out.push({
            title: T('in.s.mix'),
            basis: T('in.s.mixBasis'),
            picks: nums(hot.slice(0, 3)).concat(nums(cold.slice(0, 3))),
        });

        return out;
    }

    // "홀4 짝2" 같은 라벨에서 앞 숫자만 꺼낸다
    const digitOf = label => Number(String(label).replace(/[^0-9]/g, '').charAt(0));

    // 홀수 개수와 저번호 개수를 맞추고, 합계 100~180 · AC 7 이상인 조합을 찾는다.
    // 못 찾으면 마지막 후보를 그대로 쓴다 — 화면이 비는 것보다 낫다.
    function shapePick(rand, wantOdd, wantLow) {
        let last = null;
        for (let t = 0; t < 4000; t++) {
            const pool = [];
            for (let n = 1; n <= 45; n++) pool.push(n);
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
            }
            const pick = pool.slice(0, 6).sort(asc);
            last = pick;
            if (pick.filter(isOdd).length === wantOdd
                && pick.filter(isLow).length === wantLow
                && sumOf(pick) >= 100 && sumOf(pick) <= 180
                && acValue(pick) >= 7) return pick;
        }
        return last;
    }

    /* ───── 그리기 ───── */
    function render(container, stats, draws) {
        container.textContent = '';

        const lines = review(stats, draws);
        container.appendChild(el('section', {
            className: 'card', id: 'insight-review', 'aria-labelledby': 'insight-review-t',
        }, [
            el('h3', { className: 'card-title', id: 'insight-review-t' }, [
                el('span', { text: T('in.reviewH') }),
                el('small', { text: T('in.reviewSub', { n: stats.rounds }) }),
            ]),
            el('div', { className: 'card-body' }, [
                el('ul', { className: 'insight-list' }, lines.map(l => el('li', null, [
                    el('strong', { text: l.head }),
                    el('p', { text: l.body }),
                    el('p', { className: 'card-note', text: l.note }),
                ]))),
            ]),
        ]));

        const list = strategies(stats);
        container.appendChild(el('section', {
            className: 'card', id: 'insight-strategy', 'aria-labelledby': 'insight-strategy-t',
        }, [
            el('h3', { className: 'card-title', id: 'insight-strategy-t' }, [
                el('span', { text: T('in.strategyH') }),
                el('small', { text: T('in.strategySub') }),
            ]),
            el('div', { className: 'card-body' }, [
                el('ol', { className: 'strategy-list' }, list.map(s => el('li', { className: 'strategy' }, [
                    el('h4', { text: s.title }),
                    el('p', { className: 'strategy-basis', text: s.basis }),
                    s.pairs ? el('p', { className: 'strategy-pairs' }, s.pairs.map(p => el('span', { className: 'pair-chip' }, [
                        ball(p.a), ball(p.b), el('small', { text: T('sr.times', { n: p.count }) }),
                    ]))) : null,
                    balls(s.picks),
                ]))),
            ]),
        ]));
    }

    return { render: render, review: review, strategies: strategies };
}));
