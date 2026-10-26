// 일회용(머지 전에 지운다): 동행복권 판매점 찾기 자료(selectLtShp.do)가 어떻게 오는지 본다. 출력만 한다.
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
const B = 'https://www.dhlottery.co.kr';
const H = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*', Referer: B + '/prchsplcsrch/home' };
const get = async u => { const r = await fetch(B + u, { headers: H, signal: AbortSignal.timeout(20000) }); return { s: r.status, ct: r.headers.get('content-type'), t: await r.text() }; };
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const a = await get('/prchsplcsrch/selectAdmdst.do?srchCtpvNm=' + encodeURIComponent('서울'));
  console.log('ADMDST', a.s, a.ct, a.t.slice(0, 1500));
  for (const n of [10, 100, 1000]) {
    await wait(1500);
    const q = new URLSearchParams({ srchCtpvNm: '서울', srchSggNm: '', pageNum: '1', recordCountPerPage: String(n), pageCount: '5', st10LtNtslYn: 'Y' });
    const r = await get('/prchsplcsrch/selectLtShp.do?' + q);
    console.log('\nSHP n=' + n, r.s, r.ct, r.t.length);
    try { const j = JSON.parse(r.t); const walk = (o, p) => { if (Array.isArray(o)) { console.log('ARRAY', p, o.length); if (o[0]) console.log('FIRST', JSON.stringify(o[0]).slice(0, 1500)); return; } if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (typeof o[k] !== 'object' || o[k] === null) console.log('KEY', p + '.' + k, String(o[k]).slice(0, 80)); walk(o[k], p + '.' + k); } }; walk(j, ''); }
    catch (e) { console.log('NOTJSON', r.t.slice(0, 1500)); }
  }
  await wait(1500);
  const q = new URLSearchParams({ srchCtpvNm: '서울', srchSggNm: '', pageNum: '1', recordCountPerPage: '10', pageCount: '5' });
  const r = await get('/prchsplcsrch/selectLtShp.do?' + q);
  console.log('\nNOFLAG', r.s, r.t.slice(0, 600));
})().catch(e => console.log('ERR', e.message));
