// 일회용: 회차별 판매점 자료가 몇 회부터 있는지, 목록이 잘리지 않는지 (출력만)
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
const B = 'https://www.dhlottery.co.kr';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async u => { for (let i = 0; i < 5; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); return JSON.parse(await r.text()); } catch (x) { await sleep(3000 * (i + 1)); } } return null; };
(async () => {
  const rounds = [2, 3, 5, 10, 20, 50, 100, 150, 200, 230, 250, 255, 258, 260, 261, 262, 263, 300, 400, 500, 700, 846, 900, 1000, 1100, 1128, 1200, 1244];
  for (const r of rounds) {
    const j = await get(`${B}/wnprchsplcsrch/selectLtWnShp.do?srchWnShpRnk=all&srchLtEpsd=${r}`);
    const l = (j && j.data && j.data.list) || [];
    const by = {}; l.forEach(x => { const k = x.wnShpRnk + ':' + x.atmtPsvYnTxt; by[k] = (by[k] || 0) + 1; });
    console.log(r, 'total', j && j.data && j.data.total, 'list', l.length, JSON.stringify(by), 'regions', [...new Set(l.map(x => x.region))].join(','));
    await sleep(700);
  }
})();
