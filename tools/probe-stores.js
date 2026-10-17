// 일회용: 동행복권 1등 배출점 자료 위치 · robots 확인 (출력만, 저장 안 함)
const URLS = process.argv.slice(2);
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
(async () => {
  for (const u of URLS) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'manual' });
      const t = await r.text();
      console.log(`\n===== ${u} → ${r.status} ${r.headers.get('location') || ''} ${r.headers.get('content-type') || ''} len=${t.length}`);
      if (/robots|\.json|\.do\?|Json/i.test(u) || t.length < 4000) console.log(t.slice(0, 6000));
      else {
        const hits = new Set();
        for (const m of t.matchAll(/(?:href|src|url|action)\s*[:=]\s*["']([^"']*(?:store|Store|wnprchs|shop|Shop|win|Win|1st|rnk|plc|Plc)[^"']*)["']/g)) hits.add(m[1]);
        console.log([...hits].slice(0, 80).join('\n'));
        const i = t.search(/배출|판매점/); if (i >= 0) console.log('--- 본문 일부:', t.slice(Math.max(0, i - 1500), i + 2500).replace(/\s+/g, ' '));
      }
    } catch (e) { console.log(`\n===== ${u} → 오류 ${e.message}`); }
  }
})();
