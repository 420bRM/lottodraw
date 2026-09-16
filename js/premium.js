// 5개월 통계 페이지의 잠금 화면. 키를 확인하는 규칙은 js/license.js 가 갖고 있고,
// 여기서는 화면 전환과 안내 문구만 맡는다.
(function () {
    'use strict';

    const cfg = window.PREMIUM_CONFIG || {};
    const L = window.LottoLicense;
    const $ = id => document.getElementById(id);
    const plans = cfg.plans || {};

    function setStatus(text, isError) {
        const el = $('license-status');
        el.textContent = text;
        el.classList.toggle('error', !!isError);
    }

    function setupPlans() {
        document.querySelectorAll('[data-plan]').forEach(a => {
            const plan = plans[a.dataset.plan];
            if (plan && plan.checkoutUrl) {
                a.href = plan.checkoutUrl;
                a.removeAttribute('aria-disabled');
                a.textContent = '결제하기';
            } else {
                a.removeAttribute('href');
                a.setAttribute('aria-disabled', 'true');
                a.classList.add('is-disabled');
                a.textContent = '결제 준비 중';
            }
        });
        if (!L.configured()) {
            $('license-key').disabled = true;
            $('license-submit').disabled = true;
            setStatus('결제 연동을 준비하고 있습니다. 조금만 기다려 주세요.');
        }
    }

    // 구독 해지·영수증·키 확인은 Polar 고객 포털에서 한다. 주소가 없으면 링크를 감춘다.
    function setupPortal() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-portal]'), a => {
            if (cfg.portalUrl) {
                a.href = cfg.portalUrl;
                a.hidden = false;
            } else {
                a.removeAttribute('href');
                a.hidden = true;
            }
        });
    }

    function lock(message, isError) {
        $('premium').hidden = true;
        $('paywall').hidden = false;
        if (message) setStatus(message, isError);
    }

    function unlock(record) {
        $('paywall').hidden = true;
        $('premium').hidden = false;
        $('license-summary').textContent = L.summary(record);
        loadWindowStats();
    }

    let statsLoaded = false;
    function loadWindowStats() {
        if (statsLoaded) return;
        statsLoaded = true;
        const grid = $('stat-grid');
        fetch('lotto-data.json')
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(data => {
                const count = cfg.windowDraws || 22;
                const w = LottoStats.withinDraws(data.draws, count);
                if (!w.draws.length) throw new Error('추첨 기록이 없다');
                const sorted = w.draws.slice().sort((a, b) => b.round - a.round);
                const stats = LottoStats.compute(sorted, { recentWindow: sorted.length });
                $('window-scope').textContent =
                    `${w.from} ~ ${w.to} · ${stats.oldestRound}~${stats.latestRound}회 (추첨 ${stats.rounds}회)`;
                LottoStatsView.render(grid, stats, {
                    scopeLabel: `최근 ${stats.rounds}회차`,
                    trendTitle: '기간 중 많이·적게 나온 번호',
                    latestDraws: sorted,
                    latestTitle: `최근 ${sorted.length}회차 당첨번호`,
                });
                LottoInsights.render($('insight-grid'), stats, sorted);
                // 상세 카드는 전 회차 기록으로 그린다. 결제한 사람에게는 잠그지 않는다.
                LottoDetails.render($('detail-grid'), data.draws, { locked: false });
            })
            .catch(err => {
                console.error(err);
                statsLoaded = false;
                grid.textContent = '통계 데이터를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.';
            });
    }

    async function check(key, fromForm) {
        const cached = L.cached();
        if (!fromForm && L.fresh(cached, key)) return unlock(cached);

        if (fromForm) setStatus('확인하는 중…');
        try {
            const result = await L.validate(key);
            if (result.ok) {
                setStatus('');
                unlock(L.remember(key, result));
            } else {
                L.forget(!fromForm);
                lock(result.reason, true);
            }
        } catch (err) {
            console.error(err);
            if (L.graceOk(cached, key)) return unlock(cached);
            lock('결제대행사에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', true);
        }
    }

    function init() {
        setupPlans();
        setupPortal();
        $('license-form').addEventListener('submit', e => {
            e.preventDefault();
            const key = $('license-key').value.trim();
            if (!key) return setStatus('라이선스 키를 입력해 주세요.', true);
            if (key.length > 200) return setStatus('키가 너무 깁니다.', true);
            check(key, true);
        });
        $('license-clear').addEventListener('click', () => {
            L.forget(true);
            $('license-key').value = '';
            lock('이 브라우저에 저장된 키를 지웠습니다.');
        });
        const saved = L.savedKey();
        if (saved && L.configured()) {
            $('license-key').value = saved;
            check(saved, false);
        } else {
            lock();
        }
    }

    init();
}());
