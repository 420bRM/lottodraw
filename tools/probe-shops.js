// 일회용(머지 전에 지운다): 판매점 찾기 쪽 넘김이 겹치는지 본다
const B = 'https://www.dhlottery.co.kr';
const H = { 'User-Agent': 'Mozilla/5.0 (compatible; lottodraw.kr data updater)', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: B + '/prchsplcsrch/home' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = async q => { const r = await fetch(B + '/prchsplcsrch/selectLtShp.do?' + new URLSearchParams(q), { headers: H, signal: AbortSignal.timeout(20000) }); return (await r.json()).data; };
(async () => {
  for (const [label, extra] of [['서울', {}], ['서울 강남구', { srchSggNm: '강남구' }]]) {
    const seen = new Map();
    for (const n of [1, 2, 3, 1, 2, 3, 50]) {
      const d = await get(Object.assign({ srchCtpvNm: '서울', srchSggNm: '', pageNum: String(n), recordCountPerPage: '10', pageCount: '5' }, extra));
      const ids = d.list.map(x => x.ltShpId);
      console.log(label, 'p' + n, 'total', d.total, ids.join(','), 'l645N', d.list.filter(x => x.l645LtNtslYn !== 'Y').length, 'rowId', d.list.map(x => x.rowId).join(','));
      ids.forEach(i => seen.set(i, (seen.get(i) || 0) + 1));
      await wait(1500);
    }
  }
  const d = await get({ srchCtpvNm: '', srchSggNm: '', pageNum: '1', recordCountPerPage: '10', pageCount: '5' });
  console.log('전국 total', d.total);
  await wait(1500);
  const r = await fetch(B + '/prchsplcsrch/selectAdmdst.do?srchCtpvNm=' + encodeURIComponent('서울특별시'), { headers: H }); console.log('ADM', (await r.text()).slice(0, 400));
})().catch(e => console.log('ERR', e.message, e.cause && e.cause.code));
