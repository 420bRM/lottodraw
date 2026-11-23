// LottoHex 인스타그램 처음 9개 글 시안(2026-11-23) — 1080×1350 JPEG. 실행: node make.cjs [글 번호…]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = '/home/user/lottodraw', OUT = path.join(__dirname, 'out');
const HEX = require(REPO + '/js/hexgrid.js');
const J = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const CELLS = J('store-map-cells.json').cells, BLOCKS = J('store-map-blocks.json').b, SNAP = J('lottohex-snapshot.json');
const SHOPS = Object.keys(J('shops-all.json').shops).length;
const fmt = n => n.toLocaleString('ko-KR');
const W = 1080, H = 1350;
const FONT = '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;900&display=block" rel="stylesheet">';
const GRAD = '<linearGradient id="lg" x1="0.2" y1="0" x2="0.65" y2="1"><stop offset="0" stop-color="#ffd76a"/><stop offset="0.55" stop-color="#ff6fae"/><stop offset="1" stop-color="#8f7bff"/></linearGradient>';
const hexPts = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 90); return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1); }).join(' ');
const logo = s => `<svg viewBox="0 0 100 100" width="${s}" height="${s}"><defs>${GRAD}</defs><polygon points="${hexPts(50, 50, 48)}" fill="url(#lg)"/></svg>`;
const COLS = ['#e63946', '#ff6fae', '#2a9d8f', '#48cae4', '#f4a261', '#8f7bff', '#52b788', '#ffd166'];
const CSS = `<style>
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;background:#141a23;color:#fff;font-family:"Noto Sans KR",sans-serif;overflow:hidden}
.pg{position:relative;width:${W}px;height:${H}px;padding:56px 72px;display:flex;flex-direction:column}
.bgx{position:absolute;inset:0;z-index:0;opacity:.55}.pg>*:not(.bgx){position:relative;z-index:1}
.top{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:14px;font-weight:900;font-size:40px;letter-spacing:-.01em}
.brand small{font-weight:700;font-size:24px;color:#8f9bb0;letter-spacing:.12em;margin-left:6px}
.cnt{font-weight:700;font-size:26px;color:#8f9bb0;padding:6px 18px;border:2px solid #2c3546;border-radius:999px}
.kick{margin-top:84px;font-size:34px;font-weight:700;color:#b9b3e6;letter-spacing:.02em}
.t{margin-top:20px;font-size:92px;font-weight:900;line-height:1.16;letter-spacing:-.03em}
.t em{font-style:normal;color:#ffd76a}.t i{font-style:normal;background:linear-gradient(90deg,#ffd76a,#ff6fae 55%,#8f7bff);-webkit-background-clip:text;color:transparent}
.s{margin-top:32px;font-size:40px;font-weight:700;line-height:1.5;color:#c3cad6;letter-spacing:-.01em}
.s b{color:#fff}
.grow{flex:1}
.foot{display:flex;justify-content:space-between;align-items:flex-end;font-size:26px;font-weight:700;color:#8a94a6}
.foot .u{color:#cfd6e0}
.chip{display:inline-block;padding:8px 22px;border-radius:999px;font-size:30px;font-weight:900}
.now{background:#1f6f66;color:#d9fff8}.goal{background:linear-gradient(90deg,#ff6fae,#8f7bff);color:#fff}
.steps{display:flex;justify-content:space-between;margin-top:8px}
.st{display:flex;flex-direction:column;align-items:center;gap:10px;width:180px;font-size:28px;font-weight:700;color:#6b768a}
.st.on{color:#fff}.st.done{color:#a9b3c4}
.list{margin-top:40px;display:flex;flex-direction:column;gap:22px}
.li{display:flex;align-items:center;gap:24px;padding:24px 28px;border:2px solid #2c3546;border-radius:20px;background:rgba(29,36,49,.85);font-size:38px;font-weight:700}
.li .n{flex:none;width:64px;height:64px;display:grid;place-items:center;font-weight:900;font-size:34px;color:#141a23;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);background:#ffd76a}
.li .r{margin-left:auto;font-size:34px;color:#ffd76a;font-weight:900;white-space:nowrap}
.li small{display:block;font-size:28px;color:#8f9bb0;font-weight:700;margin-top:4px}
.warn{margin-top:40px;padding:32px 36px;border-radius:24px;background:#3a1d2a;border:3px solid #ff6fae;font-size:40px;font-weight:700;line-height:1.5}
.warn b{color:#ffd76a}
.tags{display:flex;flex-wrap:wrap;gap:14px;margin-top:14px}
.tag{padding:10px 22px;border-radius:999px;background:#1d2431;border:2px solid #34405a;font-size:30px;font-weight:700}
.tag.q{color:#6b768a;border-style:dashed}
.grp{margin-top:30px;font-size:30px;font-weight:900;color:#b9b3e6}
</style>`;
// 바탕: 옅은 육각 격자
function bgHex(seed = 3, tint = 0) {
  let s = seed; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const r = 54, w = Math.sqrt(3) * r, h = 1.5 * r; let body = '';
  for (let row = -1; row * h < H + r; row++) for (let col = -1; col * w < W + w; col++) {
    const cx = col * w + (row % 2 ? w / 2 : 0), cy = row * h;
    const lit = tint && rnd() < tint && cx > W * 0.45;
    const c = COLS[Math.floor(rnd() * COLS.length)];
    body += `<polygon points="${hexPts(cx, cy, r - 3)}" fill="${lit ? c : '#182030'}" fill-opacity="${lit ? 0.22 : 1}" stroke="${lit ? c : '#222b3b'}" stroke-opacity="${lit ? 0.5 : 1}" stroke-width="2"/>`;
  }
  return `<svg class="bgx" width="${W}" height="${H}">${body}<rect width="${W}" height="${H}" fill="url(#vg)"/><defs><radialGradient id="vg" cx="30%" cy="35%" r="85%"><stop offset="0" stop-color="#141a23" stop-opacity=".2"/><stop offset="1" stop-color="#141a23" stop-opacity=".95"/></radialGradient></defs></svg>`;
}
const top = (n, total) => `<div class="top"><div class="brand">${logo(56)}LottoHex<small>LOTTODRAW.KR</small></div>${total ? `<div class="cnt">${n} / ${total}</div>` : ''}</div>`;
const foot = (right = '무료 · 만 19세 이상') => `<div class="foot"><span class="u">lottodraw.kr/lottohex</span><span>${right}</span></div>`;
const page = (inner, o = {}) => `<div class="pg">${bgHex(o.seed || 3, o.tint || 0)}${top(o.n, o.total)}${inner}<div class="grow"></div>${o.art || ''}${foot(o.right)}</div>`;
// 로드맵 단계 표시
const STEPS = ['지도', '발걸음', '블록', '광고', '나눔'];
const steps = (cur, z = 96) => `<div class="steps">${STEPS.map((x, i) => { const on = i === cur, done = i < cur; const c = on ? 'url(#lg)' : done ? '#3b4a63' : '#1d2431';
  return `<div class="st ${on ? 'on' : done ? 'done' : ''}"><svg width="${z}" height="${z}" viewBox="0 0 100 100"><defs>${GRAD}</defs><polygon points="${hexPts(50, 50, 46)}" fill="${c}" stroke="${on ? '#ffd76a' : '#34405a'}" stroke-width="3"/><text x="50" y="62" text-anchor="middle" font-size="34" font-weight="900" fill="${on ? '#141a23' : '#8f9bb0'}" font-family="Noto Sans KR">${i + 1}</text></svg>${x}</div>`; }).join('')}</div>`;
