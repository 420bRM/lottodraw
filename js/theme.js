/* 낮/밤 모드 단추 (2026-10-21). js/i18n.js 가 머리에서 저장된 모드를 먼저 붙이고(그리기 전이라 깜빡이지 않는다) 이 파일을 불러온다.
 *
 * - 단추는 오른쪽 아래, 채팅 말풍선(펼쳤으면 채팅창) 바로 위. 머리글은 이미 단추가 많아 여기에 둔다.
 *   채팅이 없는 페이지 · 채팅이 꺼진 때는 그 자리(오른쪽 아래)에 혼자 있다.
 * - 고른 모드는 이 브라우저에 저장한다(lottodraw.theme). 처음은 낮 모드. 다른 탭에서 바꾸면 따라 바뀐다.
 * - 색은 css/site.css 의 변수로만 바뀐다(:root[data-theme="dark"]).
 * - 판매점 지도 가는 길도 여기서 붙인다(2026-10-26 사장님): 휴대폰은 낮/밤 단추 바로 위 동그란 "MAP" 단추,
 *   모든 화면은 바닥글 아래 큰 띠(다른 사이트 광고 띠처럼). 지도 페이지(store-map.html) 자신에는 붙이지 않는다.
 *   그 아래에 LottoHex 띠도 하나 더(2026-11-09 사장님).
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
            band.innerHTML = '<span class="map-band-txt"><span class="map-band-legend"><i class="d1"></i><span class="l1"></span><i class="d2"></i><span class="l2"></span></span><span class="map-band-legend map-band-legend-n"><i class="dn">✦</i><span class="ln"></span></span><b></b><small></small></span><span class="map-band-go"></span>';
            band.querySelector('.l1').textContent = tr('mapLink.l1', '1등 나온 곳');
            band.querySelector('.l2').textContent = tr('mapLink.l2', '2등만 나온 곳');
            band.querySelector('.ln').textContent = tr('mapLink.ln', 'TOP 50 판매점 · 1등이 가장 많이 나온 50곳');   // 밤 모드 띠는 TOP 50 별 화면
            band.querySelector('b').textContent = tr('mapLink.title', '로또 판매점 지도');
            band.querySelector('small').textContent = tr('mapLink.sub', '1등 · 2등이 나온 판매점 1만 곳을 지도 위 버블로. 서울부터 백령도까지, 내가 다녀온 곳도 표시해 보세요.');
            band.querySelector('.map-band-go').textContent = tr('mapLink.go', '지도 열기 →');
            foot.insertAdjacentElement('afterend', band);
            // LottoHex 가는 띠(2026-11-09 사장님 — "로또헥스도 지도처럼 바로가기 배너"): 지도 띠 바로 아래. 배경은 실제 밤 지도 위 육각 칸(img/hex-banner*.jpg),
            // 낮 · 밤 모드 모두 LottoHex 화면처럼 어두운 색 — css/site.css
            const hex = document.createElement('a');
            hex.className = 'hex-band';
            hex.href = base + 'lottohex.html';
            hex.innerHTML = '<span class="hex-band-txt"><span class="hex-band-legend"><i>⬡</i><span></span></span><b><span class="hex-band-ico" aria-hidden="true"></span>LottoHex</b><small></small></span><span class="hex-band-go"></span>';
            hex.querySelector('.hex-band-legend span').textContent = tr('hexLink.legend', '육각 칸 땅따먹기 · 칭호 도감 · 분기 랭킹');
            hex.querySelector('small').textContent = tr('hexLink.sub', '판매점에 다녀와 위치로 인증하면 육각 칸을 차지합니다. 칭호를 모으고 분기 랭킹에 도전해 보세요.');
            hex.querySelector('.hex-band-go').textContent = tr('hexLink.go', 'LottoHex 열기 →');
            band.classList.add('has-next');
            band.insertAdjacentElement('afterend', hex);
        }
        // 휴대폰(600px 밑): "판매점 지도"는 메뉴 끝 대신 머리글 오른쪽 위(2026-11-09 사장님). 넓은 화면은 아래 메뉴 그대로 — css/site.css
        const bannerEl = document.querySelector('header.banner');
        if (bannerEl && !bannerEl.querySelector('.banner-map')) {
            const a = document.createElement('a');
            a.className = 'banner-map';
            a.href = base + 'store-map.html';
            a.textContent = tr('nav.map', '판매점 지도');
            a.dataset.i18n = 'nav.map';
            // 두 단추는 한 묶음(.banner-links, 격자 한 칸)에 넣어 좌우 폭을 똑같이 맞춘다(2026-11-11 사장님)
            const links = document.createElement('div');
            links.className = 'banner-links';
            links.appendChild(a);
            bannerEl.appendChild(links);
            // 그 바로 아래 LottoHex(2026-11-11 사장님 — "여기 로또헥스 버튼도 놓자"). 무엇인지 보이게 작은 "땅따먹기 게임"(지도 모드 단추와 같은 꼴)
            const h = document.createElement('a');
            h.className = 'banner-hex';
            h.href = base + 'lottohex.html';
            h.innerHTML = '<span class="banner-hex-ico" aria-hidden="true"></span><span class="banner-hex-txt">LottoHex<small></small></span>';
            const sub = h.querySelector('small');
            sub.textContent = tr('nav.hexSub', '땅따먹기 게임');
            sub.dataset.i18n = 'nav.hexSub';
            links.appendChild(h);
        }
        // 메뉴 맨 오른쪽 "판매점 지도"(2026-10-27 사장님 — 생성기 제목 아래 단추를 옮김). 메뉴는 1,300쪽에 박혀 있어 여기서 붙인다
        const navUl = document.querySelector('nav.nav ul');
        if (navUl && !navUl.querySelector('.nav-map')) {
            const li = document.createElement('li');
            li.className = 'nav-map';
            li.innerHTML = '<a></a>';
            li.firstChild.href = base + 'store-map.html';
            li.firstChild.textContent = tr('nav.map', '판매점 지도');
            li.firstChild.dataset.i18n = 'nav.map';   // 언어를 바꾸면 i18n.js 가 다시 쓴다
            // 그 왼쪽에 LottoHex(2026-11-12 사장님 — PC 메뉴 줄 "판매점 지도" 옆). 휴대폰은 머리글 오른쪽 위 묶음(.banner-links)에 있어 여기 것은 감춘다
            const hx = document.createElement('a');
            hx.className = 'nav-hex';
            hx.href = base + 'lottohex.html';
            hx.innerHTML = '<span class="nav-hex-ico" aria-hidden="true"></span><b>LottoHex</b><small></small>';
            const hs = hx.querySelector('small');
            hs.textContent = tr('nav.hexSub', '땅따먹기 게임');
            hs.dataset.i18n = 'nav.hexSub';
            li.insertBefore(hx, li.firstChild);
            navUl.appendChild(li);
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
