// 판매점 공유 주소(2026-10-28 사장님): https://api.lottodraw.kr/s/판매점번호
//   카카오톡 · 커뮤니티가 링크 미리보기를 만들려고 읽는 쪽 — 그 판매점 이름 · 지역 · 1등 · 2등 횟수를 제목 · 설명에, 그림은 그 시도 그림.
//   사람은 바로 지도 카드(store-map.html?shop=번호)로 넘어간다. 검색에는 올리지 않는다(noindex — 얇은 판매점 쪽 1만 개를 만들지 않는다, README 4-9).
//   판매점 자료는 사이트의 공개 파일(store-map-ids · data · all.json)을 읽어 한 시간 들고 있는다
const TTL = 3600 * 1000;
let cache = null;   // { at, ids, data, all }

export function _resetShareCache() { cache = null; }

async function load(site) {
    if (cache && Date.now() - cache.at < TTL) return cache;
    const get = async f => { const r = await fetch(site + '/' + f, { cf: { cacheTtl: 3600 } }); if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); };
    const [ids, data] = await Promise.all([get('store-map-ids.json'), get('store-map-data.json')]);
    cache = { at: Date.now(), ids, data, all: null };
    return cache;
}

// 미리보기 그림: 그 판매점의 시도 그림(img/share/sido-*.jpg, 지도 공유 이미지와 같은 짜임 — 2026-10-28 한 번 찍음), 모르면 지도 공유 이미지
const SLUG = { 강원: 'gangwon', 경기: 'gyeonggi', 경남: 'gyeongnam', 경북: 'gyeongbuk', 광주: 'gwangju', 대구: 'daegu', 대전: 'daejeon', 부산: 'busan', 서울: 'seoul',
    세종: 'sejong', 울산: 'ulsan', 인천: 'incheon', 전남: 'jeonnam', 전북: 'jeonbuk', 제주: 'jeju', 충남: 'chungnam', 충북: 'chungbuk' };
export const shareImageOf = (site, sido) => site + (SLUG[sido] ? '/img/share/sido-' + SLUG[sido] + '.jpg' : '/img/og-store-map.jpg');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toLocaleString('ko-KR');
const ODDS = '어디서 사든 1등 확률은 1/8,145,060으로 같습니다.';

// 번호 → { name, place, w1, w2 } (1 · 2등 판매점, 아니면 일반 판매점). 없으면 null
export async function shopInfo(site, id) {
    const c = await load(site);
    let i = c.ids.w.indexOf(id);
    if (i >= 0) {
        const r = c.data.rows[i];
        return { name: r[4], sido: c.data.sido[r[5]] || '', place: [c.data.sido[r[5]], r[6]].filter(Boolean).join(' '), w1: r[2], w2: r[3], closed: !!r[7], first: c.data.first, last: c.data.last };
    }
    i = (c.ids.a || []).indexOf(id);
    if (i < 0) return null;
    if (!c.all) c.all = await (await fetch(site + '/store-map-all.json', { cf: { cacheTtl: 3600 } })).json();
    const r = c.all.rows[i];
    return r ? { name: r[2], sido: c.all.sido[r[3]] || '', place: [c.all.sido[r[3]], r[4]].filter(Boolean).join(' '), w1: 0, w2: 0, first: c.data.first, last: c.data.last } : null;
}

export function sharePage(site, id, s) {
    const target = site + '/store-map.html?shop=' + id;
    const title = s.name + ' · ' + s.place + ' 로또 판매점';
    const desc = (s.w1 || s.w2 ? '1등 ' + fmt(s.w1) + '번 · 2등 ' + fmt(s.w2) + '번(' + s.first + '~' + s.last + '회). ' : s.first + '회부터 1등 · 2등 기록이 없는 판매점. ') + ODDS;
    const img = shareImageOf(site, s.sido);
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + esc(title) + ' | lottodraw.kr</title><meta name="robots" content="noindex"><link rel="canonical" href="' + esc(target) + '">' +
        '<meta name="description" content="' + esc(desc) + '">' +
        '<meta property="og:type" content="website"><meta property="og:site_name" content="lottodraw.kr">' +
        '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '">' +
        '<meta property="og:url" content="' + esc(target) + '"><meta property="og:image" content="' + esc(img) + '">' +
        '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">' +
        '<meta http-equiv="refresh" content="0;url=' + esc(target) + '"></head><body>' +
        '<p><a href="' + esc(target) + '">' + esc(s.name) + ' — 판매점 지도에서 보기</a></p>' +
        '<script>location.replace(' + JSON.stringify(target) + ')</script></body></html>';
}