// 실제 블록으로 그린 그림: keys 를 화면 상자에 맞춰 그린다(위도 · 경도 → 평면)
function blockArt(keys, box, o = {}) {
  const pts = keys.map(k => { const [lng, lat] = HEX.centerOf(k); return { k, x: lng * Math.cos(36 * Math.PI / 180), y: -lat }; });
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), RU = o.real ? (0.6 / 110.95) * 1.05 : 0;   // 실제 크기면 블록 가장자리까지 상자에 넣는다
  const x0 = Math.min(...xs) - RU, x1 = Math.max(...xs) + RU, y0 = Math.min(...ys) - RU, y1 = Math.max(...ys) + RU;
  const sc = Math.min((box.w - 2 * (o.pad || 10)) / (x1 - x0 || 1), (box.h - 2 * (o.pad || 10)) / (y1 - y0 || 1));
  const ox = (box.w - (x1 - x0) * sc) / 2, oy = (box.h - (y1 - y0) * sc) / 2;
  const P = p => [ox + (p.x - x0) * sc, oy + (p.y - y0) * sc];
  const realR = (0.6 / 110.95) * sc * 0.97;   // 블록 실제 크기(중심에서 꼭짓점 0.6km)
  let body = '';
  for (const p of pts) {
    const [cx, cy] = P(p), st = o.style ? o.style(p.k, realR) : {};
    body += `<polygon points="${hexPts(cx, cy, st.r || (o.real ? realR : o.r || 4))}" fill="${st.fill || '#3a465c'}" ${st.glow ? 'filter="url(#gl)"' : ''} stroke="${st.stroke || 'none'}" stroke-width="${st.sw || 0}"/>`;
    if (st.label) body += `<text x="${cx.toFixed(1)}" y="${(cy + (st.ls || 16) * 0.35).toFixed(1)}" text-anchor="middle" font-family="Noto Sans KR" font-weight="900" font-size="${st.ls || 16}" fill="${st.lc || '#fff'}">${st.label}</text>`;
  }
  return `<svg width="${box.w}" height="${box.h}" style="display:block;margin:0 auto"><defs>${GRAD}<filter id="gl" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="${o.blur || 4}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>${o.defs || ''}</defs>${body}</svg>`;
}
const claimed = new Set(SNAP.cells);
const YT = (() => { const [q0, r0] = '-117,158'.split(',').map(Number); return Object.keys(CELLS).filter(k => { const [q, r] = k.split(',').map(Number); return (Math.abs(q - q0) + Math.abs(r - r0) + Math.abs(q + r - q0 - r0)) / 2 <= 2; }); })();
const HL = '-117,158';   // 경기-0420
function cluster(box, hl) {   // hl: { fill, label, stroke }
  return blockArt(YT, box, { real: true, pad: 8, blur: 10, defs: '<linearGradient id="adg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6fae"/><stop offset="1" stop-color="#8f7bff"/></linearGradient>',
    style: (k, R) => k === HL && hl ? { fill: hl.fill, stroke: hl.stroke || '#ffd76a', sw: 5, glow: true, label: hl.label, ls: Math.round(R * 0.34), lc: hl.lc || '#fff' }
      : { fill: '#1f2838', stroke: '#3b4a63', sw: 3, label: BLOCKS[k][0].split('-')[1], ls: Math.round(R * 0.3), lc: '#8f9bb0' } });
}
const bigNo = n => `<svg width="300" height="330" viewBox="0 0 300 330" style="position:absolute;right:56px;bottom:110px"><defs>${GRAD}<filter id="bg1"><feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><polygon points="${hexPts(150, 165, 140)}" fill="url(#lg)" filter="url(#bg1)" opacity=".95"/><text x="150" y="222" text-anchor="middle" font-family="Noto Sans KR" font-weight="900" font-size="170" fill="#141a23">${n}</text></svg>`;
const korea = (w, h, rr = 4, cr = 10) => blockArt(Object.keys(CELLS), { w, h }, { r: rr, blur: 7, style: k => claimed.has(k) ? { fill: '#ffd76a', r: cr, glow: true } : { fill: '#56637b' } });
const B = k => BLOCKS[k][0];
// 하나의 육각 블록 그림(설명용): 판매점 점 · 50m 고리
function oneBlock(o = {}) {
  const S0 = 420, c = S0 / 2, r = 190, S = o.s || 560; const dots = [[-70, -40], [40, -90], [90, 40], [-30, 80], [10, 10]];
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S0} ${S0}" style="display:block;margin:0 auto"><defs>${GRAD}<pattern id="sp" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="18" height="18" fill="#e63946" fill-opacity=".45"/><rect width="8" height="18" fill="#2a9d8f" fill-opacity=".85"/></pattern><filter id="g2"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <polygon points="${hexPts(c, c, r)}" fill="${o.owned ? 'url(#sp)' : '#1d2431'}" stroke="${o.owned ? '#ffd76a' : '#3b4a63'}" stroke-width="5" ${o.owned ? 'filter="url(#g2)"' : ''}/>
  ${dots.map(([x, y], i) => `${o.ring && i === 0 ? `<circle cx="${c + x}" cy="${c + y}" r="46" fill="#48cae4" fill-opacity=".15" stroke="#48cae4" stroke-width="3" stroke-dasharray="8 6"/><text x="${c + x}" y="${c + y - 56}" text-anchor="middle" font-size="24" font-weight="900" fill="#48cae4" font-family="Noto Sans KR">50m</text>` : ''}<circle cx="${c + x}" cy="${c + y}" r="12" fill="${(o.visited || []).includes(i) ? '#ffd76a' : '#cfd6e0'}" stroke="#141a23" stroke-width="3"/>`).join('')}
  ${o.label ? `<text x="${c}" y="${c + 150}" text-anchor="middle" font-size="34" font-weight="900" fill="#fff" font-family="Noto Sans KR">${o.label}</text>` : ''}</svg>`;
}
const POSTS = {};
// ① 고정: 로드맵(7장)
POSTS[1] = [
  page(`<div class="kick">LottoHex 로드맵</div><div class="t" style="font-size:100px">판매점 지도에서,<br><i>동네 광고판</i>으로</div><div class="s">LottoHex가 가려는 곳을<br>다섯 단계로 정리했습니다.</div>`, { n: 1, total: 7, tint: 0.3, seed: 5, art: steps(-1, 150) + '<div style="height:120px"></div>' }),
  page(`<div class="kick">1단계 · 지도 <span class="chip now">지금</span></div><div class="t">전국 로또 판매점<br><em>${fmt(SHOPS)}곳</em>을 한 지도에</div><div class="s">매주 새로 받아 문 닫은 곳은 빼고<br>옮긴 자리는 고칩니다.</div>`, { n: 2, total: 7, art: korea(900, 520, 3.2, 3.2) + '<div style="height:28px"></div>' + steps(0) + '<div style="height:32px"></div>' }),
  page(`<div class="kick">2단계 · 발걸음 <span class="chip now">지금</span></div><div class="t">화면 속 클릭이 아니라<br><em>실제로 다녀간</em> 기록</div><div class="s">판매점 50m 안에서만 인증됩니다.<br>위치는 판정에만 쓰고 저장하지 않습니다.</div>`, { n: 3, total: 7, art: oneBlock({ ring: true, s: 460 }) + '<div style="height:24px"></div>' + steps(1) + '<div style="height:32px"></div>' }),
  page(`<div class="kick">3단계 · 블록 <span class="chip now">지금</span></div><div class="t" style="font-size:84px">전국 <em>${fmt(Object.keys(CELLS).length)}블록</em>,<br>번호와 주인이<br>생겼습니다</div><div class="s">동네마다 이야기가 쌓이는 자리.</div>`, { n: 4, total: 7, art: cluster({ w: 900, h: 400 }, { fill: '#2a6f66', label: '0420', lc: '#ffd76a' }) + '<div style="height:28px"></div>' + steps(2) + '<div style="height:32px"></div>' }),
  page(`<div class="kick">4단계 · 광고 시스템 <span class="chip goal">최종 목표</span></div><div class="t">블록이 <i>동네 광고판</i>이<br>됩니다</div><div class="s">그 블록의 가게가 오가는 사람에게 알리고,<br>효과는 <b>실제로 다녀간 발걸음 수</b>로 셉니다.</div>`, { n: 5, total: 7, art: cluster({ w: 900, h: 450 }, { fill: 'url(#adg)', label: '광고', stroke: '#ffd76a' }) + '<div style="height:28px"></div>' + steps(3) + '<div style="height:32px"></div>' }),
  page(`<div class="kick">5단계 · 블록 주인의 몫 <span class="chip goal">최종 목표</span></div><div class="t">광고 수익을<br><i>블록 주인</i>과 나눕니다</div><div class="s">광고가 붙은 블록은 광고 수익의 일부가<br>그 블록 주인에게 돌아갑니다.<br><b>포인트와는 별개입니다.</b> 포인트는 게임 안에서,<br>광고 수익은 실제 수익입니다.</div>`, { n: 6, total: 7, art: cluster({ w: 900, h: 330 }, { fill: '#ffd76a', label: '주인', lc: '#141a23', stroke: '#fff' }) + '<div style="height:24px"></div>' + steps(4) + '<div style="height:32px"></div>' }),
  page(`<div class="kick">약속</div><div class="t">지키는 것</div><div class="list" style="gap:28px">
    <div class="li" style="font-size:44px;padding:36px 32px"><span class="n">1</span><span>개인 위치는 광고에 쓰지도<br>팔지도 않습니다</span></div>
    <div class="li" style="font-size:44px;padding:36px 32px"><span class="n">2</span><span>광고주는 블록별 방문 수 같은<br>묶은 숫자만 봅니다</span></div>
    <div class="li" style="font-size:44px;padding:36px 32px"><span class="n">3</span><span>게임은 무료입니다<br><small>복권을 살 필요가 없습니다</small></span></div></div>
    <div class="s" style="font-size:34px;margin-top:40px">광고와 나눔의 시작 시기 · 비율은<br>정해지는 대로 알려 드립니다.</div>`, { n: 7, total: 7, tint: 0.12, seed: 17 }),
];
// ② 고정: LottoHex란?(5장)
POSTS[2] = [
  page(`<div class="kick">LottoHex란?</div><div class="t">로또 판매점<br><i>땅따먹기</i></div><div class="s">판매점 지도 위 육각 블록을<br>차지하는 무료 위치 게임입니다.</div>`, { n: 1, total: 5, tint: 0.2, seed: 7, art: oneBlock({ owned: true, visited: [0, 2, 4] }) }),
  page(`<div class="kick">블록</div><div class="t">전국을<br><em>육각 블록</em>으로</div><div class="s">블록 하나는 끝에서 끝까지 걸어서 15분쯤.<br>판매점이 있는 블록 <b>${fmt(Object.keys(CELLS).length)}개</b>, 블록마다 번호가 있습니다.</div>`, { n: 2, total: 5, art: oneBlock({ label: '경기-0420' }) }),
  page(`<div class="kick">다녀왔어요</div><div class="t">판매점 <em>50m 안</em>에서<br>'다녀왔어요'</div><div class="s">위치로 확인되면 다녀온 곳으로 기록되고<br><b>10P</b>를 받습니다. 같은 판매점은 하루 한 번.</div>`, { n: 3, total: 5, art: oneBlock({ ring: true, visited: [0] }) }),
  page(`<div class="kick">주인</div><div class="t">가장 많이 다녀온<br>사람이 <em>주인</em></div><div class="s">수가 같으면 더 최근에 다녀온 사람이 가져갑니다.<br>빼앗기면 그 블록 판매점에서<br><b>'오늘 또 다녀왔어요'</b>로 되찾습니다.</div>`, { n: 4, total: 5, art: oneBlock({ owned: true, visited: [0, 1, 2, 3] }) }),
  page(`<div class="kick">분기 랭킹</div><div class="t">분기마다<br><em>Map 랭킹</em> 확정</div><div class="list">
    <div class="li"><span class="n">1</span>1위<span class="r">1,000P</span></div><div class="li"><span class="n">2</span>2위<span class="r">500P</span></div>
    <div class="li"><span class="n">3</span>3위<span class="r">300P</span></div><div class="li"><span class="n">4</span>4~10위<span class="r">100P</span></div></div>
    <div class="s" style="font-size:30px">무료 · 만 19세 이상 · 복권을 살 필요가 없습니다.<br>어디서 사든 1등 확률은 1/8,145,060으로 같습니다.</div>`, { n: 5, total: 5 }),
];
// ③ 고정: 시작하기(6장)
const stepPg = (n, total, no, title, sub, extra = '') => page(`<div class="kick">시작하기 ${no}</div><div class="t" style="font-size:84px">${title}</div><div class="s">${sub}</div>${extra}${bigNo(no)}`, { n, total, tint: 0.1, seed: 20 + no });
POSTS[3] = [
  page(`<div class="kick">LottoHex 시작하기</div><div class="t">첫 깃발까지<br><em>다섯 단계</em></div><div class="list">
    <div class="li"><span class="n">1</span>브라우저로 열기</div><div class="li"><span class="n">2</span>구글로 로그인 · 별명</div>
    <div class="li"><span class="n">3</span>참여 · 위치 동의</div><div class="li"><span class="n">4</span>가까운 판매점 찾기</div><div class="li"><span class="n">5</span>50m 안에서 다녀왔어요</div></div>`, { n: 1, total: 6 }),
  stepPg(2, 6, 1, '프로필 링크를<br><em>브라우저로</em> 열기', '프로필의 lottodraw.kr/lottohex 를 누릅니다.', `<div class="warn"><b>인스타그램 안에서는 구글 로그인이 막힙니다.</b><br>오른쪽 위 <b>⋯</b> → <b>외부 브라우저로 열기</b><br>(아이폰은 Safari, 안드로이드는 Chrome)</div>`),
  stepPg(3, 6, 2, '구글로 로그인하고<br><em>별명</em> 정하기', '별명은 Map 랭킹과 블록 주인 자리에 보입니다.<br>사흘 안에 정하지 않으면 무작위 별명이 붙습니다.'),
  stepPg(4, 6, 3, '참여 동의 ·<br><em>위치</em> 동의', '만 19세 이상만 참여할 수 있습니다.<br>위치는 50m 판정에만 쓰고 저장하지 않습니다.'),
  stepPg(5, 6, 4, '<em>이 근처</em>로<br>가까운 판매점 찾기', '지도 오른쪽의 이 근처를 누르면<br>가까운 판매점이 거리 순으로 나옵니다.<br>검색창에 동네 · 역 이름도 됩니다.'),
  stepPg(6, 6, 5, '50m 안에서<br><em>다녀왔어요</em>', '판매점 카드의 다녀왔어요를 누르면 끝.<br>회색 블록이면 <b>한 곳만 다녀와도 첫 깃발</b>입니다.<br>블록 카드의 링크 복사로 내 블록을 자랑하세요.'),
];
// ④ 전국 빈 블록
const allKeys = Object.keys(CELLS);
POSTS[4] = [page(`<div class="kick">11월 22일 기준</div><div class="t" style="font-size:80px">전국 ${fmt(allKeys.length)}블록 중<br>주인 있는 블록 <em>${SNAP.cells.length}개</em></div><div class="s" style="font-size:36px">${fmt(allKeys.length - SNAP.cells.length)}블록이 아직 회색지대입니다.<br>지금 다녀오면 <b>그 블록의 첫 깃발</b>입니다.</div>`,
  { art: korea(960, 780, 4, 10) + '<div style="height:8px"></div>' })];
// ⑤ 블록 번호
const yt = allKeys.filter(k => BLOCKS[k][1] === '수원시 영통구');
POSTS[5] = [page(`<div class="kick">새 기능 · 블록 번호</div><div class="t">우리 동네<br><em>블록 번호</em>는?</div><div class="s" style="font-size:36px">블록마다 번호가 생겼습니다. 검색창에<br><b>경기0420</b>처럼 넣으면 그 블록으로 갑니다.</div>`,
  { art: '<div style="text-align:center;font-size:28px;font-weight:700;color:#8f9bb0;margin-bottom:8px">수원시 영통구 · 경기-0416 ~ 0435</div>' + blockArt(yt, { w: 940, h: 590 }, { real: true, pad: 8, style: (k, R) => ({ fill: claimed.has(k) ? '#2a6f66' : '#1f2838', stroke: claimed.has(k) ? '#ffd76a' : '#3b4a63', sw: 3, label: B(k).split('-')[1], ls: Math.round(R * 0.32), lc: claimed.has(k) ? '#ffd76a' : '#cfd6e0' }) }) + '<div style="height:16px"></div>' })];
// ⑥ 분기 랭킹 중간
POSTS[6] = [page(`<div class="kick">2026년 4분기 · 11월 22일 기준</div><div class="t" style="font-size:80px">Map 랭킹 <em>중간 현황</em></div><div class="list" style="gap:14px;margin-top:32px">
  ${SNAP.rank.slice(0, 5).map((x, i) => `<div class="li" style="padding:18px 28px"><span class="n">${i + 1}</span><span>${x.nick}<small>다녀온 곳 ${x.stores}곳</small></span><span class="r">${x.cells}블록</span></div>`).join('')}</div>
  <div class="s" style="font-size:32px">12월 31일 24시 확정<br>1위 1,000P · 2위 500P · 3위 300P · 4~10위 100P</div>`, {})];
// ⑦ 칭호 도감
const TT = { '방문': ['초보탐험가', '동네 탐험가', '골목 탐험가', '베테랑 탐험가', '전국구 탐험가', '전설의 탐험가'], '영토': ['첫 깃발', '세력확장자', '영주', '군주', '대제국'], '블록 모양': ['삼각지', '일자 진격', '고속도로', '꼬마지렁이', '왕지렁이', '이무기', '벌집', '도넛', '섬나라'], '지역': ['○○구 단골', '○○구 전문가', '○○구 터줏대감', '시·도 완주', '골목대장', '팔도유람'] };
POSTS[7] = [page(`<div class="kick">칭호 도감</div><div class="t" style="font-size:80px">몇 개나<br><em>모으셨나요?</em></div>
  ${Object.entries(TT).map(([g, xs]) => `<div class="grp">${g}</div><div class="tags">${xs.map(x => `<span class="tag">${x}</span>`).join('')}</div>`).join('')}
  <div class="grp">숨은 칭호</div><div class="tags"><span class="tag q">???</span><span class="tag q">???</span><span class="tag q">???</span></div>
  <div class="s" style="font-size:30px;margin-top:28px">얻은 칭호 하나를 별명 앞에 달 수 있습니다.</div>`, {})];
// ⑧ 꾸미기
const sw = (i, kind, c1, c2) => { const id = 'k' + i; let pat = '';
  if (kind === 1) pat = `<pattern id="${id}" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="20" height="20" fill="${c1}"/><rect width="9" height="20" fill="${c2}"/></pattern>`;
  if (kind === 2) pat = `<pattern id="${id}" width="26" height="26" patternUnits="userSpaceOnUse"><rect width="26" height="26" fill="${c1}"/><circle cx="13" cy="13" r="6" fill="${c2}"/></pattern>`;
  if (kind === 3) pat = `<pattern id="${id}" width="28" height="28" patternUnits="userSpaceOnUse"><rect width="28" height="28" fill="${c1}"/><rect width="14" height="14" fill="${c2}"/><rect x="14" y="14" width="14" height="14" fill="${c2}"/></pattern>`;
  return `<svg width="190" height="210" viewBox="0 0 190 210"><defs>${pat}<filter id="g${i}"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><polygon points="${hexPts(95, 100, 82)}" fill="${kind ? 'url(#' + id + ')' : c1}" stroke="${c2}" stroke-width="5" filter="url(#g${i})"/></svg>`; };
POSTS[8] = [page(`<div class="kick">블록 꾸미기</div><div class="t" style="font-size:84px">내 블록은<br><em>내 색</em>으로</div>
  <div style="display:flex;justify-content:space-between;margin-top:40px">${[[0, '#e63946', '#ffd166', '단색'], [1, '#2a9d8f', '#48cae4', '줄무늬'], [2, '#8f7bff', '#ff6fae', '물방울'], [3, '#f4a261', '#52b788', '체크']].map(([k, a, b, n], i) => `<div style="text-align:center;font-size:28px;font-weight:700;color:#c3cad6">${sw(i, k, a, b)}<br>${n}</div>`).join('')}</div>
  <div class="list"><div class="li"><span class="n" style="background:#48cae4">◆</span><span>블록 모양 바꾸기<small>주색 · 보조색 · 무늬 4가지</small></span><span class="r">30P</span></div>
  <div class="li"><span class="n" style="background:#ff6fae">▲</span><span>영역 빛 벽<small>3D 지도에서 내 영역 테두리가 빛나고 모두에게 보입니다</small></span><span class="r">300P</span></div></div>`, {})];
// ⑨ 판매점이 가장 많은 블록
const busy = allKeys.slice().sort((a, b) => CELLS[b].length - CELLS[a].length || B(a).localeCompare(B(b), 'ko')).slice(0, 6);
POSTS[9] = [page(`<div class="kick">가장 치열해질 블록</div><div class="t" style="font-size:76px">판매점이 가장 많은 <em>블록</em></div><div class="s" style="font-size:32px;margin-top:20px">판매점이 많을수록 주인이 되기 어렵습니다.</div>
  <div class="list" style="gap:10px;margin-top:24px">${busy.map((k, i) => { const rk = 1 + busy.findIndex(x => CELLS[x].length === CELLS[k].length); return `<div class="li" style="padding:10px 28px;font-size:36px"><span class="n">${rk}</span><span>${B(k)}<small>${BLOCKS[k][1]} ${BLOCKS[k][2]}</small></span><span class="r">${CELLS[k].length}곳</span></div>`; }).join('')}</div>`, {})];
(async () => {
  const want = process.argv.slice(2).map(Number);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  for (const [no, slides] of Object.entries(POSTS)) {
    if (want.length && !want.includes(Number(no))) continue;
    for (let i = 0; i < slides.length; i++) {
      await p.setContent('<!doctype html><meta charset="utf-8">' + FONT + CSS + slides[i], { waitUntil: 'networkidle' });
      await p.evaluate(() => document.fonts.ready);
      const f = path.join(OUT, `post${no}` + (slides.length > 1 ? `-${i + 1}` : '') + '.jpg');
      await p.screenshot({ path: f, type: 'jpeg', quality: 92 });
    }
    console.log('글', no, slides.length + '장');
  }
  await b.close();
})();
