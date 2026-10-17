// 일회용: 동행복권 1등 배출점 자료 위치 · 약관 확인 (출력만, 저장 안 함)
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
const B = 'https://www.dhlottery.co.kr';
const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': UA } }); return { s: r.status, t: await r.text(), ct: r.headers.get('content-type') }; };
const flat = s => s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
(async () => {
  const p = await get(B + '/wnprchsplcsrch/home?ltGds=lt645&ltEpsd=1245');
  console.log('PAGE', p.s, p.t.length);
  const scripts = [...p.t.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m => m[1]);
  console.log('SCRIPTS', scripts.join('\n'));
  const inline = [...p.t.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => /ajax|fetch|url|\.do|select/i.test(s));
  inline.forEach((s, i) => console.log(`--- inline ${i}\n` + s.slice(0, 5000)));
  const i = flat(p.t).search(/1등 배출점|당첨 판매점 조회/);
  console.log('--- 본문', flat(p.t).slice(i, i + 3000));
  for (const s of scripts.filter(s => /wnprchs|store|shp|plc|common/i.test(s) && !/jquery|lib/i.test(s))) {
    const j = await get(s.startsWith('http') ? s : B + s);
    console.log(`\n=== JS ${s} ${j.s} ${j.t.length}`);
    for (const m of j.t.matchAll(/["'`](\/[A-Za-z0-9_\/]+(?:\.do)?[^"'`]*)["'`]/g)) console.log('  path', m[1]);
  }
  const t = await get(B + '/trms/home');
  const ft = flat(t.t);
  console.log('\n=== TERMS', t.s, ft.length);
  for (const m of ft.matchAll(/[^.。]{0,250}(수집|크롤|무단|복제|자동화|로봇|스크래|전재|재배포|저작권|영리)[^.。]{0,250}/g)) console.log('  *', m[0].trim());
})();
