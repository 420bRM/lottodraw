// LottoStats.compute() 결과를 리본 카드 9장(+최근 회차 카드)으로 그린다.
// 홈(전 회차)과 30일 통계 페이지가 같이 쓴다. 데이터는 textContent 로만 넣는다.
(function (root) {
    'use strict';

    const fmt = n => Number(n).toLocaleString('ko-KR');

    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(k => {
                if (k === 'text') node.textContent = attrs[k];
                else if (k === 'className') node.className = attrs[k];
                else if (k === 'dataset') Object.keys(attrs[k]).forEach(d => { node.dataset[d] = attrs[k][d]; });
                else if (k === 'style') Object.keys(attrs[k]).forEach(s => { node.style[s] = attrs[k][s]; });
                else node.setAttribute(k, attrs[k]);
            });
        }
        (children || []).forEach(c => { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return node;
    }

    const ball = (n, band) => el('span', { className: 'mball', dataset: { band: band }, text: String(n) });

    function card(o) {
        const title = el('h3', { className: 'card-title', id: o.id + '-t' }, [
            el('span', { text: o.title }),
            o.meta ? el('small', { text: o.meta }) : null,
        ]);
        const body = el('div', { className: 'card-body' + (o.tint ? ' bg-' + o.tint : '') }, o.body);
        return el('section', {
            className: 'card' + (o.span ? ' span-2' : ''),
            id: o.id,
            'aria-labelledby': o.id + '-t',
        }, [title, body]);
    }

    // rounds 가 적으면(30일 = 4~5회) 퍼센트가 오히려 오해를 부른다 — 횟수만 쓴다
    function valueText(count, total) {
        if (total < 20) return fmt(count) + '회';
        return fmt(count) + ' (' + (count / total * 100).toFixed(1) + '%)';
    }

    function hbars(rows, total) {
        const max = Math.max(1, Math.max.apply(null, rows.map(r => r.count)));
        return el('ul', { className: 'hbars' }, rows.map(r => el('li', { className: 'hbar' }, [
            el('span', { text: r.label }),
            el('span', { className: 'hbar-track', 'aria-hidden': 'true' }, [
                el('span', { className: 'hbar-fill', style: { width: (r.count / max * 100) + '%', display: 'block' } }),
            ]),
            el('span', { className: 'hbar-val', text: valueText(r.count, total) }),
        ])));
    }

    function extremes(rows, unit) {
        const counts = rows.map(r => r.count);
        const max = Math.max.apply(null, counts);
        const min = Math.min.apply(null, counts);
        const pick = v => rows.filter(r => r.count === v).map(r => r.number);
        const list = arr => arr.length > 4
            ? `${arr.slice(0, 4).join('·')}번 외 ${arr.length - 4}개`
            : `${arr.join('·')}번`;
        return el('p', { className: 'extremes' }, [
            el('strong', { text: `최다 ${fmt(max)}${unit}: ` }), `${list(pick(max))}   `,
            el('strong', { text: `최소 ${fmt(min)}${unit}: ` }), list(pick(min)),
        ]);
    }

    function vbars(rows, label) {
        // 막대는 0부터 그린다. 차이가 작아 보이면 실제로 거의 균등하다는 뜻이고,
        // 축을 잘라 차이를 부풀리면 "잘 나오는 번호"가 있는 것처럼 보인다.
        const max = Math.max(1, Math.max.apply(null, rows.map(r => r.count)));
        const chart = el('div', { className: 'vbars', role: 'img', 'aria-label': label }, rows.map(r =>
            el('span', {
                className: 'vbar',
                dataset: { band: r.band },
                title: `${r.number}번: ${fmt(r.count)}회`,
                style: { height: (r.count / max * 100) + '%' },
            })));
        const axis = el('div', { className: 'vaxis', 'aria-hidden': 'true' }, rows.map(r =>
            el('span', { text: (r.number === 1 || r.number % 5 === 0) ? String(r.number) : '' })));
        return [chart, axis];
    }

    function trendGroup(title, rows) {
        return el('div', { className: 'trend-group' }, [
            el('h4', { text: title }),
            el('div', { className: 'trend-balls' }, rows.map(r => el('figure', null, [
                ball(r.number, r.band),
                el('figcaption', { text: fmt(r.recent) + '회' }),
            ]))),
        ]);
    }

    function render(container, stats, opts) {
        opts = opts || {};
        const total = stats.rounds;
        const scope = opts.scopeLabel || `${fmt(total)}회`;
        const cards = [];

        cards.push(card({
            id: 'stat-frequency', span: true, tint: 'sky',
            title: '1. 번호별 출현 횟수', meta: scope,
            body: vbars(stats.frequency, '1부터 45까지 번호별 출현 횟수 막대그래프')
                .concat([extremes(stats.frequency, '회'),
                    el('p', { className: 'card-note', text: '막대 높이 차이가 작다면 실제로 거의 고르게 나왔다는 뜻입니다.' })]),
        }));

        const trendTitle = opts.trendTitle || `8. 최근 ${stats.trend.window}회 많이·적게 나온 번호`;
        cards.push(card({
            id: 'stat-trend', tint: 'peach',
            title: trendTitle,
            body: [trendGroup('많이 나온 번호', stats.trend.hot), trendGroup('적게 나온 번호', stats.trend.cold)],
        }));

        cards.push(card({
            id: 'stat-bonus', span: true, tint: 'periwinkle',
            title: '2. 보너스 번호 출현 횟수', meta: scope,
            body: vbars(stats.bonus, '보너스 번호별 출현 횟수 막대그래프').concat([extremes(stats.bonus, '회')]),
        }));

        cards.push(card({
            id: 'stat-pair', tint: 'lime',
            title: '9. 함께 나온 번호 쌍 Top 10',
            body: [el('ol', { className: 'ball-list' }, stats.pairs.map((p, i) => el('li', null, [
                el('span', { className: 'lead', text: (i + 1) + '위' }),
                ball(p.a, LottoStats.bandOf(p.a)), ball(p.b, LottoStats.bandOf(p.b)),
                el('span', { className: 'tail', text: fmt(p.count) + '회' }),
            ])))],
        }));

        cards.push(card({ id: 'stat-even-odd', tint: 'sage', title: '3. 홀짝 비율', meta: scope, body: [hbars(stats.oddEven, total)] }));
        cards.push(card({ id: 'stat-low-high', tint: 'salmon', title: '4. 저고 비율', meta: '저 1~22 · 고 23~45', body: [hbars(stats.lowHigh, total)] }));
        cards.push(card({ id: 'stat-consecutive', tint: 'steel', title: '5. 연속번호', meta: '가장 긴 연속 기준', body: [hbars(stats.consecutive, total)] }));
        cards.push(card({ id: 'stat-sum', tint: 'lime', title: '6. 번호 합계 분포', meta: scope, body: [hbars(stats.sum, total)] }));
        cards.push(card({ id: 'stat-prize', tint: 'sky', title: '7. 1등 당첨자 수', meta: '이월 = 1등 없음', body: [hbars(stats.winners, total)] }));

        if (opts.latestDraws && opts.latestDraws.length) {
            cards.push(card({
                id: 'stat-latest', tint: 'sage',
                title: opts.latestTitle || `최근 ${opts.latestDraws.length}회 당첨번호`,
                body: [el('ol', { className: 'ball-list' }, opts.latestDraws.map(d => el('li', null, [
                    el('span', { className: 'lead', text: d.round + '회' }),
                ].concat(d.numbers.map(n => ball(n, LottoStats.bandOf(n)))).concat([
                    el('span', { className: 'plus', 'aria-label': '보너스', text: '+' }),
                    ball(d.bonus, LottoStats.bandOf(d.bonus)),
                ]))))],
            }));
        }

        container.textContent = '';
        cards.forEach(c => container.appendChild(c));
    }

    root.LottoStatsView = { render: render, el: el, ball: ball, fmt: fmt };
}(this));
