// LottoHex 마일스톤 · 칭호(2026-11-09 사장님 — "마일스톤 기능이나 칭호 기능이 적극적으로, 칭호는 얻은 것 중 골라 달고, 도감도")
//
//   마일스톤 = "얼마나": 쌓이는 숫자의 단계(다녀온 판매점 · 다녀온 칸 · 다녀온 시·도 · 최대 영토). 단계마다 포인트를 한 번 준다. 본인만 본다
//   칭호     = "어떻게": 이름 붙은 업적(방문 · 영토 · 칸 모양 · 지역 · 숨은 칭호). 칭호 도감에 모으고, 얻은 것 중 하나를 골라 별명 앞에 단다(모두에게 보인다)
//
// 모두 위치로 인증한 "다녀온 곳"(user.visits — 위치 인증을 켠 뒤로는 인증한 곳만 남는다)으로 센다. 위치 인증이 꺼져 있으면 주지 않는다.
// 영토 · 칸 모양은 LottoHex 참여자의 "지금 차지한 칸"으로 센다 — 그 모양이 된 순간 얻고, 나중에 칸을 잃어도 칭호는 남는다.
// 저장(community.js u:<계정>):
//   ach: { v, c, s, t } — 마일스톤마다 이른 단계 수(steps 앞에서부터 몇 개). 포인트는 이 값으로 셈한다(score). 위치 동의를 철회해도 남긴다(받은 포인트 장부)
//   ttl: { e: { 칭호 번호: 얻은 시각 }, sel: 단 칭호 번호 } — 위치 동의를 철회하면 지운다(위치로 인증한 기록에서 나온 것)
// 바꾸면: 이용약관 7조(포인트) · 8조(LottoHex), 개인정보 처리방침 4 · 5번, js/store-map.js(도감 · 할 일 화면)와 맞출 것

export const MILESTONES = [
    { k: 'v', ko: '다녀온 판매점', en: 'Retailers visited', u: ['곳', ''], steps: [1, 3, 10, 30, 50, 100, 200, 500, 1000], pts: [10, 10, 20, 30, 50, 100, 150, 300, 500] },
    { k: 'c', ko: '다녀온 블록', en: 'Cells visited', u: ['블록', ''], steps: [3, 10, 30, 50, 100, 300], pts: [10, 20, 30, 50, 100, 300] },
    { k: 's', ko: '다녀온 시·도', en: 'Provinces visited', u: ['곳', ''], steps: [2, 5, 10, 17], pts: [10, 30, 50, 200] },
    { k: 't', ko: '최대 영토', en: 'Most cells held', u: ['칸', ''], steps: [1, 5, 10, 30, 50, 100], pts: [10, 30, 50, 100, 150, 300] },
];
// 이른 단계(ach)의 포인트 합
export function milestonePoints(ach) {
    if (!ach) return 0;
    let n = 0;
    for (const m of MILESTONES) for (let i = 0; i < Math.min(ach[m.k] || 0, m.steps.length); i++) n += m.pts[i];
    return n;
}
const reached = (m, x) => m.steps.filter(s => x >= s).length;

