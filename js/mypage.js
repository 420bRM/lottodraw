/* 마이페이지 (mypage.html). 내 정보 · 이용권 · 점수/랭킹 · 계정 관리를 한곳에 모은다.
 *
 * 서버에 새로 묻는 것은 없다 — 로그인 정보는 js/account.js(LottoAccount)가, 이용권은 js/license.js(LottoLicense)가
 * 이미 하는 일을 그대로 쓴다. 순위만 /api/ranking 에 묻는다(랭킹 페이지와 같은 길).
 * 이용권은 로그인과 상관없이 "이 브라우저에 저장된 키"라서 로그인하지 않아도 보인다.
 */
(function () {
    'use strict';

    const api = () => String((window.PREMIUM_CONFIG && window.PREMIUM_CONFIG.apiBase) || 'https://api.lottodraw.kr').replace(/\/+$/, '');
    const tr = (key, ko, vars) => {
        let s = window.I18N ? window.I18N.t(key, ko) : ko;
        if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
        return s;
    };
    const $ = id => document.getElementById(id);
    const num = n => Number(n || 0).toLocaleString(window.I18N && window.I18N.lang === 'en' ? 'en-US' : 'ko-KR');
    const ymd = ms => {
        const d = new Date(ms);
        if (isNaN(d)) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    function el(tag, props, kids) {
        const n = document.createElement(tag);
        Object.keys(props || {}).forEach(k => {
            if (k === 'text') n.textContent = props[k];
            else if (k === 'className') n.className = props[k];
            else if (k === 'on') Object.keys(props[k]).forEach(ev => n.addEventListener(ev, props[k][ev]));
            else n.setAttribute(k, props[k]);
        });
        (kids || []).forEach(c => c != null && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return n;
    }

    // 상자 본문을 갈아 끼운다
    function fill(id, kids) {
        const body = $(id).querySelector('.my-body');
        body.textContent = '';
        kids.forEach(k => k && body.appendChild(k));
    }
    // 이름 · 값 한 줄
    const row = (label, value, extra) => el('div', { className: 'my-row' }, [
        el('span', { className: 'my-k', text: label }),
        el('span', { className: 'my-v' }, [typeof value === 'string' ? value : value, extra || null]),
    ]);
    const btn = (text, onClick, cls) => el('button', { type: 'button', className: 'btn btn-secondary btn-mini' + (cls ? ' ' + cls : ''), text: text, on: { click: onClick } });

    async function copy(text, button) {
        try {
            await navigator.clipboard.writeText(text);
            const old = button.textContent;
            button.textContent = tr('my.copied', '복사했습니다');
            setTimeout(() => { button.textContent = old; }, 1500);
        } catch (e) {
            window.prompt(tr('my.copyManual', '아래 내용을 복사해 주세요'), text);
        }
    }

    /* ───── 이용권 (이 브라우저) ───── */

    async function showPass(user) {
        const L = window.LottoLicense;
        const trial = user && user.trial;
        const trialLine = user ? row(tr('my.trial', '무료 체험'), trial
            ? (trial.expiresAt > Date.now() ? tr('my.trialUntil', '{date}까지', { date: ymd(trial.expiresAt) }) : tr('my.trialOver', '끝났습니다 ({date})', { date: ymd(trial.expiresAt) }))
            : tr('my.trialNone', '받지 않음 (계정당 한 번)')) : null;
        const seePlans = el('a', { className: 'btn btn-mini', href: 'statistics.html', text: tr('my.seePlans', '이용권 보기') });

        if (!L || !L.savedKey()) {
            fill('my-pass', [
                el('p', { text: tr('my.passNone', '이 브라우저에는 이용권이 없습니다.') }),
                trialLine,
                el('p', { className: 'my-muted', text: tr('my.passNoneHint', '다른 기기에서 산 이용권은 그 기기의 "다른 기기용 링크"를 여기서 열면 이 브라우저에서도 열립니다.') }),
                el('div', { className: 'my-actions' }, [seePlans]),
            ]);
            return;
        }
        fill('my-pass', [el('p', { className: 'my-muted', text: tr('my.passChecking', '이용권을 확인하는 중…') })]);
        let state;
        try { state = await L.unlockState(); } catch (e) { state = { unlocked: false, reason: tr('my.passFail', '이용권을 확인하지 못했습니다. 잠시 뒤 다시 열어 주세요.') }; }
        if (!state.unlocked) {
            fill('my-pass', [
                el('p', { className: 'my-warn', text: state.reason || tr('my.passFail', '이용권을 확인하지 못했습니다. 잠시 뒤 다시 열어 주세요.') }),
                trialLine,
                el('div', { className: 'my-actions' }, [seePlans]),
            ]);
            return;
        }
        const r = state.record || {};
        const key = r.key || L.savedKey();
        const keyBox = el('div', { className: 'my-key', hidden: '' }, [
            el('code', { text: key }),
            el('div', { className: 'my-actions' }, [
                btn(tr('my.copyKey', '키 복사'), e => copy(key, e.currentTarget)),
                btn(tr('my.copyLink', '다른 기기용 링크 복사'), e => copy(location.origin + location.pathname.replace(/[^/]*$/, '') + 'statistics.html#key=' + key, e.currentTarget)),
            ]),
        ]);
        const toggle = btn(tr('my.showKey', '키 보기'), () => {
            keyBox.hidden = !keyBox.hidden;
            toggle.textContent = keyBox.hidden ? tr('my.showKey', '키 보기') : tr('my.hideKey', '키 숨기기');
        });
        fill('my-pass', [
            el('p', { className: 'my-ok', text: tr('my.passOn', '이용권이 열려 있습니다') + (state.offline ? ' ' + tr('my.offline', '(오프라인 — 마지막 확인 기준)') : '') }),
            row(tr('my.plan', '종류'), r.plan || ''),
            row(tr('my.until', '기간'), r.expiresAt ? tr('my.untilDate', '{date}까지', { date: ymd(r.expiresAt) }) : tr('my.noLimit', '기간 제한 없음')),
            r.keyId ? row(tr('my.keyNo', '키 번호'), String(r.keyId).toUpperCase()) : null,
            trialLine,
            el('div', { className: 'my-actions' }, [toggle, el('a', { className: 'btn btn-mini', href: 'statistics.html', text: tr('my.goStats', '5개월 통계 보기') })]),
            keyBox,
        ]);
    }

    /* ───── 로그인한 회원 ───── */

    function showProfile(user) {
        const A = window.LottoAccount;
        fill('my-profile', [
            row(tr('my.nick', '별명'), user.nick || tr('my.nickNone', '아직 없음'),
                A && A.openNick ? btn(user.nick ? tr('my.nickChange', '바꾸기') : tr('my.nickSet', '정하기'), () => A.openNick(!user.nick)) : null),
            row(tr('my.email', '이메일'), user.email || ''),
            row(tr('my.joined', '가입일'), ymd(user.createdAt)),
            user.staff ? row(tr('my.role', '구분'), tr('my.staff', '운영자 계정')) : null,
        ]);
    }

    async function showScore(user, reactions) {
        const sc = user.score || {};
        const counts = { h: 0, d: 0, w: 0 };
        Object.values(reactions || {}).forEach(v => String(v).split('').forEach(t => { if (counts[t] !== undefined) counts[t]++; }));
        const rankLine = row(tr('my.rank', '순위'), tr('my.loading', '불러오는 중…'));
        fill('my-score', [
            el('div', { className: 'my-big' }, [
                el('div', null, [el('b', { text: num(sc.total) }), el('span', { text: tr('my.points', '점수') })]),
                el('div', null, [el('b', { text: num(sc.avail != null ? sc.avail : sc.total) }), el('span', { text: tr('my.avail', '쓸 수 있는 포인트') })]),
            ]),
            rankLine,
            row(tr('my.days', '출석'), tr('my.daysN', '{n}일', { n: num(sc.days) })),
            row(tr('my.reacts', '남긴 반응'), tr('my.reactsN', '♥ {h} · $ {d} · ₩ {w}', counts)),
            row(tr('my.buy', '이용권 점수'), tr('my.ptsN', '{n}점', { n: num(sc.buy) })),
            sc.spent ? row(tr('my.spent', '쓴 포인트'), tr('my.ptsN', '{n}점', { n: num(sc.spent) })) : null,
            el('div', { className: 'my-actions' }, [el('a', { className: 'btn btn-secondary btn-mini', href: 'ranking.html', text: tr('my.goRanking', '랭킹 보기') })]),
        ]);
        // 순위는 랭킹 페이지와 같은 길로 묻는다
        try {
            const s = JSON.parse(localStorage.getItem('lottodraw.account') || 'null');
            const res = await fetch(api() + '/api/ranking', { headers: Object.assign({ Accept: 'application/json' }, s && s.session ? { Authorization: 'Bearer ' + s.session } : {}), cache: 'no-cache' });
            const data = await res.json();
            const me = res.ok && data.me;
            rankLine.querySelector('.my-v').textContent = !me ? '—'
                : me.nick ? tr('my.rankN', '{rank}위 / {of}명', { rank: num(me.rank), of: num(me.of) })
                    : tr('my.rankUnnamed', '별명을 정하면 {rank}위로 오릅니다', { rank: num(me.rank) });
        } catch (e) {
            rankLine.querySelector('.my-v').textContent = '—';
        }
    }

    function showAccount() {
        const A = window.LottoAccount;
        fill('my-account', [
            el('p', { className: 'my-muted', text: tr('my.accountHint', '로그아웃해도 이 브라우저의 이용권 키는 그대로 남습니다.') }),
            el('div', { className: 'my-actions' }, [
                btn(tr('my.logout', '로그아웃'), () => A.logout()),
                btn(tr('my.delete', '회원 탈퇴'), () => A.withdraw(), 'my-danger'),
            ]),
        ]);
    }

    // 로그인하지 않았거나 회원 기능이 꺼져 있을 때: 회원 상자 셋을 안내 하나로 바꾼다
    function showGuest(loginOn) {
        const A = window.LottoAccount;
        const msg = loginOn
            ? [el('p', { text: tr('my.needLogin', '로그인하면 내 정보·점수·랭킹을 볼 수 있습니다.') }),
                el('div', { className: 'my-actions' }, [el('button', { type: 'button', className: 'btn', text: tr('my.login', '구글로 로그인'), on: { click: () => A.openLogin(tr('my.loginReason', '마이페이지는 로그인하면 볼 수 있습니다.')) } })])]
            : [el('p', { className: 'my-muted', text: tr('my.off', '회원 기능을 준비하고 있습니다.') })];
        fill('my-profile', msg);
        $('my-score').hidden = true;
        $('my-account').hidden = true;
    }

    async function start() {
        const A = window.LottoAccount;
        if (!A || !A.loginOn()) { showGuest(false); showPass(null); return; }
        if (!A.session()) { showGuest(true); showPass(null); return; }
        let me = null;
        try { me = await A.refresh(); } catch (e) { me = A.me(); }
        if (!me || !me.user) { showGuest(true); showPass(null); return; }
        showProfile(me.user);
        showPass(me.user);
        showScore(me.user, me.reactions);
        showAccount();
    }

    // 별명을 바꾸면 account.js 가 알려 준다 — 내 정보·점수(포인트를 썼을 수 있다)를 다시 그린다
    window.addEventListener('lottodraw:account', () => {
        const me = window.LottoAccount && window.LottoAccount.me();
        if (me && me.user) { showProfile(me.user); showScore(me.user, me.reactions); }
    });

    // 계정 스크립트(js/account.js)는 i18n.js 가 나중에 붙인다. 준비될 때까지 기다리되, 못 받으면 6초 뒤 손님으로 그린다
    let started = false;
    const go = () => { if (started) return; started = true; start(); };
    const waitAccount = () => {
        if (window.LottoAccount && window.LottoAccount.ready) window.LottoAccount.ready.then(go);
        else document.addEventListener('lotto:account-ready', go, { once: true });
        setTimeout(go, 6000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitAccount);
    else waitAccount();
})();
