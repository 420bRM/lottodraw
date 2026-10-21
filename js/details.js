// 상세 분석 카드 4종. 홈에서는 잠긴 채로 보이고, 이용권 키가 있으면 열린다.
// 5개월 통계 페이지에서는 결제한 사람만 들어오므로 처음부터 열어 둔다.
//
// 네 카드 모두 전 회차 기록을 쓴다. 기간을 자르면 "몇 회차 전에 나왔나" 같은 값이
// 잘려서 답이 달라진다. 내 번호 성적표 카드는 js/report.js(LottoReport)로 계산한다.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LottoDetails = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const asc = (a, b) => a - b;
    const T = (k, v) => (v ? I18N.f(k, v) : I18N.t(k));
    const fmt = n => Number(n).toLocaleString('ko-KR');
    const bandOf = n => n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5;
    const byRoundDesc = (a, b) => b.round - a.round;

    // 1,628,391,980 → "16억 2,839만"
    function won(amount) {
        if (!amount) return T('dt.noData');
        const eok = Math.floor(amount / 1e8);
        const man = Math.floor((amount % 1e8) / 1e4);
        if (I18N.lang === 'en') {
            return amount >= 1e9 ? (amount / 1e9).toFixed(2) + ' bn KRW' : Math.round(amount / 1e6) + 'm KRW';
        }
        return eok ? (man ? `${fmt(eok)}억 ${fmt(man)}만` : `${fmt(eok)}억`) : `${fmt(man)}만`;
    }

    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(k => {
                if (k === 'text') node.textContent = attrs[k];
                else if (k === 'className') node.className = attrs[k];
                else if (k === 'dataset') Object.keys(attrs[k]).forEach(d => { node.dataset[d] = attrs[k][d]; });
                else if (k === 'on') Object.keys(attrs[k]).forEach(ev => node.addEventListener(ev, attrs[k][ev]));
                else node.setAttribute(k, attrs[k]);
            });
        }
        (children || []).forEach(c => {
            if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    const ball = n => el('span', { className: 'mball', dataset: { band: bandOf(n) }, text: String(n) });

    // 상세 분석 카드는 네 칸: 제목 · 안내(intro) · 본문 · 주석(note). 한 줄에 놓인 카드끼리 칸마다 높이를 맞춘다
    // (css .detail-card — subgrid). 안내가 사용법이면 help 로 흐리게.
    const intro = (text, help) => el('p', { className: 'detail-intro' + (help ? ' is-help' : ''), text: text });
    const note = text => el('p', { className: 'detail-note', text: text || '' });

    function card(o) {
        return el('section', { className: 'card detail-card', id: o.id, 'aria-labelledby': o.id + '-t' }, [
            el('h3', { className: 'card-title', id: o.id + '-t' }, [
                el('span', { text: o.title }),
                o.meta ? el('small', { id: o.id + '-meta', text: o.meta }) : null,
            ]),
            o.intro,
            el('div', { className: 'detail-main' }, o.body),
            o.note || note(),
        ]);
    }

    // 목록은 넉넉히(FILL_MAX) 그려 두고 min 개만 보인다. 옆 카드가 길면 fitAll() 이 그 높이까지 더 연다
    const FILL_MAX = 40;
    function fillList(tag, className, min, items, meta) {
        items.forEach((li, i) => { li.hidden = i >= min; });
        return el(tag, { className: className, dataset: meta ? { min: min, meta: meta } : { min: min } }, items);
    }

    /* ───── 계산 ───── */

    // 한 회차 안에서 이어지는 번호 묶음. [32,33] 이나 [12,13,14] 처럼 2개 이상만 센다.
    function runsOf(numbers) {
        const nums = numbers.slice().sort(asc);
        const groups = [];
        let run = [nums[0]];
        for (let i = 1; i < nums.length; i++) {
            if (nums[i] === nums[i - 1] + 1) run.push(nums[i]);
            else { if (run.length > 1) groups.push(run); run = [nums[i]]; }
        }
        if (run.length > 1) groups.push(run);
        return groups;
    }

    // 연속이 나온 회차 목록 (최신 순)
    function consecutiveRounds(draws, limit) {
        const rows = [];
        draws.slice().sort(byRoundDesc).forEach(d => {
            const groups = runsOf(d.numbers);
            if (groups.length) rows.push({ round: d.round, date: d.date || null, groups: groups, longest: Math.max.apply(null, groups.map(g => g.length)) });
        });
        return { rows: limit ? rows.slice(0, limit) : rows, total: rows.length, of: draws.length };
    }

    // 고른 번호와 함께 나온 번호
    function partners(draws, number, top) {
        const counts = {};
        const rounds = [];
        draws.slice().sort(byRoundDesc).forEach(d => {
            if (d.numbers.indexOf(number) === -1) return;
            rounds.push({ round: d.round, date: d.date || null, numbers: d.numbers.slice().sort(asc) });
            d.numbers.forEach(n => { if (n !== number) counts[n] = (counts[n] || 0) + 1; });
        });
        const list = Object.keys(counts)
            .map(n => ({ number: Number(n), count: counts[n] }))
            .sort((a, b) => b.count - a.count || a.number - b.number);
        return { number: number, appearances: rounds.length, top: list.slice(0, top || 10), rounds: rounds };
    }

    // 1등 당첨금 추이
    // 평균은 두 가지를 같이 낸다(tools/build-static-stats.js 의 firstPrizeAvg 와 같은 식):
    // avgWinner = 1등 총당첨금 ÷ 당첨자 수(동행복권 · 언론이 쓰는 값), avgAll = 회차마다의 1인당 금액 평균
    function prizeTrend(draws, count) {
        const rows = draws.slice().sort(byRoundDesc).slice(0, count || 20).map(d => ({
            round: d.round,
            date: d.date || null,
            amount: d.firstPrizeAmount || 0,
            winners: typeof d.firstPrizeWinners === 'number' ? d.firstPrizeWinners : null,
        }));
        const amounts = rows.map(r => r.amount).filter(a => a > 0);
        const paid = draws.filter(d => d.firstPrizeWinners > 0 && d.firstPrizeAmount > 0);
        const winners = paid.reduce((a, d) => a + d.firstPrizeWinners, 0);
        return {
            rows: rows,
            max: amounts.length ? Math.max.apply(null, amounts) : 0,
            avgAll: paid.length ? paid.reduce((a, d) => a + d.firstPrizeAmount, 0) / paid.length : 0,
            avgWinner: winners ? paid.reduce((a, d) => a + d.firstPrizeAmount * d.firstPrizeWinners, 0) / winners : 0,
        };
    }

    /* ───── 카드 ───── */

    function consecutiveCard(draws) {
        const data = consecutiveRounds(draws, FILL_MAX);
        return card({
            id: 'detail-runs', title: T('dt.runs.t'), meta: T('dt.allDraws'),
            intro: intro(T('dt.runs.lead', { of: fmt(data.of), n: fmt(data.total), pct: (data.total / data.of * 100).toFixed(1) })),
            body: [fillList('ul', 'run-list', 12, data.rows.map(r => el('li', null, [
                el('span', { className: 'run-round', text: T('sr.drawNo', { n: r.round }) }),
                el('span', { className: 'run-groups' }, r.groups.map(g =>
                    el('span', { className: 'run-group' }, g.map(ball)))),
                el('span', { className: 'run-tail', text: T('dt.runs.inRow', { n: r.longest >= 3 ? r.longest : 2 }) }),
            ])))],
            note: note(T('dt.runs.note')),
        });
    }

    function partnerCard(draws) {
        const box = el('div', { className: 'partner-out' });
        const recentNote = note();
        const grid = el('div', { className: 'number-grid partner-grid', role: 'group', 'aria-label': T('dt.pickNumber') });
        let current = null;

        function show(n) {
            current = n;
            Array.prototype.forEach.call(grid.children, b => {
                const on = Number(b.dataset.number) === n;
                b.classList.toggle('include', on);
                if (on) b.dataset.band = bandOf(n); else delete b.dataset.band;
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            const p = partners(draws, n, 20);
            box.textContent = '';
            box.appendChild(el('p', { className: 'detail-lead', text: T('dt.partner.lead', { n: n, c: fmt(p.appearances) }) }));
            box.appendChild(fillList('ol', 'ball-list', 10, p.top.map((row, i) => el('li', null, [
                el('span', { className: 'lead', text: T('sr.rank', { n: i + 1 }) }),
                ball(row.number),
                el('span', { className: 'tail', text: T('sr.times', { n: fmt(row.count) }) }),
            ]))));
            const recent = p.rounds.slice(0, 3);
            recentNote.textContent = recent.length ? T('dt.partner.recent', { n: n,
                list: recent.map(r => T('dt.roundWith', { r: r.round, nums: r.numbers.join('·') })).join(', ') }) : '';
            refit();
        }

        for (let n = 1; n <= 45; n++) {
            grid.appendChild(el('button', {
                type: 'button', className: 'cell', dataset: { number: n }, text: String(n),
                'aria-pressed': 'false',
                on: { click: () => show(n) },
            }));
        }

        const latest = draws.slice().sort(byRoundDesc)[0];
        const first = latest ? latest.numbers.slice().sort(asc)[0] : 1;
        const c = card({
            id: 'detail-partner', title: T('dt.partner.t'), meta: T('dt.allDraws'),
            intro: intro(T('dt.partner.help'), true), body: [grid, box], note: recentNote,
        });
        show(first);
        return c;
    }

    // 내 번호 성적표: 1회부터 매주 이 번호로 1게임씩 샀다면(report.html 과 같은 계산).
    // 2~5등 금액(prize-data.json)은 처음 누를 때 받는다. 당첨 회차 전체 · 연도별은 report.html 에서 이어 본다.
    let prizes = null;
    const loadPrizes = () => prizes || (prizes = fetch('prize-data.json')
        .then(r => (r.ok ? r.json() : { draws: [] }))
        .then(p => p.draws || [])
        .catch(() => []));
    const krw = n => (I18N.lang === 'en' ? (n < 0 ? '-₩' : '₩') + fmt(Math.abs(n)) : (n < 0 ? '-' : '') + fmt(Math.abs(n)) + '원');
    const roundLink = r => el('a', { href: 'round/' + r + '.html', text: T('rc.roundN', { n: r }) });

    // 처음 열면 빈 카드 대신 예시를 펼쳐 둔다: 마지막 회차의 2등 조합(당첨번호 앞 5개 + 보너스).
    // 그 회차에 2등이 된 번호라는 걸 위에 밝혀 둔다 — 지난 기록으로 만든 예시일 뿐이다.
    function secondPrizeExample(draws) {
        const d = draws.slice().sort(byRoundDesc)[0];
        if (!d) return null;
        return { round: d.round, bonus: d.bonus, picks: d.numbers.slice().sort(asc).slice(0, 5).concat([d.bonus]).sort(asc) };
    }

    function reportCard(draws) {
        const example = secondPrizeExample(draws);
        const input = el('input', {
            type: 'text', id: 'report-input', inputmode: 'numeric', autocomplete: 'off',
            maxlength: '30', placeholder: T('dt.report.ph', { nums: (example ? example.picks : [3, 11, 19, 27, 34, 42]).join(' ') }),
            'aria-label': T('dt.report.t'),
        });
        const out = el('div', { className: 'report-out' });
        const status = el('p', { className: 'license-status', id: 'report-status', role: 'status', 'aria-live': 'polite' });

        function show(r) {
            const set = {};
            r.picks.forEach(n => { set[n] = true; });
            // 아까웠던 회차의 당첨번호: 맞힌 번호만 색, 나머지는 흐리게
            const hitBall = n => (set[n] ? ball(n) : el('span', { className: 'mball my-miss', text: String(n) }));
            const best = r.best;
            out.appendChild(el('p', { className: 'detail-lead' }, [el('span', { className: 'strategy-nums' }, r.picks.map(ball))]));
            out.appendChild(el('p', { className: 'card-note', text: T('rc.range', { from: r.from, to: r.to, fromDate: r.fromDate, toDate: r.toDate, games: fmt(r.games) }) }));
            out.appendChild(el('div', { className: 'rc-tiles' }, [
                el('div', null, [el('span', { text: T('rc.spent') }), el('b', { text: krw(r.spent) })]),
                el('div', null, [el('span', { text: T('rc.won') }), el('b', { text: krw(r.won) })]),
                el('div', { className: r.net < 0 ? 'is-loss' : 'is-gain' }, [el('span', { text: T('rc.net') }), el('b', { text: krw(r.net) })]),
            ]));
            out.appendChild(el('div', { className: 'table-wrap' }, [el('table', { className: 'data-table rc-ranks' }, [
                el('thead', null, [el('tr', null, [1, 2, 3, 4, 5].map(k => el('th', { text: T('rc.rank' + k) })))]),
                el('tbody', null, [el('tr', null, [1, 2, 3, 4, 5].map(k => el('td', { text: T('rc.times', { n: fmt(r.ranks[k]) }) })))]),
            ])]));
            out.appendChild(best
                ? el('p', null, [T('rc.bestPre'), roundLink(best.round), ` (${best.date}) `, el('b', { text: T('rc.rank' + best.rank) }),
                    ' · ' + (best.amount ? krw(best.amount) : T('rc.unknownAmt'))])
                : el('p', { text: T('rc.noWin') }));
            out.appendChild(el('p', { className: 'report-sub', text: T('rc.nearH') }));
            out.appendChild(r.near.length ? el('ul', { className: 'ball-list rc-near' }, r.near.map(row => el('li', null, [
                el('span', { className: 'lead' }, [roundLink(row.round)]),
                el('span', { className: 'strategy-nums' }, row.numbers.map(hitBall).concat([el('span', { className: 'plus', text: '+' }), hitBall(row.bonus)])),
                el('span', { className: 'tail', text: T('rc.hits', { n: row.hits }) + (row.bonusHit ? ' + ' + T('rc.bonus') : '') + (row.rank ? ' · ' + T('rc.rank' + row.rank) : '') }),
            ]))) : el('p', { className: 'muted', text: T('rc.noNear') }));
            if (r.unknown) out.appendChild(el('p', { className: 'card-note', text: T('rc.unknown', { n: r.unknown }) }));
            out.appendChild(el('a', { className: 'btn btn-secondary', href: 'report.html?n=' + r.picks.join(','), text: T('dt.report.full') }));
            refit();
        }

        let runs = 0;   // 받는 동안 다시 누르면 마지막 것만 그린다
        function draw(picks, ex) {
            const R = window.LottoReport;
            const mine = ++runs;
            status.classList.remove('error');
            out.textContent = '';
            refit();
            if (!picks) {
                status.textContent = T(R ? 'rc.err' : 'rc.loadFail');
                status.classList.add('error');
                return;
            }
            status.textContent = T('rc.loading');
            loadPrizes().then(list => {
                if (mine !== runs) return;
                status.textContent = '';
                if (ex) out.appendChild(el('p', { className: 'report-example', text: T('dt.report.example', { r: ex.round, b: ex.bonus }) }));
                show(R.compute(draws, list, picks));
            });
        }
        const run = () => draw(window.LottoReport ? LottoReport.parsePicks(input.value) : null);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

        // js/report.js 는 defer 라 아직 없을 수 있다 — 그때는 문서를 다 읽은 뒤에
        const showExample = () => { if (example && window.LottoReport && !runs) draw(example.picks, example); };
        if (window.LottoReport) showExample();
        else if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded', showExample, { once: true });

        return card({
            id: 'detail-report', title: T('dt.report.t'), meta: T('dt.allDraws'),
            intro: intro(T('dt.report.help'), true),
            body: [
                el('div', { className: 'license-form' }, [
                    input,
                    el('button', { type: 'button', className: 'btn', text: T('dt.report.go'), on: { click: run } }),
                ]),
                status,
                out,
            ],
            note: note(T('rc.note')),
        });
    }

    function prizeCard(draws) {
        const t = prizeTrend(draws, FILL_MAX);
        const body = [
            fillList('ul', 'hbars', 20, t.rows.map(r => el('li', { className: 'hbar' }, [
                el('span', { text: T('sr.drawNo', { n: r.round }) }),
                el('span', { className: 'hbar-track', 'aria-hidden': 'true' }, [
                    el('span', { className: 'hbar-fill', style: 'width:' + (t.max ? r.amount / t.max * 100 : 0) + '%;display:block' }),
                ]),
                el('span', { className: 'hbar-val', text: won(r.amount) + (r.winners ? ' · ' + T('dt.winners', { n: r.winners }) : '') }),
            ])), 'detail-prize-meta'),
        ];
        return card({
            id: 'detail-prize', title: T('dt.prize.t'), meta: T('dt.lastN', { n: 20 }),
            intro: intro(T('dt.prize.lead', { perWinner: won(Math.round(t.avgWinner)), perDraw: won(Math.round(t.avgAll)) })),
            body: body,
            note: note(T('dt.prize.note')),
        });
    }

    /* ───── 잠금 화면 ───── */

    const LOCKED = [
        { id: 'detail-runs', key: 'dt.runs' },
        { id: 'detail-partner', key: 'dt.partner' },
        { id: 'detail-report', key: 'dt.report' },
        { id: 'detail-prize', key: 'dt.prize' },
    ];

    // onOpen 이 있으면 이용권이 확인된 상태: 잠금 대신 "열기" 버튼을 보여 주고, 누르면 그때 연다
    function lockedCard(spec, href, onOpen) {
        const action = onOpen
            ? el('button', { type: 'button', className: 'btn', text: T('dt.openNow'), on: { click: onOpen } })
            : el('a', { className: 'btn btn-secondary', href: href || 'statistics.html', text: T('dt.openWithPass') });
        return el('section', { className: 'card locked-card' + (onOpen ? ' ready-card' : ''), id: spec.id, 'aria-labelledby': spec.id + '-t' }, [
            el('h3', { className: 'card-title', id: spec.id + '-t' }, [
                el('span', { text: T(spec.key + '.t') }),
                el('small', { className: 'lock-mark', text: T(onOpen ? 'dt.ready' : 'dt.locked') }),
            ]),
            intro(T(spec.key + '.desc'), true),
            el('div', { className: 'detail-main' }, [action]),
        ]);
    }

    /* ───── 높이 맞추기 ───── */

    // 한 줄에 놓인 카드는 높이가 같다. 성적표 결과처럼 옆 카드가 길어지면 목록을 그 높이까지 더 보여 준다
    // — 늘 보이는 min 개 말고는 남는 자리만 채우고, 카드를 더 늘리지는 않는다. 휴대폰(한 줄에 카드 하나)은 늘 min 개.
    let fitting = null;   // 지금 열어 둔 상세 분석 칸
    function fitAll() {
        const box = fitting;
        if (!box || !box.isConnected || !box.getClientRects().length) return;
        const lists = Array.prototype.slice.call(box.querySelectorAll('[data-min]'));
        lists.forEach(list => Array.prototype.forEach.call(list.children, (li, i) => { li.hidden = i >= Number(list.dataset.min); }));
        lists.forEach(list => {
            // 카드 위끝에서 잰다 — 화면 위쪽에서 줄을 늘리면 브라우저가 스크롤을 옮겨(scroll anchoring) 화면 좌표가 그대로라서
            const card = list.closest('.card');
            const below = () => list.getBoundingClientRect().bottom - card.getBoundingClientRect().top;
            const limit = list.closest('.detail-main').getBoundingClientRect().bottom - card.getBoundingClientRect().top;
            let shown = Number(list.dataset.min);
            for (; shown < list.children.length; shown++) {
                list.children[shown].hidden = false;
                if (below() > limit + 1) { list.children[shown].hidden = true; break; }
            }
            const meta = list.dataset.meta && document.getElementById(list.dataset.meta);
            if (meta) meta.textContent = T('dt.lastN', { n: Math.min(shown, list.children.length) });
        });
    }
    let fitQueued = false;
    function refit() {
        if (fitQueued || !fitting) return;
        fitQueued = true;
        requestAnimationFrame(() => { fitQueued = false; fitAll(); });
    }
    let lastWidth = 0;
    if (typeof window !== 'undefined' && window.addEventListener) {
        // 휴대폰은 스크롤할 때도 resize 가 온다(주소창) — 폭이 바뀐 때만
        window.addEventListener('resize', () => { if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; refit(); } });
    }

    function render(container, draws, opts) {
        opts = opts || {};
        container.textContent = '';
        fitting = null;
        if (opts.locked || opts.onOpen) {
            if (opts.onOpen) {
                container.appendChild(el('div', { className: 'detail-open-bar' }, [
                    el('p', { text: T('dt.readyLead') }),
                    el('button', { type: 'button', className: 'btn', text: T('dt.openAll'), on: { click: opts.onOpen } }),
                ]));
            }
            LOCKED.forEach(spec => container.appendChild(lockedCard(spec, opts.href, opts.onOpen)));
            return;
        }
        container.appendChild(consecutiveCard(draws));
        container.appendChild(partnerCard(draws));
        container.appendChild(reportCard(draws));
        container.appendChild(prizeCard(draws));
        fitting = container;
        lastWidth = window.innerWidth;
        refit();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
    }

    return {
        render: render,
        runsOf: runsOf,
        consecutiveRounds: consecutiveRounds,
        partners: partners,
        prizeTrend: prizeTrend,
        won: won,
    };
}));
