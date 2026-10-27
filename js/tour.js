/* 홈 번호 생성기 사용법 둘러보기 (2026-10-14). 디테일크롭(detailcrop.com)의 "How it works" 와 같은 방식:
 *
 * - 제목 옆 "사용법 보기"를 누르면 화면을 어둡게 하고, 생성기의 한 부분씩 테두리로 비추며 옆에 설명 상자를 띄운다.
 *   단계마다 그 부분을 화면 가운데로 굴리고, 굴리거나 창 크기를 바꾸면 테두리 · 상자가 따라간다.
 * - 저절로 시작하지 않는다. 한 번도 열지 않은 브라우저에서는 단추가 맥박친다(localStorage lottodraw.tour).
 * - 어두운 막은 누르기를 막지 않는다(그림자만) — 둘러보는 동안에도 번호를 눌러 볼 수 있다. Esc · 건너뛰기로 닫는다.
 * - 로그인 창(z-index 100)이 위에 오도록 채팅 창(95)과 그 사이(98)에 둔다.
 */
(function () {
    'use strict';

    const btn = document.getElementById('tour-btn');
    if (!btn) return;
    const SEEN = 'lottodraw.tour';
    const t = k => (window.I18N ? I18N.t(k) : k);
    // 비출 곳 — 없으면 건너뛴다
    const STEPS = [
        { sel: '#sec-generator .gen-go', key: 'tour.s1' },
        { sel: '#sec-generator .gen-sliders', key: 'tour.s2' },
        { sel: '#sec-generator .gen-log', key: 'tour.s3' },
        { sel: '#number-grid', key: 'tour.s4' },
        { sel: '#sec-generator .picker-actions', key: 'tour.s5' },
        { sel: 'section[aria-labelledby="patterns-title"]', key: 'tour.s6' },
        { sel: '[data-react="index-history"]', key: 'tour.s7' },
        // 2026-10-26: 판매점 지도 가는 단추(휴대폰 MAP · PC 제목 아래) · 낮/밤 단추 · 채팅. 쉼표로 여럿 적으면 보이는 첫 것
        { sel: '.nav-map a, #map-fab', key: 'tour.s8' },
        { sel: '#theme-btn', key: 'tour.s9' },
        { sel: '#chat-panel, #chat-fab', key: 'tour.s10' },
    ];
    const shown = n => !!(n && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
    const find = sel => [...document.querySelectorAll(sel)].find(shown) || null;
    let steps = STEPS;   // 시작할 때 보이는 단계만 고른다(번호 "3 / 9" 가 건너뛴 단계를 세지 않게)

    function el(tag, cls, attrs) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
        return n;
    }
    const root = el('div', 'tour', { id: 'tour', hidden: '' });
    const ring = el('div', 'tour-ring');
    const tip = el('div', 'tour-tip', { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tour-step', 'aria-describedby': 'tour-text' });
    const stepEl = el('p', 'tour-step', { id: 'tour-step' });
    const textEl = el('p', 'tour-text', { id: 'tour-text', 'aria-live': 'polite' });
    const skip = el('button', 'tour-skip', { type: 'button' });
    const next = el('button', 'btn tour-next', { type: 'button' });
    const btns = el('div', 'tour-btns');
    btns.append(skip, next);
    tip.append(stepEl, textEl, btns);
    root.append(ring, tip);
    document.body.appendChild(root);

    let idx = -1;
    let target = null;
    const active = () => !root.hidden;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function place() {
        if (!active() || !target) return;
        const r = target.getBoundingClientRect();
        const pad = 6;
        ring.style.left = (r.left - pad) + 'px';
        ring.style.top = (r.top - pad) + 'px';
        ring.style.width = (r.width + pad * 2) + 'px';
        ring.style.height = (r.height + pad * 2) + 'px';
        // 설명 상자: 오른쪽 → 왼쪽 → 아래 → 위 순으로 들어갈 곳에, 화면 밖으로는 나가지 않게
        const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14, m = 12;
        const vw = window.innerWidth, vh = window.innerHeight;
        let left, top;
        if (r.right + gap + tw + m <= vw) { left = r.right + gap; top = r.top + r.height / 2 - th / 2; }
        else if (r.left - gap - tw >= m) { left = r.left - gap - tw; top = r.top + r.height / 2 - th / 2; }
        else if (r.bottom + gap + th + m <= vh) { left = r.left + r.width / 2 - tw / 2; top = r.bottom + gap; }
        else { left = r.left + r.width / 2 - tw / 2; top = r.top - gap - th; }
        tip.style.left = clamp(left, m, Math.max(m, vw - tw - m)) + 'px';
        tip.style.top = clamp(top, m, Math.max(m, vh - th - m)) + 'px';
    }
    function paint() {
        const step = steps[idx];
        if (!step) return;
        stepEl.textContent = (idx + 1) + ' / ' + steps.length;
        textEl.textContent = t(step.key);
        skip.textContent = t('tour.skip');
        next.textContent = idx === steps.length - 1 ? t('tour.done') : t('tour.next');
    }
    function go(i) {
        idx = i;
        if (idx >= steps.length) { end(); return; }
        const node = find(steps[idx].sel);
        if (!node) { go(idx + 1); return; }   // 그 사이 사라졌으면 건너뛴다
        target = node;
        const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        node.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        paint();
        place();
        setTimeout(place, 60);
        setTimeout(place, 450);   // 부드럽게 굴러가는 동안 · 끝난 뒤
        next.focus({ preventScroll: true });
    }
    function start() {
        if (active()) return;
        steps = STEPS.filter(s => find(s.sel));   // 없거나 숨겨진 부분은 뺀다(채팅이 꺼졌을 때 등)
        root.hidden = false;
        go(0);
    }
    function end() {
        if (!active()) return;
        root.hidden = true;
        idx = -1;
        target = null;
        try { localStorage.setItem(SEEN, '1'); } catch (e) { /* 저장소가 막힌 브라우저 */ }
        btn.focus({ preventScroll: true });
    }

    next.addEventListener('click', () => go(idx + 1));
    skip.addEventListener('click', end);
    btn.addEventListener('click', () => {
        btn.classList.remove('is-new');
        try { localStorage.setItem(SEEN, '1'); } catch (e) { /* 저장소가 막힌 브라우저 */ }
        start();
    });
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    document.addEventListener('keydown', e => {
        if (!active()) return;
        if (e.key === 'Escape') { e.preventDefault(); end(); }
    }, true);

    let seen = null;
    try { seen = localStorage.getItem(SEEN); } catch (e) { seen = '1'; }
    if (!seen) btn.classList.add('is-new');
})();
