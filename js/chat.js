/* 실시간 채팅 (오른쪽 아래 말풍선). js/account.js 가 서버에서 채팅이 켜져 있을 때만 불러온다.
 *
 * - 접어 둔 채로 시작한다(빈 방이 망해 보이지 않게). 단추에는 지금 들어와 있는 사람 수.
 * - 열면 WebSocket 으로 붙고 최근 메시지(24시간 안)를 받는다. 닫으면 연결도 끊는다.
 * - 읽기는 누구나, 쓰기는 로그인하고 별명을 정한 회원만. 링크·연락처·홍보 문구는 서버가 막는다.
 * - 글은 전부 textContent 로만 그린다(HTML 로 해석하지 않는다).
 */
(function () {
    'use strict';

    const A = window.LottoAccount;
    if (!A || document.getElementById('chat-fab')) return;

    const OPEN_STORE = 'lottodraw.chat.open';
    const api = () => String((window.PREMIUM_CONFIG && window.PREMIUM_CONFIG.apiBase) || 'https://api.lottodraw.kr').replace(/\/+$/, '');
    const wsUrl = () => api().replace(/^http/, 'ws') + '/api/chat';
    const tr = (key, ko, vars) => {
        let s = window.I18N ? window.I18N.t(key, ko) : ko;
        if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
        return s;
    };
    const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };

    function el(tag, props, kids) {
        const n = document.createElement(tag);
        Object.keys(props || {}).forEach(k => {
            if (k === 'text') n.textContent = props[k];
            else if (k === 'className') n.className = props[k];
            else if (k === 'on') Object.keys(props.on).forEach(ev => n.addEventListener(ev, props.on[ev]));
            else n.setAttribute(k, props[k]);
        });
        (kids || []).forEach(c => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return n;
    }

    const ERR = {
        need_login: () => tr('chat.e.login', '로그인하면 쓸 수 있습니다.'),
        need_nick: () => tr('chat.e.nick', '별명을 정하면 쓸 수 있습니다.'),
        banned: () => tr('chat.e.banned', '운영 원칙 위반으로 채팅이 막혀 있습니다.'),
        slow: () => tr('chat.e.slow', '조금 천천히 써 주세요 (3초에 한 번).'),
        empty: () => tr('chat.e.empty', '내용을 적어 주세요.'),
        too_long: () => tr('chat.e.long', '200자까지 쓸 수 있습니다.'),
        link: () => tr('chat.e.link', '링크·사이트 주소는 올릴 수 없습니다.'),
        contact: () => tr('chat.e.contact', '연락처·메신저 아이디는 올릴 수 없습니다.'),
        promo: () => tr('chat.e.promo', '홍보성 문구는 올릴 수 없습니다.'),
    };

    /* ───── 그리기 ───── */

    const count = el('span', { className: 'chat-count', hidden: '' });
    const fab = el('button', { type: 'button', id: 'chat-fab', className: 'chat-fab', 'aria-expanded': 'false', 'aria-controls': 'chat-panel',
        title: tr('chat.title', '실시간 채팅'), on: { click: () => toggle() } }, [
        el('span', { className: 'chat-fab-ico', 'aria-hidden': 'true', text: '💬' }),
        el('span', { className: 'chat-fab-label', text: tr('chat.fab', '채팅') }),
        count,
    ]);
    const online = el('span', { className: 'chat-online' });
    const list = el('ol', { className: 'chat-list', 'aria-live': 'polite' });
    const status = el('p', { className: 'chat-status', role: 'status' });
    const input = el('input', { type: 'text', className: 'chat-input', maxlength: '200', autocomplete: 'off', placeholder: tr('chat.ph', '메시지 입력 (200자)'),
        'aria-label': tr('chat.ph', '메시지 입력 (200자)') });
    const sendBtn = el('button', { type: 'submit', className: 'btn chat-send', text: tr('chat.send', '보내기') });
    const form = el('form', { className: 'chat-form', on: { submit: e => { e.preventDefault(); send(); } } }, [input, sendBtn]);
    const gate = el('div', { className: 'chat-gate' });
    const panel = el('section', { id: 'chat-panel', className: 'chat-panel', hidden: '', 'aria-label': tr('chat.title', '실시간 채팅') }, [
        el('header', { className: 'chat-head' }, [
            el('div', {}, [el('b', { text: tr('chat.title', '실시간 채팅') }), ' ', online]),
            el('button', { type: 'button', className: 'chat-x', 'aria-label': tr('acct.close', '닫기'), text: '×', on: { click: () => toggle(false) } }),
        ]),
        el('p', { className: 'chat-rule', text: tr('chat.rule', '메시지는 24시간 뒤 사라집니다 · 링크·연락처·홍보 금지') }),
        list,
        status,
        gate,
        form,
    ]);
    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const fmt = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

    function myNick() {
        const me = A.me && A.me();
        return me && me.user ? me.user.nick : null;
    }

    function addMsg(m) {
        if (list.querySelector('[data-id="' + CSS.escape(m.id) + '"]')) return;
        const mine = m.nick && m.nick === myNick();
        list.appendChild(el('li', { className: 'chat-msg' + (mine ? ' is-mine' : ''), 'data-id': m.id }, [
            el('span', { className: 'chat-nick' + (m.staff ? ' is-staff' : ''), text: m.nick }),
            m.staff ? el('span', { className: 'chat-staff', text: tr('chat.staff', '운영자') }) : null,
            el('span', { className: 'chat-text', text: m.text }),
            el('time', { className: 'chat-time', text: fmt(m.at) }),
        ]));
        while (list.children.length > 200) list.removeChild(list.firstChild);
        list.scrollTop = list.scrollHeight;
    }

    function setOnline(n) {
        online.textContent = n > 0 ? tr('chat.online', '{n}명 접속', { n }) : '';
        count.textContent = String(n);
        count.hidden = !(n > 1);
    }

    // 쓰기 자격: 로그인 → 별명 → 입력칸
    function renderGate() {
        gate.textContent = '';
        const me = A.me && A.me();
        let can = false;
        if (!me) {
            gate.appendChild(el('button', { type: 'button', className: 'btn btn-secondary', text: tr('chat.loginToTalk', '로그인하고 채팅하기'),
                on: { click: () => A.openLogin(tr('chat.loginReason', '채팅은 로그인한 회원이 쓸 수 있습니다.')) } }));
        } else if (!myNick()) {
            gate.appendChild(el('button', { type: 'button', className: 'btn btn-secondary', text: tr('chat.nickToTalk', '별명을 정하면 채팅할 수 있습니다'),
                on: { click: () => A.openNick && A.openNick(false) } }));
        } else if (banned) {
            gate.appendChild(el('p', { className: 'chat-status', text: ERR.banned() }));
        } else {
            can = true;
        }
        gate.hidden = can;
        form.hidden = !can;
    }

    /* ───── 연결 ───── */

    let ws = null;
    let isOpen = false;
    let retry = 0;
    let banned = false;

    function connect() {
        if (ws || !isOpen) return;
        status.textContent = tr('chat.connecting', '연결하는 중…');
        try { ws = new WebSocket(wsUrl()); } catch (e) { ws = null; status.textContent = tr('chat.fail', '채팅에 연결하지 못했습니다.'); return; }
        ws.onopen = () => {
            retry = 0;
            status.textContent = '';
            const s = A.session && A.session();
            if (s) ws.send(JSON.stringify({ t: 'auth', session: s }));
        };
        ws.onmessage = e => {
            let m;
            try { m = JSON.parse(e.data); } catch (x) { return; }
            if (m.t === 'hello') {
                list.textContent = '';
                (m.history || []).forEach(addMsg);
                if (!(m.history || []).length) list.appendChild(el('li', { className: 'chat-empty', text: tr('chat.empty', '아직 조용합니다. 첫 마디를 남겨 보세요.') }));
                setOnline(m.online || 0);
            } else if (m.t === 'msg') {
                const empty = list.querySelector('.chat-empty');
                if (empty) empty.remove();
                addMsg(m.m);
            } else if (m.t === 'del') {
                const li = list.querySelector('[data-id="' + CSS.escape(m.id) + '"]');
                if (li) li.remove();
            } else if (m.t === 'count') {
                setOnline(m.online || 0);
            } else if (m.t === 'auth') {
                banned = !!m.banned;
                renderGate();
            } else if (m.t === 'err') {
                status.textContent = (ERR[m.code] || (() => tr('chat.fail2', '보내지 못했습니다.')))();
                if (m.code === 'banned') { banned = true; renderGate(); }
            }
        };
        ws.onclose = () => {
            ws = null;
            if (!isOpen) return;
            retry = Math.min(retry + 1, 6);
            status.textContent = tr('chat.reconnect', '연결이 끊겼습니다. 다시 붙는 중…');
            setTimeout(connect, 1000 * Math.pow(2, retry - 1));
        };
    }

    function send() {
        const text = input.value.trim();
        if (!text || !ws || ws.readyState !== 1) return;
        status.textContent = '';
        ws.send(JSON.stringify({ t: 'say', text }));
        input.value = '';
        input.focus();
    }

    function toggle(force) {
        isOpen = force === undefined ? panel.hidden : !!force;
        panel.hidden = !isOpen;
        fab.hidden = isOpen;
        fab.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        safe(() => sessionStorage.setItem(OPEN_STORE, isOpen ? '1' : ''));
        if (isOpen) {
            renderGate();
            connect();
            if (!form.hidden) input.focus();
        } else if (ws) {
            const w = ws; ws = null; w.onclose = null; w.close();
        }
    }

    // 별명을 정하거나 바꾸면 서버에 다시 알린다
    window.addEventListener('lottodraw:account', () => {
        renderGate();
        const s = A.session && A.session();
        if (ws && ws.readyState === 1 && s) ws.send(JSON.stringify({ t: 'auth', session: s }));
    });

    // 접힌 단추의 접속 수 (한 번만)
    fetch(api() + '/api/chat/info').then(r => r.json()).then(d => setOnline(d.online || 0)).catch(() => {});
    if (safe(() => sessionStorage.getItem(OPEN_STORE), '') === '1') toggle(true);
})();
