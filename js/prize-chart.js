// TOP 50 당첨금 페이지 맨 위의 회차별 그래프(#prize-chart, 접는 상자 — 처음엔 펼침). 가로는 회차, 세로는 고른 지표.
// 상자를 접으면(폭 0) 그리기를 미뤘다가 펼칠 때 다시 그린다.
//
// 무료: 지표 고르기, 짚어서 값 보기, 구간 설정(최근 N회·확대·축소·휠·끌어 옮기기·두 손가락·작은 그래프),
//       세전, 서울 아파트 비교, 선 · 월봉, 240회 이동평균(FREE_IND — 처음부터 보이고 끄고 켜기는 이용권).
// 이용권: 물가 반영, 세후, 강남3구 아파트값 비교, 분기봉 · 연봉, 보조지표(평균선 · 20/60/120/240회 이동평균 끄고 켜기 ·
//       로그 눈금), 그림도구(수평선·추세선). 이용권이 있으면 처음 화면은 물가 반영 + 20회 · 240회 이동평균(DEFAULT_IND).
// 이 잠금도 license.js 와 같은 편의 잠금이다.
// 도구 상자에는 줄마다 "이용권"을 달지 않고, 잠겼을 때 맨 아래 한 줄로 "이용권이 없으면 일부 기능은 제한"이라고 안내한다.
//
// 세로축 눈금은 왼쪽. 보이는 구간의 마지막 값(파란 · 회색 · 주황)은 선이 끝나는 오른쪽에 꼬리표로 붙는다(이동평균 끝값은
// 붙이지 않는다 — 겹쳐서 읽히지 않고, 값은 짚으면 나온다). 짚은 자리는 십자선과 함께 가로축(회차)·세로축(값)에 꼬리표.
// 봉 차트: 회차를 달·분기·해로 묶어 시가(첫 회차)·고가·저가·종가(마지막 회차). 오름 빨강 · 내림 파랑.
// 선 · 월봉은 누구나, 분기봉 · 연봉은 이용권. 처음 열면 선 그래프다.
//
// 처음 열면 늘 "전체 기간 · 총 1등 당첨금 · 선 그래프 · 세전 · 240회 이동평균"이다(이용권이 있으면 물가 반영 + 20회 · 240회 이동평균).
// 고른 지표·기간은 기억하지 않는다(이용권이 있으면 보조지표만 기억한다).
//
// 로그인하지 않은 사람에게는 그래프를 흐리게 보이고 로그인을 권한다(setGated). 누구를 가릴지는 페이지가 정한다.
//
// "물가 반영"을 켜면 지금 돈 가치 선(회색)을 더 그린다: 금액 × 물가지수(기준 달) ÷ 물가지수(그 회차 달).
// 파란 선은 늘 당시 받은 금액이다 — 사람들이 먼저 알고 싶은 값. 요약·이동평균·평균선은 고른 기준(지금 돈 가치)으로 잰다.
// 물가지수는 cpi-data.json(tools/update-cpi.js 가 매달 받는다). 파일이 없으면 단추를 숨긴다.
//
// "세금: 세전/세후"는 금액 지표의 선 자체를 세후 실수령액으로 바꾼다(지금 세율, tax.html 과 같은 계산).
// "비교: 서울 · 강남 아파트 평균가"(1인당 당첨금에서만)는 그 달 아파트 평균 매매가(서울 주황 · 강남 자주, seoul-apt.json — KB부동산,
// tools/update-seoul-apt.js 가 받는다. 2008-12 이전은 지수로 거꾸로 환산한 추정이라 점선)를 겹친다. 켜면 세후로 바꾼다.
// 세로축은 기본 화면과 똑같이 잡는다(자르지 않는다). 전체 기간에서 아파트 선이 낮게 깔리면 구간·로그 눈금으로 본다.
//
// 지표는 METRICS 에 한 줄씩 늘린다. 2·3등 1게임당(tier)은 페이지가 prize-data.json 을 받아 회차에 붙여 준 값(a2 · a3 · w2 · w3)이다 —
// 그 값이 하나도 없으면 단추를 숨긴다. 판매액 · 4~5등도 같은 파일에 있다.
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
        // 2·3등 1게임당. 빈칸이 두 가지다: 당첨 게임이 없던 회차(3 · 5회의 2등)는 null("없음"),
        // 자료가 아직 붙지 않은 회차(추첨 직후 집계 전)는 undefined("집계 전"). 둘 다 선 · 평균에서는 빈칸으로 다룬다(== null)
        { id: 'second', key: 'pc.m.second', unit: 'won', tier: true, value: d => (typeof d.w2 !== 'number' ? undefined : d.w2 > 0 && d.a2 > 0 ? d.a2 : null) },
        { id: 'third', key: 'pc.m.third', unit: 'won', tier: true, value: d => (typeof d.w3 !== 'number' ? undefined : d.w3 > 0 && d.a3 > 0 ? d.a3 : null) },
    ];
    const FIRST_1000_WON = 88;   // 1~87회는 1게임 2,000원 — 2·3등 금액이 지금보다 훨씬 크다
    const RANGES = [50, 100, 300, 0];      // 0 = 전체
    const MA = [20, 60, 120, 240];
    const INDICATORS = ['avg'].concat(MA.map(n => 'ma' + n), ['log']);
    // 처음 켜 두는 보조지표. 이용권이 있으면 DEFAULT_IND(고른 것을 기억해 그것을 쓴다),
    // 없으면 FREE_IND — 240회 이동평균만 보인다(끄고 켜기 · 다른 보조지표는 이용권)
    const DEFAULT_IND = { ma20: true, ma240: true };
    const FREE_IND = { ma240: true };
    const indOf = base => Object.fromEntries(INDICATORS.map(k => [k, !!base[k]]));
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

    // 폭 w 칸을, c 칸(소수 가능)이 화면 가로 ratio(0~1) 자리에 오게 놓는다. 휠·두 손가락 확대가 쓴다
    function viewAround(len, w, c, ratio) {
        const s = c - Math.min(1, Math.max(0, ratio)) * (Math.max(1, w) - 1);
        return clampView(len, s, s + Math.max(1, w) - 1);
    }

    // 휠 한 번에 바뀌는 폭: 아래로 굴리면 넓게(축소), 위로 굴리면 좁게(확대). 적어도 한 칸은 바뀐다.
    // 노트북 터치패드 두 손가락 벌리기는 ctrl 휠로 오고 값이 작아서 더 크게 친다
    function wheelWidth(w, dy, pinch) {
        const f = Math.exp(dy * (pinch ? 0.01 : 0.002));
        return dy < 0 ? Math.min(w - 1, Math.floor(w * f)) : Math.max(w + 1, Math.ceil(w * f));
    }

    // 봉을 묶는 기간: 'm' 달 · 'q' 분기 · 'y' 해
    function periodKey(date, unit) {
        const d = String(date);
        const m = Number(d.slice(5, 7));
        return unit === 'y' ? d.slice(0, 4) : unit === 'q' ? d.slice(0, 4) + '-Q' + Math.ceil(m / 3) : d.slice(0, 7);
    }

    // 봉: 회차를 기간으로 묶어 시가(첫 회차)·고가·저가·종가(마지막 회차). 값이 없는 회차(이월)는 건너뛴다.
    // 돌려주는 것: [{ key, s, e(회차 칸 범위), o, h, l, c, hi, lo(최고·최저 칸) }] — 값이 하나도 없는 기간은 o 가 null
    function candles(dates, vals, unit) {
        const out = [];
        let cur = null;
        dates.forEach((date, i) => {
            const key = periodKey(date, unit);
            if (!cur || cur.key !== key) {
                cur = { key: key, s: i, e: i, o: null, h: null, l: null, c: null, hi: -1, lo: -1 };
                out.push(cur);
            }
            cur.e = i;
            const v = vals[i];
            if (v == null) return;
            if (cur.o === null) cur.o = v;
            cur.c = v;
            if (cur.h === null || v > cur.h) { cur.h = v; cur.hi = i; }
            if (cur.l === null || v < cur.l) { cur.l = v; cur.lo = i; }
        });
        return out;
    }

    /* ───── 계산 (브라우저 없이도 돈다: tools/test-prize-chart.js) ───── */

    // 세후 실수령액 (tax.html 과 같은 계산): 200만 원 이하 비과세, 넘으면 구입비 1,000원을 뺀 금액에
    // 3억 원까지 22%, 넘는 부분에만 33% (지방소득세 포함). 지금 세율로 모든 회차를 계산한다
    function afterTax(v) {
        if (!(v > 2000000)) return v;
        const base = Math.max(0, v - 1000);
        return v - Math.floor(Math.min(base, 3e8) * 0.22 + Math.max(0, base - 3e8) * 0.33);
    }

    // 그 회차 달의 서울 아파트 평균가. 아직 안 나온 달(최근 회차)은 마지막 달 값. { v, ym, est }
    function aptAt(apt, date) {
        if (!apt || !apt.monthly || !apt.latest || !date) return null;
        let k = String(date).slice(0, 7);
        if (k > apt.latest) k = apt.latest;
        const v = apt.monthly[k];
        if (!(v > 0)) return null;
        return { v: v, ym: k, est: !!(apt.estimatedBefore && k < apt.estimatedBefore) };
    }

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

    // 1,604,686,625 → "16억 469만 원" / "1.60 bn KRW". 영문은 3등(100만 원대)도 읽히게 1,000만 원 아래는 소수 둘째 자리까지,
    // 100만 원 아래는 원 단위까지
    function wonLong(v) {
        if (lang() === 'en') {
            if (v >= 1e9) return (v / 1e9).toFixed(2) + ' bn KRW';
            if (v >= 1e7) return Math.round(v / 1e6) + 'm KRW';
            if (v >= 1e6) return (v / 1e6).toFixed(2) + 'm KRW';
            return fmtInt(Math.round(v)) + ' KRW';
        }
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
            if (v >= 1e3) return fmtDec(v / 1e3) + 'k';
            return fmtInt(v);
        }
        if (v >= 1e8) return fmtDec(v / 1e8) + '억';
        if (v >= 1e4) return fmtDec(v / 1e4) + '만';
        return fmtInt(v);
    }

    function fmtValue(metric, v, short) {
        if (v === undefined && metric.tier) return T('pc.tierPending');
        if (v == null) return T(metric.tier ? 'pc.none' : 'pc.rollover');
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
        const apt = opts && opts.apt && opts.apt.monthly && opts.apt.latest ? opts.apt : null;
        // 강남: seoul-apt.json 의 gangnam — 강남3구(강남 · 서초 · 송파) ㎡당 평균가 × 84㎡ 를 달마다 평균한 값.
        // 다른 모양(예전 강남 권역 · 강남구 단독 파일)이면 이름표가 맞지 않으니 비교 단추를 숨긴다
        const gn = apt && apt.gangnam && apt.gangnam.name === '강남3구' && apt.gangnam.sqm && apt.gangnam.monthly && apt.gangnam.latest ? apt.gangnam : null;
        const gnName = () => T('pc.cmp.gnName', { sqm: gn.sqm });
        const all = draws.slice().sort((a, b) => a.round - b.round);
        const first = all[0].round;
        const indexOf = r => r - first;      // 회차는 1부터 빠짐없이 이어진다 (update-lotto-data.js 가 검사)
        // 2·3등 자료가 없으면(파일을 못 받음) 그 지표는 뺀다
        const metrics = METRICS.filter(m => !m.tier || all.some(d => m.value(d) != null));
        const byId = id => metrics.find(m => m.id === id) || metrics[0];

        const cache = {};
        // real: 금액을 지금 돈 가치로, net: 세후 실수령액으로 (금액 지표만). 총액의 세후는 1인당 세후 × 당첨자 수
        function seriesOf(metric, real, net) {
            real = !!(real && cpi && metric.unit === 'won');
            net = !!(net && metric.unit === 'won');
            const key = metric.id + (real ? ':real' : '') + (net ? ':net' : '');
            if (!cache[key]) {
                const vals = all.map(d => {
                    let v = metric.value(d);
                    if (v != null && net) v = metric.id === 'total' ? afterTax(d.firstPrizeAmount) * d.firstPrizeWinners : afterTax(v);
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
        // 비교선: 회차마다 세후 1인당 당첨금, 그 달 서울 · 강남 아파트 평균가
        let cmpCache = null;
        function cmpSeries() {
            if (!cmpCache) {
                const each = byId('each');
                const at = all.map(d => aptAt(apt, d.date));
                const gt = all.map(d => aptAt(gn, d.date));
                cmpCache = {
                    gross: all.map(d => each.value(d)),       // 세전 1인당 (세후가 잠겼거나 꺼졌을 때 "몇 채" 기준)
                    net: all.map(d => { const v = each.value(d); return v == null ? null : afterTax(v); }),
                    apt: at,                                  // { v, ym, est } | null
                    aptV: at.map(a => (a ? a.v : null)),
                    cut: at.findIndex(a => a && !a.est),      // 실제 평균가가 시작하는 칸 (앞은 추정)
                    gn: gt,
                    gnV: gt.map(a => (a ? a.v : null)),
                    gnCut: gt.findIndex(a => a && !a.est),
                };
            }
            return cmpCache;
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
            metric: metrics[0].id,
            view: { s: 0, e: len - 1 },   // 보는 구간 (전체 배열의 칸 번호)
            ind: indOf(FREE_IND),
            savedInd: Object.assign(indOf(DEFAULT_IND), saved.ind),   // 예전에 저장한 값에 없는 칸(예: ma240)은 처음 값으로
            unlocked: false,
            gated: false,        // 로그인 전: 그래프를 흐리게
            real: true,          // 물가 반영 (이용권 — 있으면 처음부터 켜진다. 물가 자료가 없거나 당첨자 수 지표면 무시)
            tool: null,          // 'h' | 't'
            pending: null,       // 추세선 첫 점 { r, v }
            hover: null,         // 전체 배열의 칸 번호
            cmpApt: false,       // 비교: 서울 아파트 평균가 (1인당 당첨금에서만)
            cmpGn: false,        // 비교: 강남3구 84㎡ 아파트값 (1인당 당첨금에서만)
            net: false,          // 세금: 세후 실수령액으로 (이용권, 금액 지표만)
            candle: null,        // 봉 차트: null(선, 처음 화면) | 'm'(월봉, 무료) | 'q' · 'y'(이용권)
        };
        let drawings = store.get(DRAW_STORE) || {};
        let S = null;            // 마지막으로 그린 눈금·크기
        let lastW = 0;           // 마지막으로 그린 폭. 0 이면 접힌 상자 안이라 그리기를 미뤘다

        const saveView = () => store.set(VIEW_STORE, { ind: state.unlocked ? state.ind : state.savedInd });
        const presetView = n => (n ? clampView(len, len - n, len - 1) : { s: 0, e: len - 1 });
        const isPreset = n => { const v = presetView(n); return v.s === state.view.s && v.e === state.view.e; };
        // 끌기 중에는 한 화면에 한 번만 다시 그린다
        let frame = 0;
        function setView(v, now) {
            state.view = clampView(len, v.s, v.e);
            if (now) { render(); return; }
            if (!frame) frame = g.requestAnimationFrame(() => { frame = 0; render(); });
        }

        /* 그래프 도구: 큰 사각형 하나 안에 줄마다 [이름 | 모서리 없는 사각 단추들] */
        const cell = (label, on) => el('button', { type: 'button', className: 'pt-btn', 'aria-pressed': 'false', text: label, on: { click: on } });
        const metricBtns = metrics.map(m => {
            const b = cell(T(m.key), () => { state.metric = m.id; state.pending = null; render(); });
            b.dataset.v = m.id;
            return b;
        });
        // 금액 기준: 당시 금액 / 물가 반영(지금 돈 가치). 당첨자 수에서는 둘 다 꺼진다
        function setReal(on) {
            if (on && !state.unlocked) return flashNote();   // 물가 반영은 이용권
            if (byId(state.metric).unit !== 'won') return;
            state.real = on;
            state.pending = null;
            render();
        }
        const nominalBtn = cell(T('pc.real.nominal'), () => setReal(false));
        const realBtn = cell(T('pc.real'), () => setReal(true));
        const cpiNote = el('p', { className: 'pchart-cpi-note', hidden: '' });
        const cmpNote = el('p', { className: 'pchart-cpi-note', hidden: '' });
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
        ] : []).concat(apt ? [
            T(gn ? 'pc.src.aptGn' : 'pc.src.apt'),
            safeLink(apt.link) ? el('a', { href: safeLink(apt.link), target: '_blank', rel: 'noopener', text: (apt.credit && (apt.credit[lang()] || apt.credit.ko)) || 'KB' }) : ((apt.credit && apt.credit.ko) || 'KB'),
            gn && gn.latest !== apt.latest ? T('pc.src.aptGnTail', { a: ymLabel(apt.latest), b: ymLabel(gn.latest) }) : T('pc.src.aptTail', { ym: ymLabel(apt.latest) }),
        ] : []));

        const chip = cell;
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
        // 봉 차트: 선 / 월봉(무료) / 분기봉 / 연봉(이용권)
        const freeCandle = u => !u || u === 'm';
        const CANDLES = ['', 'm', 'q', 'y'];
        const candleChips = CANDLES.map(u => {
            const c = chip(T(u ? 'pc.c.' + u : 'pc.c.line'), () => pickCandle(u));
            c.dataset.v = u;
            return c;
        });
        // 구간 설정(무료): 최근 N회·전체, 확대·축소
        const rangeChips = RANGES.map(n => {
            const c = chip(n ? T('pc.r.n', { n: n }) : T('pc.r.all'), () => pickRange(n));
            c.dataset.v = String(n);
            return c;
        });
        const zoomIn = chip('＋ ' + T('pc.zoomIn'), () => zoomBy(0.5));
        const zoomOut = chip('－ ' + T('pc.zoomOut'), () => zoomBy(2));
        zoomIn.removeAttribute('aria-pressed');
        zoomOut.removeAttribute('aria-pressed');

        const badge = el('span', { className: 'lock-mark is-on', hidden: '', text: T('pc.pro.badgeOn') });
        const proNote = el('p', { className: 'pchart-pro-note' }, [
            T('pc.pro.note') + ' ',
            el('a', { href: 'statistics.html', text: T('pc.pro.see') }),
        ]);
        // 조작법 한 줄 (구간 조작은 무료라 늘 보인다. 손가락 화면과 마우스 화면이 다르다)
        const coarse = !!(g.matchMedia && g.matchMedia('(pointer: coarse)').matches);
        const helpNote = el('p', { className: 'pchart-help', text: T(coarse ? 'pc.help.touch' : 'pc.help.mouse') });   // 구간 조작은 무료라 늘 보인다
        // 한 줄: 왼쪽 이름 칸, 오른쪽 단추 칸들. 단추는 1px 선으로만 나뉜다. 이용권 줄이라고 따로 적지 않는다(맨 아래 안내 한 줄)
        // fit: 단추가 몇 개 안 되는 줄은 줄 폭을 등분하지 않고 글자 길이만큼만 차지한다
        const row = (label, buttons, paid, fit) => el('div', { className: 'pt-row' + (paid ? ' is-paid' : '') + (fit ? ' is-fit' : ''), role: 'group', 'aria-label': label }, [
            el('div', { className: 'pt-label' }, [el('span', { text: label })]),
            el('div', { className: 'pt-btns' }, buttons),
        ]);
        const realRow = row(T('pc.row.amount'), [nominalBtn, realBtn], false, true);
        if (!cpi) realRow.hidden = true;
        // 세금: 세전(무료) / 세후(이용권). 당첨자 수에서는 둘 다 꺼진다
        function setNet(on) {
            if (on && !state.unlocked) return flashNote();   // 세후는 이용권
            if (byId(state.metric).unit !== 'won') return;
            state.net = on;
            state.pending = null;
            render();
        }
        const grossBtn = cell(T('pc.tax.gross'), () => setNet(false));
        const netBtn = cell(T('pc.tax.net'), () => setNet(true));
        const taxRow = row(T('pc.row.tax'), [grossBtn, netBtn], false, true);
        // 비교: 서울 아파트(무료) · 강남3구(이용권). 1인당 당첨금에 그 달 아파트값을 겹치고, "몇 채"는 보이는 선(세후/세전) 기준.
        // 다른 지표에서 누르면 1인당 당첨금으로 바꾸고,
        // 켤 때 세후로 바꾼다 — "당첨되면 서울 집을 살 수 있나"는 세후로 봐야 맞다. 아파트값은 그 달 값(당시 금액)이라
        // 물가 반영(지금 돈 가치 회색 선)은 끈다 — 회색 선과 아파트값을 견주면 잘못 읽는다
        function toggleCmp(k) {
            if (k === 'cmpGn' && !state.unlocked) return flashNote();   // 강남3구 비교는 이용권
            if (state.metric !== 'each') { state.metric = 'each'; state[k] = true; }
            else state[k] = !state[k];
            if (state[k]) { state.net = true; state.real = false; }
            state.pending = null;
            render();
        }
        const aptBtn = cell(T('pc.cmp.apt'), () => toggleCmp('cmpApt'));
        aptBtn.title = T('pc.cmp.aptTitle');
        const gnBtn = cell(T('pc.cmp.gn'), () => toggleCmp('cmpGn'));
        if (gn) gnBtn.title = T('pc.cmp.gnTitle', { sqm: gn.sqm });
        if (!gn) gnBtn.hidden = true;
        const cmpRow = row(T('pc.row.compare'), [aptBtn, gnBtn], false, true);
        if (!apt) cmpRow.hidden = true;
        // 지표만 그래프 위 작은 상자에, 나머지 도구는 그래프 아래 상자에
        const tierBtns = metricBtns.filter(b => byId(b.dataset.v).tier);
        const metricBox = el('div', { className: 'pchart-tools pt-top' }, [
            row(T('pc.row.metric'), metricBtns.filter(b => !byId(b.dataset.v).tier), false, true),
            tierBtns.length ? row(T('pc.row.tier'), tierBtns, false, true) : null,
        ]);
        const pro = el('div', { className: 'pchart-tools is-locked' }, [
            realRow,
            taxRow,
            cmpRow,
            row(T('pc.row.candle'), candleChips, false),
            row(T('pc.pro.range'), rangeChips.concat([zoomIn, zoomOut]), false),
            row(T('pc.pro.ind'), INDICATORS.map(k => indChips[k]), true),
            row(T('pc.pro.draw'), [toolChips.h, toolChips.t, toolChips.undo, toolChips.clear], true),
            el('div', { className: 'pt-foot' }, [badge, proNote, helpNote]),
        ]);

        const legend = el('div', { className: 'pchart-legend', hidden: '' });
        const hint = el('p', { className: 'pchart-hint', role: 'status', 'aria-live': 'polite' });
        const svgRoot = svg('svg', { 'aria-hidden': 'true', focusable: 'false' });
        // 짚은 회차 정보는 떠 있는 툴팁 대신 그래프 위 고정된 정보창에 보인다(PC · 휴대폰 같다) — 비교선 · 이평선까지 켜면
        // 줄이 많아 툴팁이 그래프를 가린다. 높이를 미리 잡아 두어 짚어도 그래프가 덜 밀린다
        const readout = el('div', { className: 'pchart-readout', 'aria-hidden': 'true' });
        const plot = el('div', { className: 'pchart-plot', role: 'group', tabindex: '0' }, [svgRoot]);
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
        plot.setAttribute('aria-describedby', 'pchart-summary');

        root.textContent = '';
        root.classList.add('pchart-body');
        // 지표 고르기 → 그래프 → 요약 줄 → 나머지 그래프 도구 상자 → (그림도구 안내) → 설명(물가 · 봉 · 세금 · 아파트) → 주의 · 출처
        // 설명은 도구 상자 아래에 둔다 — 그래프 바로 밑에 두면 길어질 때 도구 상자가 그래프에서 멀어진다.
        // 회차별 표는 따로 두지 않는다: 바로 아래(그래프를 접으면 바로 보이는) TOP 50 표가 있고, 키보드 ←→ 로 회차마다 읽을 수 있다
        [metricBox, stage, summary, pro, hint, live, cpiNote, cmpNote,
            el('p', { className: 'pchart-note', text: T('pc.note') }), sourceLine].forEach(n => root.appendChild(n));

        /* 보조지표 · 그림도구 */
        function flashNote() {
            proNote.classList.remove('is-flash');
            void proNote.offsetWidth;
            proNote.classList.add('is-flash');
        }
        function pickCandle(u) {
            if (!state.unlocked && !freeCandle(u)) return flashNote();
            state.candle = u || null;
            render();
        }
        function pickRange(n) {
            setView(presetView(n), true);
        }
        function zoomBy(factor) {
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
            metricBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === state.metric)));
            const w = state.view.e - state.view.s + 1;
            const lockIf = (c, off) => { if (off) c.setAttribute('aria-disabled', 'true'); else c.removeAttribute('aria-disabled'); };
            rangeChips.forEach(c => c.setAttribute('aria-pressed', String(isPreset(Number(c.dataset.v)))));
            candleChips.forEach(c => { c.setAttribute('aria-pressed', String((state.candle || '') === c.dataset.v)); lockIf(c, !state.unlocked && !freeCandle(c.dataset.v)); });
            lockIf(zoomIn, w <= Math.min(MIN_VIEW, len));
            lockIf(zoomOut, w >= len);
            const wonMetric = byId(state.metric).unit === 'won';
            const realShown = !!(state.real && wonMetric && state.unlocked);
            realBtn.setAttribute('aria-pressed', String(realShown));
            nominalBtn.setAttribute('aria-pressed', String(!realShown && wonMetric));
            lockIf(nominalBtn, !wonMetric);
            lockIf(realBtn, !wonMetric || !state.unlocked);
            realBtn.title = !cpi ? '' : wonMetric ? T('pc.realTitle', { ym: ymLabel(cpi.latest) }) : T('pc.realNo');
            nominalBtn.title = wonMetric ? '' : T('pc.realNo');
            const isWon = byId(state.metric).unit === 'won';
            aptBtn.setAttribute('aria-pressed', String(state.metric === 'each' && state.cmpApt));
            gnBtn.setAttribute('aria-pressed', String(state.metric === 'each' && state.cmpGn && state.unlocked));
            lockIf(gnBtn, !state.unlocked);
            const netShown = !!(state.net && wonMetric && state.unlocked);
            netBtn.setAttribute('aria-pressed', String(netShown));
            grossBtn.setAttribute('aria-pressed', String(!netShown && wonMetric));
            lockIf(grossBtn, !wonMetric);
            lockIf(netBtn, !wonMetric || !state.unlocked);
            netBtn.title = wonMetric ? T('pc.tax.netTitle') : T('pc.tax.no');
            grossBtn.title = wonMetric ? '' : T('pc.tax.no');
            pro.classList.toggle('is-locked', !state.unlocked);
            badge.hidden = !state.unlocked;
            proNote.hidden = state.unlocked;
            INDICATORS.forEach(k => {
                const c = indChips[k];
                const off = !state.unlocked || (k === 'log' && !isWon);
                c.setAttribute('aria-pressed', String(!!state.ind[k] && !(k === 'log' && !isWon)));   // 잠겨도 켜 둔 기본값은 눌린 모양
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

        // 꼬리표: 값 글자 + 상자. left = 왼쪽 세로축(짚은 값), right = 선이 끝나는 오른쪽(마지막 값).
        // 겹치면 어긋나게 놓는 것은 부르는 쪽이 한다
        const TAG_PAD = 4;
        const TAG_GAP = 7;       // 선 끝(끝 점 반지름 4~5)과 오른쪽 꼬리표 사이
        function axisTag(parent, yy, text, cls, side) {
            const w = Math.ceil(measure(text) + 2 * TAG_PAD);
            // 휴대폰(inAxis)은 왼쪽 칸이 없으니 짚은 값 꼬리표를 그래프 안 왼쪽에 겹친다
            // 왼쪽 칸보다 긴 값(예: 2등 "5,564.8만")은 그림 왼쪽 끝에 맞춰 조금 겹친다 — 잘리지 않게
            const x0 = side === 'left' ? (S.inAxis ? S.M.left + 2 : Math.max(0, S.M.left - 2 - w)) : S.M.left + S.pw + TAG_GAP;
            const t = svg('g', { class: 'pc-tag ' + cls });
            t.appendChild(svg('rect', { x: x0, y: Math.round(yy) - 8, width: w, height: 16, rx: 2 }));
            t.appendChild(svg('text', { x: x0 + TAG_PAD, y: Math.round(yy) + 4 }, text));
            parent.appendChild(t);
        }
        // 보이는 구간에서 값이 있는 마지막 칸
        function lastOk(arr, start, end, ok) {
            for (let i = end; i >= start; i--) if (ok(arr[i])) return i;
            return -1;
        }

        function render() {
            // 접힌 상자 안(폭 0)에서는 그리지 않는다 — 펼치면 ResizeObserver 가 폭을 보고 다시 그린다
            if (plot.isConnected && !plot.clientWidth) { lastW = 0; return; }
            const metric = byId(state.metric);
            const realOn = !!(state.real && state.unlocked && cpi && metric.unit === 'won');   // 물가 반영 · 세후는 이용권
            const netOn = !!(state.net && state.unlocked && metric.unit === 'won');
            const ser = seriesOf(metric, realOn, netOn);          // 고른 기준: 요약·이동평균·평균선이 이 값으로 잰다
            const nominal = realOn ? seriesOf(metric, false, netOn) : null;
            // 봉 차트: 고른 기준(물가 반영·세후) 값으로 봉을 묶는다. 이때 선은 그리지 않는다
            const unit = state.candle && (state.unlocked || freeCandle(state.candle)) ? state.candle : null;
            const bars = unit ? ((ser.candles = ser.candles || {})[unit] = ser.candles[unit] || candles(all.map(d => d.date), ser.vals, unit)) : null;
            const blue = unit ? ser.vals : realOn ? nominal.vals : ser.vals;   // 파란 선: 늘 당시 금액
            const grey = unit ? null : realOn ? ser.vals : null;               // 회색 선: 지금 돈 가치 (물가 반영 때만)
            const gnOk = !!(state.cmpGn && gn && state.unlocked);                 // 강남3구 비교는 이용권
            const cs = metric.id === 'each' && ((state.cmpApt && apt) || gnOk) ? cmpSeries() : null;
            const aptVals = cs && state.cmpApt ? cs.aptV : null;  // 주황: 서울 아파트 평균가
            const gnVals = cs && gnOk ? cs.gnV : null;            // 자주: 강남3구 아파트값
            const start = state.view.s;
            const end = state.view.e;
            const useLog = state.unlocked && state.ind.log && metric.unit === 'won';
            const mas = MA.filter(n => state.ind['ma' + n]);   // 이용권이 없으면 state.ind 는 늘 처음 값(DEFAULT_IND)
            const sum = summarize(all, ser.vals, start, end);
            if (state.hover !== null && (state.hover < start || state.hover > end)) state.hover = null;

            // 세로 범위: 보이는 값과 켜 둔 이동평균
            let vmax = 0;
            let vmin = Infinity;
            const scan = arr => { for (let i = start; i <= end; i++) { const v = arr[i]; if (v != null && v > 0) { if (v > vmax) vmax = v; if (v < vmin) vmin = v; } } };
            scan(blue);
            if (grey) scan(grey);
            // 봉은 구간 끝에 걸친 기간의 값까지 그리므로 그 고가·저가도 넣는다
            const shown = bars ? bars.filter(b => b.o !== null && b.e >= start && b.s <= end) : [];
            shown.forEach(b => { if (b.h > vmax) vmax = b.h; if (b.l > 0 && b.l < vmin) vmin = b.l; });
            if (aptVals) scan(aptVals);
            if (gnVals) scan(gnVals);
            mas.forEach(n => scan(ser.ma[n]));
            const W = Math.max(280, Math.round(plot.clientWidth || 600));
            const H = W < 600 ? 240 : 320;
            // 휴대폰: 세로축 눈금 글자를 그래프 안 왼쪽 위에 겹쳐 그려, 선이 왼쪽 끝까지 차게 한다(왼쪽 칸을 따로 두지 않는다)
            const inAxis = W < 600;
            const yt = useLog && vmin < Infinity ? logTicks(vmin, vmax) : linearTicks(vmax, H < 300 ? 4 : 5, metric.unit === 'people');
            const pts = end - start + 1;
            const tickText = yt.ticks.map(v => fmtValue(metric, v, true));
            const ok = v => v != null && (!useLog || v > 0);
            // 왼쪽 축 폭: 눈금 글자와 짚은 값 꼬리표(맨 위 값 정도 길이) 중 넓은 것
            const axisW = Math.ceil(Math.max.apply(null, tickText.concat([fmtValue(metric, yt.max, true), fmtValue(metric, vmax || 0, true)]).map(measure)) + 2 * TAG_PAD);
            // 오른쪽: 보이는 구간 마지막 값 꼬리표(파란 · 회색 · 주황)
            const tags = [];
            const pushTag = (arr, cls) => {
                const i = lastOk(arr, start, end, ok);
                if (i >= 0) tags.push({ v: arr[i], text: fmtValue(metric, arr[i], true), cls: cls });
            };
            pushTag(blue, 'pc-tag-main');
            // 최근 회차는 물가 배수가 1이라 파란·회색 끝값이 같다: 하나만
            if (grey) { pushTag(grey, 'pc-tag-real'); if (tags.length === 2 && tags[0].text === tags[1].text) tags.pop(); }
            if (aptVals) pushTag(aptVals, 'pc-tag-apt');
            if (gnVals) pushTag(gnVals, 'pc-tag-gn');
            const tagW = tags.length ? Math.ceil(Math.max.apply(null, tags.map(t => measure(t.text))) + 2 * TAG_PAD) : 0;
            // 오른쪽도 그래프 영역으로 채운다 — 가로줄 · 바닥선은 오른쪽 끝(plotW)까지 긋는다. 선 · 봉 · 이동평균은 그보다 꼬리표 띠(band)만큼
            // 앞(pw)에서 끝나고(잘라 낸다), 마지막 값 꼬리표는 그 띠 안 선이 끝난 자리 바로 오른쪽에 둔다:
            // 꼬리표는 그래프 영역 안에 있으면서 선 · 봉을 가리지 않는다
            const band = tagW ? TAG_GAP + tagW + 3 : 6;
            const M = { top: 12, right: 1, bottom: 26, left: inAxis ? 1 : axisW + 6 };
            const plotW = W - M.left - M.right;
            const pw = Math.max(40, plotW - band);
            const ph = H - M.top - M.bottom;
            const span = Math.max(1, end - start);
            const x = i => M.left + (i - start) / span * pw;
            const y = useLog
                ? v => M.top + ph - (Math.log(v) - Math.log(yt.min)) / (Math.log(yt.max) - Math.log(yt.min)) * ph
                : v => M.top + ph - (v - yt.min) / (yt.max - yt.min) * ph;
            const yInv = useLog
                ? py => Math.exp(Math.log(yt.min) + (M.top + ph - py) / ph * (Math.log(yt.max) - Math.log(yt.min)))
                : py => yt.min + (M.top + ph - py) / ph * (yt.max - yt.min);
            S = { metric: metric, ser: ser, blue: blue, grey: grey, bars: bars, unit: unit, netOn: netOn, aptOn: !!aptVals, gnOn: !!gnVals, cs: cs, realOn: realOn, start: start, end: end, x: x, y: y, yInv: yInv, M: M, pw: pw, plotW: plotW, ph: ph, W: W, H: H, mas: mas, ok: ok, useLog: useLog, inAxis: inAxis };

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

            // 눈금: 세로축은 왼쪽. 휴대폰은 그래프 안 왼쪽, 가로줄 바로 위에 흰 테두리 글자로(선 위에 그린다 — 아래 yLab)
            const grid = svg('g', { class: 'pc-axis' });
            const yLab = svg('g', { class: 'pc-axis pc-ylab' });
            yt.ticks.forEach((v, k) => {
                const yy = Math.round(y(v)) + 0.5;
                grid.appendChild(svg('line', { class: k === 0 && !useLog ? 'pc-base' : 'pc-grid', x1: M.left, x2: M.left + plotW, y1: yy, y2: yy }));
                if (!inAxis) grid.appendChild(svg('text', { class: 'pc-tick', x: M.left - 2 - TAG_PAD, y: yy + 4, 'text-anchor': 'end' }, tickText[k]));
                else if (v !== 0) yLab.appendChild(svg('text', { class: 'pc-tick pc-tick-in', x: M.left + 3, y: yy - 4, 'text-anchor': 'start' }, tickText[k]));   // 0 은 바닥선이라 뺀다(이월 표시와 겹친다)
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

            // 본 지표(파란 선): 옅은 면 + 선. 이월 칸에서 끊는다.
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
                const v = blue[i];
                if (!ok(v)) { flush(); continue; }
                const p = [x(i).toFixed(1), y(v).toFixed(1)];
                line += (seg.length ? 'L' : 'M') + p.join(' ');
                seg.push(p);
            }
            flush();
            const lw = lineWidth(pts, pw);
            if (!unit) data.appendChild(svg('path', { class: 'pc-area', d: area }));
            // 선 하나(면 없이): 회색 지금 돈 가치, 이동평균
            const plain = (arr, cls, width, from, to) => {
                let d = '';
                let pen = false;
                for (let i = from == null ? start : from; i <= (to == null ? end : to); i++) {
                    const v = arr[i];
                    if (!ok(v)) { pen = false; continue; }
                    d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
                    pen = true;
                }
                data.appendChild(svg('path', { class: cls, d: d, style: `stroke-width:${width}px` }));
            };
            if (grey) plain(grey, 'pc-real', Math.min(1.25, lw));
            if (aptVals) {
                // 2008-12 이전(지수로 추정)은 점선. 끊기지 않게 실제 첫 칸까지 점선으로 잇는다
                const cut = cs.cut < 0 ? len : cs.cut;
                if (start < cut) plain(aptVals, 'pc-apt pc-apt-est', 1.75, start, Math.min(end, cut));
                if (end >= cut) plain(aptVals, 'pc-apt', 1.75, Math.max(start, cut), end);
            }
            if (gnVals) {
                const cut = cs.gnCut < 0 ? len : cs.gnCut;
                if (start < cut) plain(gnVals, 'pc-gn pc-apt-est', 1.75, start, Math.min(end, cut));
                if (end >= cut) plain(gnVals, 'pc-gn', 1.75, Math.max(start, cut), end);
            }
            if (!unit) data.appendChild(svg('path', { class: 'pc-line', d: line, style: `stroke-width:${lw}px` }));
            // 봉: 기간이 차지하는 가로 폭의 70%가 몸통, 가운데 세로선이 꼬리(최고~최저)
            shown.forEach(b => {
                if (!ok(b.h) || !ok(b.l)) return;
                const xl = x(b.s - 0.5);
                const xr = x(b.e + 0.5);
                const cx = (xl + xr) / 2;
                const bw = Math.max(1, (xr - xl) * 0.7);
                const yo = y(b.o);
                const yc = y(b.c);
                const cls = 'pc-candle ' + (b.c >= b.o ? 'is-up' : 'is-down');
                const g1 = svg('g', { class: cls });
                g1.appendChild(svg('line', { x1: cx.toFixed(1), x2: cx.toFixed(1), y1: y(b.h).toFixed(1), y2: y(b.l).toFixed(1) }));
                g1.appendChild(svg('rect', { x: (cx - bw / 2).toFixed(1), y: Math.min(yo, yc).toFixed(1), width: bw.toFixed(1), height: Math.max(1, Math.abs(yo - yc)).toFixed(1) }));
                data.appendChild(g1);
            });

            // 보조지표
            mas.forEach(n => plain(ser.ma[n], 'pc-ma pc-ma' + n, Math.min(1.25, lw)));
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

            // 이월 표시 (1등 금액 지표에서 선이 끊긴 자리). 2·3등은 1등 이월과 상관없이 금액이 있다
            const rolls = [];
            if (metric.unit === 'won' && !metric.tier) {
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
            // 끝 점
            const lastBlue = lastOk(blue, start, end, ok);
            if (lastBlue >= 0 && !unit) labels.appendChild(svg('circle', { class: 'pc-dot', cx: x(lastBlue), cy: Math.max(M.top, y(blue[lastBlue])), r: 4 }));
            svgRoot.appendChild(labels);
            if (inAxis) svgRoot.appendChild(yLab);

            // 오른쪽 꼬리표: 보이는 구간 마지막 값. 겹치면 아래 것을 내리고, 밖으로 나가면 되민다
            tags.forEach(t => { t.y = Math.max(M.top, y(t.v)); });
            tags.sort((a, b) => a.y - b.y);
            const GAP = 17;
            for (let k = 1; k < tags.length; k++) if (tags[k].y - tags[k - 1].y < GAP) tags[k].y = tags[k - 1].y + GAP;
            for (let k = tags.length - 1; k >= 0; k--) {
                const limit = k === tags.length - 1 ? M.top + ph : tags[k + 1].y - GAP;
                if (tags[k].y > limit) tags[k].y = limit;
            }
            const tagLayer = svg('g');
            // 파란 꼬리표가 맨 위에 오게 나중에 그린다
            tags.filter(t => t.cls !== 'pc-tag-main').concat(tags.filter(t => t.cls === 'pc-tag-main')).forEach(t => axisTag(tagLayer, t.y, t.text, t.cls, 'right'));
            svgRoot.appendChild(tagLayer);

            S.hoverLayer = svg('g', { class: 'pc-hover' });
            svgRoot.appendChild(S.hoverLayer);

            // 범례: 선이 둘 이상이거나 이월 표시가 있을 때만
            legend.textContent = '';
            const items = [];
            const tagNet = netOn ? ' (' + T('pc.tax.netTag') + ')' : '';
            if (unit) {
                items.push(['pc-key-up', T('pc.c.upKey')]);
                items.push(['pc-key-down', T('pc.c.downKey')]);
            } else if (mas.length || rolls.length || realOn || aptVals || gnVals || (state.unlocked && state.ind.avg)) {
                items.push(['pc-key-main', T(metric.key) + tagNet + (realOn ? ' (' + T('pc.real.nominal') + ')' : '')]);
            }
            if (realOn && !unit) items.push(['pc-key-real', T('pc.real') + ' (' + realAs() + ')']);
            if (aptVals) {
                items.push(['pc-key-apt', T('pc.cmp.aptLegend')]);
            }
            if (gnVals) items.push(['pc-key-gn', T('pc.cmp.gnLegend', { name: gnName() })]);
            // 점선(추정) — 서울은 2008-12, 강남구는 2013-04 이전처럼 달이 다르면 둘 다 적는다
            const aptEstYm = aptVals && apt.estimatedBefore && cs.cut > start ? apt.actualFrom || apt.estimatedBefore : null;
            const gnEstYm = gnVals && gn.estimatedBefore && cs.gnCut > start ? gn.estimatedBefore : null;
            if (aptEstYm && gnEstYm && aptEstYm !== gnEstYm) {
                items.push(['pc-key-apt-est', T('pc.cmp.estBoth', { a: ymLabel(aptEstYm), name: gnName(), b: ymLabel(gnEstYm) })]);
            } else if (aptEstYm || gnEstYm) {
                items.push(['pc-key-apt-est', T('pc.cmp.aptEst', { ym: ymLabel(aptEstYm || gnEstYm) })]);
            }
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
            const parts = [T('pc.sum.scope', { label: scopeLabel, from: from, to: to }) + ' ' + T(metric.key) + tagNet + (realOn ? ' (' + realAs() + ')' : '')];
            if (sum.avg != null) parts.push(T('pc.sum.avg', { v: fmtValue(metric, metric.unit === 'won' ? Math.round(sum.avg) : sum.avg) }));
            if (sum.hi != null) parts.push(T('pc.sum.max', { r: all[sum.hi].round, v: fmtValue(metric, ser.vals[sum.hi]) }));
            if (sum.lo != null) parts.push(T('pc.sum.min', { r: all[sum.lo].round, v: fmtValue(metric, ser.vals[sum.lo]) }));
            if (sum.rollovers && !metric.tier) parts.push(T('pc.sum.roll', { n: sum.rollovers }));
            // 1인당 당첨금(보이는 기준: 세후 또는 세전)이 그 달 아파트 평균가 이상이었던 회차
            const mine = cs ? (netOn ? cs.net : cs.gross) : null;
            const beat = list => {
                let n = 0;
                let m = 0;
                for (let i = start; i <= end; i++) {
                    const a = list[i];
                    if (!a || mine[i] == null) continue;
                    m++;
                    if (mine[i] >= a.v) n++;
                }
                return m ? { n: fmtInt(n), m: fmtInt(m) } : null;
            };
            const bApt = aptVals ? beat(cs.apt) : null;
            if (bApt) parts.push(T(netOn ? 'pc.sum.aptBeat' : 'pc.sum.aptBeatGross', bApt));
            const bGn = gnVals ? beat(cs.gn) : null;
            if (bGn) parts.push(T(netOn ? 'pc.sum.gnBeat' : 'pc.sum.gnBeatGross', Object.assign({ name: gnName() }, bGn)));
            summary.textContent = parts.join(' · ');
            plot.setAttribute('aria-label', T('pc.plotAria', { metric: T(metric.key) }));

            cpiNote.hidden = !realOn;
            if (realOn) cpiNote.textContent = T('pc.real.note', { ym: ymLabel(cpi.latest) });
            // 보는 구간에 1~87회가 있거나, 이동평균 · 봉이 그 회차들까지 끌어와 계산하면 안내한다
            const reach = Math.min(start - (mas.length ? Math.max.apply(null, mas) - 1 : 0), shown.length ? shown[0].s : start);
            const oldPrice = !!(metric.tier && all[Math.max(0, reach)].round < FIRST_1000_WON);
            cmpNote.hidden = !(netOn || aptVals || gnVals || unit || oldPrice);
            if (!cmpNote.hidden) {
                cmpNote.textContent = [
                    oldPrice ? T('pc.tier.note') : '',
                    unit ? T('pc.c.note', { span: T('pc.c.span' + unit) }) : '',
                    netOn ? T('pc.cmp.noteTax') : '',
                    aptVals ? T(apt.estimatedBefore ? 'pc.cmp.noteAptEst' : 'pc.cmp.noteApt', { ym: ymLabel(apt.estimatedBefore || apt.actualFrom || apt.latest) }) : '',
                    gnVals ? T(gn.estimatedBefore ? 'pc.cmp.noteGnEst' : 'pc.cmp.noteGn', { sqm: gn.sqm, ym: ymLabel(gn.estimatedBefore || gn.latest) }) : '',
                ].filter(Boolean).join(' ');
            }
            renderNav(metric, ser, useLog);
            paintControls();
            drawHover(null);
        }

        /* 아래 작은 그래프 (전체 기간) */
        let N = null;
        function renderNav(metric, ser) {
            const W = Math.max(280, Math.round(nav.clientWidth || plot.clientWidth || 600));
            const H = 40;
            // 양 끝 손잡이(폭 8px)가 그림 밖으로 잘리지 않게 좌우를 5px 이상 남긴다 (그래프는 오른쪽 끝까지 차도)
            const L = Math.max(5, S.M.left);
            const R = Math.max(5, S.M.right);
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
            root.classList.toggle('is-compact', S.W < 600);
            root.classList.toggle('is-tier', !!S.metric.tier);   // 2·3등은 정보창 줄이 하나 더 — 높이를 미리 더 잡는다
            if (state.hover === null) {
                readout.textContent = '';
                readout.appendChild(el('p', { className: 'pr-idle', text: T(coarse ? 'pc.readoutIdle' : 'pc.readoutIdleMouse') }));
                return;
            }

            const i = state.hover;
            const xx = Math.round(x(i)) + 0.5;
            layer.appendChild(svg('line', { class: 'pc-cross', x1: xx, x2: xx, y1: M.top, y2: M.top + ph }));
            // 가로 십자선: 그림도구를 쓰는 중이면 손가락 높이, 아니면 파란 선 값에 붙는다
            const hv = state.tool && pointer ? S.yInv(pointer.y) : S.blue[i];
            if (ok(hv)) {
                const hy = Math.round(state.tool && pointer ? pointer.y : y(hv)) + 0.5;
                layer.appendChild(svg('line', { class: 'pc-cross', x1: M.left, x2: M.left + S.pw, y1: hy, y2: hy }));
            }
            S.mas.forEach(n => { const v = ser.ma[n][i]; if (ok(v)) layer.appendChild(svg('circle', { class: 'pc-dot pc-dot-ma' + n, cx: x(i), cy: y(v), r: 4 })); });
            if (S.grey && ok(S.grey[i])) layer.appendChild(svg('circle', { class: 'pc-dot pc-dot-real', cx: x(i), cy: y(S.grey[i]), r: 4 }));
            if (S.aptOn && S.cs.apt[i] && ok(S.cs.apt[i].v)) layer.appendChild(svg('circle', { class: 'pc-dot pc-dot-apt', cx: x(i), cy: y(S.cs.apt[i].v), r: 4 }));
            if (S.gnOn && S.cs.gn[i] && ok(S.cs.gn[i].v)) layer.appendChild(svg('circle', { class: 'pc-dot pc-dot-gn', cx: x(i), cy: y(S.cs.gn[i].v), r: 4 }));
            if (ok(S.blue[i])) layer.appendChild(svg('circle', { class: 'pc-dot', cx: x(i), cy: y(S.blue[i]), r: 5 }));
            // 축 꼬리표: 아래 가로축에 회차, 오른쪽 세로축에 값
            if (ok(hv)) axisTag(layer, state.tool && pointer ? pointer.y : y(hv), fmtValue(metric, hv, true), 'pc-tag-cross', 'left');
            const xl = T('pc.xTick', { n: all[i].round });
            const xw = Math.ceil(measure(xl) + 2 * TAG_PAD);
            const xl0 = Math.max(0, Math.min(S.W - xw, x(i) - xw / 2));
            const xt = svg('g', { class: 'pc-tag pc-tag-cross' });
            xt.appendChild(svg('rect', { x: xl0, y: M.top + ph + 3, width: xw, height: 16, rx: 2 }));
            xt.appendChild(svg('text', { x: xl0 + xw / 2, y: M.top + ph + 15, 'text-anchor': 'middle' }, xl));
            layer.appendChild(xt);

            fillReadout(i);
        }

        // 짚은 회차 값의 이름표: 봉일 때는 고른 기준(지금 돈 가치 등), 선일 때 물가 반영이면 파란 선 = 당시 금액
        function mainLabel() {
            const net = S.netOn ? ' (' + T('pc.tax.netTag') + ')' : '';
            if (S.unit) return T(S.metric.key) + net + (S.realOn ? ' (' + realAs() + ')' : '');
            return (S.realOn ? T('pc.real.nominal') : T(S.metric.key)) + net;
        }
        // 봉: 그 회차가 든 기간, "시 · 고 · 저 · 종", 기간 이름
        function barAt(i) {
            if (!S.bars) return null;
            const b = S.bars.find(q => i >= q.s && i <= q.e);
            return b && b.o !== null ? b : null;
        }
        function ohlcText(b) {
            const f = v => fmtValue(S.metric, v, true);
            return T('pc.c.ohlc', { o: f(b.o), h: f(b.h), l: f(b.l), c: f(b.c) });
        }
        function periodLabel(key) {
            const y = key.slice(0, 4);
            if (key.length === 4) return T('pc.c.pY', { y: y });
            if (key.indexOf('-Q') > 0) return T('pc.c.pQ', { y: y, q: key.slice(-1) });
            return ymLabel(key);
        }

        // 비교 줄들: [색 표시, 값, 이름]. 그 달 서울 · 강남 아파트 평균가, 세후로 몇 채
        function cmpLines(i, short) {
            const out = [];
            const { metric, cs } = S;
            if (!cs) return out;                         // 비교를 끈 화면
            const mine = S.netOn ? cs.net : cs.gross;   // 보이는 선과 같은 기준(세후/세전)으로 "몇 채"
            const est = a => (a.est ? ' · ' + T('pc.cmp.estTag') : '');
            const a = S.aptOn ? cs.apt[i] : null;
            if (a) {
                out.push(['pc-key-apt', fmtValue(metric, a.v, short), T('pc.cmp.aptAt', { ym: ymLabel(a.ym) }) + est(a)]);
                if (mine[i] != null) out.push([null, T('pc.cmp.unitsVal', { n: (mine[i] / a.v).toFixed(2) }), T(S.netOn ? 'pc.cmp.units' : 'pc.cmp.unitsGross')]);
            }
            const g = S.gnOn ? cs.gn[i] : null;
            if (g) {
                out.push(['pc-key-gn', fmtValue(metric, g.v, short), T('pc.cmp.gnAt', { name: gnName(), ym: ymLabel(g.ym) }) + est(g)]);
                if (mine[i] != null) out.push([null, T('pc.cmp.unitsVal', { n: (mine[i] / g.v).toFixed(2) }), T(S.netOn ? 'pc.cmp.gnUnits' : 'pc.cmp.gnUnitsGross', { name: gnName() })]);
            }
            return out;
        }

        // 정보창: 1줄 회차·날짜·번호, 그 아래 값들을 이어서. 좁은 화면은 본 지표만 긴 금액, 나머지는 짧게
        function fillReadout(i) {
            const { ser, metric } = S;
            const short = S.W < 600;
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
            item('pc-key-main', fmtValue(metric, S.blue[i]), mainLabel());
            const bar = barAt(i);
            if (bar) item(null, ohlcText(bar), T('pc.c.of', { p: periodLabel(bar.key) }));
            if (S.netOn) item(null, fmtValue(metric, seriesOf(metric).vals[i], short), T('pc.tax.grossRow'));
            if (S.realOn) {
                if (S.grey) item('pc-key-real', fmtValue(metric, S.grey[i], short), realAs());
                const f = realFactor(cpi, d.date);
                if (f) item(null, '×' + f.toFixed(2), T('pc.real.factor'));
            }
            cmpLines(i, short).forEach(c => item(c[0], c[1], c[2]));
            S.mas.forEach(n => { const v = ser.ma[n][i]; item('pc-key-ma' + n, v == null ? '—' : fmtValue(metric, metric.unit === 'won' && !short ? Math.round(v) : v, short), T(short ? 'pc.i.maShort' : 'pc.i.ma', { n: n })); });
            // 같은 묶음(1등 셋 · 2·3등 둘)의 다른 지표만 — 다 넣으면 정보창이 너무 길다
            metrics.filter(m => m.id !== metric.id && !m.tier === !metric.tier).forEach(m => item(null, fmtValue(m, seriesOf(m).vals[i], short && m.unit === 'won'), T(m.key)));
            if (metric.tier) [['w2', 'pc.i.game2', 'pc.i.games2'], ['w3', 'pc.i.game3', 'pc.i.games3']].forEach(([k, one, many]) => { if (typeof d[k] === 'number') item(null, fmtInt(d[k]) + T('pc.unitGames'), T(d[k] === 1 ? one : many)); });
            readout.appendChild(vals);
        }

        function toSvg(e) {
            const rect = svgRoot.getBoundingClientRect();
            return { x: (e.clientX - rect.left) * (S.W / rect.width), y: (e.clientY - rect.top) * (S.H / rect.height) };
        }
        function pointAt(e) {
            const q = toSvg(e);
            const i = Math.round(S.start + (q.x - S.M.left) / S.pw * Math.max(1, S.end - S.start));
            return { i: Math.min(S.end, Math.max(S.start, i)), x: q.x, y: Math.min(S.M.top + S.ph, Math.max(S.M.top, q.y)) };
        }
        // 화면 가로 자리 → 그 자리의 비율(0~1)과 지금 보는 구간에서의 칸 번호(소수)
        function anchorAt(px) {
            const ratio = Math.min(1, Math.max(0, (px - S.M.left) / S.pw));
            return { ratio: ratio, c: state.view.s + ratio * Math.max(1, state.view.e - state.view.s) };
        }
        const showAt = p => { state.hover = p.i; drawHover(p); };
        const hideHover = () => { if (state.hover === null) return; state.hover = null; drawHover(null); };

        /* 조작 (구간 설정 — 무료). 거래소 차트처럼:
         *  PC     휠 = 확대·축소(커서 자리가 제자리), 가로 휠·Shift+휠 = 옮기기, 끌기 = 옮기기, 두 번 클릭 = 전체 기간
         *  휴대폰 두 손가락 = 확대·축소·옮기기, 확대해 있으면 옆으로 밀기 = 옮기기, 길게 누른 채 밀기 = 값 보기
         * 전체 기간이면 손가락으로 옆으로 밀 때 값을 본다(옮길 데가 없다). 그림도구를 쓰는 중에는 옮기지 않는다. */
        const canMove = () => !state.gated && !state.tool;
        const zoomed = () => state.view.e - state.view.s + 1 < len;
        const pts = new Map();   // 누르고 있는 마우스·손가락: pointerId → svg 좌표
        let gest = null;         // { kind: 'pan' | 'pinch' | 'wait' | 'scrub' | 'idle', … }
        let pressTimer = 0;
        let swallowClick = false;
        const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; } };

        function startPinch() {
            const [a, b] = Array.from(pts.values());
            gest = { kind: 'pinch', d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), w0: state.view.e - state.view.s + 1, c: anchorAt((a.x + b.x) / 2).c };
            clearPress();
            hideHover();
        }
        plot.addEventListener('pointerdown', e => {
            if (!S) return;
            swallowClick = false;
            pts.set(e.pointerId, toSvg(e));
            if (pts.size === 2 && canMove()) { startPinch(); return; }
            if (pts.size > 1) return;
            const p = pointAt(e);
            showAt(p);
            if (e.pointerType === 'mouse') {
                if (e.button === 0 && canMove() && zoomed()) {
                    gest = { kind: 'pan', x0: p.x, view0: Object.assign({}, state.view), moved: false };
                    try { plot.setPointerCapture(e.pointerId); } catch (err) { /* 오래된 브라우저 */ }
                }
                return;
            }
            // 손가락: 누른 자리 값을 먼저 보인다. 옆으로 밀면 옮기기, 그대로 길게 누르면 값 보기
            if (canMove() && zoomed()) {
                gest = { kind: 'wait', x0: p.x, y0: toSvg(e).y, view0: Object.assign({}, state.view), moved: false };
                pressTimer = setTimeout(() => { pressTimer = 0; if (gest && gest.kind === 'wait') gest.kind = 'scrub'; }, 350);
            } else gest = { kind: 'scrub' };
        });
        plot.addEventListener('pointermove', e => {
            if (!S) return;
            const q = toSvg(e);
            if (pts.has(e.pointerId)) pts.set(e.pointerId, q);
            if (gest && gest.kind === 'pinch') {
                if (pts.size < 2) return;
                const [a, b] = Array.from(pts.values());
                const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
                const ratio = ((a.x + b.x) / 2 - S.M.left) / S.pw;
                setView(viewAround(len, Math.round(gest.w0 * gest.d0 / d), gest.c, ratio));
                return;
            }
            if (gest && gest.kind === 'idle') return;
            if (gest && gest.kind === 'wait') {
                const dx = q.x - gest.x0;
                if (Math.abs(dx) <= 6 || Math.abs(dx) < Math.abs(q.y - gest.y0)) return;
                clearPress();
                gest.kind = 'pan';
            }
            if (gest && gest.kind === 'pan') {
                const dx = q.x - gest.x0;
                if (!gest.moved && Math.abs(dx) < 4) { showAt(pointAt(e)); return; }
                if (!gest.moved) { gest.moved = true; plot.classList.add('is-panning'); hideHover(); }
                const v = gest.view0;
                const dI = Math.round(-dx / S.pw * Math.max(1, v.e - v.s));
                setView({ s: v.s + dI, e: v.e + dI });
                return;
            }
            showAt(pointAt(e));
        });
        function endPointer(e, cancelled) {
            pts.delete(e.pointerId);
            clearPress();
            if (!gest) return;
            if (gest.kind === 'pinch' || gest.kind === 'idle') {
                // 두 손가락 중 하나만 떼면 남은 손가락은 뗄 때까지 아무 일도 하지 않는다
                gest = pts.size ? { kind: 'idle' } : null;
                return;
            }
            if (gest.kind === 'pan' && gest.moved) {
                swallowClick = true;
                plot.classList.remove('is-panning');
                if (e.pointerType === 'mouse' && !cancelled) showAt(pointAt(e));
            }
            if (cancelled && e.pointerType !== 'mouse') hideHover();   // 세로로 밀어 페이지를 내렸다
            gest = null;
        }
        plot.addEventListener('pointerup', e => endPointer(e, false));
        plot.addEventListener('pointercancel', e => endPointer(e, true));
        plot.addEventListener('pointerleave', e => {
            if (e.pointerType !== 'mouse' || (gest && gest.kind === 'pan')) return;   // 손가락은 떼도 값을 남겨 둔다. 다른 데를 누르면 닫힌다
            hideHover();
        });
        document.addEventListener('pointerdown', e => {
            if (plot.contains(e.target) || state.hover === null) return;
            hideHover();
        });
        plot.addEventListener('dblclick', e => {
            if (!canMove() || !zoomed()) return;
            e.preventDefault();
            setView({ s: 0, e: len - 1 }, true);
        });
        // 두 손가락은 페이지 확대·스크롤 대신 그래프 확대로 (사파리는 gesturestart 로 페이지를 키운다)
        const stopTwo = e => { if (e.touches.length > 1 && canMove() && e.cancelable) e.preventDefault(); };
        plot.addEventListener('touchstart', stopTwo, { passive: false });
        plot.addEventListener('touchmove', stopTwo, { passive: false });
        plot.addEventListener('gesturestart', e => { if (canMove()) e.preventDefault(); });

        // 휠. 페이지를 굴려 내려가다 그래프가 커서 밑으로 지나가면 페이지를 계속 굴린다(방금 페이지가 움직였으면 손대지 않는다).
        // 더 넓힐 수 없는데(전체 기간) 아래로 굴리거나, 더 좁힐 수 없는데 위로 굴리면 페이지가 굴러간다
        let lastScroll = 0;
        let lastWheel = 0;
        let panAcc = 0;
        g.addEventListener('scroll', () => { lastScroll = Date.now(); }, { passive: true });
        plot.addEventListener('wheel', e => {
            if (!S || !canMove()) return;
            const now = Date.now();
            const mine = now - lastWheel < 300;
            if (!mine && now - lastScroll < 300) return;
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? S.H : 1;
            let dx = e.deltaX * unit;
            let dy = e.deltaY * unit;
            if (e.shiftKey && !dx) { dx = dy; dy = 0; }
            const v = state.view;
            const w = v.e - v.s + 1;
            if (Math.abs(dx) > Math.abs(dy)) {
                if (w >= len) return;
                e.preventDefault();
                lastWheel = now;
                panAcc += dx / S.pw * w;
                const step = Math.trunc(panAcc);
                if (step) { panAcc -= step; setView({ s: v.s + step, e: v.e + step }); }
                return;
            }
            if (!dy) return;
            if (dy > 0 ? w >= len : w <= Math.min(MIN_VIEW, len)) {
                if (mine) { e.preventDefault(); lastWheel = now; }   // 굴리던 손길이 끝까지 와도 페이지가 갑자기 움직이지 않게
                return;
            }
            e.preventDefault();
            lastWheel = now;
            const an = anchorAt(toSvg(e).x);
            setView(viewAround(len, wheelWidth(w, dy, e.ctrlKey), an.c, an.ratio));
        }, { passive: false });

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

        // 키보드: ← → 한 회차, PageUp/PageDown 10회차, Home/End 처음·끝, + - 확대·축소, Esc 닫기.
        // 이용권이 있으면 보는 구간 끝을 넘어갈 때 구간도 따라 옮긴다
        plot.addEventListener('keydown', e => {
            if (!S) return;
            if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
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
            i = Math.min(len - 1, Math.max(0, i));
            if (canMove() && (i < state.view.s || i > state.view.e)) {
                const dI = i < state.view.s ? i - state.view.s : i - state.view.e;
                setView({ s: state.view.s + dI, e: state.view.e + dI }, true);
            }
            state.hover = Math.min(S.end, Math.max(S.start, i));
            drawHover(null);
            const d = all[state.hover];
            live.textContent = T('pc.drawNo', { n: d.round }) + ' ' + (d.date || '') + ', ' + T(S.metric.key) + ' ' + fmtValue(S.metric, S.blue[state.hover]) +
                (S.realOn && S.grey ? ', ' + realAs() + ' ' + fmtValue(S.metric, S.grey[state.hover]) : '') +   // 봉 차트는 회색 선이 없다
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
            if (!N) return;
            const p = navIndex(e);
            const xs = N.x(state.view.s);
            const xe = N.x(state.view.e);
            const w = state.view.e - state.view.s;
            let mode = 'move';
            if (Math.abs(p.px - xs) <= 10) mode = 'l';
            else if (Math.abs(p.px - xe) <= 10) mode = 'r';
            else if (p.px < xs || p.px > xe) setView({ s: p.i - Math.round(w / 2), e: p.i - Math.round(w / 2) + w }, true);
            navDrag = { mode: mode, grab: p.i, view: Object.assign({}, state.view) };
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
        const navEnd = () => { if (!navDrag) return; navDrag = null; render(); };
        nav.addEventListener('pointerup', navEnd);
        nav.addEventListener('pointercancel', navEnd);
        // 키보드: ← → 구간 옮기기, + - 확대·축소
        nav.addEventListener('keydown', e => {
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

        // 폭이 바뀌면 다시 그린다 (휴대폰 회전, 접은 상자를 다시 펼칠 때 등)
        const onResize = () => {
            const w = Math.round(plot.clientWidth);
            if (w && w !== lastW) { lastW = w; render(); }
        };
        if (g.ResizeObserver) new g.ResizeObserver(() => g.requestAnimationFrame(onResize)).observe(plot);
        else g.addEventListener('resize', onResize);
        // 접는 상자(<details>)를 다시 펼치면 한 번 더 그린다 — ResizeObserver 가 없거나, 접힌 동안 그리기를 미룬 경우
        const fold = root.closest && root.closest('details');
        if (fold) fold.addEventListener('toggle', () => { if (fold.open) { lastW = 0; onResize(); } });

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
                    state.ind = indOf(FREE_IND);   // 이용권이 없으면 240회 이동평균만
                    state.tool = null;
                    state.pending = null;
                    if (!freeCandle(state.candle)) state.candle = null;   // 분기봉·연봉은 잠기므로 처음 화면(선)으로
                }
                render();
            },
        };
    }

    return {
        METRICS: METRICS,
        DEFAULT_IND: DEFAULT_IND,
        FREE_IND: FREE_IND,
        mount: mount,
        movingAverage: movingAverage,
        realFactor: realFactor,
        lineWidth: lineWidth,
        clampView: clampView,
        zoomView: zoomView,
        afterTax: afterTax,
        aptAt: aptAt,
        candles: candles,
        viewAround: viewAround,
        wheelWidth: wheelWidth,
        MIN_VIEW: MIN_VIEW,
        niceStep: niceStep,
        linearTicks: linearTicks,
        logTicks: logTicks,
        summarize: summarize,
        wonLong: wonLong,
        wonShort: wonShort,
    };
}));
