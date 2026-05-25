// 다이어그램 렌더러 레지스트리 + hydration.
// markdown.js 가 만든 .mdv-diagram placeholder 를 렌더 후 비동기로 그림으로 치환한다.
// 엔진별 렌더러는 registerDiagram(lang, fn) 으로 등록. fn(src, el) => SVG문자열 | Node.
import DOMPurify from '../../../vendor/dompurify.js';

// 신뢰않는 엔진(d2·plantuml)의 문자열 SVG 산출물 새니타이즈. 이들은 신뢰않는 .md
// 소스를 SVG 로 변환하므로 script/이벤트핸들러/javascript: 링크가 섞일 수 있다.
// el.innerHTML 주입 전 통과시킨다(노트 본문 살균과 동일 방어선).
// 통합 프로파일 + foreignobject 보존 설정(marp.js 와 동일). d2/plantuml 은 <text>
// 기반이라 실제론 foreignObject 를 안 쓰지만, 향후 엔진 확장 대비 보존 설정 유지.
// (foreignObject htmlLabels 를 쓰는 mermaid 는 strict 자체살균이라 trusted 로 면제 —
//  DOMPurify 가 SVG 네임스페이스 안의 HTML 자식을 제거해 라벨이 사라지기 때문.)
function sanitizeDiagramSvg(svg) {
  return DOMPurify.sanitize(svg, {
    ADD_TAGS: ['foreignobject', 'use'],
    ADD_ATTR: ['viewBox', 'preserveAspectRatio'],
  });
}

const renderers = new Map();
// 렌더 결과(SVG 문자열) 메모이즈: key = lang + '\n' + src.
// 재렌더(원본↔렌더 토글 등) 시 엔진 재호출 회피 → 특히 PlantUML(java -jar, 느림+20s cap)
// 시간초과/중복호출 버그 방지, 토글 왕복 비용 0.
const renderCache = new Map();

// trusted:true 인 엔진은 자체적으로 안전한 SVG 를 보장하므로 추가 살균을 건너뛴다.
// (mermaid securityLevel:strict 가 대표 — 살균이 foreignObject htmlLabels 를 지워
//  라벨이 사라지는 회귀를 막기 위해 면제). 미지정(신뢰않음) 엔진은 주입 전 살균.
export function registerDiagram(lang, fn, opts = {}) {
  renderers.set(lang, { fn, trusted: !!opts.trusted });
}

/** 렌더 결과 메모이즈 비우기 — mermaid 테마 변경 등 동일 소스의 재렌더가 필요할 때.
 *  (캐시 키는 lang+src 라 테마는 반영 안 되므로 테마 변경 시 명시 무효화) */
export function clearRenderCache() {
  renderCache.clear();
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
  const entry = renderers.get(lang);

  if (!entry) {
    renderError(el, lang, `미지원 다이어그램 엔진: ${lang}`, src);
    return;
  }
  const { fn, trusted } = entry;

  // 메모이즈 히트: 엔진 재호출 없이 즉시 (로딩 표시도 생략). 캐시값은 이미 살균됨.
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
      // 신뢰않는 엔진(d2/plantuml)의 문자열 SVG 는 주입 전 살균(XSS 방어).
      // 신뢰 엔진(mermaid strict)은 자체 살균 보장 + foreignObject 라벨 보존 위해 면제.
      const safe = trusted ? result : sanitizeDiagramSvg(result);
      el.innerHTML = safe;
      renderCache.set(cacheKey, safe);
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
