// 주문 관리 화면 (admin.html). 판매자만 쓴다 — 그래서 한국어만 있고 번역 사전을 쓰지 않는다.
// 서버 주소는 js/premium-config.js 의 apiBase, 인증은 Worker 비밀값 ADMIN_TOKEN.
(function () {
    'use strict';

    const api = String((window.PREMIUM_CONFIG || {}).apiBase || '').replace(/\/+$/, '');
    const TOKEN_STORE = 'lottodraw.admin.token';
    const $ = id => document.getElementById(id);
    const STATUS = { pending: '입금 대기', paid: '발급 완료', refunded: '환불', cancelled: '취소' };
    const METHOD = { bank: '계좌이체', payapp: '카드(페이앱)', manual: '직접 발급' };
    const PLAN = { week: '1주', month: '1개월', lifetime: '평생', custom: '기간 지정' };

    let token = null;
    let tab = 'pending';
    let status = null;
    let timer = null;
    const focusId = (location.hash.match(/^#([0-9A-Z]{8})$/) || [])[1] || null;

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 프라이빗 모드 */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* 프라이빗 모드 */ } },
    };

    const won = n => Number(n || 0).toLocaleString('ko-KR') + '원';
    const when = ms => {
        if (!ms) return '';
        const d = new Date(ms);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} `
            + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    function el(tag, props, children) {
        const node = document.createElement(tag);
        Object.keys(props || {}).forEach(k => {
            if (k === 'text') node.textContent = props[k];
            else if (k === 'className') node.className = props[k];
            else if (k === 'on') Object.keys(props.on).forEach(ev => node.addEventListener(ev, props.on[ev]));
            else node.setAttribute(k, props[k]);
        });
        (children || []).forEach(c => { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return node;
    }

    function say(id, text, isError) {
        $(id).textContent = text || '';
        $(id).classList.toggle('error', !!isError);
    }

    async function call(path, opts) {
        opts = opts || {};
        const init = { method: opts.method || 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } };
        if (opts.body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(opts.body);
        }
        const res = await fetch(api + '/api/admin' + path, init);
        let data = null;
        try { data = await res.json(); } catch (e) { data = null; }
        if (!res.ok) {
            const err = new Error((data && data.message) || ('HTTP ' + res.status));
            err.status = res.status;
            throw err;
        }
        return data;
    }

    async function copy(text, btn) {
        try { await navigator.clipboard.writeText(text); } catch (e) {
            const ta = el('textarea', { style: 'position:fixed;left:-9999px' });
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e2) { /* 무시 */ }
            ta.remove();
        }
        if (btn) { const old = btn.textContent; btn.textContent = '복사했습니다'; setTimeout(() => { btn.textContent = old; }, 1500); }
    }

    function keyBox(order) {
        return el('div', { className: 'admin-key' }, [
            el('code', { className: 'key-code', text: order.key }),
            el('p', { className: 'co-actions' }, [
                el('button', { type: 'button', className: 'btn btn-mini', text: '키 복사', on: { click: e => copy(order.key, e.currentTarget) } }),
                el('button', { type: 'button', className: 'btn btn-secondary btn-mini', text: '열기 링크 복사',
                    on: { click: e => copy('https://www.lottodraw.kr/statistics.html#key=' + order.key, e.currentTarget) } }),
            ]),
            el('p', { className: 'card-note', text: `키 번호 ${String(order.keyId || '').toUpperCase()} · ${order.expiresAt ? when(order.expiresAt) + '까지' : '기간 제한 없음'}` }),
        ]);
    }

    /* ───── 로그인 ───── */

    async function login(t) {
        token = t;
        say('login-status', '확인하는 중…');
        try {
            status = await call('/status');
            store.set(TOKEN_STORE, token);
            $('login-card').hidden = true;
            $('admin-app').hidden = false;
            renderSetup();
            await loadOrders();
        } catch (err) {
            token = null;
            store.del(TOKEN_STORE);
            $('login-card').hidden = false;
            $('admin-app').hidden = true;
            say('login-status', err.status === 401 ? '토큰이 맞지 않습니다.' : '서버에 연결하지 못했습니다: ' + err.message, true);
        }
    }

    function logout() {
        token = null;
        store.del(TOKEN_STORE);
        location.reload();
    }

    function renderSetup() {
        const s = status;
        const c = s.counts || {};
        $('admin-summary').textContent = `입금 대기 ${c.pending || 0} · 발급 ${c.paid || 0} · 환불 ${c.refunded || 0}`;
        const list = $('setup-list');
        list.textContent = '';
        const items = [
            [s.methods.bank, '계좌이체', '켜짐', 'BANK_NAME · BANK_ACCOUNT · BANK_HOLDER 비밀값이 필요합니다'],
            [s.methods.payapp, '카드(페이앱)', '켜짐', '페이앱 심사 통과 뒤 PAYAPP_USERID · PAYAPP_LINKKEY · PAYAPP_LINKVAL 을 넣으면 켜집니다'],
            [s.notify.telegram || s.notify.url, '새 주문 알림', s.notify.telegram ? '텔레그램' : '알림 주소', 'TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID 또는 NOTIFY_URL 을 넣으면 휴대폰으로 받습니다'],
            [s.hooks.deposit, '입금 알림 자동 매칭', '켜짐', '(선택) DEPOSIT_HOOK_SECRET 을 넣으면 켜집니다'],
        ];
        items.forEach(([on, name, yes, how]) => {
            list.appendChild(el('li', { className: on ? 'on' : 'off' }, [
                el('b', { text: (on ? '✔ ' : '✘ ') + name }), ' ', el('span', { text: on ? yes : how }),
            ]));
        });
        list.appendChild(el('li', { className: 'on' }, [el('b', { text: '✔ 서명 키' }), ' ', el('span', { text: 'kid ' + s.kid })]));
        const prices = Object.keys(s.plans).map(id => `${PLAN[id] || id} ${won(s.plans[id].amount)}`).join(' · ');
        list.appendChild(el('li', { className: 'on' }, [el('b', { text: '가격' }), ' ', el('span', { text: prices })]));
    }

    /* ───── 주문 목록 ───── */

    async function loadOrders() {
        if (timer) clearTimeout(timer);
        say('admin-status', '불러오는 중…');
        try {
            const r = await call('/orders?status=' + tab);
            renderOrders(r.orders || []);
            say('admin-status', `${STATUS[tab] || '전체'} ${r.orders.length}건 · ${when(Date.now())} 기준`);
            if (tab === 'pending') timer = setTimeout(() => { if (!document.hidden) loadOrders(); }, 60000);
        } catch (err) {
            say('admin-status', '목록을 불러오지 못했습니다: ' + err.message, true);
        }
    }

    function renderOrders(orders) {
        const box = $('order-list');
        box.textContent = '';
        if (!orders.length) {
            box.appendChild(el('p', { className: 'card-note', text: tab === 'pending' ? '입금을 기다리는 주문이 없습니다.' : '해당하는 주문이 없습니다.' }));
            return;
        }
        orders.forEach(o => box.appendChild(orderCard(o)));
        if (focusId) {
            const hit = document.getElementById('o-' + focusId);
            if (hit) { hit.classList.add('focus'); hit.scrollIntoView({ block: 'center' }); }
        }
    }

    function orderCard(o) {
        const detail = el('div', { className: 'admin-detail' });
        const actions = [];
        if (o.s === 'pending') {
            actions.push(el('button', { type: 'button', className: 'btn', text: '입금 확인 → 키 발급', on: { click: () => act(o, 'confirm', detail) } }));
            actions.push(el('button', { type: 'button', className: 'btn btn-secondary', text: '주문 취소', on: { click: () => act(o, 'cancel', detail) } }));
        }
        if (o.s === 'paid') {
            actions.push(el('button', { type: 'button', className: 'btn btn-secondary', text: '키 보기', on: { click: () => showDetail(o, detail) } }));
            actions.push(el('button', { type: 'button', className: 'btn btn-secondary', text: '환불 처리(키 정지)', on: { click: () => act(o, 'refund', detail) } }));
        }
        if (o.s === 'cancelled') {
            actions.push(el('button', { type: 'button', className: 'btn btn-secondary', text: '늦은 입금 확인 → 키 발급', on: { click: () => act(o, 'confirm', detail) } }));
        }
        actions.push(el('button', { type: 'button', className: 'btn btn-secondary', text: '자세히', on: { click: () => showDetail(o, detail) } }));

        return el('section', { className: 'card admin-order st-' + o.s, id: 'o-' + o.id }, [
            el('h3', { className: 'card-title' }, [
                el('span', { text: o.id }),
                el('small', { className: 'badge', text: STATUS[o.s] || o.s }),
            ]),
            el('div', { className: 'card-body' }, [
                el('p', { className: 'admin-line' }, [
                    el('b', { text: `${PLAN[o.p] || o.p} · ${o.m === 'manual' ? '무료' : won(o.a)}` }),
                    ` · ${METHOD[o.m] || o.m} · ${when(o.c)}`,
                ]),
                o.n ? el('p', { className: 'admin-line' }, ['입금자명/받는 사람: ', el('b', { text: o.n })]) : null,
                o.k ? el('p', { className: 'admin-line', text: '키 번호 ' + o.k.toUpperCase() }) : null,
                el('p', { className: 'co-actions' }, actions),
                detail,
            ]),
        ]);
    }

    async function showDetail(o, box) {
        box.textContent = '불러오는 중…';
        try {
            const r = await call('/orders/' + o.id);
            const d = r.order;
            box.textContent = '';
            if (d.key && d.status === 'paid') box.appendChild(keyBox(d));
            const lines = [
                ['연락처', d.contact],
                ['휴대폰 끝자리', d.phoneTail],
                ['메모', d.note],
                ['입금 기한', d.method === 'bank' ? when(d.deadline) : ''],
                ['기록', (d.log || []).map(l => `${when(l.at)} ${l.what}${l.by ? '(' + l.by + ')' : ''}`).join(' → ')],
            ].filter(x => x[1]);
            box.appendChild(el('dl', { className: 'ob-bank' }, lines.map(([k, v]) => el('div', { className: 'ob-row' }, [el('dt', { text: k }), el('dd', { text: v })]))));
        } catch (err) {
            box.textContent = '불러오지 못했습니다: ' + err.message;
        }
    }

    async function act(o, action, box) {
        const ask = {
            confirm: `${o.n || '입금자'} 님의 ${won(o.a)} 입금을 통장에서 확인했습니까?\n확인하면 바로 키가 발급되고 구매자 화면이 열립니다.`,
            cancel: `주문 ${o.id} 을 취소합니까? (입금이 없을 때만)`,
            refund: `주문 ${o.id} 을 환불 처리합니까?\n키가 정지됩니다. 돈은 구매자 계좌로 직접 돌려보내야 합니다.`,
        }[action];
        if (!window.confirm(ask)) return;
        say('admin-status', '처리하는 중…');
        try {
            const r = await call(`/orders/${o.id}/${action}`, { method: 'POST' });
            say('admin-status', action === 'confirm' ? `${o.id} 키를 발급했습니다. 구매자 화면이 곧 열립니다.` : `${o.id} 처리했습니다.`);
            if (action === 'confirm' && r.order.key) {
                box.textContent = '';
                box.appendChild(keyBox(r.order));
            }
            status = await call('/status');
            renderSetup();
            setTimeout(loadOrders, action === 'confirm' ? 4000 : 300);
        } catch (err) {
            say('admin-status', '실패: ' + err.message, true);
        }
    }

    /* ───── 직접 발급 · 정지 ───── */

    async function issue(e) {
        e.preventDefault();
        const plan = $('issue-plan').value;
        const body = { plan, name: $('issue-name').value.trim(), note: $('issue-note').value.trim() };
        if (plan === 'custom') body.days = Number($('issue-days').value);
        const box = $('issue-result');
        box.hidden = false;
        box.textContent = '발급하는 중…';
        try {
            const r = await call('/issue', { method: 'POST', body });
            box.textContent = '';
            box.appendChild(keyBox(r.order));
            status = await call('/status');
            renderSetup();
            if (tab === 'paid' || tab === 'all') loadOrders();
        } catch (err) {
            box.textContent = '실패: ' + err.message;
        }
    }

    async function revoke(undo) {
        const v = $('revoke-key').value.trim();
        if (!v) return;
        if (!undo && !window.confirm('이 키를 정지합니까?')) return;
        try {
            const r = await call(undo ? '/unrevoke' : '/revoke', { method: 'POST', body: { key: v } });
            say('admin-status', undo ? `키 ${r.unrevoked.toUpperCase()} 정지를 풀었습니다.` : `키 ${r.revoked.toUpperCase()} 를 정지했습니다 (정지 목록 ${r.count}개).`);
            $('revoke-key').value = '';
        } catch (err) {
            say('admin-status', '실패: ' + err.message, true);
        }
    }

    function init() {
        if (!api) {
            say('login-status', 'js/premium-config.js 의 apiBase 가 비어 있습니다.', true);
            return;
        }
        $('login-form').addEventListener('submit', e => {
            e.preventDefault();
            const t = $('admin-token').value.trim();
            if (t) login(t);
        });
        $('admin-logout').addEventListener('click', logout);
        $('admin-reload').addEventListener('click', loadOrders);
        document.querySelectorAll('.admin-tabs [data-status]').forEach(b => b.addEventListener('click', () => {
            tab = b.dataset.status;
            document.querySelectorAll('.admin-tabs [data-status]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
            loadOrders();
        }));
        $('issue-plan').addEventListener('change', () => { $('issue-days-wrap').hidden = $('issue-plan').value !== 'custom'; });
        $('issue-form').addEventListener('submit', issue);
        $('revoke-form').addEventListener('submit', e => { e.preventDefault(); revoke(false); });
        $('unrevoke-btn').addEventListener('click', () => revoke(true));
        $('copy-pubkey').addEventListener('click', e => status && copy(JSON.stringify(status.publicJwk), e.currentTarget));
        document.addEventListener('visibilitychange', () => { if (!document.hidden && token && tab === 'pending') loadOrders(); });

        const saved = store.get(TOKEN_STORE);
        if (saved) login(saved);
    }

    init();
}());