// 칭호 목록. g: visit 방문 · terr 영토 · shape 칸 모양 · area 지역 · hidden 숨은 칭호(도감에는 얻기 전까지 ???)
// d: 얻는 조건(한 · 영)
export const TITLES = [
    { id: 'v3', g: 'visit', ko: '초보탐험가', en: 'Rookie Explorer', d: ['판매점 3곳 인증', 'Verify 3 retailers'] },
    { id: 'v10', g: 'visit', ko: '동네 탐험가', en: 'Local Explorer', d: ['판매점 10곳 인증', 'Verify 10 retailers'] },
    { id: 'v30', g: 'visit', ko: '골목 탐험가', en: 'Alley Explorer', d: ['판매점 30곳 인증', 'Verify 30 retailers'] },
    { id: 'v100', g: 'visit', ko: '베테랑 탐험가', en: 'Veteran Explorer', d: ['판매점 100곳 인증', 'Verify 100 retailers'] },
    { id: 'v300', g: 'visit', ko: '전국구 탐험가', en: 'Nationwide Explorer', d: ['판매점 300곳 인증', 'Verify 300 retailers'] },
    { id: 'v1000', g: 'visit', ko: '전설의 탐험가', en: 'Legendary Explorer', d: ['판매점 1,000곳 인증', 'Verify 1,000 retailers'] },
    { id: 't1', g: 'terr', ko: '첫 깃발', en: 'First Flag', d: ['LottoHex 칸 1개 차지', 'Hold 1 LottoHex cell'] },
    { id: 't5', g: 'terr', ko: '세력확장자', en: 'Expansionist', d: ['칸 5개를 동시에 차지', 'Hold 5 cells at once'] },
    { id: 't10', g: 'terr', ko: '영주', en: 'Lord', d: ['칸 10개를 동시에 차지', 'Hold 10 cells at once'] },
    { id: 't30', g: 'terr', ko: '군주', en: 'Monarch', d: ['칸 30개를 동시에 차지', 'Hold 30 cells at once'] },
    { id: 't100', g: 'terr', ko: '대제국', en: 'Empire', d: ['칸 100개를 동시에 차지', 'Hold 100 cells at once'] },
    { id: 'tri', g: 'shape', ko: '삼각지', en: 'Triangle', d: ['차지한 칸 3개가 서로 맞닿음', 'Three of your cells all touching'] },
    { id: 'line5', g: 'shape', ko: '일자 진격', en: 'Straight Ahead', d: ['차지한 칸 5개가 한 줄', 'Five of your cells in a straight line'] },
    { id: 'line8', g: 'shape', ko: '고속도로', en: 'Highway', d: ['차지한 칸 8개가 한 줄', 'Eight of your cells in a straight line'] },
    { id: 'worm4', g: 'shape', ko: '꼬마지렁이', en: 'Little Worm', d: ['차지한 칸 4개가 가지 없이 이어짐(칸마다 앞뒤 칸하고만 변을 맞댐)', 'Four cells in a chain, each touching only the cells before and after'] },
    { id: 'worm7', g: 'shape', ko: '왕지렁이', en: 'Giant Worm', d: ['차지한 칸 7개가 가지 없이 이어짐', 'Seven cells in a chain, each touching only the cells before and after'] },
    { id: 'worm12', g: 'shape', ko: '이무기', en: 'Imugi', d: ['차지한 칸 12개가 가지 없이 이어짐', 'Twelve cells in a chain, each touching only the cells before and after'] },
    { id: 'hive', g: 'shape', ko: '벌집', en: 'Honeycomb', d: ['한 칸과 그 둘레 6칸을 모두 차지', 'Hold a cell and all six around it'] },
    { id: 'donut', g: 'shape', ko: '도넛', en: 'Donut', d: ['둘레 6칸은 내 것, 가운데 칸은 내 것이 아님', 'Hold the six cells around a cell you do not hold'] },
    { id: 'isles', g: 'shape', ko: '섬나라', en: 'Archipelago', d: ['서로 떨어진 영토 묶음 5개', 'Five separate groups of cells'] },
    { id: 'dense', g: 'area', ko: '골목대장', en: 'Block Boss', d: ['한 칸 안의 판매점 10곳 인증', 'Verify 10 retailers in one cell'] },
    { id: 'all17', g: 'area', ko: '팔도유람', en: 'Grand Tour', d: ['17개 시·도 모두에서 인증', 'Verify a retailer in all 17 provinces'] },
    { id: 'pioneer', g: 'hidden', ko: '개척자', en: 'Pioneer', d: ['LottoHex 참여자가 아무도 다녀가지 않은 칸에 처음 인증', 'First LottoHex player to verify a retailer in a cell'] },
    { id: 'island', g: 'hidden', ko: '섬마을 손님', en: 'Island Visitor', d: ['섬(울릉 · 옹진 · 신안 · 완도) 판매점 인증', 'Verify a retailer on an island county'] },
    { id: 'rest', g: 'hidden', ko: '휴게소 손님', en: 'Rest Stop Visitor', d: ['고속도로 휴게소 판매점 인증', 'Verify a highway rest-stop retailer'] },
];
const BY_ID = new Map(TITLES.map(t => [t.id, t]));
// 지역 칭호: 같은 시·군·구에서 인증한 판매점 수. 번호 'r:<지역 이름>:<단계>'(지역 이름은 store-map-geo.json 의 이름 — 겹치는 구 이름은 "대구 중구"처럼 시·도를 붙였다)
export const AREA_STEPS = [10, 20, 50];
export const AREA_NAMES = [['단골', 'Regular'], ['전문가', 'Expert'], ['터줏대감', 'Local Legend']];
// 시·도 완주: 그 시·도의 모든 시·군·구에서 한 곳 이상(시·군·구가 둘 이상인 시·도만). 번호 's:<시·도>'
export const ISLAND_FLAG = 1, REST_FLAG = 2;

