// 통계 9종 계산 모듈. 홈(전 회차)과 30일 통계 페이지가 같은 함수를 쓴다.
// 같은 통계를 페이지마다 따로 계산하면 숫자가 어긋나고, 그 사실을 한참 뒤에 알게 된다.
// 이 파일에는 DOM 코드가 없다 — Node 로도 그대로 돌려 검증할 수 있게.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LottoStats = factory();
}(this, function () {
    'use strict';

    const RECENT_WINDOW = 50;
    const LOW_MAX = 22;
    const DAY_MS = 24 * 60 * 60 * 1000;

    const SUM_BINS = [
        { label: '21~99', max: 99 },
        { label: '100~119', max: 119 },
        { label: '120~139', max: 139 },
        { label: '140~159', max: 159 },
        { label: '160~179', max: 179 },
        { label: '180~199', max: 199 },
        { label: '200+', max: Infinity },
    ];
    // 0명(이월)을 따로 둔다. 예전 페이지는 `winners || 1` 로 이월 회차를 1명으로 셌다.
    const WINNER_BINS = [
        { label: '0명 (이월)', max: 0 },
        { label: '1명', max: 1 },
        { label: '2명', max: 2 },
        { label: '3~5명', max: 5 },
        { label: '6~10명', max: 10 },
        { label: '11명 이상', max: Infinity },
    ];
    const STREAK_LABELS = ['연속 없음', '2연속', '3연속', '4연속', '5연속 이상'];

    const zeros = n => { const a = []; for (let i = 0; i < n; i++) a.push(0); return a; };
    const asc = (a, b) => a - b;

    function bandOf(n) {
        return n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5;
    }

    function binIndex(bins, value) {
        for (let i = 0; i < bins.length; i++) if (value <= bins[i].max) return i;
        return bins.length - 1;
    }

    function longestRun(sorted) {
        let best = 1, cur = 1;
        for (let i = 1; i < sorted.length; i++) {
            cur = sorted[i] === sorted[i - 1] + 1 ? cur + 1 : 1;
            if (cur > best) best = cur;
        }
        return best;
    }

    // "YYYY-MM-DD" 를 UTC 자정으로. 로컬 시간대에 따라 하루가 밀리지 않게.
    function parseDay(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
    }

    // 가장 최근 추첨일로부터 days 일 안에 든 회차. 기준이 "오늘"이 아니라 데이터의 최신
    // 추첨일이라, 갱신이 하루 늦어도 기간이 비어 버리지 않는다.
    function withinDays(draws, days) {
        const dated = draws.filter(d => !isNaN(parseDay(d.date)));
        if (!dated.length) return { draws: [], from: null, to: null };
        const latest = Math.max.apply(null, dated.map(d => parseDay(d.date)));
        const cutoff = latest - (days - 1) * DAY_MS;
        const picked = dated.filter(d => parseDay(d.date) >= cutoff);
        const fmt = t => new Date(t).toISOString().slice(0, 10);
        return { draws: picked, from: fmt(cutoff), to: fmt(latest) };
    }

    function compute(draws, opts) {
        opts = opts || {};
        // 파일은 최신 회차가 앞이지만 순서에 기대지 않는다. 예전 핫/콜드 페이지는 오름차순을
        // 가정해 "최근 50회" 자리에 1~50회를 집계하고 있었다.
        const list = draws.slice().sort((a, b) => b.round - a.round);
        const n = list.length;

        const freq = zeros(46);
        const bonus = zeros(46);
        const oddBy = zeros(7);     // 인덱스 = 홀수 개수
        const lowBy = zeros(7);     // 인덱스 = 저번호(1~22) 개수
        const streak = zeros(STREAK_LABELS.length);
        const sums = zeros(SUM_BINS.length);
        const winners = zeros(WINNER_BINS.length);
        const pairs = new Map();

        list.forEach(d => {
            const nums = d.numbers.slice().sort(asc);
            let odd = 0, low = 0, total = 0;
            nums.forEach(x => {
                freq[x]++;
                if (x % 2) odd++;
                if (x <= LOW_MAX) low++;
                total += x;
            });
            bonus[d.bonus]++;
            oddBy[odd]++;
            lowBy[low]++;
            streak[Math.min(longestRun(nums), 5) - 1]++;
            sums[binIndex(SUM_BINS, total)]++;
            winners[binIndex(WINNER_BINS, d.firstPrizeWinners || 0)]++;
            for (let i = 0; i < 5; i++) {
                for (let j = i + 1; j < 6; j++) {
                    const key = nums[i] * 100 + nums[j];
                    pairs.set(key, (pairs.get(key) || 0) + 1);
                }
            }
        });

        const window = Math.min(opts.recentWindow || RECENT_WINDOW, n);
        const recent = zeros(46);
        list.slice(0, window).forEach(d => d.numbers.forEach(x => { recent[x]++; }));
        const trendRows = [];
        for (let x = 1; x <= 45; x++) trendRows.push({ number: x, band: bandOf(x), recent: recent[x], overall: freq[x] });
        const topN = opts.trendTop || 10;
        const hot = trendRows.slice().sort((a, b) => b.recent - a.recent || a.number - b.number).slice(0, topN);
        const cold = trendRows.slice().sort((a, b) => a.recent - b.recent || a.number - b.number).slice(0, topN);

        const numberRows = arr => {
            const rows = [];
            for (let x = 1; x <= 45; x++) rows.push({ number: x, band: bandOf(x), count: arr[x] });
            return rows;
        };

        const pairRows = [];
        pairs.forEach((count, key) => pairRows.push({ a: Math.floor(key / 100), b: key % 100, count: count }));
        pairRows.sort((p, q) => q.count - p.count || p.a - q.a || p.b - q.b);

        return {
            rounds: n,
            latestRound: n ? list[0].round : null,
            oldestRound: n ? list[n - 1].round : null,
            latestDate: n ? list[0].date || null : null,
            oldestDate: n ? list[n - 1].date || null : null,
            frequency: numberRows(freq),
            bonus: numberRows(bonus),
            oddEven: [6, 5, 4, 3, 2, 1, 0].map(o => ({ label: `홀${o} 짝${6 - o}`, count: oddBy[o] })),
            lowHigh: [6, 5, 4, 3, 2, 1, 0].map(l => ({ label: `저${l} 고${6 - l}`, count: lowBy[l] })),
            consecutive: STREAK_LABELS.map((label, i) => ({ label: label, count: streak[i] })),
            sum: SUM_BINS.map((b, i) => ({ label: b.label, count: sums[i] })),
            winners: WINNER_BINS.map((b, i) => ({ label: b.label, count: winners[i] })),
            trend: { window: window, hot: hot, cold: cold },
            pairs: pairRows.slice(0, opts.pairTop || 10),
        };
    }

    return {
        compute: compute,
        withinDays: withinDays,
        bandOf: bandOf,
        RECENT_WINDOW: RECENT_WINDOW,
        LOW_MAX: LOW_MAX,
    };
}));
