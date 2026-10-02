// 5개월 통계 페이지: 이용권 구매(계좌이체 · 페이앱)와 잠금 화면.
// 키가 진짜인지 판단하는 규칙은 js/license.js 에 있고, 여기서는 주문과 화면 전환만 맡는다.
//
// 구매 흐름
//   구매하기 → 주문서(결제 방법, 입금자명) → 서버가 주문번호와 계좌를 돌려줌
//   → 이 화면이 주기적으로 주문 상태를 확인 → 입금이 확인되면 서버가 키를 주고 → 바로 잠금 해제
// 주문번호와 조회용 토큰은 이 브라우저에 기억해, 페이지를 닫았다 와도 이어서 확인한다.
(function () {
    'use strict';

    const cfg = window.PREMIUM_CONFIG || {};
    const L = window.LottoLicense;
    const $ = id => document.getElementById(id);
    const T = (k, v) => (v ? I18N.f(k, v) : I18N.t(k));
    const api = String(cfg.apiBase || '').replace(/\/+$/, '');
    const ORDER_STORE = 'lottodraw.premium.order';
    // 방금 산 키. 확인이 잠깐 실패해도(네트워크) 잃어버리지 않도록 따로 둔다. 저절로 지우지 않는다.
    const PURCHASED_STORE = 'lottodraw.premium.purchased';
    const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const plans = JSON.parse(JSON.stringify(cfg.plans || {}));
    let methods = { bank: false, payapp: false };
    let autoConfirm = false;     // 입금 알림 연결이 살아 있어 계좌이체도 몇 분 안에 저절로 열리는가
    let serverReady = null;      // /api/config 를 받아 오는 약속
    let buyable = false;
    let currentPlan = null;
    let current = null;          // { id, token, payurl, createdAt, order }
    let pollTimer = null;
    let pollGen = 0;             // 폴링이 두 줄로 겹치지 않게 하는 세대 번호
    let statsLoaded = false;

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 프라이빗 모드 */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* 프라이빗 모드 */ } },
    };

    const won = n => (I18N.lang === 'en' ? '₩' + Number(n).toLocaleString('en-US') : Number(n).toLocaleString('ko-KR') + '원');
    const planName = id => L.planName(id);
    const fmtTime = ms => {
        const d = new Date(ms);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

    function setStatus(id, text, isError) {
        const node = $(id);
        if (!node) return;
        node.textContent = text || '';
        node.classList.toggle('error', !!isError);
    }

    function errText(err) {
        const key = 'err.' + ((err && err.code) || '');
        const t = I18N.t(key);
        if (t !== key) return t;
        return (err && err.message) || T('pay.offline');
    }

    function withTimeout(p, ms) {
        return Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
    }

    async function call(path, opts) {
        opts = opts || {};
        const init = { method: opts.method || 'GET', headers: { Accept: 'application/json' } };
        if (opts.body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(opts.body);
        }
        const res = await withTimeout(fetch(api + path, init), 10000);
        let data = null;
        try { data = await res.json(); } catch (e) { data = null; }
        if (!res.ok) {
            const err = new Error((data && data.message) || ('HTTP ' + res.status));
            err.code = data && data.error;
            err.status = res.status;
            throw err;
        }
        return data;
    }

    async function copy(text, btn) {
        let ok = false;
        try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
            const ta = el('textarea', { readonly: '', style: 'position:fixed;left:-9999px' });
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
            ta.remove();
        }
        if (btn) {
            const old = btn.textContent;
            btn.textContent = ok ? T('ui.copied') : T('ui.copyFail');
            setTimeout(() => { btn.textContent = old; }, 1600);
        }
    }

    /* ───── 가격 · 판매 가능 여부 ───── */

    function renderPrices() {
        document.querySelectorAll('[data-price]').forEach(p => {
            const plan = plans[p.dataset.price];
            if (plan) p.textContent = won(plan.amount);
        });
    }

    function setBuyable(on) {
        buyable = on;
        document.querySelectorAll('[data-plan]').forEach(b => {
            b.textContent = on ? T('s5.buy') : T('pay.soon');
            b.classList.toggle('is-disabled', !on);
            if (on) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
        });
        setStatus('plans-status', on ? '' : T('pay.preparing'));
    }

    function loadServerConfig() {
        if (!api) { setBuyable(false); serverReady = Promise.resolve(false); return serverReady; }
        serverReady = call('/api/config').then(c => {
            methods = Object.assign({ bank: false, payapp: false }, c.methods || {});
            autoConfirm = !!c.autoConfirm;
            if (current && current.order) renderOrder();
            Object.keys(c.plans || {}).forEach(id => {
                if (plans[id]) Object.assign(plans[id], { amount: c.plans[id].amount, days: c.plans[id].days });
            });
            renderPrices();
            $('co-bank').hidden = !methods.bank;
            $('co-payapp').hidden = !methods.payapp;
            setBuyable(methods.bank || methods.payapp);
            return true;
        }).catch(err => {
            console.warn('결제 서버 연결 실패', err);
            setBuyable(false);
            return false;
        });
        return serverReady;
    }

    /* ───── 주문서 ───── */

    function chosenMethod() {
        const r = document.querySelector('input[name="co-method"]:checked');
        return r ? r.value : 'bank';
    }

    function syncMethodFields() {
        const m = chosenMethod();
        document.querySelectorAll('.co-field[data-for]').forEach(f => { f.hidden = f.dataset.for !== m; });
    }

    async function openCheckout(plan) {
        const ready = serverReady ? await serverReady : false;
        if (!ready || !buyable) { setBuyable(false); return; }
        currentPlan = plan;
        $('co-plan').textContent = `${planName(plan)} · ${won(plans[plan].amount)}`;
        const radios = document.querySelectorAll('input[name="co-method"]');
        radios.forEach(r => { r.disabled = !methods[r.value]; });
        if (!methods[chosenMethod()]) {
            const first = Array.prototype.filter.call(radios, r => methods[r.value])[0];
            if (first) first.checked = true;
        }
        syncMethodFields();
        setStatus('co-status', current && current.order && current.order.status === 'pending'
            ? T('co.replace', { id: current.id }) : '');
        $('checkout').hidden = false;
        $('checkout').scrollIntoView({ behavior: 'smooth', block: 'start' });
        const first = chosenMethod() === 'bank' ? $('co-name') : $('co-phone');
        setTimeout(() => first.focus({ preventScroll: true }), 300);
    }

    async function submitOrder(e) {
        e.preventDefault();
        const method = chosenMethod();
        const name = $('co-name').value.trim();
        const phone = $('co-phone').value.replace(/\D/g, '');
        const contact = $('co-contact').value.trim();
        if (method === 'bank' && name.length < 2) return setStatus('co-status', T('err.need_name'), true);
        if (method === 'payapp' && !/^01\d{8,9}$/.test(phone)) return setStatus('co-status', T('err.need_phone'), true);
        if (!$('co-agree').checked) return setStatus('co-status', T('err.need_agree'), true);

        const btn = $('co-submit');
        btn.disabled = true;
        setStatus('co-status', T('co.creating'));
        try {
            if (current && current.order && current.order.status === 'pending') await cancelOrder(true);
            const r = await call('/api/orders', { method: 'POST', body: { plan: currentPlan, method, name, phone, contact, agree: true } });
            current = { id: r.order.id, token: r.token, payurl: r.payurl || null, createdAt: Date.now(), order: r.order };
            saveOrder();
            $('checkout').hidden = true;
            setStatus('co-status', '');
            if (method === 'payapp' && r.payurl) {
                renderOrder();
                location.href = r.payurl;
                return;
            }
            renderOrder();
            $('order-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
            startPolling(false);
        } catch (err) {
            setStatus('co-status', errText(err), true);
        } finally {
            btn.disabled = false;
        }
    }

    /* ───── 진행 중인 주문 ───── */

    function saveOrder() {
        if (!current) return;
        store.set(ORDER_STORE, JSON.stringify(current));
    }

    function clearOrder() {
        stopPolling();
        current = null;
        store.del(ORDER_STORE);
        $('order-box').hidden = true;
    }

    function row(label, value, copyValue) {
        return el('div', { className: 'ob-row' }, [
            el('dt', { text: label }),
            el('dd', null, [
                el('span', { className: 'ob-val', text: value }),
                copyValue ? el('button', { type: 'button', className: 'btn btn-secondary btn-mini', text: T('ui.copy'),
                    on: { click: ev => copy(copyValue, ev.currentTarget) } }) : null,
            ]),
        ]);
    }

    function renderOrder() {
        if (!current || !current.order) return;
        const o = current.order;
        const body = $('ob-body');
        body.textContent = '';
        $('order-box').hidden = false;
        $('ob-id').textContent = T('ob.orderNo', { id: o.id });
        $('ob-title').textContent = o.method === 'bank' ? T('ob.h') : T('ob.hCard');

        if (o.method === 'bank' && o.bank) {
            const b = o.bank;
            const off = (o.listPrice || o.amount) - o.amount;
            body.appendChild(el('p', { className: 'ob-lead', text: T(autoConfirm ? 'ob.leadAuto' : 'ob.lead', { amount: won(o.amount) }) }));
            body.appendChild(el('dl', { className: 'ob-bank' }, [
                row(T('ob.bank'), b.bank),
                row(T('ob.account'), b.account, b.account.replace(/[^\d-]/g, '')),
                row(T('ob.holder'), b.holder),
                row(T('ob.amount'), won(o.amount), String(o.amount)),
                row(T('ob.name'), o.name),
            ]));
            if (off > 0) body.appendChild(el('p', { className: 'ob-exact', text: T('ob.exact', { amount: won(o.amount), off: won(off) }) }));
            if (MOBILE && b.tossBank) {
                const href = `supertoss://send?bank=${encodeURIComponent(b.tossBank)}&accountNo=${b.account.replace(/\D/g, '')}&amount=${o.amount}`;
                body.appendChild(el('p', { className: 'co-actions' }, [el('a', { className: 'btn', href, text: T('ob.toss') })]));
            }
            body.appendChild(el('p', { className: 'card-note', text: T(autoConfirm ? 'ob.noteAuto' : 'ob.note', { deadline: fmtTime(o.deadline) }) }));
        } else if (o.method === 'payapp') {
            body.appendChild(el('p', { className: 'ob-lead', text: T('ob.cardLead', { amount: won(o.amount) }) }));
            if (current.payurl) {
                body.appendChild(el('p', { className: 'co-actions' }, [el('a', { className: 'btn', href: current.payurl, text: T('ob.reopen') })]));
            }
        }

        const state = el('p', { className: 'license-status', id: 'ob-state', role: 'status' });
        state.textContent = current.checkedAt ? T('ob.waiting', { time: fmtTime(current.checkedAt) }) : T('ob.waitingFirst');
        body.appendChild(state);
        body.appendChild(el('p', { className: 'co-actions' }, [
            el('button', { type: 'button', className: 'btn btn-secondary', text: T('ob.refresh'), on: { click: () => refreshOrder(true) } }),
            el('button', { type: 'button', className: 'btn btn-secondary', text: T('ob.cancel'), on: { click: () => cancelOrder(false) } }),
        ]));
        body.appendChild(el('p', { className: 'card-note', text: T('ob.keep', { id: o.id }) }));
    }

    async function refreshOrder(manual) {
        if (!current) return;
        if (manual) setStatus('ob-state', T('pay.checking'));
        try {
            const r = await call(`/api/orders/${current.id}?token=${encodeURIComponent(current.token)}`);
            current.order = r.order;
            current.checkedAt = Date.now();
            saveOrder();
            await onOrderUpdate();
        } catch (err) {
            if (err.status === 404) {
                clearOrder();
                setStatus('plans-status', T('ob.gone'), true);
                return;
            }
            setStatus('ob-state', T('ob.offline'), true);
        }
    }

    async function onOrderUpdate() {
        const o = current.order;
        if (o.status === 'paid' && o.key) {
            const key = o.key;
            // 주문 기록을 지우기 전에 키부터 저장한다. 이 뒤에 무엇이 실패해도 키는 남는다.
            store.set(L.KEY_STORE, key);
            store.set(PURCHASED_STORE, key);
            clearOrder();
            const st = await L.check(key);
            if (st.unlocked) {
                $('license-key').value = key;
                unlock(st.record, true);
            } else {
                // 서명 확인이 안 되는 드문 경우에도 키는 잃지 않게 입력칸에 넣어 둔다
                $('license-key').value = key;
                setStatus('license-status', st.reason || T('pay.offline'), true);
            }
            return;
        }
        if (o.status === 'cancelled' || o.status === 'refunded') {
            clearOrder();
            setStatus('plans-status', o.status === 'cancelled' ? T('ob.cancelled') : T('ob.refunded'));
            return;
        }
        renderOrder();
    }

    async function cancelOrder(silent) {
        if (!current) return;
        if (!silent && !window.confirm(T('ob.cancelConfirm'))) return;
        try {
            await call(`/api/orders/${current.id}/cancel`, { method: 'POST', body: { token: current.token } });
        } catch (err) {
            if (!silent) { setStatus('ob-state', errText(err), true); return; }
        }
        clearOrder();
        if (!silent) setStatus('plans-status', T('ob.cancelled'));
    }

    // 처음 15분은 10초마다, 두 시간까지는 1분마다, 그 뒤로는 5분마다 묻는다.
    // 화면을 안 보고 있으면 쉬었다가 돌아오면 바로 한 번 묻는다.
    function nextDelay() {
        const age = Date.now() - (current ? current.createdAt : Date.now());
        if (age < 15 * 60000) return 10000;
        if (age < 2 * 3600000) return 60000;
        return 300000;
    }

    function stopPolling() {
        pollGen++;
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
    }

    function startPolling(immediate) {
        stopPolling();
        const gen = pollGen;
        const tick = async () => {
            if (gen !== pollGen) return;
            pollTimer = null;
            if (!current || document.hidden) return;
            await refreshOrder(false);
            if (gen !== pollGen) return;   // 확인하는 사이 새 폴링이 시작됐으면 이 줄은 멈춘다
            if (current && current.order && current.order.status === 'pending') pollTimer = setTimeout(tick, nextDelay());
        };
        pollTimer = setTimeout(tick, immediate ? 0 : nextDelay());
    }

    function resumeOrder() {
        let saved = null;
        try { saved = JSON.parse(store.get(ORDER_STORE) || 'null'); } catch (e) { saved = null; }
        const params = new URLSearchParams(location.search);
        const fromReturn = params.get('order');
        if (fromReturn) {
            params.delete('order');
            const q = params.toString();
            history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
        }
        if (!saved || !saved.id || !saved.token) {
            if (fromReturn) setStatus('plans-status', T('ob.otherBrowser', { id: fromReturn }), true);
            return;
        }
        current = saved;
        if (current.order) renderOrder();
        if (api) startPolling(true);
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && current && current.order && current.order.status === 'pending') startPolling(true);
    });

    /* ───── 잠금 · 해제 ───── */

    function lock(message, isError) {
        $('premium').hidden = true;
        $('paywall').hidden = false;
        if (message) setStatus('license-status', message, isError);
    }

    function unlock(record, justBought) {
        $('paywall').hidden = true;
        $('premium').hidden = false;
        unlockedRecord = record;
        $('license-summary').textContent = L.summary(record);
        $('license-code').textContent = record.key;
        $('license-new').hidden = !justBought;
        if (justBought) showKey(true);
        loadWindowStats();
        if (justBought) window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ───── 환불 요청 ───── */

    const REFUND_HOURS = { week: 24, month: 168, lifetime: 168 };   // 이용약관 4조 (서버가 다시 확인한다)
    let unlockedRecord = null;

    function refundDeadline(record) {
        const h = REFUND_HOURS[record && record.planId];
        if (!h || !record.issuedAt) return null;
        return Date.parse(record.issuedAt) + h * 3600 * 1000;
    }

    function openRefund() {
        const box = $('refund-box');
        const open = box.hidden;
        box.hidden = !open;
        $('refund-open').setAttribute('aria-expanded', String(open));
        if (!open) return;
        const until = refundDeadline(unlockedRecord);
        const ok = until && until > Date.now();
        $('refund-window').textContent = ok ? T('rf.until', { date: fmtTime(until) }) : T('rf.closed');
        $('refund-form').hidden = !ok;
        setStatus('refund-status', '');
    }

    async function submitRefund(e) {
        e.preventDefault();
        if (!$('refund-agree').checked) return setStatus('refund-status', T('rf.needAgree'), true);
        const btn = $('refund-submit');
        btn.disabled = true;
        setStatus('refund-status', T('pay.checking'));
        try {
            const key = $('license-code').textContent;
            const r = await call('/api/refunds', { method: 'POST', body: { key, account: $('refund-account').value.trim() } });
            L.forget(true);
            store.del(PURCHASED_STORE);
            $('license-key').value = '';
            $('refund-box').hidden = true;
            showKey(false);
            lock(r.status === 'refunded' ? T('rf.doneCard') : T('rf.doneBank', { amount: won(r.amount) }));
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            setStatus('refund-status', errText(err), true);
        } finally {
            btn.disabled = false;
        }
    }

    function showKey(open) {
        $('license-reveal').hidden = !open;
        $('license-show').setAttribute('aria-expanded', String(open));
        $('license-show').textContent = open ? T('s5.hideKey') : T('s5.showKey');
    }

    function loadWindowStats() {
        if (statsLoaded) return;
        statsLoaded = true;
        const grid = $('stat-grid');
        fetch('lotto-data.json')
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(data => {
                const count = cfg.windowDraws || 22;
                const w = LottoStats.withinDraws(data.draws, count);
                if (!w.draws.length) throw new Error('추첨 기록이 없다');
                const sorted = w.draws.slice().sort((a, b) => b.round - a.round);
                const stats = LottoStats.compute(sorted, { recentWindow: sorted.length });
                $('window-scope').textContent =
                    `${w.from} ~ ${w.to} · ${stats.oldestRound}~${stats.latestRound}회 (추첨 ${stats.rounds}회)`;
                LottoStatsView.render(grid, stats, {
                    scopeLabel: `최근 ${stats.rounds}회차`,
                    trendTitle: I18N.t('pay.trendTitle'),
                    latestDraws: sorted,
                    latestTitle: `최근 ${sorted.length}회차 당첨번호`,
                });
                LottoInsights.render($('insight-grid'), stats, sorted);
                // 상세 카드는 전 회차 기록으로 그린다. 결제한 사람에게는 잠그지 않는다.
                LottoDetails.render($('detail-grid'), data.draws, { locked: false });
            })
            .catch(err => {
                console.error(err);
                statsLoaded = false;
                grid.textContent = I18N.t('stats.loadFail');
            });
    }

    async function checkKey(key, fromForm) {
        if (fromForm) setStatus('license-status', T('pay.checking'));
        const st = await L.check(key);
        if (st.unlocked) {
            setStatus('license-status', '');
            unlock(st.record, false);
            return true;
        }
        if (st.final) L.forget(!fromForm);
        lock(st.reason, true);
        return false;
    }

    // 다른 기기용 링크(statistics.html#key=LD1-…)로 들어온 경우. 키가 주소창에 남지 않게 바로 지운다.
    function keyFromHash() {
        const m = location.hash.match(/key=(LD1-[A-Za-z0-9_-]+)/);
        if (!m) return null;
        history.replaceState(null, '', location.pathname + location.search);
        return m[1];
    }

    function init() {
        renderPrices();
        document.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => openCheckout(b.dataset.plan)));
        document.querySelectorAll('input[name="co-method"]').forEach(r => r.addEventListener('change', syncMethodFields));
        $('order-form').addEventListener('submit', submitOrder);
        $('order-form').addEventListener('change', () => { if ($('co-status').classList.contains('error')) setStatus('co-status', ''); });
        $('co-close').addEventListener('click', () => { $('checkout').hidden = true; });

        $('license-form').addEventListener('submit', e => {
            e.preventDefault();
            const key = $('license-key').value.trim();
            if (!key) return setStatus('license-status', T('pay.needKey'), true);
            if (key.length > 200) return setStatus('license-status', T('pay.keyTooLong'), true);
            checkKey(key, true);
        });
        $('license-clear').addEventListener('click', () => {
            if (!window.confirm(T('s5.clearConfirm'))) return;
            L.forget(true);
            store.del(PURCHASED_STORE);
            $('license-key').value = '';
            showKey(false);
            lock(T('pay.cleared'));
        });
        $('license-show').addEventListener('click', () => showKey($('license-reveal').hidden));
        $('license-copy').addEventListener('click', e => copy($('license-code').textContent, e.currentTarget));
        $('refund-open').addEventListener('click', openRefund);
        $('refund-form').addEventListener('submit', submitRefund);
        $('license-copy-link').addEventListener('click', e => copy(
            location.origin + location.pathname + '#key=' + $('license-code').textContent, e.currentTarget));

        if (!L.configured()) {
            $('license-key').disabled = true;
            $('license-submit').disabled = true;
        }

        loadServerConfig();
        const fromLink = keyFromHash();
        const key = fromLink || L.savedKey();
        const purchased = store.get(PURCHASED_STORE);
        if (!key && purchased) $('license-key').value = purchased;   // 지워진 경우라도 산 키는 입력칸에 남겨 둔다
        if (key) {
            $('license-key').value = key;
            checkKey(key, !!fromLink).then(ok => { if (!ok) resumeOrder(); });
        } else {
            lock();
            resumeOrder();
        }
    }

    // 번역(js/i18n.js)이 화면 문구를 먼저 바꾼 뒤에 시작한다. 거꾸로면 이 파일이 쓴 문구를 번역이 덮는다.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
}());
