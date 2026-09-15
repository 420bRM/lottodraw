// 30일 통계 이용권 설정. Polar(polar.sh) 대시보드에서 만든 값을 넣는다.
// 여기 들어가는 값은 전부 공개돼도 되는 값이다 — 비밀 키(API 토큰)는 절대 넣지 않는다.
// organizationId 나 checkoutUrl 이 비어 있으면 결제 버튼은 "결제 준비 중"으로 보인다.
window.PREMIUM_CONFIG = {
    // 테스트할 때는 'https://sandbox-api.polar.sh' (샌드박스 조직/상품/키로)
    apiBase: 'https://api.polar.sh',

    // Polar 조직 ID (Settings → General)
    organizationId: '',

    // 상품별 Checkout Link 주소와, 그 상품에 붙인 License Key 혜택(Benefit) ID.
    // benefitId 를 넣으면 이 사이트 이용권이 아닌 키는 거절한다.
    plans: {
        week:     { name: '1주 이용권',   checkoutUrl: '', benefitId: '' },
        month:    { name: '1개월 이용권', checkoutUrl: '', benefitId: '' },
        lifetime: { name: '평생 이용권',  checkoutUrl: '', benefitId: '' },
    },

    // 통계 기간(일). 기준은 데이터의 최신 추첨일.
    windowDays: 30,

    // 한 번 확인한 키는 이 시간 동안 다시 묻지 않는다. 결제대행사 장애 때 이미 결제한
    // 사람이 막히지 않도록, 네트워크 오류 시에는 graceHours 까지 마지막 확인 결과를 믿는다.
    revalidateHours: 12,
    graceHours: 72,
};
