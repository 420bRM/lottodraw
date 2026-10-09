// 번호 공을 쌓은 분포 그림(svg.dist-chart 안의 .dist-ball — 많이 나온 번호 순위 · About 미리 보기).
// 공에 마우스를 올리면(휴대폰은 누르면) 그 공을 밝게 띄우고 나머지는 옅게, 공 위에 "34번 · 187회"를 바로 보인다.
// 그림은 생성기(tools/build-static-stats.js)가 미리 그린 SVG 다. 이 스크립트가 없어도 CSS :hover 로 밝아지고 <title> 툴팁이 뜬다.
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs) => {
        const node = document.createElementNS(NS, tag);
        Object.keys(attrs).forEach(k => node.setAttribute(k, attrs[k]));
        return node;
    };
    const fmt = v => Number(v).toLocaleString('ko-KR');
    const label = (n, c) => (window.I18N && window.I18N.lang === 'en' ? `No. ${n} · ${fmt(c)}×` : `${n}번 · ${fmt(c)}회`);

    function enhance(svg) {
        const balls = svg.querySelectorAll('.dist-ball[data-n]');
        if (!balls.length) return;
        // 바로 뜨는 이름표가 있으니, 늦게 떠서 겹치는 기본 툴팁(<title>)은 뺀다
        balls.forEach(b => { const t = b.querySelector('title'); if (t) t.remove(); });
        const tip = make('g', { class: 'dist-tip', visibility: 'hidden', 'aria-hidden': 'true' });
        const box = make('rect', { rx: 4, ry: 4 });
        const text = make('text', { 'text-anchor': 'middle' });
        tip.appendChild(box);
        tip.appendChild(text);
        svg.appendChild(tip);
        const vb = svg.viewBox.baseVal;
        let on = null;

        function show(b) {
            if (on === b) return;
            if (on) on.classList.remove('is-on');
            on = b;
            b.classList.add('is-on');
            svg.classList.add('has-on');
            // 맨 앞으로 꺼내 이웃 공에 빛 테두리가 가리지 않게 (이름표는 늘 그 위)
            if (b.nextSibling !== tip) svg.insertBefore(b, tip);
            const c = b.querySelector('circle');
            const cx = Number(c.getAttribute('cx'));
            const cy = Number(c.getAttribute('cy'));
            const r = Number(c.getAttribute('r'));
            // 그림이 줄어 보이는 휴대폰에서도 이름표 글자가 12px 쯤 되게 (공 번호보다 크게)
            const k = Math.min(1.6, Math.max(1, vb.width / (svg.getBoundingClientRect().width || vb.width)));
            text.style.fontSize = (12 * k).toFixed(1) + 'px';
            text.textContent = label(b.dataset.n, b.dataset.c);
            tip.setAttribute('visibility', 'visible');
            const w = Math.ceil(text.getComputedTextLength() + 16 * k);
            const h = Math.round(20 * k);
            const x = Math.max(vb.x + 2, Math.min(vb.x + vb.width - w - 2, cx - w / 2));
            let y = cy - r - 7 - h;
            if (y < vb.y + 2) y = cy + r + 7;     // 맨 위 공은 아래에
            box.setAttribute('x', x);
            box.setAttribute('y', y);
            box.setAttribute('width', w);
            box.setAttribute('height', h);
            text.setAttribute('x', x + w / 2);
            text.setAttribute('y', y + h * 0.7);
        }
        function hide() {
            if (on) on.classList.remove('is-on');
            on = null;
            svg.classList.remove('has-on');
            tip.setAttribute('visibility', 'hidden');
        }

        svg.addEventListener('pointerover', e => {
            const b = e.target.closest && e.target.closest('.dist-ball');
            if (b) show(b);
            else if (e.pointerType === 'mouse') hide();   // 공 사이 빈 곳
        });
        svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
        // 휴대폰: 누른 공을 켜 두고, 그림의 빈 곳이나 그림 밖을 누르면 끈다
        svg.addEventListener('click', e => {
            const b = e.target.closest && e.target.closest('.dist-ball');
            if (b) show(b); else hide();
        });
        document.addEventListener('pointerdown', e => { if (on && !svg.contains(e.target)) hide(); });
    }

    const run = () => document.querySelectorAll('svg.dist-chart').forEach(enhance);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
})();
