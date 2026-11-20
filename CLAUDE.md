# lottodraw.kr — Claude 작업 안내

- 작업 인수인계 · 진행 기록 · 할 일은 **README.md** 가 기준이다. 시작 전에 읽고, 끝나면 "진행 기록" · "할 일"을 갱신한다.
- `html` 브랜치가 실제 사이트다. Claude 는 `claude/…` 브랜치에서 고치고 PR 을 만든 뒤 **사장님 확인(Merge)을 기다린다**.
- 화면(CSS · 화면을 그리는 JS · 생성 도구의 `<style>`)을 고치면 아래 규칙을 따르고 `node tools/ui_check.cjs` 가 0곳인지 확인한다.
  css · js 를 고친 뒤에는 `node tools/asset-version.js`(지도 · LottoHex 쪽의 store-map.css 지문은 `tools/build-static-stats.js` 가 넣는다).

@docs/design.md
