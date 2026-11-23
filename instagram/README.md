# LottoHex 인스타그램 시안 보관 가지

이 가지(`claude/instagram-drafts`)는 **배포하지 않는다**(html 에 병합하지 않음). 인스타그램 글 시안 그림을 두는 곳이다.
사장님 Dropbox `04 인스타그램/<날짜 글>/보기.html` 이 이 가지의 그림을 불러와 보여 준다.

- `261123-first9/` — 처음 9개 글(1080×1350 JPEG 24장) · `captions.md`
- `tools/make-first9.cjs` — 시안을 만든 스크립트(HTML 틀 → Playwright JPEG, 저장소 자료로 숫자를 채움). 저장소 맨 위에서 경로만 맞추면 다시 만들 수 있다
