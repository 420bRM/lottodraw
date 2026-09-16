// 5개월 통계 이용권 설정. Polar(polar.sh) 대시보드에서 만든 값을 넣는다.
// 여기 들어가는 값은 전부 공개돼도 되는 값이다 — 비밀 키(API 토큰)는 절대 넣지 않는다.
// organizationId 나 checkoutUrl 이 비어 있으면 결제 버튼은 "결제 준비 중"으로 보인다.
window.PREMIUM_CONFIG = {
    // 테스트할 때는 'https://sandbox-api.polar.sh' (샌드박스 조직/상품/키로)
    apiBase: 'https://api.polar.sh',

    // Polar 조직 ID (Settings → General)
    organizationId: '',

    // Polar 고객 포털 (polar.sh/<조직 slug>/portal). 구매자가 구독 해지, 영수증,
    // 라이선스 키 확인을 하는 곳이다. 비어 있으면 관련 링크가 나오지 않는다.
    portalUrl: '',

    // 상품별 Checkout Link 주소와, 그 상품에 붙인 License Key 혜택(Benefit) ID.
    // benefitId 를 넣으면 이 사이트 이용권이 아닌 키는 거절한다.
    // recurring: true 는 자동 갱신 구독 상품. 해지하면 Polar 가 키를 회수(revoked)해서
    // 다음 확인 때 잠긴다. 최대 revalidateHours 만큼 늦게 반영된다.
    plans: {
        week:     { name: '1주 이용권',   checkoutUrl: '', benefitId: '' },
        sub:      { name: '월 구독',      checkoutUrl: '', benefitId: '', recurring: true },
        month:    { name: '1개월 이용권', checkoutUrl: '', benefitId: '' },
        lifetime: { name: '평생 이용권',  checkoutUrl: '', benefitId: '' },
    },

    // 통계에 넣을 회차 수. 최신 회차부터 이만큼 거슬러 올라간다.
    // 주 1회 추첨이라 22회차가 약 5개월이다. 달(month)로 자르면 그 안에 든 추첨 수가
    // 21~23회로 들쭉날쭉해 표본 크기가 달라지므로, 회차 수로 고정한다.
    windowDraws: 22,

    // 한 번 확인한 키는 이 시간 동안 다시 묻지 않는다. 결제대행사 장애 때 이미 결제한
    // 사람이 막히지 않도록, 네트워크 오류 시에는 graceHours 까지 마지막 확인 결과를 믿는다.
    revalidateHours: 12,
    graceHours: 72,
};
