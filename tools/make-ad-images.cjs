// 실행: NODE_PATH=$(npm root -g) node tools/make-ad-images.cjs  (Playwright 필요 · 글꼴은 Google Fonts 에서 받음)
// 구글 반응형 디스플레이 광고 이미지(2026-11-11): 기존 LottoHex 배너(실제 지도) · OG 를 재활용 + 육각 칸 그림 · 로고는 SVG 로 새로(선명하게)
// 글자는 작게(구글 권장: 그림 속 글자는 20% 이하). 결과: ads/google-lottohex-1/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const OUT = path.join(REPO, 'ads/google-lottohex-1');
const b64 = f => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(REPO, f)).toString('base64');
const FONT = '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700;900&display=block" rel="stylesheet">';
const GRAD = '<linearGradient id="g" x1="0.2" y1="0" x2="0.65" y2="1"><stop offset="0" stop-color="#ffd76a"/><stop offset="0.55" stop-color="#ff6fae"/><stop offset="1" stop-color="#8f7bff"/></linearGradient>';
// 꼭짓점이 위로 간 육각형(가운데 cx, cy, 반지름 r)
const hexPts = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 90); return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1); }).join(' ');
const logoHex = (cx, cy, r) => '<polygon points="' + hexPts(cx, cy, r) + '" fill="url(#g)"/>';
// 육각 칸 그림: 어두운 바탕에 옅은 격자, 칸 몇 개는 참여자 색(줄무늬 · 단색) + 빛 테두리 — 사이트 LottoHex 화면과 같은 느낌
function hexArt(W, H, r, seed) {
    let s = seed;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const COLS = ['#e63946', '#ff6fae', '#2a9d8f', '#48cae4', '#f4a261', '#8f7bff', '#52b788', '#ffd166'];
    const w = Math.sqrt(3) * r, h = 1.5 * r;
    let defs = '', body = '';
    COLS.forEach((c, i) => { defs += '<pattern id="p' + i + '" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="' + c + '" fill-opacity=".55"/><rect width="6" height="14" fill="' + c + '" fill-opacity=".9"/></pattern>'; });
    for (let row = -1; row * h < H + r; row++) for (let col = -1; col * w < W + w; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0), cy = row * h;
        const pick = rnd();
        // 오른쪽 · 가운데로 갈수록 칠한 칸이 많게
        const dens = 0.18 + 0.5 * (cx / W);
        if (pick < dens) {
            const k = Math.floor(rnd() * COLS.length), c = COLS[k], striped = rnd() < 0.55;
            body += '<polygon points="' + hexPts(cx, cy, r - 3) + '" fill="' + (striped ? 'url(#p' + k + ')' : c) + '" fill-opacity="' + (striped ? 1 : 0.85) + '" stroke="' + c + '" stroke-width="3" filter="url(#glow)"/>';
        } else body += '<polygon points="' + hexPts(cx, cy, r - 3) + '" fill="#1d2431" stroke="#2c3546" stroke-width="2"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"><defs>' + defs + '<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="100%" height="100%" fill="#141a23"/>' + body + '</svg>';
}
const pill = (size) => '<div class="pill" style="font-size:' + size + 'px"><svg viewBox="0 0 100 100" style="width:1.15em;height:1.15em"><defs>' + GRAD + '</defs>' + logoHex(50, 50, 48) + '</svg><span>LottoHex</span></div>';
const CSS = '<style>html,body{margin:0;padding:0;background:#141a23}body{font-family:"Noto Sans KR",Inter,sans-serif}.wrap{position:relative;overflow:hidden}.bg{position:absolute;inset:0;background-size:cover;background-position:center}.pill{position:absolute;display:inline-flex;align-items:center;gap:.35em;padding:.32em .7em .32em .5em;border-radius:999px;background:rgba(15,18,28,.82);border:2px solid rgba(255,255,255,.18);color:#fff;font-weight:900;letter-spacing:-.01em;box-shadow:0 4px 18px rgba(0,0,0,.45)}.sub{position:absolute;color:#ffe9a8;font-weight:900;text-shadow:0 2px 10px rgba(0,0,0,.7)}</style>';
const IMAGES = [
    // 가로 1.91:1 — 실제 지도 위 칸(사이트 배너) + 작은 로고
    { file: 'landscape-1-map.jpg', w: 1200, h: 628, html: '<div class="wrap" style="width:1200px;height:628px"><div class="bg" style="background-image:url(' + b64('img/hex-banner-m.jpg') + ')"></div><div style="position:absolute;left:28px;top:26px">' + pill(40).replace('class="pill"', 'class="pill" style="position:static;font-size:40px"') + '</div></div>' },
    // 가로 1.91:1 — 사이트 OG 그대로(글자가 많아 구글이 경고하면 이것만 빼면 된다)
    { file: 'landscape-2-brand.jpg', w: 1200, h: 628, html: '<div class="wrap" style="width:1200px;height:628px"><div class="bg" style="background-image:url(' + b64('img/og-lottohex.jpg') + ')"></div></div>' },
    // 정사각형 — 육각 칸 그림 + 가운데 로고 + 한 줄
    { file: 'square-1-hex.jpg', w: 1200, h: 1200, html: '<div class="wrap" style="width:1200px;height:1200px">' + hexArt(1200, 1200, 74, 7) + '<div style="position:absolute;left:0;right:0;top:470px;text-align:center">' + pill(92).replace('class="pill"', 'class="pill" style="position:static;font-size:92px"') + '</div><div class="sub" style="left:0;right:0;top:640px;text-align:center;font-size:60px">로또 판매점 땅따먹기</div></div>' },
    // 정사각형 — 실제 지도 위 칸(배너 가운데를 잘라 600×600) + 작은 로고
    { file: 'square-2-map.jpg', w: 600, h: 600, html: '<div class="wrap" style="width:600px;height:600px"><div class="bg" style="background-image:url(' + b64('img/hex-banner-m.jpg') + ');background-size:auto 600px;background-position:58% 50%"></div><div style="position:absolute;left:20px;top:20px">' + pill(30).replace('class="pill"', 'class="pill" style="position:static;font-size:30px"') + '</div></div>' },
    // 세로 9:16(일부 자리용) — 육각 칸 그림 + 로고 + 한 줄
    { file: 'portrait-hex.jpg', w: 900, h: 1600, html: '<div class="wrap" style="width:900px;height:1600px">' + hexArt(900, 1600, 70, 21) + '<div style="position:absolute;left:0;right:0;top:640px;text-align:center">' + pill(84).replace('class="pill"', 'class="pill" style="position:static;font-size:84px"') + '</div><div class="sub" style="left:0;right:0;top:800px;text-align:center;font-size:56px">로또 판매점 땅따먹기</div></div>' },
    // 로고 정사각형 — 어두운 바탕 + 색 육각형
    { file: 'logo-square.png', w: 1200, h: 1200, png: true, html: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><defs>' + GRAD + '</defs><rect width="1200" height="1200" fill="#141a23"/>' + logoHex(600, 600, 430) + '</svg>' },
    // 로고 가로 4:1 — 육각형 + LottoHex
    { file: 'logo-landscape.png', w: 1200, h: 300, png: true, html: '<div style="width:1200px;height:300px;display:flex;align-items:center;justify-content:center;gap:34px;background:#141a23;color:#fff;font:900 150px/1 &quot;Noto Sans KR&quot;,sans-serif;letter-spacing:-.02em"><svg viewBox="0 0 100 100" style="width:170px;height:170px"><defs>' + GRAD + '</defs>' + logoHex(50, 50, 48) + '</svg>LottoHex</div>' },
];
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch();
    for (const im of IMAGES) {
        const ctx = await b.newContext({ viewport: { width: im.w, height: im.h }, deviceScaleFactor: 1 });
        const p = await ctx.newPage();
        await p.setContent('<!doctype html><meta charset="utf-8">' + FONT + CSS + im.html, { waitUntil: 'networkidle' });
        await p.evaluate(() => document.fonts.ready);
        await p.waitForTimeout(300);
        const file = path.join(OUT, im.file);
        await p.screenshot({ path: file, type: im.png ? 'png' : 'jpeg', quality: im.png ? undefined : 90, clip: { x: 0, y: 0, width: im.w, height: im.h } });
        console.log(im.file, im.w + 'x' + im.h, Math.round(fs.statSync(file).size / 1024) + 'KB');
        await ctx.close();
    }
    await b.close();
})();
