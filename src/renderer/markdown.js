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

/** 노트 상대 이미지 경로 → mdv-res:// URL (외부/절대/data 는 그대로) */
function toResUrl(src, noteDir) {
  if (!src) return null;
  if (/^[a-z][a-z0-9+.\-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) {
    return null; // 이미 스킴 있음(http/data/mdv-res…) 또는 프로토콜-상대/앵커
  }
  const joined = noteDir ? `${noteDir}/${src}` : src;
  const parts = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return 'mdv-res://vault/' + parts.map(encodeURIComponent).join('/');
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

// --- 다이어그램 fence 디스패처 ---
// 알려진 다이어그램 언어의 코드펜스를 placeholder <div> 로 바꾼다.
// 실제 렌더(그림 치환)는 렌더 후 hydrateDiagrams() 가 비동기로 수행한다.
// 원문은 placeholder 내부 텍스트로 보존 → 렌더 실패 시 코드블록으로 폴백.
export const DIAGRAM_LANGS = new Set(['mermaid', 'd2', 'drawio', 'plantuml']);

function diagramFencePlugin(md) {
  const fallback = md.renderer.rules.fence?.bind(md.renderer.rules) ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const lang = (token.info || '').trim().split(/\s+/)[0].toLowerCase();
    if (DIAGRAM_LANGS.has(lang)) {
      // 원문은 텍스트로 (DOMPurify 가 텍스트는 유지). data-lang 으로 엔진 구분.
      const escaped = md.utils.escapeHtml(token.content);
      return `<div class="mdv-diagram" data-lang="${lang}"><code class="mdv-diagram-src">${escaped}</code></div>\n`;
    }
    return fallback(tokens, idx, options, env, self);
  };
}

// 이미지 src 가 vault 상대경로면 mdv-res:// 로 치환 (노트 위치 기준).
function imageRewritePlugin(md) {
  const defaultRender =
    md.renderer.rules.image ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src');
    const res = toResUrl(src, env && env.noteDir);
    if (res) token.attrSet('src', res);
    return defaultRender(tokens, idx, options, env, self);
  };
}

// GFM 태스크리스트 + 다단계 상태: 리스트 항목 첫 [ ]/[x]/[/]/[-] 를
// data-task(todo/done/doing/cancelled) + 스타일 마커로 치환 (읽기 전용).
const TASK_STATE = { ' ': 'todo', x: 'done', '/': 'doing', '-': 'cancelled' };
function taskListPlugin(md) {
  md.core.ruler.after('inline', 'mdv-task-list', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      if (tokens[i].type !== 'inline') continue;
      if (tokens[i - 1].type !== 'paragraph_open') continue;
      if (tokens[i - 2].type !== 'list_item_open') continue;
      const inline = tokens[i];
      const m = /^\[([ xX/\-])\]\s+/.exec(inline.content);
      if (!m) continue;
      const stateName = TASK_STATE[m[1].toLowerCase()];

      tokens[i - 2].attrJoin('class', 'task-list-item');
      tokens[i - 2].attrSet('data-task', stateName);
      inline.content = inline.content.slice(m[0].length);
      const children = inline.children || [];
      if (children[0] && children[0].type === 'text') {
        children[0].content = children[0].content.replace(/^\[([ xX/\-])\]\s+/, '');
      }
      const marker = new state.Token('html_inline', '', 0);
      marker.content = `<span class="task-marker"></span> `;
      children.unshift(marker);
    }
  });
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
})
  .use(wikilinkPlugin)
  .use(diagramFencePlugin)
  .use(imageRewritePlugin)
  .use(taskListPlugin);

const PURIFY_OPTS = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: ['use'],
  ADD_ATTR: ['target', 'data-target', 'data-raw', 'type', 'checked', 'disabled'],
  // 기본 안전 스킴 + 커스텀 mdv-res (vault 이미지) 허용
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel|callto|cid|xmpp|data|mdv-res):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

/** @param env { resolveWikiLink?: (target)=>relPath|null } */
export function renderMarkdown(src, env = {}) {
  const rawHtml = md.render(src ?? '', env);
  return DOMPurify.sanitize(rawHtml, PURIFY_OPTS);
}
