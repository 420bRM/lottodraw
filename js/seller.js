// 판매자 정보 한 줄 (전자상거래법 표시 의무). js/premium-config.js 의 seller 를 채우면 나타난다.
// 상호나 대표자가 비어 있으면 아무것도 그리지 않는다 — 빈칸투성이 줄을 보이는 것보다 낫다.
(function () {
    'use strict';
    const s = (window.PREMIUM_CONFIG || {}).seller || {};
    if (!s.name && !s.owner) return;
    const en = window.I18N && window.I18N.lang === 'en';
    const parts = [
        [en ? 'Business' : '상호', s.name],
        [en ? 'Representative' : '대표자', s.owner],
        [en ? 'Business reg. no.' : '사업자등록번호', s.bizNo],
        [en ? 'Mail-order reg. no.' : '통신판매업 신고', s.mailOrderNo],
        [en ? 'Address' : '주소', s.address],
        [en ? 'Phone' : '전화', s.phone],
        [en ? 'Email' : '이메일', s.email],
    ].filter(p => p[1]).map(p => `${p[0]}: ${p[1]}`);
    document.querySelectorAll('[data-seller]').forEach(node => {
        node.textContent = parts.join(' · ');
        node.hidden = false;
    });
}());
