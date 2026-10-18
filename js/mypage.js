/* 마이페이지 (mypage.html). 내 번호 · 내 정보 · 이용권 · 추첨 결과 메일 · 점수/랭킹 · 계정 관리를 한곳에 모은다.
 *
 * 로그인 정보는 js/account.js(LottoAccount)가, 이용권은 js/license.js(LottoLicense)가 이미 하는 일을 그대로 쓴다.
 * 순위는 /api/ranking(랭킹 페이지와 같은 길), 내 번호 · 메일 구독은 /api/me/numbers · /api/me/mail 에 묻는다.
 * 등수는 서버가 저장하지 않는다 — 이 페이지가 lotto-data.json(당첨번호)으로 그때그때 맞춘다. 그래서 매주 당첨번호가
 * 갱신되면(토요일 밤) 저장해 둔 번호의 등수가 저절로 나온다.
 * 이용권은 로그인과 상관없이 "이 브라우저에 저장된 키"라서 로그인하지 않아도 보인다.
 */
(function () {
    'use strict';

    const api = () => String((window.PREMIUM_CONFIG && window.PREMIUM_CONFIG.apiBase) || 'https://api.lottodraw.kr').replace(/\/+$/, '');
    const tr = (key, ko, vars) => {
        // 한국어 화면은 이 파일의 한국어 문장을 그대로 쓴다(사전에는 영어만 적은 줄이 있다 — 그 줄은 한국어에서 키가 나온다)
        let s = window.I18N && window.I18N.lang !== 'ko' ? window.I18N.t(key, ko) : ko;
        if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
        return s;
    };
    const $ = id => document.getElementById(id);
    const num = n => Number(n || 0).toLocaleString(window.I18N && window.I18N.lang === 'en' ? 'en-US' : 'ko-KR');
    const ymd = ms => {
        const d = new Date(ms);
        if (isNaN(d)) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    function el(tag, props, kids) {
        const n = document.createElement(tag);
        Object.keys(props || {}).forEach(k => {
            if (k === 'text') n.textContent = props[k];
            else if (k === 'className') n.className = props[k];
            else if (k === 'on') Object.keys(props[k]).forEach(ev => n.addEventListener(ev, props[k][ev]));
            else n.setAttribute(k, props[k]);
        });
        (kids || []).forEach(c => c != null && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return n;
    }

    // 상자 본문을 갈아 끼운다
    function fill(id, kids) {
        const body = $(id).querySelector('.my-body');
        body.textContent = '';
        kids.forEach(k => k && body.appendChild(k));
    }
    // 이름 · 값 한 줄
    const row = (label, value, extra) => el('div', { className: 'my-row' }, [
        el('span', { className: 'my-k', text: label }),
        el('span', { className: 'my-v' }, [typeof value === 'string' ? value : value, extra || null]),
    ]);
    const btn = (text, onClick, cls) => el('button', { type: 'button', className: 'btn btn-secondary btn-mini' + (cls ? ' ' + cls : ''), text: text, on: { click: onClick } });

    async function copy(text, button) {
        try {
            await navigator.clipboard.writeText(text);
            const old = button.textContent;
            button.textContent = tr('my.copied', '복사했습니다');
            setTimeout(() => { button.textContent = old; }, 1500);
        } catch (e) {
            window.prompt(tr('my.copyManual', '아래 내용을 복사해 주세요'), text);
        }
    }

    /* ───── 이용권 (이 브라우저) ───── */

    async function showPass(user) {
        const L = window.LottoLicense;
        const trial = user && user.trial;
        // 무료 체험 줄은 체험을 받은 회원에게만(가입 체험은 2026-10-11부터 끔)
        const trialLine = user && trial ? row(tr('my.trial', '무료 체험'), trial
            ? (trial.expiresAt > Date.now() ? tr('my.trialUntil', '{date}까지', { date: ymd(trial.expiresAt) }) : tr('my.trialOver', '끝났습니다 ({date})', { date: ymd(trial.expiresAt) }))
            : tr('my.trialNone', '받지 않음 (계정당 한 번)')) : null;
        const seePlans = el('a', { className: 'btn btn-mini', href: 'statistics.html', text: tr('my.seePlans', '이용권 보기') });

        if (!L || !L.savedKey()) {
            fill('my-pass', [
                el('p', { text: tr('my.passNone', '이 브라우저에는 이용권이 없습니다.') }),
                trialLine,
                el('p', { className: 'my-muted', text: tr('my.passNoneHint', '다른 기기에서 산 이용권은 그 기기의 "다른 기기용 링크"를 여기서 열면 이 브라우저에서도 열립니다.') }),
                el('div', { className: 'my-actions' }, [seePlans]),
            ]);
            return;
        }
        fill('my-pass', [el('p', { className: 'my-muted', text: tr('my.passChecking', '이용권을 확인하는 중…') })]);
        let state;
        try { state = await L.unlockState(); } catch (e) { state = { unlocked: false, reason: tr('my.passFail', '이용권을 확인하지 못했습니다. 잠시 뒤 다시 열어 주세요.') }; }
        if (!state.unlocked) {
            fill('my-pass', [
                el('p', { className: 'my-warn', text: state.reason || tr('my.passFail', '이용권을 확인하지 못했습니다. 잠시 뒤 다시 열어 주세요.') }),
                trialLine,
                el('div', { className: 'my-actions' }, [seePlans]),
            ]);
            return;
        }
        const r = state.record || {};
        const key = r.key || L.savedKey();
        const keyBox = el('div', { className: 'my-key', hidden: '' }, [
            el('code', { text: key }),
            el('div', { className: 'my-actions' }, [
                btn(tr('my.copyKey', '키 복사'), e => copy(key, e.currentTarget)),
                btn(tr('my.copyLink', '다른 기기용 링크 복사'), e => copy(location.origin + location.pathname.replace(/[^/]*$/, '') + 'statistics.html#key=' + key, e.currentTarget)),
            ]),
        ]);
        const toggle = btn(tr('my.showKey', '키 보기'), () => {
            keyBox.hidden = !keyBox.hidden;
            toggle.textContent = keyBox.hidden ? tr('my.showKey', '키 보기') : tr('my.hideKey', '키 숨기기');
        });
        fill('my-pass', [
            el('p', { className: 'my-ok', text: tr('my.passOn', '이용권이 열려 있습니다') + (state.offline ? ' ' + tr('my.offline', '(오프라인 — 마지막 확인 기준)') : '') }),
            row(tr('my.plan', '종류'), r.plan || ''),
            row(tr('my.until', '기간'), r.expiresAt ? tr('my.untilDate', '{date}까지', { date: ymd(r.expiresAt) }) : tr('my.noLimit', '기간 제한 없음')),
            r.keyId ? row(tr('my.keyNo', '키 번호'), String(r.keyId).toUpperCase()) : null,
            trialLine,
            el('div', { className: 'my-actions' }, [toggle, el('a', { className: 'btn btn-mini', href: 'statistics.html', text: tr('my.goStats', '5개월 통계 보기') })]),
            keyBox,
        ]);
    }

    /* ───── 내 번호 · 추첨 결과 ───── */

    const RANKS = [1, 2, 3, 4, 5];
    const bandOf = n => (n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5);
    const ball = (n, on) => el('span', Object.assign({ className: 'mball' + (on === false ? ' my-miss' : ''), text: String(n) }, on === false ? {} : { 'data-band': String(bandOf(n)) }));
    function rankOf(game, d) {
        const hit = game.filter(n => d.numbers.indexOf(n) !== -1);
        const bonus = game.indexOf(d.bonus) !== -1;
        const m = hit.length;
        return { rank: m === 6 ? 1 : m === 5 && bonus ? 2 : m === 5 ? 3 : m === 4 ? 4 : m === 3 ? 5 : 0, match: m, bonus: m === 5 && bonus };
    }
    let draws = null;         // 회차 → { numbers, bonus, date }
    let numState = null;      // { games, saleRound, mail, mailReady }
    let weeks = 12;           // 요약 기간(최근 몇 회차)
    let shownRounds = 6;      // 목록에 펼쳐 둔 회차 수
    async function loadDraws() {
        if (draws) return draws;
        try {
            const res = await fetch('lotto-data.json', { cache: 'no-cache' });
            const data = await res.json();
            draws = {};
            data.draws.forEach(d => { draws[d.round] = d; });
        } catch (e) { draws = {}; }
        return draws;
    }
    const A = () => window.LottoAccount;
    // 한 줄에 한 게임: 숫자 6개(띄어쓰기 · 쉼표 · 점 무엇이든). 잘못된 줄은 몇 번째인지 알려 준다
    function parseGames(text) {
        const lines = String(text).split(/\n+/).map(l => l.trim()).filter(Boolean);
        const games = [];
        for (let i = 0; i < lines.length; i++) {
            const nums = (lines[i].match(/\d+/g) || []).map(Number);
            const ok = nums.length === 6 && nums.every(n => n >= 1 && n <= 45) && new Set(nums).size === 6;
            if (!ok) return { error: tr('my.numBadLine', '{i}번째 줄을 확인해 주세요. 1~45 사이의 서로 다른 번호 6개를 적어 주세요.', { i: i + 1 }) };
            games.push(nums.sort((a, b) => a - b));
        }
        if (!games.length) return { error: tr('my.numEmpty', '번호를 적어 주세요. 한 줄에 한 게임입니다.') };
        if (games.length > 20) return { error: tr('my.numTooMany', '한 번에 20게임까지 저장할 수 있습니다.') };
        return { games };
    }

    function summary(games) {
        const top = numState.saleRound;
        const from = weeks ? top - weeks + 1 : 0;
        const pick = games.filter(g => g.r >= from);
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 0: 0, wait: 0 };
        pick.forEach(g => { const d = draws[g.r]; if (!d) counts.wait++; else counts[rankOf(g.n, d).rank]++; });
        const sel = el('select', { 'aria-label': tr('my.numPeriod', '기간') }, [4, 12, 52, 0].map(w => {
            const o = el('option', { value: String(w), text: w ? tr('my.numWeeks', '최근 {n}회', { n: w }) : tr('my.numAll', '전체') });
            if (w === weeks) o.selected = true;
            return o;
        }));
        sel.addEventListener('change', () => { weeks = Number(sel.value); paintNumbers(); });
        const cells = RANKS.map(r => el('div', { className: counts[r] ? 'my-hit' : '' }, [el('b', { text: num(counts[r]) }), el('span', { text: tr('my.tier' + r, r + '등') })]));
        cells.push(el('div', null, [el('b', { text: num(counts[0]) }), el('span', { text: tr('my.numLose', '낙첨') })]));
        return el('div', { className: 'my-sum' }, [
            el('div', { className: 'my-sum-head' }, [sel, el('span', { className: 'my-muted', text: tr('my.numGames', '{n}게임', { n: num(pick.length) }) + (counts.wait ? ' · ' + tr('my.numWaitN', '추첨 전 {n}', { n: num(counts.wait) }) : '') })]),
            el('div', { className: 'my-sum-grid' }, cells),
        ]);
    }

    function form() {
        const top = numState.saleRound;
        const sel = el('select', { id: 'my-num-round', 'aria-label': tr('my.numRound', '회차') });
        for (let r = top; r > Math.max(0, top - 8); r--) {
            sel.appendChild(el('option', { value: String(r), text: r === top ? tr('my.numThis', '{r}회 (이번 회차)', { r }) : tr('my.numRoundN', '{r}회', { r }) }));
        }
        const area = el('textarea', { id: 'my-num-text', rows: '3', placeholder: tr('my.numPh', '한 줄에 한 게임\n예) 3 11 19 27 34 42'), 'aria-label': tr('my.numInput', '산 번호 (한 줄에 한 게임)') });
        const msg = el('p', { className: 'my-muted', role: 'status', 'aria-live': 'polite' });
        const save = btn(tr('my.numSave', '저장'), async () => {
            const p = parseGames(area.value);
            if (p.error) { msg.className = 'my-warn'; msg.textContent = p.error; area.focus(); return; }
            save.disabled = true;
            try {
                const r = await A().call('/api/me/numbers', { method: 'POST', body: { round: Number(sel.value), games: p.games, src: 'm' } });
                numState.games = r.games;
                area.value = '';
                paintNumbers(tr('my.numSaved', '{n}게임을 저장했습니다.', { n: r.added }) + (r.dup ? ' ' + tr('my.numDupN', '이미 있던 {n}게임은 건너뛰었습니다.', { n: r.dup }) : '') + (r.full ? ' ' + tr('my.numFullN', '한 회차에 20게임까지라 {n}게임은 넣지 못했습니다.', { n: r.full }) : ''));
            } catch (e) {
                msg.className = 'my-warn';
                msg.textContent = e.status && e.message ? e.message : tr('my.numFail', '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
            }
            save.disabled = false;
        });
        save.classList.remove('btn-secondary');
        return el('div', { className: 'my-num-form' }, [
            el('div', { className: 'my-num-inputs' }, [sel, area, save]),
            msg,
        ]);
    }

    async function remove(body, label) {
        if (!window.confirm(label)) return;
        try {
            const r = await A().call('/api/me/numbers/delete', { method: 'POST', body });
            numState.games = r.games;
            paintNumbers();
        } catch (e) { window.alert(e.status && e.message ? e.message : tr('my.numFail', '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')); }
    }

    function roundBlock(r, list) {
        const d = draws[r];
        const head = el('div', { className: 'my-round-head' }, [
            el('b', { text: tr('my.numRoundN', '{r}회', { r }) }),
            d ? el('span', { className: 'my-draw' }, d.numbers.map(n => ball(n)).concat([el('span', { className: 'my-plus', text: '+' }), ball(d.bonus)]))
                : el('span', { className: 'my-muted', text: tr('my.numBefore', '추첨 전') }),
            el('button', { type: 'button', className: 'my-x', text: tr('my.numDel', '지우기'), 'aria-label': tr('my.numDelRoundAria', '{r}회 번호 지우기', { r }), on: { click: () => remove({ round: r }, tr('my.numDelRoundQ', '{r}회 번호 {n}게임을 지울까요?', { r, n: list.length })) } }),
        ]);
        const rows = list.map(g => {
            const res = d ? rankOf(g.n, d) : null;
            const tag = !res ? tr('my.numWait', '추첨 전') : res.rank ? tr('my.tier' + res.rank, res.rank + '등') + ' · ' + tr('my.numMatch', '{m}개 일치', { m: res.match }) + (res.bonus ? ' + ' + tr('my.numBonus', '보너스') : '') : tr('my.numLose', '낙첨') + ' · ' + tr('my.numMatch', '{m}개 일치', { m: res.match });
            return el('li', { className: res && res.rank ? 'my-win' : '' }, [
                el('span', { className: 'my-balls' }, g.n.map(n => ball(n, d ? d.numbers.indexOf(n) !== -1 || (res.bonus && n === d.bonus) : undefined))),
                el('span', { className: 'my-res', text: tag }),
                el('button', { type: 'button', className: 'my-x', 'aria-label': tr('my.numDelOne', '이 게임 지우기'), text: '×', on: { click: () => remove({ id: g.id }, tr('my.numDelOneQ', '{nums} 을(를) 지울까요?', { nums: g.n.join(' ') })) } }),
            ]);
        });
        return el('div', { className: 'my-round' }, [head, el('ul', { className: 'my-games' }, rows)]);
    }

    function paintNumbers(note) {
        const games = numState.games || [];
        const byRound = new Map();
        games.forEach(g => { if (!byRound.has(g.r)) byRound.set(g.r, []); byRound.get(g.r).push(g); });
        const rounds = [...byRound.keys()].sort((a, b) => b - a);
        const blocks = rounds.slice(0, shownRounds).map(r => roundBlock(r, byRound.get(r)));
        const more = rounds.length > shownRounds ? btn(tr('my.numMore', '지난 회차 더 보기 ({n})', { n: rounds.length - shownRounds }), () => { shownRounds += 10; paintNumbers(); }) : null;
        fill('my-numbers', [
            el('p', { className: 'my-muted', text: tr('my.numLead', '산 번호를 회차별로 저장해 두면, 매주 당첨번호가 갱신될 때 등수와 맞은 번호를 보여 줍니다. 홈 번호 생성기의 "＋ 내 번호"로도 저장됩니다.') }),
            games.length ? summary(games) : null,
            form(),
            note ? el('p', { className: 'my-ok', role: 'status', text: note }) : null,
            games.length ? el('div', { className: 'my-rounds' }, blocks) : el('p', { className: 'my-muted', text: tr('my.numNone', '아직 저장한 번호가 없습니다.') }),
            more ? el('div', { className: 'my-actions' }, [more]) : null,
            el('p', { className: 'my-muted', text: tr('my.numNote', '번호는 회차마다 20게임, 최근 104회차까지 보관합니다. 결과는 참고용이며, 당첨금 수령은 실물 복권(또는 동행복권 구매 내역)으로 확인해 주세요.') }),
        ]);
    }

    async function showNumbers() {
        const box = $('my-numbers');
        box.hidden = false;
        try {
            const [st] = await Promise.all([A().call('/api/me/numbers'), loadDraws()]);
            numState = st;
            paintNumbers();
            showMail();
        } catch (e) {
            fill('my-numbers', [el('p', { className: 'my-warn', text: tr('my.numLoadFail', '내 번호를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.') })]);
        }
    }

    function showMail() {
        const box = $('my-mail');
        box.hidden = false;
        const me = A().me();
        const email = me && me.user && me.user.email;
        const on = !!numState.mail;
        const ready = !!numState.mailReady;
        const toggle = btn(on ? tr('my.mailOff', '메일 끄기') : tr('my.mailOn', '메일 받기'), async () => {
            toggle.disabled = true;
            try {
                const r = await A().call('/api/me/mail', { method: 'POST', body: { on: !on } });
                numState.mail = r.mail;
            } catch (e) { window.alert(e.status && e.message ? e.message : tr('my.mailFail', '바꾸지 못했습니다. 잠시 뒤 다시 시도해 주세요.')); }
            showMail();
        });
        if (!on) toggle.classList.remove('btn-secondary');
        if (!ready && !on) toggle.disabled = true;
        fill('my-mail', [
            el('p', { text: tr('my.mailLead', '추첨 다음 날(일요일) 오전에 그 회차 당첨번호와, 위 내 번호에 저장한 그 회차 번호의 등수 · 맞은 번호를 메일로 보냅니다. 그 회차 번호를 저장하지 않은 주에는 보내지 않습니다.') }),
            row(tr('my.mailState', '상태'), on ? tr('my.mailIsOn', '받는 중') : tr('my.mailIsOff', '받지 않음')),
            row(tr('my.email', '이메일'), email || ''),
            el('div', { className: 'my-actions' }, [toggle]),
            !ready ? el('p', { className: 'my-muted', text: tr('my.mailNotReady', '메일 발송을 준비하고 있습니다.') }) : null,
            el('p', { className: 'my-muted', text: tr('my.mailNote', '당첨 여부는 복권 실물과 동행복권에서 한 번 더 확인해 주세요. 메일마다 수신 거부 링크가 있고, 여기서도 언제든 끌 수 있습니다. 광고는 넣지 않습니다.') }),
        ]);
    }

    /* ───── 로그인한 회원 ───── */

    function showProfile(user) {
        const A = window.LottoAccount;
        fill('my-profile', [
            row(tr('my.nick', '별명'), user.nick || tr('my.nickNone', '아직 없음'),
                A && A.openNick ? btn(user.nick ? tr('my.nickChange', '바꾸기') : tr('my.nickSet', '정하기'), () => A.openNick(!user.nick)) : null),
            row(tr('my.email', '이메일'), user.email || ''),
            row(tr('my.joined', '가입일'), ymd(user.createdAt)),
            user.staff ? row(tr('my.role', '구분'), tr('my.staff', '운영자 계정')) : null,
        ]);
    }

    async function showScore(user, reactions) {
        const sc = user.score || {};
        const counts = { h: 0, d: 0, w: 0 };
        Object.values(reactions || {}).forEach(v => String(v).split('').forEach(t => { if (counts[t] !== undefined) counts[t]++; }));
        const rankLine = row(tr('my.rank', '순위'), tr('my.loading', '불러오는 중…'));
        fill('my-score', [
            el('div', { className: 'my-big' }, [
                el('div', null, [el('b', { text: num(sc.total) }), el('span', { text: tr('my.points', '점수') })]),
                el('div', null, [el('b', { text: num(sc.avail != null ? sc.avail : sc.total) }), el('span', { text: tr('my.avail', '쓸 수 있는 포인트') })]),
            ]),
            rankLine,
            row(tr('my.days', '출석'), tr('my.daysN', '{n}일', { n: num(sc.days) })),
            row(tr('my.reacts', '남긴 반응'), tr('my.reactsN', '♥ {h} · $ {d} · ₩ {w}', counts)),
            row(tr('my.buy', '이용권 점수'), tr('my.ptsN', '{n}점', { n: num(sc.buy) })),
            sc.spent ? row(tr('my.spent', '쓴 포인트'), tr('my.ptsN', '{n}점', { n: num(sc.spent) })) : null,
            el('div', { className: 'my-actions' }, [el('a', { className: 'btn btn-secondary btn-mini', href: 'ranking.html', text: tr('my.goRanking', '랭킹 보기') })]),
        ]);
        // 순위는 랭킹 페이지와 같은 길로 묻는다
        try {
            const s = JSON.parse(localStorage.getItem('lottodraw.account') || 'null');
            const res = await fetch(api() + '/api/ranking', { headers: Object.assign({ Accept: 'application/json' }, s && s.session ? { Authorization: 'Bearer ' + s.session } : {}), cache: 'no-cache' });
            const data = await res.json();
            const me = res.ok && data.me;
            rankLine.querySelector('.my-v').textContent = !me ? '—'
                : me.nick ? tr('my.rankN', '{rank}위 / {of}명', { rank: num(me.rank), of: num(me.of) })
                    : tr('my.rankUnnamed', '별명을 정하면 {rank}위로 오릅니다', { rank: num(me.rank) });
        } catch (e) {
            rankLine.querySelector('.my-v').textContent = '—';
        }
    }

    function showAccount() {
        const A = window.LottoAccount;
        fill('my-account', [
            el('p', { className: 'my-muted', text: tr('my.accountHint', '로그아웃해도 이 브라우저의 이용권 키는 그대로 남습니다.') }),
            el('div', { className: 'my-actions' }, [
                btn(tr('my.logout', '로그아웃'), () => A.logout()),
                btn(tr('my.delete', '회원 탈퇴'), () => A.withdraw(), 'my-danger'),
            ]),
        ]);
    }

    // 로그인하지 않았거나 회원 기능이 꺼져 있을 때: 회원 상자 셋을 안내 하나로 바꾼다
    function showGuest(loginOn) {
        const A = window.LottoAccount;
        const msg = loginOn
            ? [el('p', { text: tr('my.needLogin', '로그인하면 내 정보·점수·랭킹을 볼 수 있습니다.') }),
                el('div', { className: 'my-actions' }, [el('button', { type: 'button', className: 'btn', text: tr('my.login', '구글로 로그인'), on: { click: () => A.openLogin(tr('my.loginReason', '마이페이지는 로그인하면 볼 수 있습니다.')) } })])]
            : [el('p', { className: 'my-muted', text: tr('my.off', '회원 기능을 준비하고 있습니다.') })];
        fill('my-profile', msg);
        $('my-score').hidden = true;
        $('my-account').hidden = true;
    }

    async function start() {
        const A = window.LottoAccount;
        if (!A || !A.loginOn()) { showGuest(false); showPass(null); return; }
        if (!A.session()) { showGuest(true); showPass(null); return; }
        let me = null;
        try { me = await A.refresh(); } catch (e) { me = A.me(); }
        if (!me || !me.user) { showGuest(true); showPass(null); return; }
        showProfile(me.user);
        showPass(me.user);
        showScore(me.user, me.reactions);
        showAccount();
        showNumbers();
    }

    // 별명을 바꾸면 account.js 가 알려 준다 — 내 정보·점수(포인트를 썼을 수 있다)를 다시 그린다
    window.addEventListener('lottodraw:account', () => {
        const me = window.LottoAccount && window.LottoAccount.me();
        if (me && me.user) { showProfile(me.user); showScore(me.user, me.reactions); }
    });

    // 계정 스크립트(js/account.js)는 i18n.js 가 나중에 붙인다. 준비될 때까지 기다리되, 못 받으면 6초 뒤 손님으로 그린다
    let started = false;
    const go = () => { if (started) return; started = true; start(); };
    const waitAccount = () => {
        if (window.LottoAccount && window.LottoAccount.ready) window.LottoAccount.ready.then(go);
        else document.addEventListener('lotto:account-ready', go, { once: true });
        setTimeout(go, 6000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitAccount);
    else waitAccount();
})();
