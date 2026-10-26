// 일회용(머지 전에 지운다): 동행복권 "판매점 찾기"(/prchsplcsrch/home) 자료가 어떻게 오는지 본다. 출력만 한다.
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
const B = 'https://www.dhlottery.co.kr';
const get = async (u, init) => { const r = await fetch(u, Object.assign({ headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }, init || {})); return { s: r.status, ct: r.headers.get('content-type'), t: await r.text() }; };
(async () => {
  console.log('robots:', (await get(B + '/robots.txt')).t.replace(/\s+/g, ' '));
  const p = await get(B + '/prchsplcsrch/home');
  console.log('page', p.s, p.t.length);
  const inl = [...p.t.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  for (const s of inl) {
    const urls = [...s.matchAll(/['"`](\/prchsplcsrch\/[A-Za-z0-9_]+\.do)['"`]/g)].map(m => m[1]);
    if (!urls.length) continue;
    console.log('URLS', [...new Set(urls)].join(' '));
    for (const u of new Set(urls)) { const k = s.indexOf(u); console.log('--- ctx', u, '\n', s.slice(Math.max(0, k - 900), k + 600)); }
  }
})().catch(e => console.log('ERR', e.message));
