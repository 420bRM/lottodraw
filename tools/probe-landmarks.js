// 일회용(머지 전에 지운다): OpenStreetMap(Overpass)에서 랜드마크 건물 외곽선 · 높이를 받아 tmp-shots/landmarks-osm.json 에 둔다
const fs = require('fs');
const Q = `[out:json][timeout:90];
(
  way["building"](around:260,37.5260,126.9280);
  way["building:part"](around:260,37.5260,126.9280);
);
out geom tags;`;
(async () => {
  for (const host of ['https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter']) {
    try {
      const r = await fetch(host, { method: 'POST', body: 'data=' + encodeURIComponent(Q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'lottodraw.kr landmark probe' } });
      const j = await r.json();
      fs.mkdirSync('tmp-shots', { recursive: true });
      fs.writeFileSync('tmp-shots/landmarks-osm-parc.json', JSON.stringify(j));
      for (const e of j.elements) console.log(e.type, e.id, JSON.stringify(e.tags).slice(0, 220), e.geometry ? e.geometry.length + 'pts' : (e.members ? e.members.length + 'mem' : ''));
      return;
    } catch (e) { console.log('ERR', host, e.message); }
  }
})();
