// TOP 50 당첨금 페이지 맨 위의 회차별 그래프. 가로는 회차, 세로는 고른 지표.
//
// 그래프(지표 고르기, 물가 반영, 짚어서 값 보기, 표로 보기)는 무료이고 늘 전체 기간을 보인다.
// 구간 설정(최근 N회·확대·축소·끌어 확대·작은 그래프로 옮기기), 보조지표(평균선·이동평균·로그 눈금),
// 그림도구(수평선·추세선)는 이용권이 있을 때만 켜진다. 이 잠금도 license.js 와 같은 편의 잠금이다.
//
// 처음 열면 늘 "전체 기간 · 총 1등 당첨금"이다. 고른 지표·기간은 기억하지 않는다(보조지표만 기억한다).
//
// 로그인하지 않은 사람에게는 그래프를 흐리게 보이고 로그인을 권한다(setGated). 누구를 가릴지는 페이지가 정한다.
//
// "물가 반영"을 켜면 금액 지표를 지금 돈 가치로 바꿔 그린다: 금액 × 물가지수(기준 달) ÷ 물가지수(그 회차 달).
// 물가지수는 cpi-data.json(tools/update-cpi.js 가 매달 받는다). 파일이 없으면 단추를 숨긴다.
//
// 지표는 METRICS 에 한 줄씩 늘린다. 판매액이나 2~5등이 lotto-data.json 에 들어오면 여기에 더하면 된다.
// 세로축은 늘 하나다 — 단위가 다른 두 지표를 한 그림에 겹치지 않는다(겹치면 없는 상관이 보인다).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PrizeChart = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const g = typeof window !== 'undefined' ? window : globalThis;
    const lang = () => (g.I18N ? g.I18N.lang : 'ko');
    const T = (k, v) => (g.I18N ? (v ? g.I18N.f(k, v) : g.I18N.t(k)) : k);
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const VIEW_STORE = 'lottodraw.chart.view';
    const DRAW_STORE = 'lottodraw.chart.draw';

    // 이월(1등 0명) 회차는 1인당·총액이 없다. 0으로 그리면 "그 회차는 0원"으로 읽히므로 빈칸으로 둔다.
    const paid = d => d.firstPrizeWinners > 0 && d.firstPrizeAmount > 0;
    const METRICS = [      // 맨 앞이 처음 보이는 지표
        { id: 'total', key: 'pc.m.total', unit: 'won', value: d => (paid(d) ? d.firstPrizeAmount * d.firstPrizeWinners : null) },
        { id: 'winners', key: 'pc.m.winners', unit: 'people', value: d => (typeof d.firstPrizeWinners === 'number' ? d.firstPrizeWinners : null) },
        { id: 'each', key: 'pc.m.each', unit: 'won', value: d => (paid(d) ? d.firstPrizeAmount : null) },
    ];
    const RANGES = [50, 100, 300, 0];      // 0 = 전체
    const MA = [20, 60, 120, 240];
    const INDICATORS = ['avg'].concat(MA.map(n => 'ma' + n), ['log']);
    const MIN_VIEW = 10;                   // 확대해도 이보다 좁게는 안 본다 (회차 수)

    // 점이 촘촘할수록 선을 가늘게: 전체 기간(1,200여 회)을 한 화면에 넣으면 2px 선은 뭉개진다.
    // 1px 에 점이 몇 개 들어가는지로 정한다.
    function lineWidth(points, px) {
        const per = points / Math.max(1, px);
        return per <= 0.15 ? 2 : per <= 0.4 ? 1.5 : per <= 0.8 ? 1.2 : per <= 1.6 ? 1 : 0.8;
    }

    // 보는 구간 [s, e] 를 전체 len 안에 맞춘다. 폭은 MIN_VIEW 이상, 전체 이하.
    function clampView(len, s, e) {
        let w = Math.round(e - s + 1);
        w = Math.max(Math.min(MIN_VIEW, len), Math.min(len, w));
        s = Math.round(Math.min(Math.max(0, s), len - w));
        return { s: s, e: s + w - 1 };
    }

    // factor 0.5 = 두 배 확대, 2 = 두 배 축소. center 칸이 화면에서 같은 자리에 머문다.
    function zoomView(len, view, factor, center) {
        const w = view.e - view.s + 1;
        const nw = Math.max(Math.min(MIN_VIEW, len), Math.min(len, Math.round(w * factor)));
        const c = center == null ? (view.s + view.e) / 2 : center;
        const ratio = w > 1 ? (c - view.s) / (w - 1) : 0.5;
        return clampView(len, c - ratio * (nw - 1), c - ratio * (nw - 1) + nw - 1);
    }

    /* ───── 계산 (브라우저 없이도 돈다: tools/test-prize-chart.js) ───── */

    // 그 회차 금액을 기준 달(cpi.latest) 돈 가치로 바꾸는 배수. 그 달 지수가 아직 없으면(최근 회차) 1배.
    function realFactor(cpi, date) {
        if (!cpi || !cpi.monthly || !cpi.latest || !date) return null;
        const base = cpi.monthly[cpi.latest];
        const k = String(date).slice(0, 7);
        const v = k > cpi.latest ? base : cpi.monthly[k];
        return base > 0 && v > 0 ? base / v : null;
    }

    // 창 안의 빈 값(이월)은 빼고 평균한다. 창이 다 차기 전 회차는 null.
    function movingAverage(values, n) {
        const out = new Array(values.length).fill(null);
        let sum = 0;
        let cnt = 0;
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (v != null) { sum += v; cnt++; }
            if (i >= n) {
                const old = values[i - n];
                if (old != null) { sum -= old; cnt--; }
            }
            if (i >= n - 1 && cnt > 0) out[i] = sum / cnt;
        }
        return out;
    }

    // 눈금 간격: 1·2·2.5·5 × 10^k. 사람 수처럼 정수만 되는 값은 2.5 를 건너뛰고 1 아래로 내려가지 않는다.
    function niceStep(span, count, integer) {
        const raw = span / Math.max(1, count);
        const p = Math.pow(10, Math.floor(Math.log10(raw)));
        const m = raw / p;
        const steps = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
        const step = steps.find(s => m <= s) * p;
        return integer ? Math.max(1, Math.round(step)) : step;
    }

    function linearTicks(max, count, integer) {
        if (!(max > 0)) return { min: 0, max: integer ? 1 : 1, ticks: [0, 1] };
        const step = niceStep(max, count, integer);
        const top = Math.ceil(max / step - 1e-9) * step;
        const ticks = [];
        for (let k = 0; k * step <= top + step / 2; k++) ticks.push(+(k * step).toPrecision(12));
        return { min: 0, max: top, ticks: ticks };
    }

    // 로그 눈금: 1·2·5 × 10^k 로 위아래를 잡고, 눈금이 많으면 10^k 만 남긴다.
    function logTicks(min, max) {
        const seq = [];
        for (let k = Math.floor(Math.log10(min)) - 1; k <= Math.ceil(Math.log10(max)) + 1; k++) {
            [1, 2, 5].forEach(m => seq.push(+(m * Math.pow(10, k)).toPrecision(12)));
        }
        let lo = seq[0];
        seq.forEach(v => { if (v <= min) lo = v; });
        const hi = seq.find(v => v > lo && v >= max) || seq[seq.length - 1];   // 값이 하나뿐이어도 위아래가 같아지지 않게
        const ticks = seq.filter(v => v >= lo && v <= hi);
        if (ticks.length <= 7) return { min: lo, max: hi, ticks: ticks };
        // 너무 촘촘하면 10배 눈금만 쓰고, 위아래도 10배 자리로 넓힌다
        const a = Math.floor(Math.log10(min));
        const b = Math.ceil(Math.log10(max));
        const pow = [];
        for (let k = a; k <= b; k++) pow.push(+Math.pow(10, k).toPrecision(12));
        return { min: pow[0], max: pow[pow.length - 1], ticks: pow };
    }

    // 보이는 구간 요약: 평균, 최고, 최저(같으면 최근 회차), 이월 수
    function summarize(draws, values, start, end) {
        let sum = 0;
        let cnt = 0;
        let hi = null;
        let lo = null;
        let roll = 0;
        for (let i = start; i <= end; i++) {
            if (draws[i].firstPrizeWinners === 0) roll++;
            const v = values[i];
            if (v == null) continue;
            sum += v;
            cnt++;
            if (hi === null || v >= values[hi]) hi = i;
            if (lo === null || v <= values[lo]) lo = i;
        }
        return { avg: cnt ? sum / cnt : null, hi: hi, lo: lo, rollovers: roll, count: end - start + 1 };
    }

    /* ───── 글자 ───── */

    const fmtInt = n => Number(n).toLocaleString(lang() === 'en' ? 'en-US' : 'ko-KR');
    const fmtDec = n => Number(n).toLocaleString(lang() === 'en' ? 'en-US' : 'ko-KR', { maximumFractionDigits: 1 });

    // 1,604,686,625 → "16억 469만 원" / "1.60 bn KRW"
    function wonLong(v) {
        if (lang() === 'en') return v >= 1e9 ? (v / 1e9).toFixed(2) + ' bn KRW' : Math.round(v / 1e6) + 'm KRW';
        const eok = Math.floor(v / 1e8);
        const man = Math.floor((v % 1e8) / 1e4);
        if (!eok) return fmtInt(man) + '만 원';
        return fmtInt(eok) + '억' + (man ? ' ' + fmtInt(man) + '만' : '') + ' 원';
    }

    // 눈금용: 0 / 5,000만 / 2.5억 / 300억 · 0 / 500m / 2.5bn
    function wonShort(v) {
        if (v === 0) return '0';
        if (lang() === 'en') {
            if (v >= 1e9) return fmtDec(v / 1e9) + 'bn';
            if (v >= 1e6) return fmtDec(v / 1e6) + 'm';
            return fmtInt(v);
        }
        if (v >= 1e8) return fmtDec(v / 1e8) + '억';
        if (v >= 1e4) return fmtDec(v / 1e4) + '만';
        return fmtInt(v);
    }

    function fmtValue(metric, v, short) {
        if (v == null) return T('pc.rollover');
        if (metric.unit === 'won') return short ? wonShort(v) : wonLong(v);
        const n = short ? fmtDec(v) : (Number.isInteger(v) ? fmtInt(v) : fmtDec(v));
        return short ? n : n + T('pc.unitPeople');
    }

    /* ───── 화면 ───── */

    const store = {
        get(k) { try { return JSON.parse(g.localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
        set(k, v) { try { g.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 프라이빗 모드 */ } },
    };

    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(k => {
            if (k === 'text') node.textContent = attrs[k];
            else if (k === 'className') node.className = attrs[k];
            else if (k === 'on') Object.keys(attrs[k]).forEach(ev => node.addEventListener(ev, attrs[k][ev]));
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(c => { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return node;
    }

    const bandOf = n => (n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5);
    const ball = n => el('span', { className: 'mball', 'data-band': String(bandOf(n)), text: String(n) });

    function svg(tag, attrs, text) {
        const node = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach(k => node.setAttribute(k, attrs[k]));
        if (text != null) node.textContent = text;
        return node;
    }

    function mount(root, draws, opts) {
        const cpi = opts && opts.cpi && opts.cpi.monthly && opts.cpi.latest ? opts.cpi : null;
        const all = draws.slice().sort((a, b) => a.round - b.round);
        const first = all[0].round;
        const indexOf = r => r - first;      // 회차는 1부터 빠짐없이 이어진다 (update-lotto-data.js 가 검사)
        const byId = id => METRICS.find(m => m.id === id) || METRICS[0];

        const cache = {};
        // real: 금액을 지금 돈 가치로 (금액 지표만)
        function seriesOf(metric, real) {
            real = !!(real && cpi && metric.unit === 'won');
            const key = metric.id + (real ? ':real' : '');
            if (!cache[key]) {
                const vals = all.map(d => {
                    const v = metric.value(d);
                    if (v == null || !real) return v;
                    const f = realFactor(cpi, d.date);
                    return f ? v * f : v;
                });
                const ma = {};
                MA.forEach(n => { ma[n] = movingAverage(vals, n); });
                cache[key] = { vals: vals, ma: ma, real: real };
            }
            return cache[key];
        }
        // "2026년 8월" / "Aug 2026"
        const ymLabel = k => {
            const [y, m] = String(k).split('-').map(Number);
            return lang() === 'en' ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : `${y}년 ${m}월`;
        };
        const realAs = () => T('pc.real.as', { ym: ymLabel(cpi.latest) });

        const saved = store.get(VIEW_STORE) || {};
        const len = all.length;
        const state = {
            metric: METRICS[0].id,
            view: { s: 0, e: len - 1 },   // 보는 구간 (전체 배열의 칸 번호)
            ind: Object.fromEntries(INDICATORS.map(k => [k, false])),
            savedInd: saved.ind || {},
            unlocked: false,
            gated: false,        // 로그인 전: 그래프를 흐리게
            real: false,         // 물가 반영
            tool: null,          // 'h' | 't'
            pending: null,       // 추세선 첫 점 { r, v }
            hover: null,         // 전체 배열의 칸 번호
        };
        let drawings = store.get(DRAW_STORE) || {};
        let S = null;            // 마지막으로 그린 눈금·크기

        const saveView = () => store.set(VIEW_STORE, { ind: state.unlocked ? state.ind : state.savedInd });
        const presetView = n => (n ? clampView(len, len - n, len - 1) : { s: 0, e: len - 1 });
        const isPreset = n => { const v = presetView(n); return v.s === state.view.s && v.e === state.view.e; };
        // 끌기 중에는 한 화면에 한 번만 다시 그린다
        let frame = 0;
        let dragging = false;
        function setView(v, now) {
            state.view = clampView(len, v.s, v.e);
            if (now) { render(); return; }
            if (!frame) frame = g.requestAnimationFrame(() => { frame = 0; render(); });
        }

        /* 조작 줄 */
        function segGroup(aria, items, isOn, onPick) {
            const box = el('div', { className: 'pchart-seg', role: 'group', 'aria-label': aria });
            items.forEach(it => {
                box.appendChild(el('button', { type: 'button', 'data-v': String(it.v), 'aria-pressed': 'false', text: it.label,
                    on: { click: () => onPick(it.v) } }));
            });
            box.paint = () => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(isOn(b.dataset.v))));
            return box;
        }
        const metricSeg = segGroup(T('pc.metricAria'), METRICS.map(m => ({ v: m.id, label: T(m.key) })),
            v => v === state.metric, v => { state.metric = v; state.pending = null; render(); });
        const realBtn = el('button', { type: 'button', 'aria-pressed': 'false', text: T('pc.real'), on: { click: () => {
            if (byId(state.metric).unit !== 'won') return;
            state.real = !state.real;
            state.pending = null;
            render();
        } } });
        const realSeg = el('div', { className: 'pchart-seg pchart-real', role: 'group', 'aria-label': T('pc.real') }, [realBtn]);
        if (!cpi) realSeg.hidden = true;
        const cpiNote = el('p', { className: 'pchart-cpi-note', hidden: '' });
        // 출처 한 줄 (늘 보인다). 물가지수 출처 이름·링크는 cpi-data.json 이 정한다 — 받은 곳이 바뀌면 같이 바뀐다
        const cpiCredit = () => {
            if (!cpi) return '';
            if (cpi.credit && cpi.credit[lang()]) return cpi.credit[lang()];
            if (cpi.credit && cpi.credit.ko) return cpi.credit.ko;
            return /OECD/.test(cpi.source || '') ? 'OECD' : (cpi.source || '');
        };
        const safeLink = u => (/^https:\/\/[^\s"'<>]+$/.test(u || '') ? u : null);
        const sourceLine = el('p', { className: 'pchart-source' }, [T('pc.src.lotto')].concat(cpi ? [
            T('pc.src.cpi'),
            safeLink(cpi.link || cpi.sourceUrl) ? el('a', { href: safeLink(cpi.link || cpi.sourceUrl), target: '_blank', rel: 'noopener', text: cpiCredit() }) : cpiCredit(),
            T('pc.src.cpiTail', { ym: ymLabel(cpi.latest) }),
        ] : []));

        const chip = (label, on) => el('button', { type: 'button', className: 'pchart-chip', 'aria-pressed': 'false', text: label, on: { click: on } });
        const indChips = { avg: chip(T('pc.i.avg'), () => toggleInd('avg')) };
        MA.forEach(n => { indChips['ma' + n] = chip(T('pc.i.maChip', { n: n }), () => toggleInd('ma' + n)); });
        indChips.log = chip(T('pc.i.log'), () => toggleInd('log'));
        const toolChips = {
            h: chip(T('pc.d.h'), () => pickTool('h')),
            t: chip(T('pc.d.t'), () => pickTool('t')),
            undo: chip(T('pc.d.undo'), () => undo()),
            clear: chip(T('pc.d.clear'), () => clearDrawings()),
        };
        toolChips.undo.removeAttribute('aria-pressed');
        toolChips.clear.removeAttribute('aria-pressed');
        // 구간 설정(이용권): 최근 N회·전체, 확대·축소. 잠겨 있으면 늘 전체 기간이다
        const rangeChips = RANGES.map(n => {
            const c = chip(n ? T('pc.r.n', { n: n }) : T('pc.r.all'), () => pickRange(n));
            c.dataset.v = String(n);
            return c;
        });
        const zoomIn = chip('＋ ' + T('pc.zoomIn'), () => zoomBy(0.5));
        const zoomOut = chip('－ ' + T('pc.zoomOut'), () => zoomBy(2));
        zoomIn.removeAttribute('aria-pressed');
        zoomOut.removeAttribute('aria-pressed');

        const badge = el('span', { className: 'lock-mark', text: T('pc.pro.badge') });
        const proNote = el('p', { className: 'pchart-pro-note' }, [
            T('pc.pro.note') + ' ',
            el('a', { href: 'statistics.html', text: T('pc.pro.see') }),
        ]);
        const pro = el('div', { className: 'pchart-pro is-locked' }, [
            el('div', { className: 'pchart-pro-group', role: 'group', 'aria-label': T('pc.pro.range') }, [
                el('span', { className: 'pchart-pro-label', text: T('pc.pro.range') }),
            ].concat(rangeChips, [zoomIn, zoomOut])),
            el('div', { className: 'pchart-pro-group', role: 'group', 'aria-label': T('pc.pro.ind') }, [
                el('span', { className: 'pchart-pro-label', text: T('pc.pro.ind') }),
            ].concat(INDICATORS.map(k => indChips[k]))),
            el('div', { className: 'pchart-pro-group', role: 'group', 'aria-label': T('pc.pro.draw') }, [
                el('span', { className: 'pchart-pro-label', text: T('pc.pro.draw') }),
                toolChips.h, toolChips.t, toolChips.undo, toolChips.clear,
            ]),
            badge,
            proNote,
        ]);

        const legend = el('div', { className: 'pchart-legend', hidden: '' });
        const hint = el('p', { className: 'pchart-hint', role: 'status', 'aria-live': 'polite' });
        const svgRoot = svg('svg', { 'aria-hidden': 'true', focusable: 'false' });
        const tip = el('div', { className: 'pchart-tip', hidden: '' });
        // 좁은 화면(휴대폰)에서는 떠 있는 툴팁이 그래프를 가리므로, 그래프 위 고정된 정보 줄에 짧게 보인다.
        // 높이를 미리 잡아 두어 눌러도 그래프가 밀리지 않는다
        const readout = el('div', { className: 'pchart-readout', 'aria-hidden': 'true' });
        const plot = el('div', { className: 'pchart-plot', role: 'group', tabindex: '0' }, [svgRoot, tip]);
        // 아래 작은 그래프: 전체 기간 위에 지금 보는 구간을 표시한다. 끌어서 옮기고, 양 끝을 끌어 넓히거나 좁힌다
        const navSvg = svg('svg', { 'aria-hidden': 'true', focusable: 'false' });
        const nav = el('div', { className: 'pchart-nav', role: 'group', tabindex: '0', 'aria-label': T('pc.navAria'), 'aria-describedby': 'pchart-summary' }, [navSvg]);
        // 로그인 전에 그래프 위에 얹는 안내
        const gate = el('div', { className: 'pchart-gate', hidden: '' }, [
            el('p', { className: 'pchart-gate-title', text: T('pc.gate.title') }),
            el('p', { className: 'pchart-gate-sub', text: T('pc.gate.sub') }),
            el('button', { type: 'button', className: 'btn', text: T('pc.gate.btn'), on: { click: () => {
                if (g.LottoAccount && g.LottoAccount.openLogin) g.LottoAccount.openLogin(T('pc.gate.reason'));
            } } }),
        ]);
        const stage = el('div', { className: 'pchart-stage' }, [legend, readout, plot, nav, gate]);
        const summary = el('p', { className: 'pchart-summary', id: 'pchart-summary' });
        const live = el('p', { className: 'sr-only', 'aria-live': 'polite' });
        const tableBody = el('tbody');
        const tableHead = el('thead');
        const table = el('details', { className: 'pchart-table' }, [
            el('summary', { text: T('pc.table') }),
            el('div', { className: 'table-scroll' }, [
                el('table', { className: 'data-table' }, [
                    tableHead,
                    tableBody,
                ]),
            ]),
        ]);
        table.addEventListener('toggle', () => { if (table.open) fillTable(); });
        plot.setAttribute('aria-describedby', 'pchart-summary');

        root.textContent = '';
        root.classList.add('pchart-body');
        [el('div', { className: 'pchart-controls' }, [metricSeg, realSeg]), pro, stage, hint, summary, cpiNote, live, table,
            el('p', { className: 'pchart-note', text: T('pc.note') }), sourceLine].forEach(n => root.appendChild(n));

        /* 보조지표 · 그림도구 */
        function flashNote() {
            proNote.classList.remove('is-flash');
            void proNote.offsetWidth;
            proNote.classList.add('is-flash');
        }
        function pickRange(n) {
            if (!state.unlocked) return flashNote();
            setView(presetView(n), true);
        }
        function zoomBy(factor) {
            if (!state.unlocked) return flashNote();
            setView(zoomView(len, state.view, factor, state.hover), true);
        }
        function toggleInd(k) {
            if (!state.unlocked) return flashNote();
            if (k === 'log' && byId(state.metric).unit !== 'won') return;
            state.ind[k] = !state.ind[k];
            saveView();
            render();
        }
        function pickTool(k) {
            if (!state.unlocked) return flashNote();
            state.tool = state.tool === k ? null : k;
            state.pending = null;
            render();
        }
        const myDrawings = () => (drawings[state.metric] = drawings[state.metric] || []);
        function saveDrawings() { store.set(DRAW_STORE, drawings); }
        function undo() {
            if (!state.unlocked) return flashNote();
            if (state.pending) state.pending = null;
            else myDrawings().pop();
            saveDrawings();
            render();
        }
        function clearDrawings() {
            if (!state.unlocked) return flashNote();
            drawings[state.metric] = [];
            state.pending = null;
            saveDrawings();
            render();
        }

        function paintControls() {
            metricSeg.paint();
            const w = state.view.e - state.view.s + 1;
            const lockIf = (c, off) => { if (off) c.setAttribute('aria-disabled', 'true'); else c.removeAttribute('aria-disabled'); };
            rangeChips.forEach(c => { c.setAttribute('aria-pressed', String(state.unlocked && isPreset(Number(c.dataset.v)))); lockIf(c, !state.unlocked); });
            lockIf(zoomIn, !state.unlocked || w <= Math.min(MIN_VIEW, len));
            lockIf(zoomOut, !state.unlocked || w >= len);
            nav.hidden = !state.unlocked;     // 작은 그래프(구간 옮기기)도 이용권 기능
            const wonMetric = byId(state.metric).unit === 'won';
            realBtn.setAttribute('aria-pressed', String(!!(state.real && wonMetric)));
            realBtn.disabled = !wonMetric;
            realBtn.title = !cpi ? '' : wonMetric ? T('pc.realTitle', { ym: ymLabel(cpi.latest) }) : T('pc.realNo');
            const isWon = byId(state.metric).unit === 'won';
            pro.classList.toggle('is-locked', !state.unlocked);
            badge.textContent = state.unlocked ? T('pc.pro.badgeOn') : T('pc.pro.badge');
            badge.classList.toggle('is-on', state.unlocked);
            proNote.hidden = state.unlocked;
            INDICATORS.forEach(k => {
                const c = indChips[k];
                const off = !state.unlocked || (k === 'log' && !isWon);
                c.setAttribute('aria-pressed', String(state.unlocked && !!state.ind[k] && !(k === 'log' && !isWon)));
                if (off) c.setAttribute('aria-disabled', 'true'); else c.removeAttribute('aria-disabled');
                if (k === 'log') c.title = isWon ? '' : T('pc.i.logNo');
            });
            ['h', 't'].forEach(k => toolChips[k].setAttribute('aria-pressed', String(state.tool === k)));
            ['h', 't', 'undo', 'clear'].forEach(k => {
                if (state.unlocked) toolChips[k].removeAttribute('aria-disabled'); else toolChips[k].setAttribute('aria-disabled', 'true');
            });
            plot.classList.toggle('is-drawing', !!state.tool);
            root.classList.toggle('is-gated', state.gated);
            gate.hidden = !state.gated;
            table.hidden = state.gated;
            [legend, readout, plot, nav, summary].forEach(n => { if (state.gated) n.setAttribute('aria-hidden', 'true'); else n.removeAttribute('aria-hidden'); });
            plot.tabIndex = state.gated ? -1 : 0;
            nav.tabIndex = state.gated ? -1 : 0;
            hint.textContent = state.tool === 'h' ? T('pc.d.hintH') : state.tool === 't' ? (state.pending ? T('pc.d.hintT2') : T('pc.d.hintT1')) : '';
        }

        /* 그리기 */
        function measure(text) {
            if (!measure.ctx) {
                measure.ctx = document.createElement('canvas').getContext('2d');
                measure.ctx.font = '11px ' + (getComputedStyle(plot).fontFamily || 'sans-serif');
            }
            return measure.ctx ? measure.ctx.measureText(text).width : text.length * 7;
        }

        function render() {
            const metric = byId(state.metric);
            const realOn = !!(state.real && cpi && metric.unit === 'won');
            const ser = seriesOf(metric, realOn);
            const nominal = realOn ? seriesOf(metric, false) : null;   // 비교용: 당시 금액
            const start = state.view.s;
            const end = state.view.e;
            const useLog = state.unlocked && state.ind.log && metric.unit === 'won';
            const mas = state.unlocked ? MA.filter(n => state.ind['ma' + n]) : [];
            const sum = summarize(all, ser.vals, start, end);
            if (state.hover !== null && (state.hover < start || state.hover > end)) state.hover = null;

            // 세로 범위: 보이는 값과 켜 둔 이동평균
            let vmax = 0;
            let vmin = Infinity;
            const scan = arr => { for (let i = start; i <= end; i++) { const v = arr[i]; if (v != null && v > 0) { if (v > vmax) vmax = v; if (v < vmin) vmin = v; } } };
            scan(ser.vals);
            if (nominal) scan(nominal.vals);
            mas.forEach(n => scan(ser.ma[n]));
            const W = Math.max(280, Math.round(plot.clientWidth || 600));
            const H = W < 600 ? 240 : 320;
            const yt = useLog && vmin < Infinity ? logTicks(vmin, vmax) : linearTicks(vmax, H < 300 ? 4 : 5, metric.unit === 'people');
            const pts = end - start + 1;
            const tickText = yt.ticks.map(v => fmtValue(metric, v, true));
            const endLabels = mas.map(n => ({ n: n, text: T('pc.i.maShort', { n: n }) }));
            const M = {
                top: 12,
                right: 12 + (endLabels.length ? Math.max.apply(null, endLabels.map(l => measure(l.text))) + 10 : 0),
                bottom: 26,
                left: Math.ceil(Math.max.apply(null, tickText.map(measure))) + 12,
            };
            const pw = W - M.left - M.right;
            const ph = H - M.top - M.bottom;
            const span = Math.max(1, end - start);
            const x = i => M.left + (i - start) / span * pw;
            const y = useLog
                ? v => M.top + ph - (Math.log(v) - Math.log(yt.min)) / (Math.log(yt.max) - Math.log(yt.min)) * ph
                : v => M.top + ph - (v - yt.min) / (yt.max - yt.min) * ph;
            const yInv = useLog
                ? py => Math.exp(Math.log(yt.min) + (M.top + ph - py) / ph * (Math.log(yt.max) - Math.log(yt.min)))
                : py => yt.min + (M.top + ph - py) / ph * (yt.max - yt.min);
            const ok = v => v != null && (!useLog || v > 0);
            S = { metric: metric, ser: ser, nominal: nominal, realOn: realOn, start: start, end: end, x: x, y: y, yInv: yInv, M: M, pw: pw, ph: ph, W: W, H: H, mas: mas, ok: ok, useLog: useLog };

            svgRoot.textContent = '';
            svgRoot.setAttribute('viewBox', `0 0 ${W} ${H}`);
            svgRoot.setAttribute('width', W);
            svgRoot.setAttribute('height', H);
            const clipId = 'pchart-clip';
            const defs = svg('defs');
            const clip = svg('clipPath', { id: clipId });
            clip.appendChild(svg('rect', { x: M.left, y: M.top - 4, width: pw, height: ph + 8 }));
            defs.appendChild(clip);
            svgRoot.appendChild(defs);

            // 눈금
            const grid = svg('g', { class: 'pc-axis' });
            yt.ticks.forEach((v, k) => {
                const yy = Math.round(y(v)) + 0.5;
                grid.appendChild(svg('line', { class: k === 0 && !useLog ? 'pc-base' : 'pc-grid', x1: M.left, x2: M.left + pw, y1: yy, y2: yy }));
                grid.appendChild(svg('text', { class: 'pc-tick', x: M.left - 8, y: yy + 4, 'text-anchor': 'end' }, tickText[k]));
            });
            const xStep = niceStep(span, Math.max(2, Math.floor(pw / 90)), true);
            const firstTick = Math.ceil(all[start].round / xStep) * xStep;
            for (let r = firstTick; r <= all[end].round; r += xStep) {
                const xx = x(indexOf(r));
                const label = T('pc.xTick', { n: r });
                const w = measure(label);
                const anchor = xx - w / 2 < 0 ? 'start' : xx + w / 2 > W ? 'end' : 'middle';
                grid.appendChild(svg('line', { class: 'pc-xtick', x1: xx, x2: xx, y1: M.top + ph, y2: M.top + ph + 4 }));
                grid.appendChild(svg('text', { class: 'pc-tick', x: xx, y: H - 6, 'text-anchor': anchor }, label));
            }
            svgRoot.appendChild(grid);

            // 본 지표: 옅은 면 + 2px 선. 이월 칸에서 끊는다.
            const data = svg('g', { 'clip-path': `url(#${clipId})` });
            const base = M.top + ph;
            let line = '';
            let area = '';
            let seg = [];
            const flush = () => {
                if (seg.length) area += `M${seg[0][0]} ${base}L` + seg.map(p => p.join(' ')).join('L') + `L${seg[seg.length - 1][0]} ${base}Z`;
                seg = [];
            };
            for (let i = start; i <= end; i++) {
                const v = ser.vals[i];
                if (!ok(v)) { flush(); continue; }
                const p = [x(i).toFixed(1), y(v).toFixed(1)];
                line += (seg.length ? 'L' : 'M') + p.join(' ');
                seg.push(p);
            }
            flush();
            const lw = lineWidth(pts, pw);
            data.appendChild(svg('path', { class: 'pc-area', d: area }));
            if (nominal) {
                let nd = '';
                let pen = false;
                for (let i = start; i <= end; i++) {
                    const v = nominal.vals[i];
                    if (!ok(v)) { pen = false; continue; }
                    nd += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
                    pen = true;
                }
                data.appendChild(svg('path', { class: 'pc-nominal', d: nd, style: `stroke-width:${Math.min(1, lw)}px` }));
            }
            data.appendChild(svg('path', { class: 'pc-line', d: line, style: `stroke-width:${lw}px` }));

            // 보조지표
            mas.forEach(n => {
                let d = '';
                let pen = false;
                for (let i = start; i <= end; i++) {
                    const v = ser.ma[n][i];
                    if (!ok(v)) { pen = false; continue; }
                    d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
                    pen = true;
                }
                data.appendChild(svg('path', { class: 'pc-ma pc-ma' + n, d: d, style: `stroke-width:${Math.min(1.25, lw)}px` }));
            });
            if (state.unlocked && state.ind.avg && sum.avg != null && ok(sum.avg)) {
                const yy = Math.round(y(sum.avg)) + 0.5;
                data.appendChild(svg('line', { class: 'pc-avg', x1: M.left, x2: M.left + pw, y1: yy, y2: yy }));
            }

            // 그림도구로 그린 선
            if (state.unlocked) {
                myDrawings().forEach(dw => {
                    if (dw.t === 'h' && ok(dw.v)) {
                        const yy = y(dw.v);
                        data.appendChild(svg('line', { class: 'pc-draw', x1: M.left, x2: M.left + pw, y1: yy, y2: yy }));
                    } else if (dw.t === 't' && ok(dw.v1) && ok(dw.v2)) {
                        const a = [x(indexOf(dw.r1)), y(dw.v1)];
                        const b = [x(indexOf(dw.r2)), y(dw.v2)];
                        data.appendChild(svg('line', { class: 'pc-draw', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
                        [a, b].forEach(p => data.appendChild(svg('circle', { class: 'pc-draw-end', cx: p[0], cy: p[1], r: 3 })));
                    }
                });
            }
            svgRoot.appendChild(data);

            // 이월 표시 (금액 지표에서 선이 끊긴 자리)
            const rolls = [];
            if (metric.unit === 'won') {
                for (let i = start; i <= end; i++) if (all[i].firstPrizeWinners === 0) rolls.push(i);
                const rg = svg('g');
                rolls.forEach(i => rg.appendChild(svg('circle', { class: 'pc-roll', cx: x(i), cy: base, r: 4 })));
                svgRoot.appendChild(rg);
            }

            // 글자는 선 위에 (흰 테두리로 선과 겹쳐도 읽히게)
            const labels = svg('g', { class: 'pc-labels' });
            if (state.unlocked && state.ind.avg && sum.avg != null && ok(sum.avg)) {
                labels.appendChild(svg('text', { class: 'pc-label', x: M.left + pw - 4, y: y(sum.avg) - 5, 'text-anchor': 'end' },
                    T('pc.avgLabel', { v: fmtValue(metric, sum.avg, true) })));
            }
            if (state.unlocked) {
                myDrawings().forEach(dw => {
                    if (dw.t === 'h' && ok(dw.v)) labels.appendChild(svg('text', { class: 'pc-label', x: M.left + 4, y: y(dw.v) - 5 }, fmtValue(metric, dw.v, true)));
                });
            }
            // 이동평균 끝 이름표: 겹치면 아래 것을 조금 내린다
            const ends = endLabels.map(l => {
                const arr = ser.ma[l.n];
                let i = end;
                while (i >= start && !ok(arr[i])) i--;
                return i >= start ? { text: l.text, y: y(arr[i]) } : null;
            }).filter(Boolean).sort((a, b) => a.y - b.y);
            for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
            // 아래로 밀려 그래프 밖으로 나가면 위로 되민다
            for (let k = ends.length - 1; k >= 0; k--) {
                const limit = k === ends.length - 1 ? M.top + ph : ends[k + 1].y - 13;
                if (ends[k].y > limit) ends[k].y = limit;
            }
            ends.forEach(l => labels.appendChild(svg('text', { class: 'pc-tick', x: M.left + pw + 8, y: l.y + 4 }, l.text)));
            // 끝 점
            for (let i = end; i >= start; i--) {
                if (ok(ser.vals[i])) { labels.appendChild(svg('circle', { class: 'pc-dot', cx: x(i), cy: y(ser.vals[i]), r: 4 })); break; }
            }
            svgRoot.appendChild(labels);

            S.hoverLayer = svg('g', { class: 'pc-hover' });
            svgRoot.appendChild(S.hoverLayer);

            // 범례: 선이 둘 이상이거나 이월 표시가 있을 때만
            legend.textContent = '';
            const items = [];
            if (mas.length || rolls.length || realOn || (state.unlocked && state.ind.avg)) items.push(['pc-key-main', T(metric.key) + (realOn ? ' (' + realAs() + ')' : '')]);
            if (realOn) items.push(['pc-key-nominal', T('pc.real.nominal')]);
            mas.forEach(n => items.push(['pc-key-ma' + n, T('pc.i.ma', { n: n })]));
            if (state.unlocked && state.ind.avg) items.push(['pc-key-avg', T('pc.i.avg')]);
            if (rolls.length) items.push(['pc-key-roll', T('pc.legend.roll')]);
            items.forEach(it => legend.appendChild(el('span', null, [el('i', { className: 'pchart-key ' + it[0], 'aria-hidden': 'true' }), it[1]])));
            legend.hidden = !items.length;

            // 요약 한 줄 (그래프 아래 글자 — 짚지 않아도 읽힌다)
            const from = all[start].round;
            const to = all[end].round;
            const preset = RANGES.find(isPreset);
            const scopeLabel = preset === undefined ? T('pc.r.custom') : preset ? T('pc.r.n', { n: preset }) : T('pc.r.all');
            const parts = [T('pc.sum.scope', { label: scopeLabel, from: from, to: to }) + ' ' + T(metric.key) + (realOn ? ' (' + realAs() + ')' : '')];
            if (sum.avg != null) parts.push(T('pc.sum.avg', { v: fmtValue(metric, metric.unit === 'won' ? Math.round(sum.avg) : sum.avg) }));
            if (sum.hi != null) parts.push(T('pc.sum.max', { r: all[sum.hi].round, v: fmtValue(metric, ser.vals[sum.hi]) }));
            if (sum.lo != null) parts.push(T('pc.sum.min', { r: all[sum.lo].round, v: fmtValue(metric, ser.vals[sum.lo]) }));
            if (sum.rollovers) parts.push(T('pc.sum.roll', { n: sum.rollovers }));
            summary.textContent = parts.join(' · ');
            plot.setAttribute('aria-label', T('pc.plotAria', { metric: T(metric.key) }));

            cpiNote.hidden = !realOn;
            if (realOn) cpiNote.textContent = T('pc.real.note', { ym: ymLabel(cpi.latest) });
            renderNav(metric, ser, useLog);
            paintControls();
            drawHover(null);
            if (table.open && !dragging) fillTable();
        }

        /* 아래 작은 그래프 (전체 기간) */
        let N = null;
        function renderNav(metric, ser) {
            const W = Math.max(280, Math.round(nav.clientWidth || plot.clientWidth || 600));
            const H = 40;
            const L = S.M.left;
            const R = S.M.right;
            const pw = W - L - R;
            let vmax = 0;
            ser.vals.forEach(v => { if (v != null && v > vmax) vmax = v; });
            const x = i => L + i / Math.max(1, len - 1) * pw;
            const y = v => 4 + (H - 8) - (vmax ? v / vmax : 0) * (H - 8);
            N = { W: W, H: H, L: L, pw: pw, x: x };

            navSvg.textContent = '';
            navSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
            navSvg.setAttribute('width', W);
            navSvg.setAttribute('height', H);
            let d = '';
            let pen = false;
            for (let i = 0; i < len; i++) {
                const v = ser.vals[i];
                if (v == null) { pen = false; continue; }
                d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
                pen = true;
            }
            navSvg.appendChild(svg('rect', { class: 'pn-bg', x: L, y: 0, width: pw, height: H, rx: 4 }));
            navSvg.appendChild(svg('path', { class: 'pn-line', d: d }));
            const xs = x(state.view.s);
            const xe = x(state.view.e);
            navSvg.appendChild(svg('rect', { class: 'pn-shade', x: L, y: 0, width: Math.max(0, xs - L), height: H }));
            navSvg.appendChild(svg('rect', { class: 'pn-shade', x: xe, y: 0, width: Math.max(0, L + pw - xe), height: H }));
            navSvg.appendChild(svg('rect', { class: 'pn-win', x: xs, y: 0.5, width: Math.max(1, xe - xs), height: H - 1 }));
            [xs, xe].forEach(xx => navSvg.appendChild(svg('rect', { class: 'pn-handle', x: xx - 4, y: H / 2 - 10, width: 8, height: 20, rx: 2 })));
        }

        /* 짚은 회차 */
        function drawHover(pointer) {
            if (!S) return;
            const layer = S.hoverLayer;
            layer.textContent = '';
            const { x, y, M, ph, ser, metric, ok } = S;

            // 추세선을 긋는 중이면 첫 점에서 손가락까지 미리 보여 준다
            if (state.unlocked && state.tool === 't' && state.pending && pointer && ok(state.pending.v)) {
                layer.appendChild(svg('line', { class: 'pc-draw pc-draw-pending', x1: x(indexOf(state.pending.r)), y1: y(state.pending.v), x2: pointer.x, y2: pointer.y }));
            }
            const compact = S.W < 600;
            root.classList.toggle('is-compact', compact);
            if (state.hover === null) {
                tip.hidden = true;
                if (compact) { readout.textContent = ''; readout.appendChild(el('p', { className: 'pr-idle', text: T('pc.readoutIdle') })); }
                return;
            }

            const i = state.hover;
            const xx = Math.round(x(i)) + 0.5;
            layer.appendChild(svg('line', { class: 'pc-cross', x1: xx, x2: xx, y1: M.top, y2: M.top + ph }));
            S.mas.forEach(n => { const v = ser.ma[n][i]; if (ok(v)) layer.appendChild(svg('circle', { class: 'pc-dot pc-dot-ma' + n, cx: x(i), cy: y(v), r: 4 })); });
            if (ok(ser.vals[i])) layer.appendChild(svg('circle', { class: 'pc-dot', cx: x(i), cy: y(ser.vals[i]), r: 5 }));

            const d = all[i];
            if (compact) { fillReadout(i); tip.hidden = true; return; }
            tip.textContent = '';
            tip.appendChild(el('p', { className: 'pchart-tip-head' }, [el('b', { text: T('pc.drawNo', { n: d.round }) }), ' ' + (d.date || '')]));
            if (d.numbers && d.numbers.length) {
                tip.appendChild(el('p', { className: 'pchart-tip-balls', 'aria-label': T('pc.numbersAria', { nums: d.numbers.join(', '), bonus: d.bonus }) },
                    d.numbers.map(ball).concat([el('span', { className: 'plus', text: '+' }), ball(d.bonus)])));
            }
            const row = (keyClass, value, label) => tip.appendChild(el('p', { className: 'pchart-tip-row' }, [
                keyClass ? el('i', { className: 'pchart-key ' + keyClass, 'aria-hidden': 'true' }) : el('i', { className: 'pchart-key pc-key-none', 'aria-hidden': 'true' }),
                el('b', { text: value }), el('span', { text: label }),
            ]));
            // 물가 반영 중이면: 지금 돈 가치 / 당시 금액 / 물가가 몇 배 올랐나 (툴팁이 넓어지지 않게 이름표는 짧게)
            row('pc-key-main', fmtValue(metric, ser.vals[i]), S.realOn ? realAs() : T(metric.key));
            if (S.realOn) {
                row('pc-key-nominal', fmtValue(metric, S.nominal.vals[i]), T('pc.real.nominal'));
                const f = realFactor(cpi, d.date);
                if (f) row(null, '×' + f.toFixed(2), T('pc.real.factor'));
            }
            S.mas.forEach(n => { const v = ser.ma[n][i]; row('pc-key-ma' + n, v == null ? '—' : fmtValue(metric, metric.unit === 'won' ? Math.round(v) : v), T('pc.i.ma', { n: n })); });
            METRICS.filter(m => m.id !== metric.id).forEach(m => row(null, fmtValue(m, seriesOf(m).vals[i]), T(m.key)));

            tip.hidden = false;
            const tw = tip.offsetWidth;
            let left = x(i) + 14;
            if (left + tw > S.W) left = x(i) - 14 - tw;
            if (left < 0) left = Math.max(0, Math.min(S.W - tw, x(i) - tw / 2));
            tip.style.left = left + 'px';
            tip.style.top = M.top + 'px';
        }

        // 휴대폰 정보 줄: 1줄 회차·날짜·번호, 그 아래 값들을 이어서 (본 지표만 긴 금액, 나머지는 짧게)
        function fillReadout(i) {
            const { ser, metric } = S;
            const d = all[i];
            readout.textContent = '';
            readout.appendChild(el('p', { className: 'pr-head' }, [
                el('b', { text: T('pc.drawNo', { n: d.round }) }),
                el('span', { className: 'pr-date', text: d.date || '' }),
                d.numbers && d.numbers.length ? el('span', { className: 'pr-balls' }, d.numbers.map(ball).concat([el('span', { className: 'plus', text: '+' }), ball(d.bonus)])) : null,
            ]));
            const vals = el('p', { className: 'pr-vals' });
            const item = (keyClass, value, label) => vals.appendChild(el('span', { className: 'pr-item' }, [
                keyClass ? el('i', { className: 'pchart-key ' + keyClass, 'aria-hidden': 'true' }) : null,
                el('b', { text: value }), ' ' + label,
            ]));
            item('pc-key-main', fmtValue(metric, ser.vals[i]), S.realOn ? realAs() : T(metric.key));
            if (S.realOn) {
                item('pc-key-nominal', fmtValue(metric, S.nominal.vals[i], true), T('pc.real.nominal'));
                const f = realFactor(cpi, d.date);
                if (f) item(null, '×' + f.toFixed(2), T('pc.real.factor'));
            }
            S.mas.forEach(n => { const v = ser.ma[n][i]; item('pc-key-ma' + n, v == null ? '—' : fmtValue(metric, v, true), T('pc.i.maShort', { n: n })); });
            METRICS.filter(m => m.id !== metric.id).forEach(m => item(null, fmtValue(m, seriesOf(m).vals[i], m.unit === 'won'), T(m.key)));
            readout.appendChild(vals);
        }

        function pointAt(e) {
            const rect = svgRoot.getBoundingClientRect();
            const px = (e.clientX - rect.left) * (S.W / rect.width);
            const py = (e.clientY - rect.top) * (S.H / rect.height);
            const i = Math.round(S.start + (px - S.M.left) / S.pw * Math.max(1, S.end - S.start));
            return { i: Math.min(S.end, Math.max(S.start, i)), x: px, y: Math.min(S.M.top + S.ph, Math.max(S.M.top, py)) };
        }

        // PC: 그래프를 가로로 끌면 그 구간을 확대한다 (그림도구를 쓰는 중이 아닐 때)
        let sel = null;          // { x0, i0, moved }
        let swallowClick = false;
        plot.addEventListener('pointermove', e => {
            if (!S) return;
            const p = pointAt(e);
            state.hover = p.i;
            drawHover(p);
            if (sel) {
                if (Math.abs(p.x - sel.x0) > 4) sel.moved = true;
                if (sel.moved) {
                    const x0 = Math.max(S.M.left, Math.min(sel.x0, p.x));
                    const x1 = Math.min(S.M.left + S.pw, Math.max(sel.x0, p.x));
                    S.hoverLayer.appendChild(svg('rect', { class: 'pc-select', x: x0, y: S.M.top, width: Math.max(0, x1 - x0), height: S.ph }));
                }
            }
        });
        plot.addEventListener('pointerdown', e => {
            if (!S) return;
            const p = pointAt(e);
            state.hover = p.i;
            drawHover(p);
            if (e.pointerType === 'mouse' && e.button === 0 && !state.tool && state.unlocked) {
                sel = { x0: p.x, i0: p.i, moved: false };
                try { plot.setPointerCapture(e.pointerId); } catch (err) { /* 오래된 브라우저 */ }
            }
        });
        const endSelect = e => {
            if (!sel) return;
            const s0 = sel;
            sel = null;
            if (!s0.moved || !S) return;
            swallowClick = true;
            const i1 = pointAt(e).i;
            setView({ s: Math.min(s0.i0, i1), e: Math.max(s0.i0, i1) }, true);
        };
        plot.addEventListener('pointerup', endSelect);
        plot.addEventListener('pointercancel', () => { sel = null; drawHover(null); });
        plot.addEventListener('pointerleave', e => {
            if (e.pointerType !== 'mouse') return;   // 손가락은 떼도 값을 남겨 둔다. 다른 데를 누르면 닫힌다
            state.hover = null;
            drawHover(null);
        });
        document.addEventListener('pointerdown', e => {
            if (plot.contains(e.target) || state.hover === null) return;
            state.hover = null;
            drawHover(null);
        });
        plot.addEventListener('click', e => {
            if (swallowClick) { swallowClick = false; return; }
            if (!S || !state.unlocked || !state.tool) return;
            const p = pointAt(e);
            const v = S.yInv(p.y);
            const r = all[p.i].round;
            if (state.tool === 'h') {
                myDrawings().push({ t: 'h', v: v });
                state.tool = null;
            } else if (!state.pending) {
                state.pending = { r: r, v: v };
                paintControls();
                return;
            } else {
                if (r !== state.pending.r) myDrawings().push({ t: 't', r1: state.pending.r, v1: state.pending.v, r2: r, v2: v });
                state.pending = null;
                state.tool = null;
            }
            saveDrawings();
            render();
        });

        // 키보드: ← → 한 회차, PageUp/PageDown 10회차, Home/End 처음·끝, + - 확대·축소, Esc 닫기
        plot.addEventListener('keydown', e => {
            if (!S) return;
            if (state.unlocked && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) {
                e.preventDefault();
                setView(zoomView(len, state.view, e.key === '-' || e.key === '_' ? 2 : 0.5, state.hover), true);
                return;
            }
            const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -10, PageDown: 10 }[e.key];
            let i = state.hover === null ? S.end : state.hover;
            if (step) i += step;
            else if (e.key === 'Home') i = S.start;
            else if (e.key === 'End') i = S.end;
            else if (e.key === 'Escape') { state.tool = null; state.pending = null; state.hover = null; paintControls(); drawHover(null); return; }
            else return;
            e.preventDefault();
            state.hover = Math.min(S.end, Math.max(S.start, i));
            drawHover(null);
            const d = all[state.hover];
            live.textContent = T('pc.drawNo', { n: d.round }) + ' ' + (d.date || '') + ', ' + T(S.metric.key) + ' ' + fmtValue(S.metric, S.ser.vals[state.hover]) +
                (d.numbers ? ', ' + T('pc.numbersAria', { nums: d.numbers.join(', '), bonus: d.bonus }) : '');
        });
        plot.addEventListener('focus', () => {
            // 키보드로 들어왔을 때만 마지막 회차를 짚어 준다 (마우스로 누른 것은 누른 자리)
            if (state.hover !== null || !S || !plot.matches(':focus-visible')) return;
            state.hover = S.end;
            drawHover(null);
        });
        plot.addEventListener('blur', () => { state.hover = null; drawHover(null); });

        // 작은 그래프: 창 안을 끌면 옮기기, 양 끝(손잡이)을 끌면 넓히기·좁히기, 창 밖을 누르면 그 자리로 옮기기
        let navDrag = null;      // { mode: 'move'|'l'|'r', grab, view }
        function navIndex(e) {
            const rect = navSvg.getBoundingClientRect();
            const px = (e.clientX - rect.left) * (N.W / rect.width);
            return { px: px, i: Math.round((px - N.L) / N.pw * (len - 1)) };
        }
        nav.addEventListener('pointerdown', e => {
            if (!N || !state.unlocked) return;
            const p = navIndex(e);
            const xs = N.x(state.view.s);
            const xe = N.x(state.view.e);
            const w = state.view.e - state.view.s;
            let mode = 'move';
            if (Math.abs(p.px - xs) <= 10) mode = 'l';
            else if (Math.abs(p.px - xe) <= 10) mode = 'r';
            else if (p.px < xs || p.px > xe) setView({ s: p.i - Math.round(w / 2), e: p.i - Math.round(w / 2) + w }, true);
            navDrag = { mode: mode, grab: p.i, view: Object.assign({}, state.view) };
            dragging = true;
            try { nav.setPointerCapture(e.pointerId); } catch (err) { /* 오래된 브라우저 */ }
            e.preventDefault();
        });
        nav.addEventListener('pointermove', e => {
            if (!navDrag) return;
            const i = navIndex(e).i;
            const v = navDrag.view;
            if (navDrag.mode === 'move') { const dI = i - navDrag.grab; setView({ s: v.s + dI, e: v.e + dI }); }
            else if (navDrag.mode === 'l') setView({ s: Math.min(i, v.e - MIN_VIEW + 1), e: v.e });
            else setView({ s: v.s, e: Math.max(i, v.s + MIN_VIEW - 1) });
        });
        const navEnd = () => { if (!navDrag) return; navDrag = null; dragging = false; render(); };
        nav.addEventListener('pointerup', navEnd);
        nav.addEventListener('pointercancel', navEnd);
        // 키보드: ← → 구간 옮기기, + - 확대·축소
        nav.addEventListener('keydown', e => {
            if (!state.unlocked) return;
            const w = state.view.e - state.view.s + 1;
            const step = Math.max(1, Math.round(w / 10));
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const dI = e.key === 'ArrowLeft' ? -step : step;
                setView({ s: state.view.s + dI, e: state.view.e + dI }, true);
            } else if (e.key === '+' || e.key === '=') setView(zoomView(len, state.view, 0.5), true);
            else if (e.key === '-' || e.key === '_') setView(zoomView(len, state.view, 2), true);
            else return;
            e.preventDefault();
        });

        /* 표로 보기: 보이는 구간을 최근 회차부터 */
        function fillTable() {
            if (!S) return;
            const each = byId('each');
            const total = byId('total');
            const realTotal = cpi ? seriesOf(total, true).vals : null;
            const showReal = !!(S.realOn && realTotal);
            tableHead.textContent = '';
            tableHead.appendChild(el('tr', null, ['pc.th.round', 'pc.th.date', 'pc.th.winners', 'pc.th.each', 'pc.th.total'].map(k => el('th', { scope: 'col', text: T(k) }))
                .concat(showReal ? [el('th', { scope: 'col', text: T('pc.th.total') + ' (' + realAs() + ')' })] : [])));
            const frag = document.createDocumentFragment();
            for (let i = S.end; i >= S.start; i--) {
                const d = all[i];
                frag.appendChild(el('tr', null, [
                    el('td', null, [el('a', { href: 'round/' + d.round + '.html', text: T('pc.drawNo', { n: d.round }) })]),
                    el('td', { text: d.date || '' }),
                    el('td', { text: fmtInt(d.firstPrizeWinners) + T('pc.unitPeople') }),
                    el('td', { text: fmtValue(each, each.value(d)) }),
                    el('td', { text: fmtValue(total, total.value(d)) }),
                    showReal ? el('td', { text: fmtValue(total, realTotal[i]) }) : null,
                ]));
            }
            tableBody.textContent = '';
            tableBody.appendChild(frag);
        }

        // 폭이 바뀌면 다시 그린다 (휴대폰 회전 등)
        let lastW = 0;
        const onResize = () => {
            const w = Math.round(plot.clientWidth);
            if (w && w !== lastW) { lastW = w; render(); }
        };
        if (g.ResizeObserver) new g.ResizeObserver(() => g.requestAnimationFrame(onResize)).observe(plot);
        else g.addEventListener('resize', onResize);

        render();
        lastW = Math.round(plot.clientWidth);

        return {
            // 이용권이 확인되면 true, 환불·만료로 다시 잠그면 false
            // 로그인 전이면 true: 그래프를 흐리게 하고 로그인 안내를 얹는다
            setGated(on) {
                on = !!on;
                if (on === state.gated) return;
                state.gated = on;
                state.hover = null;
                render();
            },
            setUnlocked(on) {
                on = !!on;
                if (on === state.unlocked) return;
                state.unlocked = on;
                if (on) {
                    INDICATORS.forEach(k => { state.ind[k] = !!state.savedInd[k]; });
                } else {
                    state.savedInd = Object.assign({}, state.ind);
                    INDICATORS.forEach(k => { state.ind[k] = false; });
                    state.tool = null;
                    state.pending = null;
                    state.view = { s: 0, e: len - 1 };   // 구간 설정도 잠기므로 전체 기간으로
                }
                render();
            },
        };
    }

    return {
        METRICS: METRICS,
        mount: mount,
        movingAverage: movingAverage,
        realFactor: realFactor,
        lineWidth: lineWidth,
        clampView: clampView,
        zoomView: zoomView,
        MIN_VIEW: MIN_VIEW,
        niceStep: niceStep,
        linearTicks: linearTicks,
        logTicks: logTicks,
        summarize: summarize,
        wonLong: wonLong,
        wonShort: wonShort,
    };
}));
