// 판매점 지도 "영역"(육각 칸 땅따먹기, 2026-11-07 사장님 — 시험판)
//
// 규칙
//   - 땅을 육각 칸(js/hexgrid.js, 중심에서 꼭짓점까지 1.2km)으로 나눈다. 칸마다 판매점(폐점 제외) 목록은 사이트의 store-map-cells.json
//   - 참여에 동의한 회원만 센다. 이번 시즌에 "다녀온 곳"으로 표시한 판매점이 그 칸에서 가장 많은 사람이 칸을 차지한다
//   - 같은 수면 그 수를 먼저 채운 사람(그 칸에서 n번째로 표시한 시각이 이른 사람)
//   - 시즌: 분기(한국 시간 1/1 · 4/1 · 7/1 · 10/1). 시즌이 바뀌면 모든 칸이 빈다 — 판매점이 한 곳뿐인 칸만이 아니라,
//     차지한 사람이 칸의 판매점을 다 다녀온 칸은 같은 수가 되어도 먼저 채운 사람을 못 이기기 때문이다.
//     "다녀온 곳" 기록은 그대로 남고, 지난 시즌에 표시한 곳은 카드의 "이번 시즌에 또 다녀왔어요"로 다시 센다
//   - 시험판: 지금은 "다녀왔어요"를 누른 기록만 센다. 위치기반서비스사업 신고 뒤 GPS 인증(판매점 50m 안)만 세게 바꾼다
//   - Map 랭킹: 차지한 칸 수 → 같으면 이번 시즌 다녀온 곳 수 → 같으면 먼저 참여한 순
// 공개되는 것(참여 동의 문구 · 개인정보 처리방침과 맞출 것): 칸 주인의 별명 · 그 칸에서 다녀온 판매점 수, 랭킹의 별명 · 칸 수 · 다녀온 곳 수.
// 누가 어느 판매점을 다녀왔는지는 내보내지 않는다

export const TERR_CONSENT = 1;   // 동의 문구 판. 문구를 크게 바꾸면 올려서 다시 동의를 받는다(js/store-map.js 의 TERR_V 와 같게)
export const TERR_RANK = 50;     // 랭킹에 보여 주는 수
// 시각 없이 저장된 다녀온 곳(시각을 적기 전, 2026-10-26 ~ 11-07) = 2026-10-26 00:00 한국 시간으로 본다
export const LEGACY_T = Date.UTC(2026, 9, 25, 15);
const KST = 9 * 3600 * 1000;

// 그때가 든 시즌(분기). id 예: '2026Q4'
export function seasonOf(now) {
    const k = new Date(now + KST);
    const y = k.getUTCFullYear(), q = Math.floor(k.getUTCMonth() / 3);
    return { id: y + 'Q' + (q + 1), from: Date.UTC(y, q * 3, 1) - KST, to: Date.UTC(y, q * 3 + 3, 1) - KST };
}

// 참여자 기록(tp:<계정>) → 칸 주인 · 랭킹.
// players: [{ sub, nick, at, v: { 판매점 번호: [표시한 시각(없으면 0), 칸] } }]
export function computeTerritory(players, season) {
    const per = new Map();    // 칸 → [{ sub, n, t }]
    const stat = new Map();   // 계정 → { sub, nick, at, stores, cells, counts }
    for (const p of players) {
        const byCell = new Map();
        let stores = 0;
        for (const [t, cell] of Object.values(p.v || {})) {
            const at = t || LEGACY_T;
            if (!cell || at < season.from || at >= season.to) continue;
            stores++;
            if (!byCell.has(cell)) byCell.set(cell, []);
            byCell.get(cell).push(at);
        }
        const counts = {};
        for (const [cell, ts] of byCell) {
            counts[cell] = ts.length;
            if (!per.has(cell)) per.set(cell, []);
            per.get(cell).push({ sub: p.sub, n: ts.length, t: Math.max(...ts) });   // n곳을 채운 때 = 그 칸의 마지막 표시
        }
        stat.set(p.sub, { sub: p.sub, nick: p.nick || null, at: p.at || 0, stores, cells: 0, counts });
    }
    const cells = {};
    for (const [cell, list] of per) {
        list.sort((a, b) => (b.n - a.n) || (a.t - b.t) || (a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0));
        const w = list[0];
        stat.get(w.sub).cells++;
        cells[cell] = { sub: w.sub, n: w.n, next: list[1] ? list[1].n : 0, k: list.length };
    }
    const rank = [...stat.values()].filter(s => s.cells > 0)
        .sort((a, b) => (b.cells - a.cells) || (b.stores - a.stores) || (a.at - b.at) || (a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0));
    return { cells, rank, stat };
}

// 화면에 내보내는 모양. 계정 번호는 빼고 별명만
export function publicTerritory(t, season, sub, joined) {
    const nickOf = s => (t.stat.get(s) || {}).nick || null;
    const cells = {};
    for (const [cell, c] of Object.entries(t.cells)) cells[cell] = [nickOf(c.sub), c.n, c.next, c.k];
    const out = {
        season: { id: season.id, from: season.from, to: season.to },
        cells,
        rank: t.rank.slice(0, TERR_RANK).map(s => ({ nick: s.nick, cells: s.cells, stores: s.stores })),
        players: t.stat.size,
    };
    if (sub) {
        const me = t.stat.get(sub);
        const at = t.rank.findIndex(s => s.sub === sub);
        out.me = { joined: !!joined, cells: me ? Object.keys(t.cells).filter(c => t.cells[c].sub === sub) : [], counts: me ? me.counts : {},
            stores: me ? me.stores : 0, rank: at >= 0 ? at + 1 : null };
    }
    return out;
}

// 사이트의 칸 목록(store-map-cells.json) → 판매점 번호 → 칸. 한 시간 들고 있는다
const TTL = 3600 * 1000;
let cellCache = null;   // { at, map }
export function _resetCellsForTests() { cellCache = null; }
export async function cellMap(site) {
    if (cellCache && Date.now() - cellCache.at < TTL) return cellCache.map;
    const r = await fetch(site + '/store-map-cells.json', { cf: { cacheTtl: 3600 } });
    if (!r.ok) throw new Error('store-map-cells.json ' + r.status);
    const j = await r.json();
    const map = new Map();
    for (const [cell, ids] of Object.entries(j.cells || {})) for (const id of ids) map.set(id, cell);
    cellCache = { at: Date.now(), map };
    return map;
}
