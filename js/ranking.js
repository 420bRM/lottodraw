/* 회원 랭킹 페이지 (ranking.html). 점수 계산은 서버(worker/src/community.js)가 한다.
   로그인했으면 내 순위도 위에 보여 준다. 로그인을 켜기 전에는 "준비 중"으로 둔다. */
(function () {
    'use strict';

    const api = () => String((window.PREMIUM_CONFIG && window.PREMIUM_CONFIG.apiBase) || 'https://api.lottodraw.kr').replace(/\/+$/, '');
    const tr = (key, ko, vars) => {
        let s = window.I18N ? window.I18N.t(key, ko) : ko;
        if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
        return s;
    };
    const $ = id => document.getElementById(id);

    function el(tag, props, kids) {
        const n = document.createElement(tag);
        Object.keys(props || {}).forEach(k => { if (k === 'text') n.textContent = props[k]; else if (k === 'className') n.className = props[k]; else n.setAttribute(k, props[k]); });
        (kids || []).forEach(c => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return n;
    }

    function session() {
        try { const s = JSON.parse(localStorage.getItem('lottodraw.account') || 'null'); return s && s.session; } catch (e) { return null; }
    }

    function fill(rows, message) {
        const body = $('rank-table').querySelector('tbody');
        body.textContent = '';
        if (message) { body.appendChild(el('tr', {}, [el('td', { colspan: '4', text: message })])); return; }
        rows.forEach(r => body.appendChild(el('tr', { className: r.rank <= 3 ? 'top' + r.rank : '' }, [
            el('td', { text: r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : String(r.rank) }),
            el('td', { text: r.nick }),
            el('td', { text: tr('rank.pts', '{n}점', { n: r.points.toLocaleString() }) }),
            el('td', { text: tr('rank.days', '{n}일', { n: r.days }) }),
        ])));
    }

    function showMe(me) {
        const box = $('rank-me');
        box.textContent = '';
        if (!me) return;
        box.hidden = false;
        box.appendChild(el('p', { className: 'rank-me-line' }, [
            el('b', { text: me.nick ? tr('rank.meNamed', '{nick} 님은 {rank}위', { nick: me.nick, rank: me.rank }) : tr('rank.meUnnamed', '별명을 정하면 {rank}위로 올라갑니다', { rank: me.rank }) }),
            ' ',
            el('span', { text: tr('rank.meScore', '{total}점 (출석 {days}일 · 반응 {reacts}개 · 이용권 {buy}점)', me) }),
        ]));
    }

    async function load() {
        const headers = { Accept: 'application/json' };
        const s = session();
        if (s) headers.Authorization = 'Bearer ' + s;
        try {
            const res = await fetch(api() + '/api/ranking', { headers, cache: 'no-cache' });
            if (res.status === 503) { fill([], tr('rank.off', '회원 기능을 준비하고 있습니다.')); return; }
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || res.status);
            if (data.points) {
                const p = data.points;
                const rules = $('rank-rules').children;
                rules[0].textContent = tr('rank.r1x', '출석: 하루 한 번, 로그인한 채 사이트에 들어오면 +{n}점', { n: p.attend });
                rules[1].textContent = tr('rank.r2x', '반응: 카드에 남긴 ♥ · $ · ₩ 하나마다 +{n}점 (취소하면 빠집니다)', { n: p.react });
                rules[2].textContent = tr('rank.r3x', '이용권: 로그인한 채 산 이용권 금액 100원마다 +{n}점 (환불하면 빠집니다)', { n: p.buyPer100 });
            }
            fill(data.top || [], (data.top || []).length ? '' : tr('rank.empty', '아직 순위에 오른 회원이 없습니다. 첫 번째가 되어 보세요!'));
            showMe(data.me);
        } catch (e) {
            fill([], tr('rank.fail', '랭킹을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'));
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
    else load();
})();
