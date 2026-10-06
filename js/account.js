/* 로그인(구글) · 가입 무료 체험 · 좋아요(♥ 하트 / $ 대박 기원).
 *
 * 모든 공개 페이지가 읽는 js/i18n.js 가 이 파일을 붙인다 — 페이지 1,300여 개의 HTML 을 고치지 않으려고.
 * 서버(/api/config)가 로그인을 켜 두지 않았으면 아무것도 그리지 않는다.
 *
 *   머리글   "로그인 · 3일 무료" 단추 → 구글 로그인 창. 로그인하면 "내 계정" 메뉴(체험 기간, 로그아웃, 탈퇴)
 *   카드     오른쪽 아래 "+" → ♥(좋아요)·$(대박 기원) 중 고르기. 회원에게는 자기가 누른 아이콘만 보인다
 *            (합계는 관리자 페이지에서만). 누르려면 로그인.
 *            카드가 없는 페이지는 본문 끝에 하나(약관·개인정보·문의·소개 페이지는 빼고).
 *   별명     처음 가입하면 정하라고 묻고(건너뛸 수 있음), "내 계정"에서 바꾼다. 머리글 단추에 보인다.
 *   체험 키  처음 가입하면 서버가 3일 무료 체험 키를 준다. 이 브라우저에 더 긴 이용권이 없으면 그 키를 넣는다.
 */
