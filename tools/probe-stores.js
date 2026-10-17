// 일회용: 1등 배출점 자료 형식 · 약관 확인 (출력만, 저장 안 함)
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
const B = 'https://www.dhlottery.co.kr';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async (u, init) => { let e; for (let i = 0; i < 5; i++) { try { const r = await fetch(u, Object.assign({ headers: { 'User-Agent': UA, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: B + '/wnprchsplcsrch/home' } }, init || {})); return { s: r.status, t: await r.text(), ct: r.headers.get('content-type') }; } catch (x) { e = x; await sleep(3000 * (i + 1)); } } return { s: 0, t: String(e) }; };
const flat = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
(async () => {
  for (const q of ['srchWnShpRnk=1&srchLtEpsd=1245&srchShpLctn=', 'srchWnShpRnk=1&srchLtEpsd=1245', 'srchWnShpRnk=1&srchLtEpsd=600', 'srchWnShpRnk=1&srchLtEpsd=262', 'srchWnShpRnk=1&srchLtEpsd=1', 'srchWnShpRnk=2&srchLtEpsd=1245', 'srchWnShpRnk=all&srchLtEpsd=1245']) {
    const r = await get(B + '/wnprchsplcsrch/selectLtWnShp.do?' + q);
    console.log(`\n=== ${q} → ${r.s} ${r.ct} len=${r.t.length}`);
    console.log(r.t.slice(0, 2500));
    await sleep(500);
  }
  for (const [u, init] of [[B + '/trms/selectTrms.do', {}], [B + '/trms/selectTrms.do', { method: 'POST' }]]) {
    const t = await get(u, init);
    console.log(`\n=== TERMS ${u} ${init.method || 'GET'} → ${t.s} len=${t.t.length}`);
    let txt = t.t; try { txt = JSON.stringify(JSON.parse(t.t)); } catch (e) {}
    const ft = flat(txt.replace(/\\n|\\r|\\t/g, ' ').replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'));
    console.log(ft.slice(0, 600));
    for (const m of ft.matchAll(/[^.。]{0,300}(수집|크롤|무단|복제|자동화|로봇|스크래|전재|재배포|저작권|영리|2차|가공)[^.。]{0,300}/g)) console.log('  *', m[0].trim());
  }
})();
