// 다이어그램 렌더러 레지스트리 + hydration.
// markdown.js 가 만든 .mdv-diagram placeholder 를 렌더 후 비동기로 그림으로 치환한다.
// 엔진별 렌더러는 registerDiagram(lang, fn) 으로 등록. fn(src, el) => SVG문자열 | Node.

const renderers = new Map();
// 렌더 결과(SVG 문자열) 메모이즈: key = lang + '\n' + src.
// 재렌더(원본↔렌더 토글 등) 시 엔진 재호출 회피 → 특히 PlantUML(java -jar, 느림+20s cap)
// 시간초과/중복호출 버그 방지, 토글 왕복 비용 0.
const renderCache = new Map();

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

  // 메모이즈 히트: 엔진 재호출 없이 즉시 (로딩 표시도 생략)
  const cacheKey = lang + '\n' + src;
  if (renderCache.has(cacheKey)) {
    el.innerHTML = renderCache.get(cacheKey);
    return;
  }

  showLoading(el, lang); // cache miss → 렌더 중 표시
  try {
    const result = await fn(src, el);
    // fn 이 undefined 를 반환하면 el 을 직접 채운 것 → 건드리지 않음 (예: drawio)
    if (result === undefined || result === null) return;
    el.replaceChildren();
    if (typeof result === 'string') {
      el.innerHTML = result;
      renderCache.set(cacheKey, result); // 문자열 결과만 캐시
    } else if (result instanceof Node) {
      el.appendChild(result);
    }
  } catch (e) {
    renderError(el, lang, (e && e.message) || String(e), src);
  }
}

/** cache miss 비동기 렌더 동안 "렌더링 중…" 표시 */
function showLoading(el, lang) {
  const d = document.createElement('div');
  d.className = 'mdv-diagram-loading';
  d.textContent = `${lang} 렌더링 중…`;
  el.replaceChildren(d);
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
