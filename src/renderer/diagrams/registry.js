// 다이어그램 렌더러 레지스트리 + hydration.
// markdown.js 가 만든 .mdv-diagram placeholder 를 렌더 후 비동기로 그림으로 치환한다.
// 엔진별 렌더러는 registerDiagram(lang, fn) 으로 등록. fn(src, el) => SVG문자열 | Node.

const renderers = new Map();

export function registerDiagram(lang, fn) {
  renderers.set(lang, fn);
}

/** root 하위의 모든 다이어그램 placeholder 를 렌더한다 (이미 한 것은 건너뜀). */
export async function hydrateDiagrams(root) {
  const nodes = root.querySelectorAll('.mdv-diagram');
  await Promise.all(Array.from(nodes, hydrateOne));
}

async function hydrateOne(el) {
  if (el.dataset.hydrated) return;
  el.dataset.hydrated = '1';

  const lang = el.dataset.lang;
  const srcEl = el.querySelector('.mdv-diagram-src');
  const src = (srcEl ? srcEl.textContent : el.textContent) || '';
  const fn = renderers.get(lang);

  if (!fn) {
    renderError(el, lang, `미지원 다이어그램 엔진: ${lang}`, src);
    return;
  }

  try {
    const result = await fn(src, el);
    el.replaceChildren();
    if (typeof result === 'string') el.innerHTML = result;
    else if (result instanceof Node) el.appendChild(result);
  } catch (e) {
    renderError(el, lang, (e && e.message) || String(e), src);
  }
}

/** 렌더 실패 시: 에러 메시지 + 원문 코드블록 폴백 */
function renderError(el, lang, message, src) {
  el.classList.add('mdv-diagram-error');
  const wrap = document.createElement('div');
  const msg = document.createElement('div');
  msg.className = 'mdv-diagram-msg';
  msg.textContent = `⚠ ${lang} 렌더 실패: ${message}`;
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = src;
  pre.appendChild(code);
  wrap.append(msg, pre);
  el.replaceChildren(wrap);
}