(function () {
    'use strict';

    const SESSION_STORE = 'lottodraw.account';          // { session, email }
    const ME_STORE = 'lottodraw.account.me';            // sessionStorage { at, user, reactions }
    const CONFIG_STORE = 'lottodraw.account.config';    // sessionStorage { at, login }
    const NOTE_STORE = 'lottodraw.account.note';        // sessionStorage: 새로 고친 뒤 띄울 안내
    const KEY_STORE = 'lottodraw.premium.key';          // js/license.js 와 같은 자리
    const CACHE_MS = 10 * 60 * 1000;
    const NO_BAR = ['privacy', 'terms', 'contact', 'about', 'admin'];

    const script = document.currentScript;
    const root = script && script.src ? new URL('..', script.src).href : '/';
    const api = () => String((window.PREMIUM_CONFIG && window.PREMIUM_CONFIG.apiBase) || 'https://api.lottodraw.kr').replace(/\/+$/, '');

    const tr = (key, ko, vars) => {
        let s = window.I18N ? window.I18N.t(key, ko) : ko;
        if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
        return s;
    };
    const lang = () => (window.I18N && window.I18N.lang) || 'ko';

    const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
    const local = {
        get: k => safe(() => JSON.parse(localStorage.getItem(k) || 'null'), null),
        set: (k, v) => safe(() => localStorage.setItem(k, JSON.stringify(v))),
        del: k => safe(() => localStorage.removeItem(k)),
    };
    const temp = {
        get: k => safe(() => JSON.parse(sessionStorage.getItem(k) || 'null'), null),
        set: (k, v) => safe(() => sessionStorage.setItem(k, JSON.stringify(v))),
        del: k => safe(() => sessionStorage.removeItem(k)),
    };

    function el(tag, props, kids) {
        const n = document.createElement(tag);
        Object.keys(props || {}).forEach(k => {
            if (k === 'text') n.textContent = props[k];
            else if (k === 'on') Object.keys(props.on).forEach(ev => n.addEventListener(ev, props.on[ev]));
            else if (k === 'className') n.className = props[k];
            else n.setAttribute(k, props[k]);
        });
        (kids || []).forEach(c => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return n;
    }

    async function request(path, opts) {
        const o = Object.assign({ headers: {} }, opts || {});
        const s = local.get(SESSION_STORE);
        if (o.auth && s && s.session) o.headers.Authorization = 'Bearer ' + s.session;
        if (o.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
        o.method = o.method || 'GET';
        delete o.auth;
        const res = await fetch(api() + path, o);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { const e = new Error(data.message || ('HTTP ' + res.status)); e.status = res.status; e.code = data.error; throw e; }
        return data;
    }

    const fmtDate = ms => {
        const d = new Date(ms);
        const p = n => String(n).padStart(2, '0');
        return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    /* ───── 상태 ───── */

    let login = null;      // { google, trialDays }
    let me = null;         // { user, reactions }

    async function loadConfig() {
        const c = temp.get(CONFIG_STORE);
        if (c && Date.now() - c.at < CACHE_MS) return c.login;
        const got = await request('/api/config');
        temp.set(CONFIG_STORE, { at: Date.now(), login: got.login || null });
        return got.login || null;
    }

    async function loadMe(force) {
        const s = local.get(SESSION_STORE);
        if (!s || !s.session) return null;
        const c = temp.get(ME_STORE);
        if (!force && c && Date.now() - c.at < CACHE_MS) return c;
        try {
            const got = await request('/api/me', { auth: true });
            const v = { at: Date.now(), user: got.user, reactions: got.reactions || {} };
            temp.set(ME_STORE, v);
            return v;
        } catch (e) {
            if (e.status === 401) signOutLocal();
            return c || null;
        }
    }

    function signOutLocal() {
        local.del(SESSION_STORE);
        temp.del(ME_STORE);
        me = null;
    }

    // 키 본문에서 만료 시각만 읽는다(서명 확인은 js/license.js 가 한다). 0 이면 기간 제한 없음.
    function expiryOf(key) {
        return safe(() => {
            const b64 = key.slice(4).replace(/-/g, '+').replace(/_/g, '/');
            const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
            if (bin.length !== 78) return null;
            return ((bin.charCodeAt(10) << 24) >>> 0) + (bin.charCodeAt(11) << 16) + (bin.charCodeAt(12) << 8) + bin.charCodeAt(13);
        }, null);
    }

    // 체험 키를 이 브라우저에 넣는다. 더 오래 가는 이용권(산 키)이 이미 있으면 그대로 둔다.
    function applyTrial(trial) {
        if (!trial || !trial.key || !(trial.expiresAt > Date.now())) return false;
        const saved = safe(() => localStorage.getItem(KEY_STORE), null);
        if (saved === trial.key) return false;
        if (saved) {
            const exp = expiryOf(saved);
            if (exp === 0) return false;                                 // 평생 이용권
            if (exp && exp * 1000 >= trial.expiresAt) return false;      // 더 긴 이용권
        }
        safe(() => localStorage.setItem(KEY_STORE, trial.key));
        safe(() => localStorage.removeItem('lottodraw.premium.check'));
        return true;
    }

    /* ───── 안내 ───── */

    let toastTimer = null;
    function toast(message, link) {
        let box = document.getElementById('acct-toast');
        if (!box) { box = el('div', { id: 'acct-toast', className: 'acct-toast', role: 'status' }); document.body.appendChild(box); }
        box.textContent = message;
        if (link) { box.appendChild(document.createTextNode(' ')); box.appendChild(el('a', { href: link.href, text: link.text })); }
        box.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { box.hidden = true; }, link ? 9000 : 4000);
    }

    function reloadWith(note) {
        temp.set(NOTE_STORE, note);
        location.reload();
    }

    /* ───── 로그인 창 ───── */

    let gisPromise = null;
    function loadGis() {
        if (!gisPromise) {
            gisPromise = new Promise((resolve, reject) => {
                if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
                const s = el('script', { src: 'https://accounts.google.com/gsi/client', async: '' });
                s.onload = () => resolve();
                s.onerror = () => { gisPromise = null; reject(new Error('gis')); };
                document.head.appendChild(s);
            });
        }
        return gisPromise;
    }

    function closeModal() {
        const m = document.getElementById('acct-modal');
        if (m) m.remove();
        document.removeEventListener('keydown', escClose);
    }
    function escClose(e) { if (e.key === 'Escape') closeModal(); }

    async function openLogin(reason) {
        closeModal();
        const slot = el('div', { className: 'acct-gbtn' }, [el('span', { className: 'acct-wait', text: tr('acct.loading', '구글 로그인 단추를 불러오는 중…') })]);
        const err = el('p', { className: 'acct-err', role: 'alert', hidden: '' });
        const days = (login && login.trialDays) || 3;
        const box = el('div', { className: 'acct-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'acct-title' }, [
            el('button', { type: 'button', className: 'acct-x', 'aria-label': tr('acct.close', '닫기'), text: '×', on: { click: closeModal } }),
            el('h2', { id: 'acct-title', text: tr('acct.title', '로그인 · 가입') }),
            reason ? el('p', { className: 'acct-reason', text: reason }) : null,
            el('p', { className: 'acct-lead', text: tr('acct.lead', '구글 계정으로 바로 가입됩니다. 처음 가입하면 5개월 통계와 상세 분석 4종을 {days}일 동안 무료로 열어 드립니다.', { days }) }),
            el('ul', { className: 'acct-perks' }, [
                el('li', { text: tr('acct.perk1', '{days}일 무료 체험 (계정당 한 번)', { days }) }),
                el('li', { text: tr('acct.perk2', '카드마다 ♥ 좋아요 · $ 대박 기원 남기기') }),
                el('li', { text: tr('acct.perk3', '다른 기기에서 로그인해도 체험 이어 쓰기') }),
            ]),
            slot,
            err,
            el('p', { className: 'acct-fine' }, [
                tr('acct.fine1', '만 14세 이상만 가입할 수 있습니다. 구글에서는 이메일 주소만 받습니다. 가입하면 '),
                el('a', { href: root + 'terms.html#members', text: tr('acct.terms', '이용약관') }),
                tr('acct.and', '과 '),
                el('a', { href: root + 'privacy.html#members', text: tr('acct.privacy', '개인정보 처리방침') }),
                tr('acct.fine2', '에 동의하는 것으로 봅니다.'),
            ]),
        ]);
        const modal = el('div', { id: 'acct-modal', className: 'acct-modal', on: { click: e => { if (e.target === modal) closeModal(); } } }, [box]);
        document.body.appendChild(modal);
        document.addEventListener('keydown', escClose);
        box.querySelector('.acct-x').focus();

        try {
            await loadGis();
            window.google.accounts.id.initialize({
                client_id: login.google,
                callback: resp => onCredential(resp, err),
                auto_select: false,
                cancel_on_tap_outside: true,
                use_fedcm_for_button: true,
            });
            slot.textContent = '';
            window.google.accounts.id.renderButton(slot, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: lang(), width: 260 });
        } catch (e) {
            slot.textContent = tr('acct.gisFail', '구글 로그인을 불러오지 못했습니다. 광고 차단 등 확장 프로그램을 끄거나 잠시 뒤 다시 시도해 주세요.');
        }
    }

    async function onCredential(resp, errBox) {
        try {
            const got = await request('/api/auth/google', { method: 'POST', body: { credential: resp && resp.credential } });
            local.set(SESSION_STORE, { session: got.session, email: got.user.email });
            temp.del(ME_STORE);   // 새로 고친 뒤 내 정보와 내가 누른 좋아요를 다시 받는다
            const added = applyTrial(got.user.trial);
            if (got.trialNew) {
                reloadWith({ kind: 'trial', until: got.user.trial && got.user.trial.expiresAt, askNick: !got.user.nick });
            } else {
                reloadWith({ kind: added ? 'trialBack' : 'login', until: got.user.trial && got.user.trial.expiresAt, askNick: got.isNew && !got.user.nick });
            }
        } catch (e) {
            errBox.textContent = e.code === 'too_many' ? tr('acct.tooMany', '잠시 뒤 다시 시도해 주세요.') : tr('acct.fail', '로그인하지 못했습니다. 다시 시도해 주세요.');
            errBox.hidden = false;
        }
    }

    function showNote() {
        const n = temp.get(NOTE_STORE);
        if (!n) return;
        temp.del(NOTE_STORE);
        const go = { href: root + 'statistics.html', text: tr('acct.goStats', '5개월 통계 보기 →') };
        if (n.kind === 'trial') toast(tr('acct.welcome', '가입을 환영합니다! 5개월 통계와 상세 분석 4종이 {until}까지 열립니다.', { until: fmtDate(n.until) }), go);
        else if (n.kind === 'trialBack') toast(tr('acct.trialBack', '로그인했습니다. 무료 체험이 {until}까지 이어집니다.', { until: fmtDate(n.until) }), go);
        else if (n.kind === 'login') toast(tr('acct.loggedIn', '로그인했습니다.'));
        else if (n.kind === 'logout') toast(tr('acct.loggedOut', '로그아웃했습니다.'));
        else if (n.kind === 'deleted') toast(tr('acct.deleted', '탈퇴했습니다. 계정과 좋아요 기록을 지웠습니다.'));
        if (n.askNick && me) openNick(true);
    }

    /* ───── 별명 ───── */

    function openNick(first) {
        closeModal();
        const input = el('input', { type: 'text', id: 'acct-nick', className: 'acct-input', maxlength: '12', autocomplete: 'nickname',
            value: (me && me.user && me.user.nick) || '', placeholder: tr('acct.nickPh', '예: 행운의곰') });
        const err = el('p', { className: 'acct-err', role: 'alert', hidden: '' });
        const save = el('button', { type: 'submit', className: 'btn', text: tr('acct.nickSave', '저장') });
        const form = el('form', { className: 'acct-nick-form', on: { submit: async e => {
            e.preventDefault();
            const nickname = input.value.trim();
            err.hidden = true;
            save.disabled = true;
            try {
                const got = await request('/api/me/nickname', { method: 'POST', auth: true, body: { nickname } });
                me.user = got.user;
                temp.set(ME_STORE, Object.assign({ at: Date.now() }, me));
                const s = local.get(SESSION_STORE);
                if (s) local.set(SESSION_STORE, Object.assign(s, { nick: got.user.nick }));
                closeModal();
                renderHeader();
                toast(tr('acct.nickDone', '별명을 "{nick}"(으)로 정했습니다.', { nick: got.user.nick }));
            } catch (x) {
                err.textContent = x.code === 'taken_nick' ? tr('acct.nickTaken', '이미 쓰고 있는 별명입니다. 다른 별명을 골라 주세요.')
                    : x.code === 'reserved_nick' ? tr('acct.nickReserved', '쓸 수 없는 별명입니다. 다른 별명을 골라 주세요.')
                    : x.code === 'bad_nick' ? tr('acct.nickRule', '한글·영문·숫자·밑줄(_)로 2~12자, 띄어쓰기 없이 적어 주세요.')
                    : x.status === 401 ? tr('acct.expired', '로그인이 끝났습니다. 다시 로그인해 주세요.')
                    : tr('acct.tooMany', '잠시 뒤 다시 시도해 주세요.');
                err.hidden = false;
            } finally {
                save.disabled = false;
            }
        } } }, [
            el('label', { for: 'acct-nick', className: 'sr-only', text: tr('acct.nickTitle', '별명') }),
            input,
            el('p', { className: 'acct-hint', text: tr('acct.nickRule', '한글·영문·숫자·밑줄(_)로 2~12자, 띄어쓰기 없이 적어 주세요.') }),
            err,
            el('div', { className: 'acct-actions' }, [
                save,
                el('button', { type: 'button', className: 'btn btn-secondary', text: first ? tr('acct.later', '나중에') : tr('acct.cancel', '취소'), on: { click: closeModal } }),
            ]),
        ]);
        const box = el('div', { className: 'acct-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'acct-title' }, [
            el('button', { type: 'button', className: 'acct-x', 'aria-label': tr('acct.close', '닫기'), text: '×', on: { click: closeModal } }),
            el('h2', { id: 'acct-title', text: first ? tr('acct.nickFirst', '별명을 정해 주세요') : tr('acct.nickTitle', '별명') }),
            el('p', { className: 'acct-lead', text: first
                ? tr('acct.nickLeadFirst', '사이트에서 쓸 별명입니다. 나중에 "내 계정"에서 바꿀 수 있습니다.')
                : tr('acct.nickLead', '사이트에서 쓸 별명입니다. 다른 사람과 겹치지 않아야 합니다.') }),
            form,
        ]);
        const modal = el('div', { id: 'acct-modal', className: 'acct-modal', on: { click: e => { if (e.target === modal) closeModal(); } } }, [box]);
        document.body.appendChild(modal);
        document.addEventListener('keydown', escClose);
        input.focus();
    }

    /* ───── 머리글 단추 ───── */

    function renderHeader() {
        const host = document.querySelector('.banner-right');
        if (!host) return;
        const old = document.getElementById('acct-head');
        if (old) old.remove();
        const wrap = el('div', { id: 'acct-head', className: 'acct-head' });
        if (!me) {
            wrap.appendChild(el('button', { type: 'button', className: 'acct-btn', on: { click: () => openLogin() } }, [
                tr('acct.login', '로그인'),
                el('span', { className: 'acct-badge', text: tr('acct.badge', '{days}일 무료', { days: (login && login.trialDays) || 3 }) }),
            ]));
        } else {
            const menu = el('div', { className: 'acct-menu', hidden: '' });
            const btn = el('button', { type: 'button', className: 'acct-btn is-in', 'aria-expanded': 'false', on: { click: () => {
                const open = menu.hidden;
                menu.hidden = !open;
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            } } }, [(me.user && me.user.nick) || tr('acct.mine', '내 계정')]);
            const trial = me.user && me.user.trial;
            if (me.user && me.user.nick) menu.appendChild(el('p', { className: 'acct-nick', text: me.user.nick }));
            menu.appendChild(el('p', { className: 'acct-email', text: me.user ? me.user.email : '' }));
            menu.appendChild(el('p', { className: 'acct-trial', text: trial
                ? (trial.expiresAt > Date.now() ? tr('acct.trialUntil', '무료 체험: {until}까지', { until: fmtDate(trial.expiresAt) }) : tr('acct.trialOver', '무료 체험이 끝났습니다'))
                : tr('acct.trialNone', '무료 체험은 계정당 한 번입니다') }));
            menu.appendChild(el('a', { href: root + 'statistics.html', text: tr('acct.goStats', '5개월 통계 보기 →') }));
            menu.appendChild(el('button', { type: 'button', text: me.user && me.user.nick ? tr('acct.nickChange', '별명 바꾸기') : tr('acct.nickSet', '별명 정하기'),
                on: { click: () => { menu.hidden = true; openNick(false); } } }));
            menu.appendChild(el('button', { type: 'button', text: tr('acct.logout', '로그아웃'), on: { click: logout } }));
            menu.appendChild(el('button', { type: 'button', className: 'acct-danger', text: tr('acct.delete', '회원 탈퇴'), on: { click: withdraw } }));
            wrap.appendChild(btn);
            wrap.appendChild(menu);
            document.addEventListener('click', e => {
                if (!menu.hidden && !wrap.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
            });
        }
        const langSwitch = host.querySelector('.lang-switch');
        host.insertBefore(wrap, langSwitch || null);
    }

    async function logout() {
        try { await request('/api/auth/logout', { method: 'POST', auth: true }); } catch (e) { /* 이미 끝난 세션 */ }
        signOutLocal();
        reloadWith({ kind: 'logout' });
    }

    async function withdraw() {
        const ok = window.confirm(tr('acct.deleteConfirm', '탈퇴하면 계정과 누른 좋아요가 지워집니다.\n받은 무료 체험은 기간까지 이 브라우저에서 그대로 쓸 수 있지만, 다시 가입해도 체험은 다시 받을 수 없습니다.\n\n탈퇴할까요?'));
        if (!ok) return;
        try {
            await request('/api/me/delete', { method: 'POST', auth: true, body: { confirm: true } });
            signOutLocal();
            reloadWith({ kind: 'deleted' });
        } catch (e) {
            if (e.status === 401) { signOutLocal(); renderHeader(); }
            toast(tr('acct.deleteFail', '탈퇴하지 못했습니다. 다시 로그인한 뒤 시도해 주세요.'));
        }
    }

    /* ───── 좋아요 ─────
     * 카드마다 오른쪽 아래에 "+" 단추. 누르면 ♥(좋아요)와 $(대박 기원) 중에 고른다. 내가 누른 것만 아이콘으로 보인다.
     * 합계는 회원에게 보여 주지 않는다 — 관리자 페이지 "회원" 칸에서 본다.
     * 카드가 없는 페이지(통계 12쪽, 블로그, 회차 …)는 본문 끝에 같은 단추 하나.
     * 카드는 스크립트가 나중에 그리기도 해서(홈 통계·상세 분석) 새로 생기는 카드를 지켜보다가 붙인다.
     */

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ICONS = {   // Material Icons (Apache 2.0): favorite, attach_money
        h: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
        d: 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z',
    };
    function icon(type) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'rx-ico');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', ICONS[type]);
        svg.appendChild(path);
        return svg;
    }
    const LABEL = { h: () => tr('react.h', '좋아요'), d: () => tr('react.d', '대박 기원') };

    const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
    const NO_CARD = /^(plan-|order|checkout|unlock|reveal|license|ob-|admin)/;   // 결제·주문 칸에는 달지 않는다
    const widgets = {};   // 항목 → [위젯 …]

    function pageId() {
        let p = location.pathname.replace(/^\/+/, '').replace(/\.html$/, '').replace(/(^|\/)index$/, '').replace(/\/+$/, '');
        if (!p) p = 'index';
        return p.toLowerCase().replace(/\//g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+/, '').slice(0, 64) || 'index';
    }
    const clean = s => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

    // 카드 이름: data-react > 카드 id > 제목 id(-t, -title 뗌). 페이지 이름을 앞에 붙여 페이지끼리 섞이지 않게.
    function cardId(card) {
        if (card.dataset.react) return clean(card.dataset.react).slice(0, 64);
        const title = card.querySelector('.card-title[id]');
        const raw = card.id || (title ? title.id.replace(/-(t|title)$/, '') : '') || card.getAttribute('aria-labelledby') || '';
        const base = clean(raw.replace(/-(t|title)$/, ''));
        if (!base || NO_CARD.test(base)) return '';
        return (pageId() + '-' + base).slice(0, 64).replace(/-+$/, '');
    }

    function makeWidget(id, extraClass) {
        const box = el('div', { className: 'rx' + (extraClass ? ' ' + extraClass : ''), 'data-rx': id });
        const pick = el('div', { className: 'rx-pick', hidden: '' });
        ['h', 'd'].forEach(type => {
            pick.appendChild(el('button', { type: 'button', className: 'rx-opt rx-' + type, title: LABEL[type](), 'aria-label': LABEL[type](),
                on: { click: () => { pick.hidden = true; add.setAttribute('aria-expanded', 'false'); press(id, type); } } }, [icon(type)]));
        });
        const add = el('button', { type: 'button', className: 'rx-add', text: '+', title: tr('react.add', '반응 남기기'), 'aria-label': tr('react.add', '반응 남기기'), 'aria-expanded': 'false',
            on: { click: e => {
                e.stopPropagation();
                if (!me) { openLogin(tr('react.needLogin', '좋아요는 로그인하면 누를 수 있습니다.')); return; }
                closePickers(pick);
                pick.hidden = !pick.hidden;
                add.setAttribute('aria-expanded', pick.hidden ? 'false' : 'true');
            } } });
        box.appendChild(el('span', { className: 'rx-chips' }));
        box.appendChild(pick);
        box.appendChild(add);
        (widgets[id] = widgets[id] || []).push(box);
        paint(box);
        return box;
    }

    function closePickers(except) {
        document.querySelectorAll('.rx-pick').forEach(p => {
            if (p === except) return;
            p.hidden = true;
            const b = p.parentNode && p.parentNode.querySelector('.rx-add');
            if (b) b.setAttribute('aria-expanded', 'false');
        });
    }

    // 내가 누른 것만 아이콘으로 보인다(색이 찬다). 눌러서 바로 취소할 수도 있다.
    function paint(box) {
        const id = box.dataset.rx;
        const mine = (me && me.reactions && me.reactions[id]) || '';
        const chips = box.querySelector('.rx-chips');
        chips.textContent = '';
        ['h', 'd'].forEach(type => {
            if (mine.indexOf(type) === -1) return;
            chips.appendChild(el('button', { type: 'button', className: 'rx-chip rx-' + type, 'aria-pressed': 'true',
                title: LABEL[type](), 'aria-label': LABEL[type](), on: { click: () => press(id, type) } }, [icon(type)]));
        });
        box.querySelectorAll('.rx-opt').forEach(b => {
            const type = b.classList.contains('rx-h') ? 'h' : 'd';
            b.setAttribute('aria-pressed', mine.indexOf(type) !== -1 ? 'true' : 'false');
        });
    }
    const repaint = id => (widgets[id] || []).forEach(w => document.body.contains(w) && paint(w));

    async function press(id, type) {
        if (!me) { openLogin(tr('react.needLogin', '좋아요는 로그인하면 누를 수 있습니다.')); return; }
        const boxes = widgets[id] || [];
        boxes.forEach(b => b.classList.add('is-busy'));
        try {
            const got = await request('/api/reactions', { method: 'POST', auth: true, body: { id, type } });
            me.reactions = me.reactions || {};
            if (got.mine) me.reactions[id] = got.mine; else delete me.reactions[id];
            temp.set(ME_STORE, Object.assign({ at: Date.now() }, me));
            repaint(id);
        } catch (e) {
            if (e.status === 401) { signOutLocal(); renderHeader(); openLogin(tr('acct.expired', '로그인이 끝났습니다. 다시 로그인해 주세요.')); }
            else toast(e.code === 'too_many' ? tr('acct.tooMany', '잠시 뒤 다시 시도해 주세요.') : tr('react.fail', '좋아요를 저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'));
        } finally {
            boxes.forEach(b => b.classList.remove('is-busy'));
        }
    }

    // 아직 단추가 없는 카드에 붙인다
    function attachCards() {
        document.querySelectorAll('.card').forEach(card => {
            if (card.querySelector(':scope > .rx') || card.closest('.rx')) return;
            const id = cardId(card);
            if (!ID_RE.test(id)) return;
            card.classList.add('has-rx');
            card.appendChild(makeWidget(id, 'rx-card'));
        });
    }

    function renderReactions() {
        document.addEventListener('click', e => { if (!e.target.closest || !e.target.closest('.rx')) closePickers(null); });
        const main = document.querySelector('main');
        const id = pageId();
        if (!document.querySelector('.card') && main && NO_BAR.indexOf(id) === -1) {
            main.appendChild(makeWidget(id, 'rx-page'));
            return;
        }
        attachCards();
        // 홈 통계·상세 분석처럼 나중에 그려지는 카드
        if (window.MutationObserver) {
            let queued = false;
            new MutationObserver(() => {
                if (queued) return;
                queued = true;
                requestAnimationFrame(() => { queued = false; attachCards(); });
            }).observe(document.body, { childList: true, subtree: true });
        }
    }

    /* ───── 시작 ───── */

    async function start() {
        try { login = await loadConfig(); } catch (e) { return; }
        if (!login || !login.google) return;
        me = await loadMe(false);
        if (me && me.user) applyTrial(me.user.trial);
        renderHeader();
        showNote();
        renderReactions();
    }

    window.LottoAccount = { openLogin: r => (login ? openLogin(r) : null) };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
