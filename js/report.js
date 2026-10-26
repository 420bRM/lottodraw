/* 내 번호 성적표 (report.html, 2026-10-21).
 *
 * 번호 6개로 1회부터 마지막 회차까지 매주 한 게임씩 샀다면 어땠는지: 쓴 돈 · 받은 돈(세전) · 손익 · 등수별 횟수 · 가장 좋았던 회차.
 * 요약은 누구나 보고, 자세한 내역(아까웠던 회차 · 당첨된 회차 전체 · 연도별 · 첫 당첨과 가장 길었던 꽝 행진)은 이용권으로 연다(js/license.js).
 *
 * - 당첨금은 그 회차에 실제로 지급된 1게임당 금액(세전): 1등은 lotto-data.json 의 1인당 금액, 2~5등은 prize-data.json 의 a2~a5.
 *   1등이 없던(이월) 회차에 1등이었다면 금액을 알 수 없어 0원으로 두고 따로 센다(unknown).
 * - 한 게임 값은 1~87회 2,000원, 88회부터 1,000원.
 * - 지난 기록일 뿐이다. 다음 회차를 예측하지 않고, 어떤 조합이든 1등 확률은 1/8,145,060 이다.
 * 계산(compute)은 브라우저 없이도 돈다 — 시험: node tools/test-report.js
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LottoReport = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PRICE_CHANGE = 88;   // 이 회차부터 1게임 1,000원
    const costOf = round => (round < PRICE_CHANGE ? 2000 : 1000);
    const rankOf = (hits, bonus) => (hits === 6 ? 1 : hits === 5 && bonus ? 2 : hits === 5 ? 3 : hits === 4 ? 4 : hits === 3 ? 5 : 0);
    const NEAR = 5;   // 아까웠던 회차 몇 개

    // draws: lotto-data.json 의 draws, prizes: prize-data.json 의 draws(없으면 2~5등 금액을 0원으로), picks: 번호 6개
    function compute(draws, prizes, picks) {
        const set = new Set(picks);
        const tier = new Map((prizes || []).map(p => [p.round, p]));
        const list = draws.slice().sort((a, b) => a.round - b.round);
        const out = {
            picks: picks.slice().sort((a, b) => a - b),
            games: list.length, from: list[0].round, to: list[list.length - 1].round,
            fromDate: list[0].date, toDate: list[list.length - 1].date,
            spent: 0, won: 0, net: 0, ranks: [0, 0, 0, 0, 0, 0], wins: [], near: [], unknown: 0,
            best: null, firstWin: null, drought: { len: 0, from: null, to: null }, years: [],
        };
        const years = new Map();
        let run = 0;
        let runFrom = null;
        const closeRun = lastRound => {
            if (run > out.drought.len) out.drought = { len: run, from: runFrom, to: lastRound };
            run = 0;
        };
        let prev = null;
        list.forEach(d => {
            const hits = d.numbers.filter(n => set.has(n)).length;
            const bonus = set.has(d.bonus);
            const rank = rankOf(hits, bonus);
            const cost = costOf(d.round);
            let amount = 0;
            if (rank === 1) amount = d.firstPrizeWinners > 0 ? (d.firstPrizeAmount || 0) : 0;
            else if (rank > 1) { const t = tier.get(d.round); amount = (t && t['a' + rank]) || 0; }
            if (rank && !amount) out.unknown++;
            out.spent += cost;
            out.won += amount;
            const row = { round: d.round, date: d.date, rank: rank, amount: amount, hits: hits, bonusHit: bonus, numbers: d.numbers.slice().sort((a, b) => a - b), bonus: d.bonus };
            if (rank) {
                out.ranks[rank]++;
                out.wins.push(row);
                if (!out.firstWin) out.firstWin = row;
                closeRun(prev);
            } else {
                if (!run) runFrom = d.round;
                run++;
            }
            // 아까웠던 회차: 많이 맞힌 순, 같으면 보너스까지 맞힌 쪽, 같으면 최근 회차
            if (hits >= 3) {
                out.near.push(row);
                out.near.sort((a, b) => (b.hits - a.hits) || (b.bonusHit - a.bonusHit) || (b.round - a.round));
                if (out.near.length > NEAR) out.near.length = NEAR;
            }
            const y = d.date.slice(0, 4);
            const yr = years.get(y) || { year: y, games: 0, spent: 0, won: 0, wins: 0 };
            yr.games++;
            yr.spent += cost;
            yr.won += amount;
            if (rank) yr.wins++;
            years.set(y, yr);
            prev = d.round;
        });
        closeRun(prev);
        out.net = out.won - out.spent;
        out.years = [...years.values()];
        out.best = out.wins.slice().sort((a, b) => (a.rank - b.rank) || (b.amount - a.amount) || (b.round - a.round))[0] || null;
        return out;
    }

    // 붙여 넣은 글에서 번호를 뽑는다. 1~45 서로 다른 6개면 오름차순 배열, 아니면 null
    function parsePicks(text) {
        const nums = (String(text || '').match(/\d+/g) || []).map(Number);
        const uniq = nums.filter((v, i, a) => a.indexOf(v) === i);
        if (uniq.length !== 6 || uniq.some(n => n < 1 || n > 45)) return null;
        return uniq.sort((a, b) => a - b);
    }

    const api = { compute: compute, parsePicks: parsePicks, costOf: costOf, rankOf: rankOf };
    if (typeof document === 'undefined' || !document.getElementById) return api;

    /* ───── 화면 (report.html) ───── */

    const $ = id => document.getElementById(id);
    const T = (k, v) => (v ? I18N.f(k, v) : I18N.t(k));
    const en = () => window.I18N && I18N.lang === 'en';
    const fmt = n => Number(n).toLocaleString(en() ? 'en-US' : 'ko-KR');
    const won = n => (en() ? (n < 0 ? '-₩' : '₩') + fmt(Math.abs(n)) : (n < 0 ? '-' : '') + fmt(Math.abs(n)) + '원');
    const bandOf = n => (n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5);

    function el(tag, props, kids) {
        const n = document.createElement(tag);
        Object.keys(props || {}).forEach(k => {
            if (k === 'text') n.textContent = props[k];
            else if (k === 'className') n.className = props[k];
            else if (k === 'on') Object.keys(props.on).forEach(ev => n.addEventListener(ev, props.on[ev]));
            else n.setAttribute(k, props[k]);
        });
        (kids || []).forEach(c => { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return n;
    }
    const ball = (n, on) => el('span', Object.assign({ className: 'mball' + (on === false ? ' my-miss' : ''), text: String(n) }, on === false ? {} : { 'data-band': String(bandOf(n)) }));
    const roundLink = r => el('a', { href: 'round/' + r + '.html', text: T('rc.roundN', { n: r }) });
    const rankName = r => T('rc.rank' + r);

    let data = null;
    function loadData() {
        if (data) return data;
        const lotto = window.SiteHeader && window.SiteHeader.loadData ? window.SiteHeader.loadData()
            : fetch('lotto-data.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
        const prize = fetch('prize-data.json').then(r => (r.ok ? r.json() : { draws: [] })).catch(() => ({ draws: [] }));
        data = Promise.all([lotto, prize]).then(([l, p]) => ({ draws: l.draws, prizes: p.draws || [] }));
        return data;
    }

    // 이용권이 있으면 자세히 연다. 한 번 확인하면 이 페이지에서는 다시 묻지 않는다
    let unlocked = null;
    function passState() {
        if (!unlocked) {
            const L = window.LottoLicense;
            unlocked = L && L.savedKey && L.savedKey() ? L.unlockState().then(s => !!(s && s.unlocked)).catch(() => false) : Promise.resolve(false);
        }
        return unlocked;
    }

    function renderSummary(r) {
        const box = $('rc-out');
        box.textContent = '';
        const best = r.best;
        box.appendChild(el('div', { className: 'rc-picks' }, r.picks.map(n => ball(n))));
        box.appendChild(el('p', { className: 'rc-range', text: T('rc.range', { from: r.from, to: r.to, fromDate: r.fromDate, toDate: r.toDate, games: fmt(r.games) }) }));
        box.appendChild(el('div', { className: 'rc-tiles' }, [
            el('div', {}, [el('span', { text: T('rc.spent') }), el('b', { text: won(r.spent) })]),
            el('div', {}, [el('span', { text: T('rc.won') }), el('b', { text: won(r.won) })]),
            el('div', { className: r.net < 0 ? 'is-loss' : 'is-gain' }, [el('span', { text: T('rc.net') }), el('b', { text: won(r.net) })]),
        ]));
        const head = el('tr', {}, [1, 2, 3, 4, 5].map(k => el('th', { text: rankName(k) })));
        const body = el('tr', {}, [1, 2, 3, 4, 5].map(k => el('td', { text: T('rc.times', { n: fmt(r.ranks[k]) }) })));
        box.appendChild(el('div', { className: 'table-wrap' }, [el('table', { className: 'data-table rc-ranks' }, [el('thead', {}, [head]), el('tbody', {}, [body])])]));
        box.appendChild(best
            ? el('p', { className: 'rc-best' }, [T('rc.bestPre'), roundLink(best.round), ` (${best.date}) `, el('b', { text: rankName(best.rank) }), ' · ' + (best.amount ? won(best.amount) : T('rc.unknownAmt'))])
            : el('p', { className: 'rc-best', text: T('rc.noWin') }));
        if (r.unknown) box.appendChild(el('p', { className: 'card-note', text: T('rc.unknown', { n: r.unknown }) }));
        box.appendChild(el('p', { className: 'card-note', text: T('rc.note') }));
        box.hidden = false;
    }

    function renderLocked(r) {
        const box = $('rc-more');
        box.textContent = '';
        box.appendChild(el('h2', { className: 'card-title' }, [el('span', { text: T('rc.moreH') }), el('small', { text: T('rc.pass') })]));
        box.appendChild(el('div', { className: 'card-body' }, [
            el('ul', { className: 'rc-teaser' }, [
                el('li', { text: T('rc.tNear', { n: r.near.length }) }),
                el('li', { text: T('rc.tWins', { n: fmt(r.wins.length) }) }),
                el('li', { text: T('rc.tYears', { n: r.years.length }) }),
                el('li', { text: T('rc.tDrought') }),
            ]),
            el('p', { className: 'page-actions' }, [el('a', { className: 'btn', href: 'statistics.html#paywall', text: T('rc.cta') })]),
            el('p', { className: 'card-note', text: T('rc.ctaNote') }),
        ]));
        box.classList.add('rc-locked');
        box.hidden = false;
    }

    function renderDetail(r) {
        const box = $('rc-more');
        box.textContent = '';
        box.classList.remove('rc-locked');
        const set = new Set(r.picks);
        const numRow = row => el('span', { className: 'strategy-nums' }, row.numbers.map(n => ball(n, set.has(n))).concat(
            [el('span', { className: 'plus', text: '+' }), ball(row.bonus, set.has(row.bonus))]));
        const kids = [];
        // 첫 당첨 · 가장 길었던 꽝 행진
        kids.push(el('p', {}, r.firstWin
            ? [T('rc.firstPre'), roundLink(r.firstWin.round), ` (${r.firstWin.date}) · ${rankName(r.firstWin.rank)}`]
            : [T('rc.noWin')]));
        if (r.drought.len) kids.push(el('p', {}, [T('rc.drought', { n: fmt(r.drought.len) }) + ' ', roundLink(r.drought.from), ' ~ ', roundLink(r.drought.to)]));
        // 아까웠던 회차
        kids.push(el('h3', { text: T('rc.nearH') }));
        kids.push(r.near.length ? el('ul', { className: 'ball-list rc-near' }, r.near.map(row => el('li', {}, [
            el('span', { className: 'lead' }, [roundLink(row.round)]),
            numRow(row),
            el('span', { className: 'tail', text: T('rc.hits', { n: row.hits }) + (row.bonusHit ? ' + ' + T('rc.bonus') : '') + (row.rank ? ' · ' + rankName(row.rank) : '') }),
        ]))) : el('p', { className: 'muted', text: T('rc.noNear') }));
        // 당첨된 회차: 1~4등은 다 보이고, 5등은 접어 둔다(수백 줄)
        kids.push(el('h3', { text: T('rc.winsH', { n: fmt(r.wins.length) }) }));
        const winTable = rows => el('div', { className: 'table-wrap' }, [el('table', { className: 'data-table rc-wins' }, [
            el('thead', {}, [el('tr', {}, [T('rc.colRound'), T('rc.colDate'), T('rc.colNums'), T('rc.colRank'), T('rc.colAmt')].map(h => el('th', { text: h })))]),
            el('tbody', {}, rows.slice().reverse().map(w => el('tr', {}, [
                el('td', {}, [roundLink(w.round)]), el('td', { text: w.date }), el('td', {}, [numRow(w)]),
                el('td', { text: rankName(w.rank) }), el('td', { text: w.amount ? won(w.amount) : T('rc.unknownAmt') }),
            ]))),
        ])]);
        const top = r.wins.filter(w => w.rank <= 4);
        const fifth = r.wins.filter(w => w.rank === 5);
        if (top.length) kids.push(winTable(top));
        else kids.push(el('p', { className: 'muted', text: T('rc.noTop') }));
        if (fifth.length) kids.push(el('details', { className: 'rc-fifth' }, [el('summary', { text: T('rc.fifth', { n: fmt(fifth.length) }) }), winTable(fifth)]));
        // 연도별
        kids.push(el('h3', { text: T('rc.yearsH') }));
        kids.push(el('div', { className: 'table-wrap' }, [el('table', { className: 'data-table rc-years' }, [
            el('thead', {}, [el('tr', {}, [T('rc.colYear'), T('rc.colGames'), T('rc.spent'), T('rc.won'), T('rc.net'), T('rc.colWins')].map(h => el('th', { text: h })))]),
            el('tbody', {}, r.years.slice().reverse().map(y => el('tr', {}, [
                el('td', { text: y.year }), el('td', { text: fmt(y.games) }), el('td', { text: won(y.spent) }),
                el('td', { text: won(y.won) }), el('td', { className: y.won - y.spent < 0 ? 'is-loss' : 'is-gain', text: won(y.won - y.spent) }), el('td', { text: fmt(y.wins) }),
            ]))),
        ])]));
        box.appendChild(el('h2', { className: 'card-title' }, [el('span', { text: T('rc.moreH') }), el('small', { text: T('rc.passOn') })]));
        box.appendChild(el('div', { className: 'card-body' }, kids));
        box.hidden = false;
    }

    async function run(picks, fromUser) {
        const status = $('rc-status');
        status.classList.remove('error');
        if (!picks) {
            status.textContent = T('rc.err');
            status.classList.add('error');
            return;
        }
        status.textContent = T('rc.loading');
        let d;
        try { d = await loadData(); } catch (e) {
            status.textContent = T('rc.loadFail');
            status.classList.add('error');
            return;
        }
        status.textContent = '';
        const r = compute(d.draws, d.prizes, picks);
        renderSummary(r);
        if (await passState()) renderDetail(r); else renderLocked(r);
        try { history.replaceState(null, '', location.pathname + '?n=' + r.picks.join(',') + location.hash); } catch (e) { /* 그만 */ }
        if (fromUser) $('rc-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function randomPicks() {
        const pool = Array.from({ length: 45 }, (_, i) => i + 1);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, 6).sort((a, b) => a - b);
    }

    function init() {
        const input = $('rc-input');
        if (!input) return;
        const go = () => run(parsePicks(input.value), true);
        $('rc-go').addEventListener('click', go);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        $('rc-random').addEventListener('click', () => { const p = randomPicks(); input.value = p.join(' '); run(p, true); });
        // 홈 생성기 · 마이페이지에서 번호를 들고 온 경우(report.html?n=3,11,19,27,34,42)
        let fromUrl = null;
        try { fromUrl = parsePicks(new URLSearchParams(location.search).get('n')); } catch (e) { fromUrl = null; }
        if (fromUrl) { input.value = fromUrl.join(' '); run(fromUrl, false); }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    return api;
}));
