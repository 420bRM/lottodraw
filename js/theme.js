/* 낮/밤 모드 단추 (2026-10-21). js/i18n.js 가 머리에서 저장된 모드를 먼저 붙이고(그리기 전이라 깜빡이지 않는다) 이 파일을 불러온다.
 *
 * - 단추는 오른쪽 아래, 채팅 말풍선(펼쳤으면 채팅창) 바로 위. 머리글은 이미 단추가 많아 여기에 둔다.
 *   채팅이 없는 페이지 · 채팅이 꺼진 때는 그 자리(오른쪽 아래)에 혼자 있다.
 * - 고른 모드는 이 브라우저에 저장한다(lottodraw.theme). 처음은 낮 모드. 다른 탭에서 바꾸면 따라 바뀐다.
 * - 색은 css/site.css 의 변수로만 바뀐다(:root[data-theme="dark"]).
 * - 판매점 지도 가는 길도 여기서 붙인다(2026-10-26 사장님): 휴대폰은 낮/밤 단추 바로 위 동그란 "MAP" 단추,
 *   모든 화면은 바닥글 아래 큰 띠(다른 사이트 광고 띠처럼). 지도 페이지(store-map.html) 자신에는 붙이지 않는다.
 */
(function () {
    'use strict';

    if (document.getElementById('theme-btn')) return;
    const me = document.currentScript;
    const base = me && me.src ? me.src.replace(/js\/theme\.js(\?.*)?$/, '') : '';   // 사이트 맨 위 주소(blog/ · round/ 에서도 맞게)
    const STORE = 'lottodraw.theme';
    const root = document.documentElement;
    const tr = (key, ko) => (window.I18N ? window.I18N.t(key, ko) : ko);
    const isDark = () => root.getAttribute('data-theme') === 'dark';

    const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" fill="currentColor"/></svg>';
    const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.6" fill="currentColor"/>' +
        '<path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'theme-btn';
    btn.className = 'theme-btn';

    function paint() {
        const dark = isDark();
        btn.innerHTML = dark ? SUN : MOON;
        const label = dark ? tr('theme.toLight', '낮 모드로 보기') : tr('theme.toDark', '밤 모드로 보기');
        btn.setAttribute('aria-label', label);
        btn.title = label;
    }
    function set(dark, save) {
        if (dark) root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
        if (save) { try { localStorage.setItem(STORE, dark ? 'dark' : 'light'); } catch (e) { /* 프라이빗 모드: 이 페이지에서만 */ } }
        paint();
    }
    btn.addEventListener('click', () => set(!isDark(), true));
    window.addEventListener('storage', e => { if (e.key === STORE) set(e.newValue === 'dark', false); });
    document.body.appendChild(btn);
    // 배포 직후 옛 site.css 를 쥔 브라우저에서는 모양 없는 단추가 페이지 끝에 붙는다 — 그때는 빼 둔다(다음에 열 때 생긴다)
    if (getComputedStyle(btn).position !== 'fixed') { btn.remove(); return; }
    paint();

    // 판매점 지도 가는 길: 휴대폰 "MAP" 단추(낮/밤 단추 위) + 바닥글 아래 큰 띠
    const onMap = document.body.classList.contains('sm-full');
    let mapFab = null;
    if (!onMap && base) {
        mapFab = document.createElement('a');
        mapFab.id = 'map-fab';
        mapFab.className = 'map-fab';
        mapFab.href = base + 'store-map.html';
        mapFab.textContent = 'MAP';
        mapFab.setAttribute('aria-label', tr('mapLink.fab', '로또 판매점 지도'));
        mapFab.title = mapFab.getAttribute('aria-label');
        document.body.appendChild(mapFab);
        const foot = document.querySelector('footer.footer');
        if (foot) {
            const band = document.createElement('a');
            band.className = 'map-band';
            band.href = base + 'store-map.html';
            // 배경은 실제 지도 화면(서울 + 버블, img/map-banner*.jpg), 색은 지도 페이지와 같게(흰 패널 · 남색 글씨 · 1등 주황 · 2등 파랑) — css/site.css
            band.innerHTML = '<span class="map-band-txt"><span class="map-band-legend"><i class="d1"></i><span class="l1"></span><i class="d2"></i><span class="l2"></span></span><b></b><small></small></span><span class="map-band-go"></span>';
            band.querySelector('.l1').textContent = tr('mapLink.l1', '1등 나온 곳');
            band.querySelector('.l2').textContent = tr('mapLink.l2', '2등만 나온 곳');
            band.querySelector('b').textContent = tr('mapLink.title', '로또 판매점 지도');
            band.querySelector('small').textContent = tr('mapLink.sub', '1등 · 2등이 나온 판매점 1만 곳을 지도 위 버블과 3D 막대로. 서울부터 백령도까지, 내가 다녀온 곳도 표시해 보세요.');
            band.querySelector('.map-band-go').textContent = tr('mapLink.go', '지도 열기 →');
            foot.insertAdjacentElement('afterend', band);
        }
    }

    // 채팅 말풍선 · 창 바로 위에 앉는다. 채팅은 나중에 붙고(js/account.js → js/chat.js) 열고 닫으면 높이가 바뀌어 지켜본다
    const GAP = 10;
    function place() {
        const box = ['chat-panel', 'chat-fab'].map(id => document.getElementById(id)).find(n => n && !n.hidden && n.offsetHeight);
        if (!box) { btn.style.bottom = ''; btn.style.right = ''; }
        else {
            const cs = getComputedStyle(box);
            btn.style.bottom = (parseFloat(cs.bottom) || 0) + box.offsetHeight + GAP + 'px';
            btn.style.right = cs.right;
        }
        // MAP 단추는 낮/밤 단추 바로 위(같은 줄)
        if (mapFab) {
            const cs = getComputedStyle(btn);
            mapFab.style.bottom = (parseFloat(cs.bottom) || 0) + btn.offsetHeight + GAP + 'px';
            mapFab.style.right = cs.right;
        }
    }
    const seen = new Set();
    const resized = window.ResizeObserver ? new ResizeObserver(place) : null;
    const toggled = new MutationObserver(() => { watch(); place(); });
    function watch() {
        ['chat-panel', 'chat-fab'].forEach(id => {
            const n = document.getElementById(id);
            if (!n || seen.has(n)) return;
            seen.add(n);
            if (resized) resized.observe(n);
            toggled.observe(n, { attributes: true, attributeFilter: ['hidden'] });
        });
    }
    toggled.observe(document.body, { childList: true });
    window.addEventListener('resize', place);
    watch();
    place();
})();
