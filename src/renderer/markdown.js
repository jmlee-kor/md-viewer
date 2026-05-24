// Markdown 렌더 파이프라인: markdown-it (+위키링크 룰) → DOMPurify 살균.
// 후속: 다이어그램 fence 디스패처가 여기에 붙는다.

import MarkdownIt from '../../vendor/markdown-it.js';
import DOMPurify from '../../vendor/dompurify.js';

// --- 위키링크 해석 유틸 (main 의 link-index.js 와 동일 규칙) ---

function normKey(raw) {
  return String(raw)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
}

function parseWikiTarget(inner) {
  let s = inner;
  let alias = null;
  let heading = null;
  const pipe = s.indexOf('|');
  if (pipe >= 0) {
    alias = s.slice(pipe + 1).trim();
    s = s.slice(0, pipe);
  }
  const hash = s.indexOf('#');
  if (hash >= 0) {
    heading = s.slice(hash + 1).trim();
    s = s.slice(0, hash);
  }
  return { target: s.trim(), heading, alias };
}

/** resolve 맵 → (rawTarget) => relPath | null */
export function makeResolver(resolveMap) {
  return (rawTarget) => {
    if (!resolveMap) return null;
    const key = normKey(rawTarget);
    if (resolveMap[key]) return resolveMap[key];
    const base = key.split('/').pop();
    return resolveMap[base] || null;
  };
}

// --- markdown-it 위키링크 인라인 룰 ---
// [[Note]], [[Note|alias]], [[Note#heading]], ![[embed]] 를 <a class="wikilink"> 로.
// 해석기는 state.env.resolveWikiLink 로 주입 (없으면 미해결 처리).
function wikilinkPlugin(md) {
  // 'image' 보다 앞: ![[embed]] 를 이미지 룰보다 먼저 가로챈다.
  md.inline.ruler.before('image', 'wikilink', (state, silent) => {
    const src = state.src;
    let pos = state.pos;
    let embed = false;

    if (src.charCodeAt(pos) === 0x21 /* ! */ && src.charCodeAt(pos + 1) === 0x5b && src.charCodeAt(pos + 2) === 0x5b) {
      embed = true;
      pos += 1;
    } else if (!(src.charCodeAt(pos) === 0x5b /* [ */ && src.charCodeAt(pos + 1) === 0x5b)) {
      return false;
    }

    const end = src.indexOf(']]', pos + 2);
    if (end < 0) return false;
    const inner = src.slice(pos + 2, end);
    if (!inner.trim()) return false;

    if (!silent) {
      const { target, heading, alias } = parseWikiTarget(inner);
      const resolver = state.env && state.env.resolveWikiLink;
      const dest = resolver ? resolver(target) : null;
      let display = alias || target;
      if (!alias && heading) display = `${target} › ${heading}`;
      if (embed) display = `📎 ${display}`;

      const open = state.push('link_open', 'a', 1);
      open.attrSet('class', dest ? 'wikilink' : 'wikilink broken');
      open.attrSet('data-target', dest || '');
      open.attrSet('data-raw', target);
      open.attrSet('title', dest || `미해결: ${target}`);

      const txt = state.push('text', '', 0);
      txt.content = display;

      state.push('link_close', 'a', -1);
    }

    state.pos = end + 2;
    return true;
  });
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
}).use(wikilinkPlugin);

const PURIFY_OPTS = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: ['use'],
  ADD_ATTR: ['target', 'data-target', 'data-raw'],
};

/** @param env { resolveWikiLink?: (target)=>relPath|null } */
export function renderMarkdown(src, env = {}) {
  const rawHtml = md.render(src ?? '', env);
  return DOMPurify.sanitize(rawHtml, PURIFY_OPTS);
}
