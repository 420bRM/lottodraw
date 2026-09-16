// LottoStats.compute() 결과를 카드로 그린다. 카드는 제목 번호 순서대로 DOM 에 넣는다 —
// 보이는 순서와 번호가 어긋나면 읽는 사람이 뭘 놓쳤나 되짚게 된다.
// 홈(전 회차)과 10회차 통계 페이지가 같이 쓴다. 데이터는 textContent 로만 넣는다.
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

    // rounds 가 적으면(10회차) 퍼센트가 오히려 오해를 부른다 — 횟수만 쓴다
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

    // 번호별 막대. 막대는 0부터 그린다 — 축을 자르면 "잘 나오는 번호"가 있는 것처럼 보인다.
    //
    // 많은순으로 바꿀 때 막대를 지웠다 다시 그리면 화면이 뚝 끊긴다. 같은 막대를 그대로 두고
    // 새 자리로 옮긴다 — 어떤 막대가 어디로 갔는지 눈으로 따라갈 수 있어야 정렬이 정보가 된다.
    function chartWithToggle(rows, label) {
        const max = Math.max(1, Math.max.apply(null, rows.map(r => r.count)));
        const bars = rows.map(r => el('span', {
            className: 'vbar',
            dataset: { band: r.band },
            title: `${r.number}번: ${fmt(r.count)}회`,
            style: { height: (r.count / max * 100) + '%' },
        }));
        const tags = rows.map(() => el('span'));
        const chart = el('div', { className: 'vbars', role: 'img', 'aria-label': label }, bars);
        const axis = el('div', { className: 'vaxis', 'aria-hidden': 'true' }, tags);
        const btn = el('button', { type: 'button', className: 'btn btn-secondary btn-small', text: '많은순으로 보기' });
        let sorted = false;

        const canMeasure = typeof bars[0].getBoundingClientRect === 'function';
        const reduceMotion = () => typeof matchMedia === 'function'
            && matchMedia('(prefers-reduced-motion: reduce)').matches;

        function place(animate) {
            const order = rows.map((r, i) => i);
            if (sorted) order.sort((a, b) => rows[b].count - rows[a].count || rows[a].number - rows[b].number);
            const slot = [];
            order.forEach((idx, at) => { slot[idx] = at + 1; });

            const movers = bars.concat(tags);
            const from = animate && canMeasure ? movers.map(m => m.getBoundingClientRect().left) : null;
            rows.forEach((r, i) => {
                // 행까지 고정해야 한다. 열만 지정하면 앞 칸으로 되돌아가는 순간 브라우저가
                // 줄을 새로 만들어 막대가 계단처럼 흩어진다.
                bars[i].style.gridColumnStart = String(slot[i]);
                bars[i].style.gridRowStart = "1";
                tags[i].style.gridColumnStart = String(slot[i]);
                tags[i].style.gridRowStart = "1";
                tags[i].textContent = sorted || r.number === 1 || r.number % 5 === 0 ? String(r.number) : '';
            });
            axis.className = 'vaxis' + (sorted ? ' vaxis-all' : '');
            chart.setAttribute('aria-label', label + (sorted ? ' (많은순)' : ''));
            if (!from) return;

            // FLIP: 옮긴 뒤 원래 자리로 되돌려 놓고, 그 되돌림을 풀며 미끄러지게 한다
            const to = movers.map(m => m.getBoundingClientRect().left);
            movers.forEach((m, i) => {
                const dx = from[i] - to[i];
                if (!dx) return;
                m.style.transition = 'none';
                m.style.transform = 'translateX(' + dx + 'px)';
            });
            void chart.offsetWidth;   // 되돌린 자리를 브라우저에 한 번 반영시킨다
            movers.forEach(m => {
                m.style.transition = 'transform .5s cubic-bezier(.2, .7, .3, 1)';
                m.style.transform = '';
            });
        }

        btn.addEventListener('click', () => {
            sorted = !sorted;
            btn.textContent = sorted ? '번호순으로 보기' : '많은순으로 보기';
            place(!reduceMotion());
        });
        place(false);
        return [el('div', { className: 'chart-tools' }, [btn]), chart, axis];
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

    // 미출현 회차: 공 + "N회차 전". 0 은 바로 지난 회차에 나왔다는 뜻이다.
    function gapList(rows) {
        return el('ol', { className: 'ball-list' }, rows.map((r, i) => el('li', null, [
            el('span', { className: 'lead', text: (i + 1) + '위' }),
            ball(r.number, r.band),
            el('span', { className: 'tail', text: r.gap === 0 ? '지난 회차' : fmt(r.gap) + '회차 전' }),
        ])));
    }

    // AC 는 0~10 이지만 5 이하가 거의 안 나와 줄만 길어진다 — 5 이하를 한 줄로 묶는다.
    function acRows(rows) {
        const low = rows.slice(0, 6).reduce((sum, r) => sum + r.count, 0);
        return [{ label: 'AC 5 이하', count: low }].concat(
            rows.slice(6).map((r, i) => ({ label: 'AC ' + (i + 6), count: r.count })));
    }

    // 끝자리는 후보 번호 개수가 달라(1~5 는 5개, 0·6~9 는 4개) 총 횟수를 그대로 그리면
    // 1~5 가 잘 나오는 것처럼 보인다. 번호 1개당 평균으로 그린다.
    function tailBars(rows) {
        const max = Math.max.apply(null, rows.map(r => r.per));
        return el('ul', { className: 'hbars' }, rows.map(r => el('li', { className: 'hbar' }, [
            el('span', { text: r.label }),
            el('span', { className: 'hbar-track', 'aria-hidden': 'true' }, [
                el('span', { className: 'hbar-fill', style: { width: (r.per / max * 100) + '%', display: 'block' } }),
            ]),
            el('span', { className: 'hbar-val', text: '평균 ' + r.per.toFixed(1) + '회' }),
        ])));
    }

    function render(container, stats, opts) {
        opts = opts || {};
        const total = stats.rounds;
        const scope = opts.scopeLabel || `${fmt(total)}회`;
        const specs = [];

        specs.push({
            id: 'stat-frequency', span: true, tint: 'sky',
            title: '번호별 출현 횟수', meta: scope,
            body: chartWithToggle(stats.frequency, '1부터 45까지 번호별 출현 횟수 막대그래프')
                .concat([extremes(stats.frequency, '회'),
                    el('p', { className: 'card-note', text: '막대 높이 차이가 작다면 실제로 거의 고르게 나왔다는 뜻입니다.' })]),
        });

        specs.push({
            id: 'stat-bonus', span: true, tint: 'periwinkle',
            title: '보너스 번호 출현 횟수', meta: scope,
            body: chartWithToggle(stats.bonus, '보너스 번호별 출현 횟수 막대그래프').concat([extremes(stats.bonus, '회')]),
        });

        specs.push({ id: 'stat-even-odd', tint: 'sage', title: '홀짝 비율', meta: scope, body: [hbars(stats.oddEven, total)] });
        specs.push({ id: 'stat-low-high', tint: 'salmon', title: '저고 비율', meta: '저 1~22 · 고 23~45', body: [hbars(stats.lowHigh, total)] });
        specs.push({ id: 'stat-consecutive', tint: 'steel', title: '연속번호', meta: '가장 긴 연속 기준', body: [hbars(stats.consecutive, total)] });
        specs.push({ id: 'stat-sum', tint: 'lime', title: '번호 합계 분포', meta: scope, body: [hbars(stats.sum, total)] });
        specs.push({ id: 'stat-prize', tint: 'sky', title: '1등 당첨자 수', meta: '이월 = 1등 없음', body: [hbars(stats.winners, total)] });

        specs.push({
            id: 'stat-trend', tint: 'peach',
            title: opts.trendTitle || `최근 ${stats.trend.window}회 많이·적게 나온 번호`,
            body: [trendGroup('많이 나온 번호', stats.trend.hot), trendGroup('적게 나온 번호', stats.trend.cold)],
        });

        specs.push({
            id: 'stat-pair', tint: 'lime',
            title: '함께 나온 번호 쌍 Top 10',
            body: [el('ol', { className: 'ball-list' }, stats.pairs.map((p, i) => el('li', null, [
                el('span', { className: 'lead', text: (i + 1) + '위' }),
                ball(p.a, LottoStats.bandOf(p.a)), ball(p.b, LottoStats.bandOf(p.b)),
                el('span', { className: 'tail', text: fmt(p.count) + '회' }),
            ])))],
        });

        // 표본이 적으면 대부분의 번호가 "한 번도 안 나옴"으로 묶여 순위가 무의미해진다.
        if (stats.gaps && total >= 50) {
            specs.push({
                id: 'stat-gap', tint: 'salmon',
                title: '오래 안 나온 번호 Top 10', meta: '마지막 출현 기준',
                body: [gapList(stats.gaps.slice(0, 10)),
                    el('p', { className: 'card-note', text: '오래 쉬었다고 다음에 나올 확률이 올라가지는 않습니다.' })],
            });
        }

        if (stats.ac) {
            specs.push({
                id: 'stat-ac', tint: 'steel',
                title: 'AC값 분포', meta: '높을수록 흩어진 조합',
                body: [hbars(acRows(stats.ac), total),
                    el('p', { className: 'card-note', text: '번호 6개를 두 개씩 뺀 차이 15개 중 서로 다른 값의 개수 − 5 입니다.' })],
            });
        }

        if (stats.tail) {
            specs.push({
                id: 'stat-tail', tint: 'sage',
                title: '끝자리 분포', meta: '번호 1개당 평균',
                body: [tailBars(stats.tail),
                    el('p', { className: 'card-note', text: '끝자리 0·6~9 는 해당 번호가 4개뿐이라 총 횟수 대신 번호당 평균으로 그렸습니다.' })],
            });
        }

        if (opts.latestDraws && opts.latestDraws.length) {
            specs.push({
                id: 'stat-latest', span: true, tint: 'sage', numbered: false,
                title: opts.latestTitle || `최근 ${opts.latestDraws.length}회 당첨번호`,
                body: [el('ol', { className: 'ball-list' }, opts.latestDraws.map(d => el('li', null, [
                    el('span', { className: 'lead', text: d.round + '회' }),
                ].concat(d.numbers.map(n => ball(n, LottoStats.bandOf(n)))).concat([
                    el('span', { className: 'plus', 'aria-label': '보너스', text: '+' }),
                    ball(d.bonus, LottoStats.bandOf(d.bonus)),
                ]))))],
            });
        }

        // 번호는 여기서 매긴다. 표본이 적어 빠지는 카드가 있어도(10번) 1,2,3… 이 이어진다.
        let no = 0;
        container.textContent = '';
        specs.forEach(spec => {
            if (spec.numbered !== false) spec.title = (++no) + '. ' + spec.title;
            container.appendChild(card(spec));
        });
    }

    root.LottoStatsView = { render: render, el: el, ball: ball, fmt: fmt };
}(this));
