// Markdown 렌더 파이프라인: markdown-it → DOMPurify 살균.
// 후속 단계에서 위키링크 룰 / 다이어그램 fence 디스패처가 여기에 붙는다.

import MarkdownIt from '../../vendor/markdown-it.js';
import DOMPurify from '../../vendor/dompurify.js';

const md = new MarkdownIt({
  html: true, // 노트 안의 인라인 HTML 허용 (살균은 DOMPurify 가 담당)
  linkify: true,
  typographer: true,
  breaks: false,
});

// 임의 .md 를 렌더하므로 살균은 필수. svg/mathml 까지 허용(다이어그램 대비).
const PURIFY_OPTS = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: ['use'],
  ADD_ATTR: ['target'],
};

export function renderMarkdown(src) {
  const rawHtml = md.render(src ?? '');
  return DOMPurify.sanitize(rawHtml, PURIFY_OPTS);
}