// 칭호 이름 [한, 영] — 없는 번호면 null
export function titleName(id) {
    if (typeof id !== 'string') return null;
    const t = BY_ID.get(id);
    if (t) return [t.ko, t.en];
    let m = /^r:(.+):([0-2])$/.exec(id);
    if (m) return [m[1] + ' ' + AREA_NAMES[m[2]][0], m[1] + ' ' + AREA_NAMES[m[2]][1]];
    m = /^s:(.+)$/.exec(id);
    if (m) return [m[1] + ' 완주', m[1] + ' Complete'];
    return null;
}
export function titleGroup(id) {
    const t = BY_ID.get(id);
    return t ? t.g : /^r:/.test(id) ? 'area' : /^s:/.test(id) ? 'area' : null;
}
// 화면에 내려 보내는 목록(누구나): 숨은 칭호는 번호와 무리만(이름 · 조건은 얻은 사람에게만)
export function catalog() {
    return {
        milestones: MILESTONES,
        titles: TITLES.map(t => (t.g === 'hidden' ? { id: t.id, g: t.g } : t)),
        area: { steps: AREA_STEPS, names: AREA_NAMES },
    };
}
// 회원에게 보이는 내 칭호: 얻은 것(이름 포함) · 단 것
export function myTitles(user) {
    const e = (user.ttl && user.ttl.e) || {};
    const list = Object.entries(e).map(([id, at]) => { const n = titleName(id) || [id, id]; const t = BY_ID.get(id); return { id, at, ko: n[0], en: n[1], g: titleGroup(id), d: t ? t.d : null }; })
        .sort((a, b) => a.at - b.at);
    return { e: list, sel: (user.ttl && user.ttl.sel) || null };
}
// 별명 앞에 다는 칭호 [한, 영] — 칸 · 랭킹 색인에 그대로 넣는다
export function selTitle(user) {
    const sel = user.ttl && user.ttl.sel;
    return sel && user.ttl.e && user.ttl.e[sel] ? titleName(sel) : null;
}

// ───── 칸 모양(축 좌표 "q,r", js/hexgrid.js — 꼭짓점이 위인 육각형) ─────
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];   // 둘레를 차례로 돈다(이웃한 둘은 서로도 맞닿는다)
const parse = k => { const p = String(k).split(','); return [Number(p[0]), Number(p[1])]; };
const key = (q, r) => q + ',' + r;
const ring = k => { const [q, r] = parse(k); return DIRS.map(([dq, dr]) => key(q + dq, r + dr)); };
// 차지한 칸 목록 → 그 모양 칭호 번호들. skip: 이미 얻은 것(지렁이 찾기는 무거워 건너뛴다)
export function shapeTitles(held, skip) {
    const set = new Set(held || []), out = [];
    if (!set.size) return out;
    const has = id => !(skip && skip.has(id));
    if (has('tri') && [...set].some(k => { const n = ring(k); return n.some((x, i) => set.has(x) && set.has(n[(i + 1) % 6])); })) out.push('tri');
    // 한 줄: 세 축마다 줄의 첫 칸에서 센다
    let line = 0;
    for (const k of set) {
        const [q, r] = parse(k);
        for (let d = 0; d < 3; d++) {
            const [dq, dr] = DIRS[d];
            if (set.has(key(q - dq, r - dr))) continue;
            let n = 1;
            while (set.has(key(q + dq * n, r + dr * n))) n++;
            if (n > line) line = n;
        }
    }
    if (line >= 5 && has('line5')) out.push('line5');
    if (line >= 8 && has('line8')) out.push('line8');
    // 벌집 · 도넛: 둘레 6칸이 모두 내 것인 칸(가운데가 내 것이면 벌집, 아니면 도넛)
    const centers = new Set();
    for (const k of set) ring(k).forEach(x => centers.add(x));
    for (const c of centers) {
        if (!ring(c).every(x => set.has(x))) continue;
        if (set.has(c)) { if (has('hive') && !out.includes('hive')) out.push('hive'); }
        else if (has('donut') && !out.includes('donut')) out.push('donut');
    }
    // 섬나라: 서로 떨어진 묶음 수
    const comps = [];
    const seen = new Set();
    for (const k of set) {
        if (seen.has(k)) continue;
        const stack = [k], comp = [];
        seen.add(k);
        while (stack.length) { const x = stack.pop(); comp.push(x); for (const y of ring(x)) if (set.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); } }
        comps.push(comp);
    }
    if (comps.length >= 5 && has('isles')) out.push('isles');
    // 지렁이: 가지 없이 이어진 칸(칸마다 앞뒤 칸하고만 변을 맞댄다 — 그래프의 유도 경로)
    for (const [id, L] of [['worm4', 4], ['worm7', 7], ['worm12', 12]]) {
        if (!has(id)) continue;
        if (comps.some(c => c.length >= L && inducedPath(new Set(c), L))) out.push(id);
        else break;   // 짧은 것이 없으면 긴 것도 없다
    }
    return out;
}
// 길이 L 의 유도 경로가 있나(깊이 우선, 계산량에 상한 — 넘으면 이번엔 못 찾은 것으로)
export function inducedPath(set, L, budget = 60000) {
    let steps = 0;
    const path = [], inPath = new Set();
    const dfs = () => {
        if (path.length >= L) return true;
        if (++steps > budget) return false;
        const last = path[path.length - 1];
        for (const x of ring(last)) {
            if (!set.has(x) || inPath.has(x)) continue;
            if (ring(x).some(y => y !== last && inPath.has(y))) continue;   // 앞의 칸(바로 앞 말고)에 닿으면 가지가 생긴다
            path.push(x); inPath.add(x);
            if (dfs()) return true;
            path.pop(); inPath.delete(x);
        }
        return false;
    };
    for (const s of set) {
        path.length = 0; inPath.clear();
        path.push(s); inPath.add(s);
        if (dfs()) return true;
        if (steps > budget) return false;
    }
    return false;
}

