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
    const listNums = rows => rows.slice(0, 4).map(r => r.number).join('·') + '번'
        + (rows.length > 4 ? ' 외 ' + (rows.length - 4) + '개' : '');

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
            head: '많이 나온 번호',
            body: listNums(top) + ' — ' + max + '회. ' + rounds + '회 동안 한 번호의 기대 출현은 '
                + fmt1(mean) + '회이니 ' + fmt1(max - mean) + '회 많습니다 (+' + fmt1(zMax) + ' 표준편차).',
            note: zMax <= EXPECTED_MAX_Z + 0.6
                ? '번호 45개 중 최다 번호는 공평한 추첨에서도 평균 +' + EXPECTED_MAX_Z + ' 표준편차쯤 튑니다. 이 정도는 흔한 값입니다.'
                : '평균적인 최댓값(+' + EXPECTED_MAX_Z + ' 표준편차)보다 큽니다. 다만 ' + rounds + '회는 매우 작은 표본이라 다음 기간에 쉽게 뒤집힙니다.',
        });

        lines.push({
            head: '적게 나온 번호',
            body: listNums(bottom) + ' — ' + min + '회로 기대보다 ' + fmt1(mean - min) + '회 적습니다 (-' + fmt1(zMin) + ' 표준편차).',
            note: '적게 나왔다고 앞으로 더 나올 이유는 없습니다. 추첨기는 지난 결과를 기억하지 않습니다.',
        });

        const missing = stats.frequency.filter(r => r.count === 0).length;
        const missingExpected = 45 * Math.pow(1 - P, rounds);
        lines.push({
            head: '한 번도 안 나온 번호',
            body: missing + '개입니다. ' + rounds + '회라면 평균 ' + fmt1(missingExpected) + '개가 그렇습니다.',
            note: missing > missingExpected
                ? '기대보다 많지만, 회차가 적을수록 이런 번호는 늘어납니다.'
                : '기대 범위 안입니다.',
        });

        const best = rows => rows.slice().sort((a, b) => b.count - a.count)[0];
        const oddTop = best(stats.oddEven);
        lines.push({
            head: '홀짝 형태',
            body: oddTop.label + ' 이 ' + oddTop.count + '회로 가장 잦았습니다 (' + fmt1(oddTop.count / rounds * 100) + '%).',
            note: '홀3 짝3 이 이론상 가장 흔한 형태입니다(약 33%). 나머지 형태도 고르게 섞여 나옵니다.',
        });

        const lowTop = best(stats.lowHigh);
        lines.push({
            head: '저고 형태',
            body: lowTop.label + ' 이 ' + lowTop.count + '회로 가장 잦았습니다 (저 1~22 · 고 23~45 기준).',
            note: '저3 고3 역시 이론상 가장 흔한 형태입니다(약 33%).',
        });

        if (draws && draws.length) {
            const avg = draws.reduce((a, d) => a + sumOf(d.numbers), 0) / draws.length;
            lines.push({
                head: '번호 합계',
                body: '이번 기간 평균은 ' + fmt1(avg) + '입니다.',
                note: '이론 평균은 ' + SUM_MEAN + '입니다. 합계는 가운데로 몰리는 값이라 특별한 신호로 읽기 어렵습니다.',
            });
        }

        const withStreak = rounds - stats.consecutive[0].count;
        lines.push({
            head: '연속 번호',
            body: withStreak + '회에서 연속한 번호가 나왔습니다 (' + fmt1(withStreak / rounds * 100) + '%).',
            note: '이론값은 ' + fmt1(CONSEC_P * 100) + '%입니다. 연속 번호는 피할 대상이 아니라 절반 가까이 나오는 흔한 형태입니다.',
        });

        const pair = stats.pairs[0];
        if (pair) {
            lines.push({
                head: '가장 많이 함께 나온 쌍',
                body: pair.a + '번과 ' + pair.b + '번이 ' + pair.count + '회 함께 나왔습니다. 한 쌍의 기대 동반 출현은 '
                    + fmt1(rounds * PAIR_P) + '회입니다.',
                note: '쌍은 ' + PAIR_COUNT + '가지나 됩니다. 그중 최댓값이 이 정도인 건 우연으로도 흔합니다.',
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
            title: '많이 나온 번호로 묶기',
            basis: '이번 기간 출현 상위: ' + hot.slice(0, 6).map(r => r.number + '번(' + r.count + '회)').join(', '),
            picks: nums(hot.slice(0, 6)),
            note: '흐름을 타는 번호가 있다고 보는 방식입니다. 많이 나온 건 기록상 사실이지만, 다음 회차 확률은 다른 번호와 같습니다.',
        });

        out.push({
            title: '안 나온 번호 노리기',
            basis: '이번 기간 출현 하위: ' + cold.slice(0, 6).map(r => r.number + '번(' + r.count + '회)').join(', '),
            picks: nums(cold.slice(0, 6)),
            note: '이제 나올 때가 됐다고 보는 방식입니다. 실제로 그런 순서는 없습니다. 위 전략과 정반대인데 둘 다 확률은 같습니다.',
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
            title: '같이 나온 쌍 잇기',
            basis: '동반 출현 상위 쌍: ' + topPairs.map(p => p.a + '·' + p.b + '번(' + p.count + '회)').join(', '),
            pairs: topPairs,
            picks: pairPick.slice(0, 6),
            note: '쌍을 통째로 넣는 방식입니다. 쌍 ' + PAIR_COUNT + '가지 중 상위가 몇 회씩 겹치는 건 자연스러운 일이라 특별한 궁합은 아닙니다. 확률은 다른 조합과 같습니다.',
        });

        // 이번 기간에 가장 잦았던 홀짝·저고 형태에 합계와 AC 범위를 맞춘 조합
        const oddTop = stats.oddEven.slice().sort((a, b) => b.count - a.count)[0];
        const lowTop = stats.lowHigh.slice().sort((a, b) => b.count - a.count)[0];
        const shaped = shapePick(rand, digitOf(oddTop.label), digitOf(lowTop.label));
        out.push({
            title: '가장 흔한 형태 맞추기',
            basis: '이번 기간 최다 형태 ' + oddTop.label + ' · ' + lowTop.label
                + ' 에 맞춘 조합 (합계 ' + sumOf(shaped) + ' · AC ' + acValue(shaped) + ')',
            picks: shaped,
            note: '자주 나온 형태에 맞춰 만드는 방식입니다. 형태별로 가능한 조합 수가 달라 흔해 보일 뿐, 조합 하나하나의 확률은 모두 같습니다.',
        });

        out.push({
            title: '많이·적게 섞기',
            basis: '출현 상위 3개와 하위 3개를 반씩',
            picks: nums(hot.slice(0, 3)).concat(nums(cold.slice(0, 3))),
            note: '한쪽에 걸지 않는 절충입니다. 마음은 편하지만 확률은 역시 같습니다.',
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
                el('span', { text: '이번 기간 리뷰' }),
                el('small', { text: '최근 ' + stats.rounds + '회차' }),
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
            className: 'card span-2', id: 'insight-strategy', 'aria-labelledby': 'insight-strategy-t',
        }, [
            el('h3', { className: 'card-title', id: 'insight-strategy-t' }, [
                el('span', { text: '이번 주 전략' }),
                el('small', { text: '확률은 모두 같음' }),
            ]),
            el('div', { className: 'card-body' }, [
                el('p', {
                    className: 'strategy-warn',
                    text: '아래는 이번 기간 기록으로 번호를 고르는 방식일 뿐입니다. 어떤 6개를 골라도 1등 확률은 1/8,145,060으로 같습니다.',
                }),
                el('ol', { className: 'strategy-list' }, list.map(s => el('li', { className: 'strategy' }, [
                    el('h4', { text: s.title }),
                    el('p', { className: 'strategy-basis', text: s.basis }),
                    s.pairs ? el('p', { className: 'strategy-pairs' }, s.pairs.map(p => el('span', { className: 'pair-chip' }, [
                        ball(p.a), ball(p.b), el('small', { text: p.count + '회' }),
                    ]))) : null,
                    balls(s.picks),
                    el('p', { className: 'card-note', text: s.note }),
                ]))),
            ]),
        ]));
    }

    return { render: render, review: review, strategies: strategies };
}));
