// 사용: node tools/test-i18n.js
// 브라우저 없이 js/i18n.js 를 돌려 본다. 확인하려는 것 두 가지:
//   1) aria-label 처럼 붙임표가 든 속성을 만나도 init 이 죽지 않는가
//   2) EN 단추를 누르면 언어가 저장되고 페이지를 다시 읽는가
// dataset 은 브라우저와 같은 규칙으로 던지게 흉내 낸다.
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function makeDataset() {
    return new Proxy({}, {
        set(t, k, v) {
            if (typeof k === 'string' && /-[a-z]/.test(k)) {
                throw new SyntaxError('dataset 이름에 "-" 뒤 소문자는 쓸 수 없다: ' + k);
            }
            t[k] = v; return true;
        },
        get(t, k) { return t[k]; },
    });
}

function el(tag, attrs, text) {
    const node = {
        tagName: tag, textContent: text || '', innerHTML: text || '',
        _attrs: Object.assign({}, attrs), dataset: makeDataset(),
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); } },
        getAttribute(n) { return this._attrs[n]; },
        setAttribute(n, v) { this._attrs[n] = v; },
        closest(sel) { return this._matches(sel) ? this : null; },
        _matches(sel) {
            const m = sel.match(/^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/);
            if (!m) return false;
            const has = this._attrs[m[1]] !== undefined;
            return m[2] === undefined ? has : this._attrs[m[1]] === m[2];
        },
    };
    // data-* 는 dataset 에도 비친다 (브라우저와 같게)
    Object.keys(node._attrs).forEach(k => {
        if (!k.startsWith('data-')) return;
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        node.dataset[camel] = node._attrs[k];
    });
    return node;
}

// 실제 사이트와 같은 모양: 메뉴의 aria-label + KO/EN 단추 + 번역할 문장 하나
const nav = el('nav', { 'aria-label': '주 메뉴', 'data-i18n-attr': 'aria-label:nav.aria' });
const link = el('a', { 'data-i18n': 'nav.draws' }, '당첨번호');
const koBtn = el('button', { 'data-lang-btn': 'ko' }, 'KO');
const enBtn = el('button', { 'data-lang-btn': 'en' }, 'EN');
const all = [nav, link, koBtn, enBtn];

let clickHandler = null;
const store = {};
let replacedWith = null;

global.window = global;
global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
};
global.location = { href: 'https://www.lottodraw.kr/draws.html', search: '', replace(u) { replacedWith = u; }, reload() { replacedWith = 'reload'; } };
global.URL = require('url').URL;
global.URLSearchParams = require('url').URLSearchParams;
global.document = {
    readyState: 'complete',
    documentElement: el('html', {}),
    addEventListener(type, fn) { if (type === 'click') clickHandler = fn; },
    querySelectorAll(sel) { return all.filter(n => n._matches(sel)); },
};

require(path.join(ROOT, 'js', 'i18n-dict.js'));

let failed = 0;
function check(name, ok, extra) {
    console.log((ok ? '  통과  ' : '  실패  ') + name + (ok || extra === undefined ? '' : ' → ' + extra));
    if (!ok) failed++;
}

try {
    require(path.join(ROOT, 'js', 'i18n.js'));
    check('init 이 예외 없이 끝난다', true);
} catch (e) {
    check('init 이 예외 없이 끝난다', false, e.message);
}

check('클릭 처리기가 등록됐다', clickHandler !== null);
check('메뉴 aria-label 이 살아 있다', nav.getAttribute('aria-label') === '주 메뉴', nav.getAttribute('aria-label'));

if (clickHandler) {
    clickHandler({ target: enBtn, preventDefault() {} });
    check('EN 을 누르면 언어가 저장된다', store['lottodraw.lang'] === 'en', JSON.stringify(store));
    check('EN 을 누르면 페이지를 다시 읽는다', replacedWith !== null, String(replacedWith));
}

// 영어로 다시 그려 보기
delete require.cache[path.join(ROOT, 'js', 'i18n.js')];
nav.dataset = makeDataset(); link.dataset = makeDataset();
Object.keys(link._attrs).forEach(k => {
    if (!k.startsWith('data-')) return;
    link.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = link._attrs[k];
});
Object.keys(nav._attrs).forEach(k => {
    if (!k.startsWith('data-')) return;
    nav.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = nav._attrs[k];
});
require(path.join(ROOT, 'js', 'i18n.js'));
check('영어에서 메뉴 글자가 바뀐다', link.textContent === 'Past Results', link.textContent);
check('영어에서 aria-label 도 바뀐다', nav.getAttribute('aria-label') === 'Main menu', nav.getAttribute('aria-label'));

console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
process.exit(failed ? 1 : 0);
