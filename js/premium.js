// 5개월 통계 잠금. Polar 라이선스 키를 브라우저에서 확인한다.
//
// 이 잠금은 편의 잠금이다. 원본 데이터(lotto-data.json)와 계산 코드가 공개돼 있어서,
// 마음먹은 사람이 직접 계산하는 것까지 막을 수는 없다. 서버 없는 정적 사이트의 한계다.
// 키 외의 사용자 입력(포함/제외 번호, 생성 이력)은 어디로도 보내지 않는다.
(function () {
    'use strict';

    const cfg = window.PREMIUM_CONFIG || {};
    const KEY_STORE = 'lottodraw.premium.key';
    const CHECK_STORE = 'lottodraw.premium.check';
    const HOUR = 60 * 60 * 1000;
    const $ = id => document.getElementById(id);

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 프라이빗 모드 */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* 프라이빗 모드 */ } },
    };

    const plans = cfg.plans || {};
    const benefitIds = () => Object.keys(plans).map(p => plans[p].benefitId).filter(Boolean);
    const planOf = id => {
        const hit = Object.keys(plans).filter(p => plans[p].benefitId && plans[p].benefitId === id)[0];
        return hit ? plans[hit] : null;
    };
    const fmtDate = iso => {
        const d = new Date(iso);
        return isNaN(d) ? iso : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

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
        if (!cfg.organizationId) {
            $('license-key').disabled = true;
            $('license-submit').disabled = true;
            setStatus('결제 연동을 준비하고 있습니다. 조금만 기다려 주세요.');
        }
    }

    // Polar 응답을 이용 가능 여부로 판정
    function judge(lk) {
        if (lk.status !== 'granted') {
            return { ok: false, reason: lk.status === 'revoked' ? '환불 또는 취소된 이용권입니다.' : '사용이 중지된 이용권입니다.' };
        }
        const allowed = benefitIds();
        if (allowed.length && allowed.indexOf(lk.benefit_id) === -1) {
            return { ok: false, reason: '이 사이트의 이용권 키가 아닙니다.' };
        }
        if (lk.expires_at && Date.parse(lk.expires_at) <= Date.now()) {
            return { ok: false, reason: `${fmtDate(lk.expires_at)}에 기간이 끝난 이용권입니다.` };
        }
        const plan = planOf(lk.benefit_id);
        return {
            ok: true,
            expiresAt: lk.expires_at || null,
            plan: plan ? plan.name : '이용권',
            recurring: !!(plan && plan.recurring),
        };
    }

    async function validate(key) {
        const res = await fetch(`${cfg.apiBase}/v1/customer-portal/license-keys/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ key: key, organization_id: cfg.organizationId }),
        });
        if (res.status === 404) return { ok: false, reason: '찾을 수 없는 키입니다. 앞뒤 공백 없이 그대로 붙여 넣었는지 확인해 주세요.' };
        if (res.status === 422) return { ok: false, reason: '키 형식이 올바르지 않습니다.' };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return judge(await res.json());
    }

    function readCheck() {
        try { return JSON.parse(store.get(CHECK_STORE) || 'null'); } catch (e) { return null; }
    }
    const stillValid = c => c && c.ok && (!c.expiresAt || Date.parse(c.expiresAt) > Date.now());

    function lock(message, isError) {
        $('premium').hidden = true;
        $('paywall').hidden = false;
        if (message) setStatus(message, isError);
    }

    function unlock(check) {
        $('paywall').hidden = true;
        $('premium').hidden = false;
        const until = check.expiresAt ? `${fmtDate(check.expiresAt)}까지 이용 가능`
            : check.recurring ? '해지 전까지 이용 가능'
            : '기간 제한 없음';
        $('license-summary').textContent = `${check.plan} · ${until}`;
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
                LottoInsights.render(document.getElementById("insight-grid"), stats, sorted);
                LottoStatsView.render(grid, stats, {
                    scopeLabel: `최근 ${stats.rounds}회차`,
                    trendTitle: '기간 중 많이·적게 나온 번호',
                    latestDraws: sorted,
                    latestTitle: `최근 ${sorted.length}회차 당첨번호`,
                });
            })
            .catch(err => {
                console.error(err);
                statsLoaded = false;
                grid.textContent = '통계 데이터를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.';
            });
    }

    async function check(key, fromForm) {
        const cached = readCheck();
        const fresh = cached && cached.key === key && stillValid(cached) &&
            Date.now() - cached.checkedAt < (cfg.revalidateHours || 12) * HOUR;
        if (!fromForm && fresh) return unlock(cached);

        if (fromForm) setStatus('확인하는 중…');
        try {
            const result = await validate(key);
            if (result.ok) {
                const record = Object.assign({ key: key, checkedAt: Date.now() }, result);
                store.set(KEY_STORE, key);
                store.set(CHECK_STORE, JSON.stringify(record));
                setStatus('');
                unlock(record);
            } else {
                store.del(CHECK_STORE);
                if (!fromForm) store.del(KEY_STORE);
                lock(result.reason, true);
            }
        } catch (err) {
            console.error(err);
            const graceOk = cached && cached.key === key && stillValid(cached) &&
                Date.now() - cached.checkedAt < (cfg.graceHours || 72) * HOUR;
            if (graceOk) return unlock(cached);
            lock('결제대행사에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', true);
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
            store.del(KEY_STORE);
            store.del(CHECK_STORE);
            $('license-key').value = '';
            lock('이 브라우저에 저장된 키를 지웠습니다.');
        });
        const saved = store.get(KEY_STORE);
        if (saved && cfg.organizationId) {
            $('license-key').value = saved;
            check(saved, false);
        } else {
            lock();
        }
    }

    init();
}());
