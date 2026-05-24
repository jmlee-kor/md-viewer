// Marp 슬라이드 렌더. frontmatter `marp: true` 노트를 슬라이드 덱으로.
import { Marp } from '../../vendor/marp.js';
import DOMPurify from '../../vendor/dompurify.js';

let marp = null;
function getMarp() {
  // inlineSVG:false → 슬라이드가 <svg><foreignObject> 없이 평범한 <section> 으로 출력.
  // (SVG 래핑 시 DOMPurify 가 네임스페이스 때문에 내부 HTML 을 제거함)
  if (!marp) marp = new Marp({ inlineSVG: false });
  return marp;
}

/** 노트 frontmatter 에 marp: true 가 있는지 (간이 검사) */
export function hasMarpFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src || '');
  if (!m) return false;
  return /^\s*marp\s*:\s*true\s*$/m.test(m[1]);
}

/** marp 원문 → { html, css }. html 살균: marp 인라인 script + javascript: 링크 등 제거.
 *  주의: USE_PROFILES 로 SVG 만 제한하면 foreignObject 안의 HTML(section)이 사라진다.
 *  기본 DOMPurify(html+svg+mathml 통합)로 두어야 svg>foreignObject>section 구조가 보존된다. */
export function renderMarp(src) {
  const { html, css } = getMarp().render(src || '');
  const safeHtml = DOMPurify.sanitize(html, {
    ADD_TAGS: ['foreignobject', 'use'],
    ADD_ATTR: ['data-marpit-svg', 'viewBox', 'preserveAspectRatio'],
  });
  return { html: safeHtml, css };
}