// ───── 셈 ─────
// user 의 다녀온 곳 · 차지한 칸으로 새로 이른 마일스톤과 새로 얻은 칭호를 셈해 user 에 적는다(저장은 부른 쪽).
// ctx: { cellOf: 판매점 번호 → 칸(Map), geo: 판매점 번호 → [위도, 경도, 지역 번호, 표시](Map), regions: [[시·도, 시·군·구, 이름]],
//        held: 지금 차지한 칸 목록(LottoHex 참여자, 아니면 null), pioneer: 이번 인증이 그 칸의 첫 방문인가, now }
// 돌려주는 것: { titles: [새 칭호 번호], pts: 새로 받은 마일스톤 포인트, steps: [{ k, n }] 새로 이른 단계 }
export function evaluate(user, ctx) {
    const now = ctx.now || Date.now();
    const ids = Object.keys(user.visits || {});
    const cellN = new Map(), regionN = new Map(), sido = new Set();
    let island = false, rest = false;
    for (const id of ids) {
        const c = ctx.cellOf && ctx.cellOf.get(id);
        if (c) cellN.set(c, (cellN.get(c) || 0) + 1);
        const g = ctx.geo && ctx.geo.get(id);
        if (!g) continue;
        const ri = g[2];
        if (ri != null && ctx.regions && ctx.regions[ri]) { regionN.set(ri, (regionN.get(ri) || 0) + 1); sido.add(ctx.regions[ri][0]); }
        if (g[3] === ISLAND_FLAG) island = true;
        if (g[3] === REST_FLAG) rest = true;
    }
    const held = Array.isArray(ctx.held) ? ctx.held : null;
    const val = { v: ids.length, c: cellN.size, s: sido.size, t: held ? held.length : 0 };
    // 마일스톤
    const ach = Object.assign({}, user.ach || {});
    let pts = 0;
    const steps = [];
    for (const m of MILESTONES) {
        const was = ach[m.k] || 0, now_ = reached(m, val[m.k]);
        if (now_ > was) { for (let i = was; i < now_; i++) pts += m.pts[i]; ach[m.k] = now_; steps.push({ k: m.k, n: now_ }); }
    }
    if (steps.length) user.ach = ach;
    // 칭호
    const ttl = { e: Object.assign({}, (user.ttl && user.ttl.e) || {}), sel: (user.ttl && user.ttl.sel) || null };
    const got = new Set(Object.keys(ttl.e)), fresh = [];
    const give = id => { if (!got.has(id)) { got.add(id); ttl.e[id] = now; fresh.push(id); } };
    for (const [id, n] of [['v3', 3], ['v10', 10], ['v30', 30], ['v100', 100], ['v300', 300], ['v1000', 1000]]) if (val.v >= n) give(id);
    if (held) {
        for (const [id, n] of [['t1', 1], ['t5', 5], ['t10', 10], ['t30', 30], ['t100', 100]]) if (val.t >= n) give(id);
        shapeTitles(held, got).forEach(give);
    }
    if ([...cellN.values()].some(n => n >= 10)) give('dense');
    if (sido.size >= 17) give('all17');
    if (ctx.pioneer) give('pioneer');
    if (island) give('island');
    if (rest) give('rest');
    if (ctx.regions) {
        for (const [ri, n] of regionN) AREA_STEPS.forEach((s, k) => { if (n >= s) give('r:' + ctx.regions[ri][2] + ':' + k); });
        const per = new Map();   // 시·도 → [시·군·구 수, 다녀온 시·군·구 수]
        ctx.regions.forEach(([si], ri) => { const p = per.get(si) || [0, 0]; p[0]++; if (regionN.has(ri)) p[1]++; per.set(si, p); });
        for (const [si, [all, mine]] of per) if (all >= 2 && mine >= all) give('s:' + si);
    }
    if (fresh.length) user.ttl = ttl;
    return { titles: fresh, pts, steps };
}
