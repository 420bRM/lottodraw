// lottodraw.kr 사이트 Worker(2026-11-16). 파일이 그대로 있으면 Cloudflare 가 이 코드를 부르지 않고 바로 내보낸다.
// 맞는 파일이 없을 때만 여기로 와서 GitHub Pages 와 같은 규칙으로 찾는다:
//   /  · /blog/       → index.html (폴더 주소)
//   /about           → about.html (확장자 없는 주소 — GitHub Pages 도 200 으로 내보냈다)
//   /blog            → 301 /blog/ (폴더인데 / 가 빠진 주소)
//   그 밖            → 404.html 을 404 로
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const p = url.pathname;
		if (p.endsWith('/')) {
			const r = await find(env, request, url, p + 'index.html');
			if (r) return r;
		} else if (!/\.[A-Za-z0-9]+$/.test(p.slice(p.lastIndexOf('/') + 1))) {
			const r = await find(env, request, url, p + '.html');
			if (r) return r;
			if (await find(env, request, url, p + '/index.html')) return Response.redirect(url.origin + p + '/' + url.search, 301);
		}
		const nf = await env.ASSETS.fetch(new URL('/404.html', url));
		const headers = new Headers(nf.headers);
		headers.set('Cache-Control', 'public, max-age=60');
		headers.delete('ETag');
		return new Response(request.method === 'HEAD' ? null : nf.body, { status: 404, headers });
	},
};

// 정적 파일에서 path 를 찾는다. 있으면(200 · 304) 그 응답, 없으면 null
async function find(env, request, url, path) {
	const r = await env.ASSETS.fetch(new Request(new URL(path + url.search, url), request));
	return r.status === 200 || r.status === 304 ? r : null;
}
