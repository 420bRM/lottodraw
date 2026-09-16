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
    const fmt = n => Number(n).toLocaleString('ko-KR');
    const bandOf = n => n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5;
    const byRoundDesc = (a, b) => b.round - a.round;

    // 1,628,391,980 → "16억 2,839만"
    function won(amount) {
        if (!amount) return '자료 없음';
        const eok = Math.floor(amount / 1e8);
        const man = Math.floor((amount % 1e8) / 1e4);
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
            el('p', { className: 'detail-lead', text: `전 회차 ${fmt(data.of)}회 중 ${fmt(data.total)}회에서 연속한 번호가 나왔습니다 (${(data.total / data.of * 100).toFixed(1)}%).` }),
            el('ul', { className: 'run-list' }, data.rows.map(r => el('li', null, [
                el('span', { className: 'run-round', text: r.round + '회' }),
                el('span', { className: 'run-groups' }, r.groups.map(g =>
                    el('span', { className: 'run-group' }, g.map(ball)))),
                el('span', { className: 'run-tail', text: r.longest >= 3 ? r.longest + '연속' : '2연속' }),
            ]))),
            el('p', { className: 'card-note', text: '가장 최근 12회차만 보여줍니다. 연속 묶음이 두 개인 회차는 묶음을 나눠 표시합니다.' }),
        ];
        return card({ id: 'detail-runs', title: '연속번호가 나온 회차', meta: '전 회차', body: body });
    }

    function partnerCard(draws) {
        const box = el('div', { className: 'partner-out' });
        const grid = el('div', { className: 'number-grid partner-grid', role: 'group', 'aria-label': '번호 선택' });
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
            box.appendChild(el('p', { className: 'detail-lead', text: `${n}번은 전 회차에서 ${fmt(p.appearances)}회 나왔습니다. 그때 함께 나온 번호입니다.` }));
            box.appendChild(el('ol', { className: 'ball-list' }, p.top.map((row, i) => el('li', null, [
                el('span', { className: 'lead', text: (i + 1) + '위' }),
                ball(row.number),
                el('span', { className: 'tail', text: fmt(row.count) + '회' }),
            ]))));
            const recent = p.rounds.slice(0, 3);
            if (recent.length) {
                box.appendChild(el('p', { className: 'card-note', text: '최근 ' + n + '번이 나온 회차: '
                    + recent.map(r => r.round + '회(' + r.numbers.join('·') + ')').join(', ') }));
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
            el('p', { className: 'picker-help', text: '번호를 누르면 그 번호와 같이 나온 번호를 보여줍니다.' }),
            grid,
            box,
        ];
        const c = card({ id: 'detail-partner', title: '번호별 동반 출현', meta: '전 회차', body: body });
        show(first);
        return c;
    }

    function matchCard(draws) {
        const input = el('input', {
            type: 'text', id: 'match-input', inputmode: 'numeric', autocomplete: 'off',
            maxlength: '30', placeholder: '예: 7 13 16 23 24 43',
        });
        const out = el('div', { className: 'match-out' });
        const status = el('p', { className: 'license-status', id: 'match-status', role: 'status', 'aria-live': 'polite' });

        function run() {
            const picks = (input.value.match(/\d+/g) || []).map(Number);
            const uniq = picks.filter((v, i, a) => a.indexOf(v) === i);
            status.classList.remove('error');
            out.textContent = '';
            if (uniq.length !== 6 || uniq.some(n => n < 1 || n > 45)) {
                status.textContent = '1~45 사이의 서로 다른 번호 6개를 넣어 주세요.';
                status.classList.add('error');
                return;
            }
            status.textContent = '';
            const m = matchHistory(draws, uniq);
            out.appendChild(el('p', { className: 'detail-lead' }, [
                el('span', { className: 'strategy-nums' }, m.picks.map(ball)),
            ]));
            out.appendChild(el('p', { text: `전 회차 ${fmt(m.rounds)}회와 맞춰 본 결과, 가장 많이 겹친 건 ${m.best}개입니다.` }));
            if (m.bestRows.length) {
                out.appendChild(el('ul', { className: 'ball-list' }, m.bestRows.map(d => el('li', null, [
                    el('span', { className: 'lead', text: d.round + '회' }),
                    el('span', { className: 'strategy-nums' }, d.numbers.slice().sort(asc).map(ball)),
                ]))));
            }
            out.appendChild(el('ul', { className: 'hbars' }, [6, 5, 4, 3].map(h => el('li', { className: 'hbar' }, [
                el('span', { text: h + '개 일치' }),
                el('span', { className: 'hbar-track', 'aria-hidden': 'true' }, [
                    el('span', { className: 'hbar-fill', style: 'width:' + (m.dist[h] / Math.max(1, m.dist[3]) * 100) + '%;display:block' }),
                ]),
                el('span', { className: 'hbar-val', text: fmt(m.dist[h]) + '회' }),
            ]))));
            out.appendChild(el('p', { className: 'card-note', text: '1등(6개)이 0회인 건 당연합니다. 같은 조합이 두 번 나온 적은 없습니다.' }));
        }

        const body = [
            el('p', { className: 'picker-help', text: '번호 6개를 넣으면 지난 회차와 맞춰 봅니다. 생성기에서 뽑은 번호를 그대로 넣어 보세요.' }),
            el('div', { className: 'license-form' }, [
                input,
                el('button', { type: 'button', className: 'btn', text: '대조하기', on: { click: run } }),
            ]),
            status,
            out,
        ];
        return card({ id: 'detail-match', title: '내 번호 과거 대조', meta: '전 회차', body: body });
    }

    function prizeCard(draws) {
        const t = prizeTrend(draws, 20);
        const body = [
            el('p', { className: 'detail-lead', text: `전 회차 1등 평균 당첨금은 ${won(Math.round(t.avgAll))}입니다. 아래는 최근 20회차입니다.` }),
            el('ul', { className: 'hbars' }, t.rows.map(r => el('li', { className: 'hbar' }, [
                el('span', { text: r.round + '회' }),
                el('span', { className: 'hbar-track', 'aria-hidden': 'true' }, [
                    el('span', { className: 'hbar-fill', style: 'width:' + (t.max ? r.amount / t.max * 100 : 0) + '%;display:block' }),
                ]),
                el('span', { className: 'hbar-val', text: won(r.amount) + (r.winners ? ` · ${r.winners}명` : '') }),
            ]))),
            el('p', { className: 'card-note', text: '당첨자가 많으면 1인당 금액이 줄어듭니다. 금액이 낮은 회차는 대개 당첨자가 많았던 회차입니다.' }),
        ];
        return card({ id: 'detail-prize', title: '1등 당첨금 추이', meta: '최근 20회차', body: body });
    }

    /* ───── 잠금 화면 ───── */

    const LOCKED = [
        { id: 'detail-runs', title: '연속번호가 나온 회차', desc: '어느 회차에서 어떤 번호가 이어졌는지 회차별로 봅니다.' },
        { id: 'detail-partner', title: '번호별 동반 출현', desc: '번호를 누르면 그 번호와 같이 나온 번호를 순위로 봅니다.' },
        { id: 'detail-match', title: '내 번호 과거 대조', desc: '번호 6개를 지난 전 회차와 맞춰 최고 몇 개까지 겹쳤는지 봅니다.' },
        { id: 'detail-prize', title: '1등 당첨금 추이', desc: '회차별 1등 당첨금과 당첨자 수를 함께 봅니다.' },
    ];

    function lockedCard(spec, href) {
        return el('section', { className: 'card locked-card', id: spec.id, 'aria-labelledby': spec.id + '-t' }, [
            el('h3', { className: 'card-title', id: spec.id + '-t' }, [
                el('span', { text: spec.title }),
                el('small', { className: 'lock-mark', text: '잠김' }),
            ]),
            el('div', { className: 'card-body' }, [
                el('p', { text: spec.desc }),
                el('a', { className: 'btn btn-secondary', href: href || 'statistics.html', text: '이용권으로 열기' }),
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
