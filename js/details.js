// 상세 분석 카드 4종. 홈에서는 잠긴 채로 보이고, 이용권 키가 있으면 열린다.
// 5개월 통계 페이지에서는 결제한 사람만 들어오므로 처음부터 열어 둔다.
//
// 네 카드 모두 전 회차 기록을 쓴다. 기간을 자르면 "몇 회차 전에 나왔나" 같은 값이
// 잘려서 답이 달라진다.
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

    function card(o) {
        return el('section', { className: 'card' + (o.span ? ' span-2' : ''), id: o.id, 'aria-labelledby': o.id + '-t' }, [
            el('h3', { className: 'card-title', id: o.id + '-t' }, [
                el('span', { text: o.title }),
                o.meta ? el('small', { text: o.meta }) : null,
            ]),
            el('div', { className: 'card-body' }, o.body),
        ]);
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

    // 고른 6개가 과거 회차와 몇 개나 겹쳤는지
    function matchHistory(draws, picks) {
        const set = {};
        picks.forEach(n => { set[n] = true; });
        const dist = [0, 0, 0, 0, 0, 0, 0];
        let best = 0;
        let bestRows = [];
        draws.forEach(d => {
            let hit = 0;
            d.numbers.forEach(n => { if (set[n]) hit++; });
            dist[hit]++;
            if (hit > best) { best = hit; bestRows = [d]; }
            else if (hit === best && best > 0) bestRows.push(d);
        });
        bestRows = bestRows.slice().sort(byRoundDesc).slice(0, 5);
        return { picks: picks.slice().sort(asc), best: best, bestRows: bestRows, dist: dist, rounds: draws.length };
    }

    // 1등 당첨금 추이
    function prizeTrend(draws, count) {
        const rows = draws.slice().sort(byRoundDesc).slice(0, count || 20).map(d => ({
            round: d.round,
            date: d.date || null,
            amount: d.firstPrizeAmount || 0,
            winners: typeof d.firstPrizeWinners === 'number' ? d.firstPrizeWinners : null,
        }));
        const amounts = rows.map(r => r.amount).filter(a => a > 0);
        const all = draws.map(d => d.firstPrizeAmount || 0).filter(a => a > 0);
        return {
            rows: rows,
            max: amounts.length ? Math.max.apply(null, amounts) : 0,
            avgAll: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0,
        };
    }

    /* ───── 카드 ───── */

    function consecutiveCard(draws) {
        const data = consecutiveRounds(draws, 12);
        const body = [
            el('p', { className: 'detail-lead', text: T('dt.runs.lead', { of: fmt(data.of), n: fmt(data.total), pct: (data.total / data.of * 100).toFixed(1) }) }),
            el('ul', { className: 'run-list' }, data.rows.map(r => el('li', null, [
                el('span', { className: 'run-round', text: T('sr.drawNo', { n: r.round }) }),
                el('span', { className: 'run-groups' }, r.groups.map(g =>
                    el('span', { className: 'run-group' }, g.map(ball)))),
                el('span', { className: 'run-tail', text: T('dt.runs.inRow', { n: r.longest >= 3 ? r.longest : 2 }) }),
            ]))),
            el('p', { className: 'card-note', text: T('dt.runs.note') }),
        ];
        return card({ id: 'detail-runs', title: T('dt.runs.t'), meta: T('dt.allDraws'), body: body });
    }

    function partnerCard(draws) {
        const box = el('div', { className: 'partner-out' });
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
            const p = partners(draws, n, 10);
            box.textContent = '';
            box.appendChild(el('p', { className: 'detail-lead', text: T('dt.partner.lead', { n: n, c: fmt(p.appearances) }) }));
            box.appendChild(el('ol', { className: 'ball-list' }, p.top.map((row, i) => el('li', null, [
                el('span', { className: 'lead', text: T('sr.rank', { n: i + 1 }) }),
                ball(row.number),
                el('span', { className: 'tail', text: T('sr.times', { n: fmt(row.count) }) }),
            ]))));
            const recent = p.rounds.slice(0, 3);
            if (recent.length) {
                box.appendChild(el('p', { className: 'card-note', text: T('dt.partner.recent', { n: n,
                    list: recent.map(r => T('dt.roundWith', { r: r.round, nums: r.numbers.join('·') })).join(', ') }) }));
            }
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
        const body = [
            el('p', { className: 'picker-help', text: T('dt.partner.help') }),
            grid,
            box,
        ];
        const c = card({ id: 'detail-partner', title: T('dt.partner.t'), meta: T('dt.allDraws'), body: body });
        show(first);
        return c;
    }

    function matchCard(draws) {
        const input = el('input', {
            type: 'text', id: 'match-input', inputmode: 'numeric', autocomplete: 'off',
            maxlength: '30', placeholder: T('dt.match.ph'),
        });
        const out = el('div', { className: 'match-out' });
        const status = el('p', { className: 'license-status', id: 'match-status', role: 'status', 'aria-live': 'polite' });

        function run() {
            const picks = (input.value.match(/\d+/g) || []).map(Number);
            const uniq = picks.filter((v, i, a) => a.indexOf(v) === i);
            status.classList.remove('error');
            out.textContent = '';
            if (uniq.length !== 6 || uniq.some(n => n < 1 || n > 45)) {
                status.textContent = T('dt.match.err');
                status.classList.add('error');
                return;
            }
            status.textContent = '';
            const m = matchHistory(draws, uniq);
            out.appendChild(el('p', { className: 'detail-lead' }, [
                el('span', { className: 'strategy-nums' }, m.picks.map(ball)),
            ]));
            out.appendChild(el('p', { text: T('dt.match.lead', { n: fmt(m.rounds), best: m.best }) }));
            if (m.bestRows.length) {
                out.appendChild(el('ul', { className: 'ball-list' }, m.bestRows.map(d => el('li', null, [
                    el('span', { className: 'lead', text: T('sr.drawNo', { n: d.round }) }),
                    el('span', { className: 'strategy-nums' }, d.numbers.slice().sort(asc).map(ball)),
                ]))));
            }
            out.appendChild(el('ul', { className: 'hbars' }, [6, 5, 4, 3].map(h => el('li', { className: 'hbar' }, [
                el('span', { text: T('dt.match.hits', { n: h }) }),
                el('span', { className: 'hbar-track', 'aria-hidden': 'true' }, [
                    el('span', { className: 'hbar-fill', style: 'width:' + (m.dist[h] / Math.max(1, m.dist[3]) * 100) + '%;display:block' }),
                ]),
                el('span', { className: 'hbar-val', text: T('sr.times', { n: fmt(m.dist[h]) }) }),
            ]))));
            out.appendChild(el('p', { className: 'card-note', text: T('dt.match.note') }));
        }

        const body = [
            el('p', { className: 'picker-help', text: T('dt.match.help') }),
            el('div', { className: 'license-form' }, [
                input,
                el('button', { type: 'button', className: 'btn', text: T('dt.match.go'), on: { click: run } }),
            ]),
            status,
            out,
        ];
        return card({ id: 'detail-match', title: T('dt.match.t'), meta: T('dt.allDraws'), body: body });
    }

    function prizeCard(draws) {
        const t = prizeTrend(draws, 20);
        const body = [
            el('p', { className: 'detail-lead', text: T('dt.prize.lead', { amount: won(Math.round(t.avgAll)) }) }),
            el('ul', { className: 'hbars' }, t.rows.map(r => el('li', { className: 'hbar' }, [
                el('span', { text: T('sr.drawNo', { n: r.round }) }),
                el('span', { className: 'hbar-track', 'aria-hidden': 'true' }, [
                    el('span', { className: 'hbar-fill', style: 'width:' + (t.max ? r.amount / t.max * 100 : 0) + '%;display:block' }),
                ]),
                el('span', { className: 'hbar-val', text: won(r.amount) + (r.winners ? ' · ' + T('dt.winners', { n: r.winners }) : '') }),
            ]))),
            el('p', { className: 'card-note', text: T('dt.prize.note') }),
        ];
        return card({ id: 'detail-prize', title: T('dt.prize.t'), meta: T('dt.last20'), body: body });
    }

    /* ───── 잠금 화면 ───── */

    const LOCKED = [
        { id: 'detail-runs', key: 'dt.runs' },
        { id: 'detail-partner', key: 'dt.partner' },
        { id: 'detail-match', key: 'dt.match' },
        { id: 'detail-prize', key: 'dt.prize' },
    ];

    function lockedCard(spec, href) {
        return el('section', { className: 'card locked-card', id: spec.id, 'aria-labelledby': spec.id + '-t' }, [
            el('h3', { className: 'card-title', id: spec.id + '-t' }, [
                el('span', { text: T(spec.key + '.t') }),
                el('small', { className: 'lock-mark', text: T('dt.locked') }),
            ]),
            el('div', { className: 'card-body' }, [
                el('p', { text: T(spec.key + '.desc') }),
                el('a', { className: 'btn btn-secondary', href: href || 'statistics.html', text: T('dt.openWithPass') }),
            ]),
        ]);
    }

    function render(container, draws, opts) {
        opts = opts || {};
        container.textContent = '';
        if (opts.locked) {
            LOCKED.forEach(spec => container.appendChild(lockedCard(spec, opts.href)));
            return;
        }
        container.appendChild(consecutiveCard(draws));
        container.appendChild(partnerCard(draws));
        container.appendChild(matchCard(draws));
        container.appendChild(prizeCard(draws));
    }

    return {
        render: render,
        runsOf: runsOf,
        consecutiveRounds: consecutiveRounds,
        partners: partners,
        matchHistory: matchHistory,
        prizeTrend: prizeTrend,
        won: won,
    };
}));
