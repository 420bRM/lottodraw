// 일회용: 동행복권 1등 배출점 자료 위치 · 약관 확인 (출력만, 저장 안 함)
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
const B = 'https://www.dhlottery.co.kr';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async u => { let e; for (let i = 0; i < 5; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); return { s: r.status, t: await r.text(), ct: r.headers.get('content-type') }; } catch (x) { e = x; console.log('retry', u, x.cause && x.cause.code); await sleep(3000 * (i + 1)); } } return { s: 0, t: String(e), ct: '' }; };
const flat = s => s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
(async () => {
  const p = await get(B + '/wnprchsplcsrch/home?ltGds=lt645&ltEpsd=1245');
  console.log('PAGE', p.s, p.t.length);
  const scripts = [...p.t.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m => m[1]);
  console.log('SCRIPTS', scripts.join('\n'));
  const inline = [...p.t.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => /ajax|fetch|url|\.do|select/i.test(s));
  inline.forEach((s, i) => { const u = new Set(); for (const m of s.matchAll(/url\s*:\s*["'`]([^"'`]+)["'`]|["'`](\/[a-zA-Z0-9_\/]+\.do[^"'`]*)["'`]/g)) u.add(m[1] || m[2]); console.log(`--- inline ${i} urls:`, [...u].join(' | ')); const k = s.search(/wnShp|WnShp|ltWn|selectLt|shpWn|rnk/); if (k >= 0) console.log(s.slice(Math.max(0,k-1500), k + 2500)); });
  const i = flat(p.t).search(/1등 배출점|당첨 판매점 조회/);
  console.log('--- 본문', flat(p.t).slice(i, i + 3000));
  for (const s of scripts.filter(s => /wnprchs|store|shp|plc|common/i.test(s) && !/jquery|lib/i.test(s))) {
    const j = await get(s.startsWith('http') ? s : B + s);
    console.log(`\n=== JS ${s} ${j.s} ${j.t.length}`);
    for (const m of j.t.matchAll(/["'`](\/[A-Za-z0-9_\/]+(?:\.do)?[^"'`]*)["'`]/g)) console.log('  path', m[1]);
  }
  const t = await get(B + '/trms/home'); for (const m of t.t.matchAll(/url\s*:\s*["'`]([^"'`]+)["'`]|["'`](\/[a-zA-Z0-9_\/]+\.do[^"'`]*)["'`]/g)) console.log('TERMS url', m[1] || m[2]);
  const ft = flat(t.t);
  console.log('\n=== TERMS', t.s, ft.length);
  for (const m of ft.matchAll(/[^.。]{0,250}(수집|크롤|무단|복제|자동화|로봇|스크래|전재|재배포|저작권|영리)[^.。]{0,250}/g)) console.log('  *', m[0].trim());
})();
