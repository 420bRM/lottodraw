/* 블로그 글 댓글. js/account.js 가 블로그 글(blog/*.html, 목록 제외)에서만 불러온다.
 *
 * - 읽기는 누구나, 쓰기는 로그인하고 별명을 정한 회원만(채팅과 같다). 링크·연락처·홍보 문구는 서버가 막는다.
 * - 15초에 한 번, 하루 30개까지. 내 댓글은 지울 수 있고, 관리자는 관리자 페이지에서 지운다.
 * - 글은 전부 textContent 로만 그린다(HTML 로 해석하지 않는다). 줄바꿈은 CSS(pre-wrap)로 보인다.
 */
(function () {
    'use strict';

    const A = window.LottoAccount;
    const main = document.querySelector('main.blog-post') || document.querySelector('main');
    if (!A || !main || document.getElementById('comments')) return;
    const post = (location.pathname.match(/\/blog\/([a-z0-9][a-z0-9-]*)\.html$/) || [])[1];
    if (!post) return;

    const MAX = 500;
    const api = () => String((window.PREMIUM_CONFIG && window.PREMIUM_CONFIG.apiBase) || 'https://api.lottodraw.kr').replace(/\/+$/, '');
    const tr = (key, ko, vars) => {
        let s = window.I18N ? window.I18N.t(key, ko) : ko;
        if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
        return s;
    };

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

    async function request(path, opts) {
        const o = Object.assign({ headers: {} }, opts || {});
        const s = A.session && A.session();
        if (s) o.headers.Authorization = 'Bearer ' + s;
        if (o.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
        const res = await fetch(api() + path, o);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { const e = new Error(data.message || ('HTTP ' + res.status)); e.code = data.error; throw e; }
        return data;
    }

    const ERR = {
        empty: () => tr('cm.e.empty', '내용을 적어 주세요.'),
        too_long: () => tr('cm.e.long', '500자까지 쓸 수 있습니다.'),
        link: () => tr('chat.e.link', '링크·사이트 주소는 올릴 수 없습니다.'),
        contact: () => tr('chat.e.contact', '연락처·메신저 아이디는 올릴 수 없습니다.'),
        promo: () => tr('chat.e.promo', '홍보성 문구는 올릴 수 없습니다.'),
        need_nick: () => tr('cm.e.nick', '별명을 정하면 댓글을 쓸 수 있습니다.'),
        banned: () => tr('cm.e.banned', '운영 원칙 위반으로 댓글·채팅이 막혀 있습니다.'),
        slow: () => tr('cm.e.slow', '조금 천천히 써 주세요 (15초에 한 번).'),
        daily: () => tr('cm.e.daily', '댓글은 하루 30개까지 쓸 수 있습니다.'),
        not_found: () => tr('cm.e.gone', '이미 지워진 댓글입니다.'),
    };
    const errText = e => (ERR[e.code] ? ERR[e.code]() : (e.message || tr('cm.e.fail', '처리하지 못했습니다.')));

    const fmt = ms => {
        const d = new Date(ms);
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    /* ───── 그리기 ───── */

    const count = el('span', { className: 'cm-count' });
    const list = el('ol', { className: 'cm-list' });
    const status = el('p', { className: 'cm-status', role: 'status' });
    const input = el('textarea', { className: 'cm-input', rows: '3', maxlength: String(MAX),
        placeholder: tr('cm.ph', '이 글에 대한 생각을 남겨 주세요 (500자)'), 'aria-label': tr('cm.ph', '이 글에 대한 생각을 남겨 주세요 (500자)') });
    const left = el('span', { className: 'cm-left', text: '0/' + MAX });
    const sendBtn = el('button', { type: 'submit', className: 'btn cm-send', text: tr('cm.send', '댓글 남기기') });
    const form = el('form', { className: 'cm-form', hidden: '', on: { submit: e => { e.preventDefault(); send(); } } }, [
        input, el('div', { className: 'cm-form-foot' }, [left, sendBtn]),
    ]);
    const gate = el('div', { className: 'cm-gate' });
    const box = el('section', { id: 'comments', className: 'cm', 'aria-labelledby': 'cm-title' }, [
        el('h2', { id: 'cm-title' }, [tr('cm.title', '댓글'), ' ', count]),
        el('p', { className: 'cm-rule', text: tr('cm.rule', '링크·연락처·홍보 글과 비방은 지웁니다. 댓글은 쓴 사람의 의견입니다.') }),
        list, form, gate, status,
    ]);
    // 본문 바로 아래(관련 페이지·이전/다음 글 앞)에 둔다
    const anchor = main.querySelector('section.related') || main.querySelector('.post-nav') || main.querySelector('.page-disclaimer');
    if (anchor) main.insertBefore(box, anchor); else main.appendChild(box);

    input.addEventListener('input', () => { left.textContent = input.value.length + '/' + MAX; });

    function myNick() {
        const me = A.me && A.me();
        return me && me.user ? me.user.nick : null;
    }

    function item(c) {
        const head = el('div', { className: 'cm-head' }, [
            el('b', { className: 'cm-nick' + (c.staff ? ' is-staff' : ''), text: c.nick || tr('cm.noNick', '(별명 없음)') }),
            c.staff ? el('span', { className: 'chat-staff', text: tr('chat.staff', '운영자') }) : null,
            el('time', { className: 'cm-time', datetime: new Date(c.at).toISOString(), text: fmt(c.at) }),
            c.mine ? el('button', { type: 'button', className: 'cm-del', text: tr('cm.del', '지우기'), on: { click: () => remove(c) } }) : null,
        ]);
        return el('li', { className: 'cm-item' + (c.mine ? ' is-mine' : ''), 'data-id': c.id }, [head, el('p', { className: 'cm-text', text: c.text })]);
    }

    function render(comments) {
        list.textContent = '';
        comments.forEach(c => list.appendChild(item(c)));
        if (!comments.length) list.appendChild(el('li', { className: 'cm-empty', text: tr('cm.empty', '아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.') }));
        count.textContent = comments.length ? String(comments.length) : '';
    }

    // 쓰기 자격: 로그인 → 별명 → 입력칸
    function renderGate() {
        gate.textContent = '';
        const me = A.me && A.me();
        let can = false;
        if (!me) {
            gate.appendChild(el('button', { type: 'button', className: 'btn btn-secondary', text: tr('cm.login', '로그인하고 댓글 쓰기'),
                on: { click: () => A.openLogin(tr('cm.loginReason', '댓글은 로그인한 회원이 쓸 수 있습니다.')) } }));
        } else if (!myNick()) {
            gate.appendChild(el('button', { type: 'button', className: 'btn btn-secondary', text: tr('cm.nick', '별명을 정하면 댓글을 쓸 수 있습니다'),
                on: { click: () => A.openNick && A.openNick(false) } }));
        } else {
            can = true;
        }
        gate.hidden = can;
        form.hidden = !can;
    }

    async function load() {
        try {
            const r = await request('/api/comments?post=' + encodeURIComponent(post));
            render(r.comments || []);
        } catch (e) {
            status.textContent = tr('cm.loadFail', '댓글을 불러오지 못했습니다.');
        }
    }

    async function send() {
        const text = input.value.trim();
        if (!text) { status.textContent = ERR.empty(); return; }
        sendBtn.disabled = true;
        status.textContent = '';
        try {
            await request('/api/comments', { method: 'POST', body: { post, text } });
            input.value = '';
            left.textContent = '0/' + MAX;
            await load();
            list.lastChild && list.lastChild.scrollIntoView && list.lastChild.scrollIntoView({ block: 'nearest' });
        } catch (e) {
            status.textContent = errText(e);
        } finally {
            sendBtn.disabled = false;
        }
    }

    async function remove(c) {
        if (!window.confirm(tr('cm.delAsk', '이 댓글을 지웁니까?'))) return;
        try {
            await request('/api/comments/delete', { method: 'POST', body: { post, id: c.id } });
            await load();
        } catch (e) {
            status.textContent = errText(e);
        }
    }

    // 별명을 정하거나 바꾸면 입력칸과 내 댓글 별명을 새로
    window.addEventListener('lottodraw:account', () => { renderGate(); load(); });

    renderGate();
    load();
})();
