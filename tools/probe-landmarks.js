// 일회용(머지 전에 지운다): OpenStreetMap(Overpass)에서 랜드마크 건물 외곽선 · 높이를 받아 tmp-shots/landmarks-osm.json 에 둔다
const fs = require('fs');
const Q = `[out:json][timeout:90];
(
  way["building"]["name"~"파크원|Parc|IFC|국회의사당|롯데월드타워|63|서울타워|콘래드|Conrad"](37.50,126.90,37.56,127.11);
  relation["building"]["name"~"파크원|Parc|IFC|국회의사당|롯데월드타워|63|서울타워|콘래드|Conrad"](37.50,126.90,37.56,127.11);
  way["building:part"](around:250,37.5126,127.1025);
  way["building:part"](around:250,37.5260,126.9280);
  way["building:part"](around:250,37.5253,126.9258);
  way["building:part"](around:150,37.5319,126.9142);
  way["building:part"](around:150,37.5199,126.9403);
  way["building:part"](around:80,37.5512,126.9882);
  way["building"](around:120,37.5512,126.9882);
);
out geom tags;`;
(async () => {
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const r = await fetch(host, { method: 'POST', body: 'data=' + encodeURIComponent(Q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'lottodraw.kr landmark probe' } });
      const j = await r.json();
      fs.mkdirSync('tmp-shots', { recursive: true });
      fs.writeFileSync('tmp-shots/landmarks-osm.json', JSON.stringify(j));
      for (const e of j.elements) console.log(e.type, e.id, JSON.stringify(e.tags).slice(0, 220), e.geometry ? e.geometry.length + 'pts' : (e.members ? e.members.length + 'mem' : ''));
      return;
    } catch (e) { console.log('ERR', host, e.message); }
  }
})();
