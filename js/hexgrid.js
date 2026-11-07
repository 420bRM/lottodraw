/* 판매점 지도 "영역" 육각 칸 (2026-11-07 시험판)
 * 우버 H3 처럼 땅을 육각형으로 나누되, 한국만 쓰니 라이브러리 없이 평면 육각 격자로 한다.
 *   - 위도 · 경도를 북위 36° 기준 등거리 평면(km)으로 펴고(남북 끝에서도 크기 차이 ±4%), 꼭짓점이 위로 간 육각형으로 나눈다
 *   - 칸 하나: 중심에서 꼭짓점까지 R = 0.6km(넓이 약 0.94km², 마주 보는 변 사이 1.04km — 걸어서 15분쯤). 우버 H3 해상도 8(0.74km²)쯤.
 *     처음(11/7)은 1.2km 였다 — "육각형이 너무 크다"(사장님)로 반으로. 서버는 칸 목록으로 다시 세므로 다녀온 곳을 다시 표시할 필요는 없다
 *   - 칸 이름: 축 좌표 "q,r"(정수 둘). 같은 식을 생성기(tools/build-static-stats.js → store-map-cells.json)와
 *     지도(js/store-map.js)가 함께 쓴다. 서버는 칸을 계산하지 않고 store-map-cells.json 을 읽는다
 * 브라우저에서는 window.LottoHex, node 에서는 require 로 쓴다. 바꾸면 차지한 칸이 모두 달라진다(서버는 새 칸 목록으로 다시 센다)
 */
(function (root) {
    'use strict';
    const R = 0.6;                                  // km
    const LAT0 = 36, LNG0 = 127.5;
    const KY = 110.95;                              // 위도 1도 = km
    const KX = 111.32 * Math.cos(LAT0 * Math.PI / 180);   // 경도 1도 = km (북위 36°)
    const S3 = Math.sqrt(3);

    const toXY = (lat, lng) => [(lng - LNG0) * KX, (lat - LAT0) * KY];
    const toLL = (x, y) => [LNG0 + x / KX, LAT0 + y / KY];   // [경도, 위도] — 지도(GeoJSON) 차례

    // 위도 · 경도 → 칸 이름 "q,r"
    function cellOf(lat, lng) {
        const [x, y] = toXY(lat, lng);
        const fq = (S3 / 3 * x - y / 3) / R, fr = (2 / 3 * y) / R, fs = -fq - fr;
        let q = Math.round(fq), r = Math.round(fr);
        const s = Math.round(fs);
        const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
        if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
        return (q + 0) + ',' + (r + 0);   // -0 을 0 으로
    }
    function parse(key) { const p = String(key).split(','); return [Number(p[0]), Number(p[1])]; }
    // 칸 중심 [경도, 위도]
    function centerOf(key) {
        const [q, r] = parse(key);
        return toLL(R * S3 * (q + r / 2), R * 1.5 * r);
    }
    // 칸 테두리 [[경도, 위도] × 7] (닫힌 고리)
    function ringOf(key) {
        const [q, r] = parse(key);
        const cx = R * S3 * (q + r / 2), cy = R * 1.5 * r;
        const ring = [];
        for (let i = 0; i <= 6; i++) {
            const a = Math.PI / 180 * (60 * (i % 6) - 30);
            const p = toLL(cx + R * Math.cos(a), cy + R * Math.sin(a));
            ring.push([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
        }
        return ring;
    }
    const api = { R, cellOf, centerOf, ringOf };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LottoHex = api;
})(typeof window !== 'undefined' ? window : this);
