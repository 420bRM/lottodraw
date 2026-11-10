#!/usr/bin/env node
// 판매점 지도 검색창의 "지역 찾기"(2026-11-10 사장님 — "청주 사창동"처럼 사는 곳을 찾고 그 근처 판매점을 보게) 목록을 만든다 → store-map-places.json
//
// 원자료: 행정동 경계 GeoJSON(통계청 SGIS 공공누리 제1유형, 가공 vuski/admdongkor — CC BY 4.0, https://github.com/vuski/admdongkor).
// 경계는 싣지 않고 이름과 지도를 옮길 자리(가장 큰 조각의 무게중심 · 그 조각이 화면에 들어오는 줌)만 남긴다.
// 행정구역이 바뀌었을 때만 다시 돌린다(매주 돌지 않는다):
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/vuski/admdongkor.git /tmp/adm && cd /tmp/adm && git sparse-checkout set ver20261001
//   node tools/make-places.mjs /tmp/adm/ver20261001/HangJeongDong_ver20261001.geojson
import fs from 'fs';

const src = process.argv[2];
if (!src) { console.error('행정동 GeoJSON 경로를 주세요'); process.exit(1); }
const ver = (src.match(/ver(\d{8})/) || [])[1] || '';
const j = JSON.parse(fs.readFileSync(src, 'utf8'));

// 시·도 짧은 이름(판매점 자료와 같게). 2026 전남광주통합특별시는 구(동 · 서 · 남 · 북 · 광산구)는 광주, 시 · 군은 전남으로 나눈다
const SHORT = { 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종',
    경기도: '경기', 강원특별자치도: '강원', 강원도: '강원', 충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주' };
const shortOf = (sidonm, sggnm) => (/^전남광주/.test(sidonm) ? (/구$/.test(sggnm) ? '광주' : '전남') : SHORT[sidonm] || sidonm);
// "청주시서원구" → ['청주시', '서원구'], "종로구" → ['', '종로구'], "여수시" → ['여수시', ''], 세종은 시 하나
function splitSgg(s) {
    const m = /^(.+?시)(.+구)$/.exec(s);
    if (m) return [m[1], m[2]];
    if (/구$/.test(s)) return ['', s];
    return [s, ''];
}
// 평면 다각형 넓이 · 무게중심(위경도 그대로 — 동 하나 크기에서는 충분)
function ringStat(ring) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = ring.length - 1; i < n; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[i + 1], f = x0 * y1 - x1 * y0;
        a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    a /= 2;
    return a ? { a: Math.abs(a), c: [cx / (6 * a), cy / (6 * a)] } : { a: 0, c: ring[0] };
}
const bboxOf = ring => ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
// 휴대폰 화면(지도 약 360×420px)에 범위가 들어오는 줌(512px 타일), 10~15.5
function zoomFor(b) {
    const lat = (b[1] + b[3]) / 2, sx = Math.max(1e-4, b[2] - b[0]), sy = Math.max(1e-4, (b[3] - b[1]) / Math.cos(lat * Math.PI / 180));
    const z = Math.log2(0.85 * Math.min(360 / sx, 420 / sy) * 360 / 512);
    return Math.round(Math.min(15.5, Math.max(10, z)) * 10) / 10;
}
const r4 = v => Math.round(v * 1e4) / 1e4;

const sido = [], sIdx = new Map();
const sgg = [], gIdx = new Map();
const dong = [];
const boxOfG = [];   // 시군구마다 동 범위 합
for (const f of j.features) {
    const p = f.properties, g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    let best = null;
    for (const poly of polys) { const s = ringStat(poly[0]); if (!best || s.a > best.a) best = Object.assign(s, { ring: poly[0] }); }
    const sh = shortOf(p.sidonm, p.sggnm);
    if (!sIdx.has(sh)) { sIdx.set(sh, sido.length); sido.push(sh); }
    const [si, gu] = splitSgg(p.sggnm);
    const gk = sh + '|' + si + '|' + gu;
    if (!gIdx.has(gk)) { gIdx.set(gk, sgg.length); sgg.push([sIdx.get(sh), si, gu]); boxOfG.push([180, 90, -180, -90]); }
    const gi = gIdx.get(gk), name = p.adm_nm.split(' ').pop();
    const b = bboxOf(best.ring);
    const gb = boxOfG[gi];
    boxOfG[gi] = [Math.min(gb[0], b[0]), Math.min(gb[1], b[1]), Math.max(gb[2], b[2]), Math.max(gb[3], b[3])];
    dong.push([gi, name, r4(best.c[0]), r4(best.c[1]), zoomFor(b)]);
}
const mid = b => [r4((b[0] + b[2]) / 2), r4((b[1] + b[3]) / 2)];
const G = sgg.map((g, i) => g.concat(mid(boxOfG[i]), zoomFor(boxOfG[i])));
// 구가 여러 개인 시(청주시 · 수원시 …)는 시 하나로도 찾게
const city = new Map();
sgg.forEach(([s, si, gu], i) => {
    if (!si || !gu) return;
    const k = s + '|' + si, b = boxOfG[i], c = city.get(k) || [180, 90, -180, -90];
    city.set(k, [Math.min(c[0], b[0]), Math.min(c[1], b[1]), Math.max(c[2], b[2]), Math.max(c[3], b[3])]);
});
const C = [...city.entries()].map(([k, b]) => { const [s, si] = k.split('|'); return [Number(s), si].concat(mid(b), zoomFor(b)); });
const sb = sido.map(() => [180, 90, -180, -90]);
sgg.forEach(([s], i) => { const b = boxOfG[i], c = sb[s]; sb[s] = [Math.min(c[0], b[0]), Math.min(c[1], b[1]), Math.max(c[2], b[2]), Math.max(c[3], b[3])]; });
const S = sido.map((n, i) => [n].concat(mid(sb[i]), Math.max(7, zoomFor(sb[i]) - 0.3)));

const out = {
    note: '판매점 지도 검색창의 지역 찾기(tools/make-places.mjs). s: 시·도 [이름, 경도, 위도, 줌], c: 구가 여러 개인 시 [시·도, 시, 경도, 위도, 줌], g: 시·군·구 [시·도, 시, 구, 경도, 위도, 줌], d: 읍·면·동 [시·군·구, 이름, 경도, 위도, 줌]',
    src: '본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, https://github.com/vuski/admdongkor), CC BY 4.0으로 배포됩니다.' + (ver ? ' 기준 ' + ver.slice(0, 4) + '-' + ver.slice(4, 6) + '-' + ver.slice(6) : ''),
    s: S, c: C, g: G, d: dong,
};
fs.writeFileSync(new URL('../store-map-places.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`지역: 시·도 ${S.length} · 시 ${C.length} · 시·군·구 ${G.length} · 읍·면·동 ${dong.length}`);
