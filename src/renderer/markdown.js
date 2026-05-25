// Markdown 렌더 파이프라인: markdown-it (+위키링크 룰) → DOMPurify 새니타이즈.
// 후속: 다이어그램 fence 디스패처가 여기에 붙는다.

import MarkdownIt from '../../vendor/markdown-it.js';
import DOMPurify from '../../vendor/dompurify.js';
import hljs from '../../vendor/highlight.js';
import katex from '../../vendor/katex.js';

// 코드블록 syntax highlight. lang 인식되면 hljs 토큰 span, 아니면 기본 이스케이프.
// 다이어그램 fence 는 diagramFencePlugin 이 먼저 가로채므로 여기 안 옴.
function highlightCode(str, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try {
      const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`;
    } catch {
      /* fall through */
    }
  }
  return ''; // markdown-it 기본 이스케이프 fence
}

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
export function toResUrl(src, noteDir) {
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

      if (embed) {
        // ![[...]] 임베드: placeholder 로 두고 렌더러(hydrateEmbeds)가 비동기로
        // 이미지(<img>) 또는 노트 transclusion 으로 치환. 미하이드레이트/실패 시 폴백 텍스트.
        const eo = state.push('mdv_embed_open', 'span', 1);
        eo.attrSet('class', 'mdv-embed');
        eo.attrSet('data-raw', target);
        if (heading) eo.attrSet('data-heading', heading);
        const et = state.push('text', '', 0);
        et.content = `📎 ${alias || target}${!alias && heading ? ' › ' + heading : ''}`;
        state.push('mdv_embed_close', 'span', -1);
        state.pos = end + 2;
        return true;
      }

      const resolver = state.env && state.env.resolveWikiLink;
      const dest = resolver ? resolver(target) : null;
      let display = alias || target;
      if (!alias && heading) display = `${target} › ${heading}`;

      const open = state.push('link_open', 'a', 1);
      open.attrSet('class', dest ? 'wikilink' : 'wikilink broken');
      open.attrSet('data-target', dest || '');
      open.attrSet('data-raw', target);
      if (heading) open.attrSet('data-heading', heading); // [[note#heading]] 앵커 스크롤용
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

// Obsidian 콜아웃: `> [!type] 제목` blockquote → 스타일 박스(div.mdv-callout).
// 첫 줄이 [!type] 마커면 blockquote 를 콜아웃으로 변환, 제목 삽입 + 본문 재파싱.
const CALLOUT_RE = /^\[!(\w+)\][+-]?\s*(.*)$/;
function calloutPlugin(md) {
  md.core.ruler.after('block', 'mdv_callout', (state) => {
    const t = state.tokens;
    for (let i = 0; i < t.length; i++) {
      if (t[i].type !== 'blockquote_open') continue;
      const para = t[i + 1];
      const inl = t[i + 2];
      if (!para || para.type !== 'paragraph_open' || !inl || inl.type !== 'inline') continue;
      const nl = inl.content.indexOf('\n');
      const firstLine = (nl >= 0 ? inl.content.slice(0, nl) : inl.content).trim();
      const m = CALLOUT_RE.exec(firstLine);
      if (!m) continue;
      const type = m[1].toLowerCase();
      const titleText = m[2].trim() || type.charAt(0).toUpperCase() + type.slice(1);
      // blockquote_open/close → div.mdv-callout
      t[i].tag = 'div';
      t[i].attrSet('class', `mdv-callout mdv-callout-${type}`);
      t[i].attrSet('data-callout', type);
      let depth = 0;
      for (let j = i; j < t.length; j++) {
        if (t[j].type === 'blockquote_open') depth++;
        else if (t[j].type === 'blockquote_close') {
          depth--;
          if (depth === 0) {
            t[j].tag = 'div';
            break;
          }
        }
      }
      // 본문에서 마커 줄만 제거. content 만 갱신 → core 'inline' 룰(이 plugin 이후
      // 실행)이 파싱한다. (여기서 수동 파싱하면 inline 룰이 또 파싱해 children 중복)
      inl.content = nl >= 0 ? inl.content.slice(nl + 1) : '';
      // 제목 토큰 삽입 (blockquote_open 다음)
      const titleTok = new state.Token('html_block', '', 0);
      titleTok.content = `<div class="mdv-callout-title">${md.utils.escapeHtml(titleText)}</div>\n`;
      t.splice(i + 1, 0, titleTok);
    }
  });
}

// #tag → 클릭 가능한 칩 <a class="mdv-tag" data-tag="..">. 앞이 공백/구두점/줄머리일 때만.
function tagPlugin(md) {
  md.inline.ruler.after('emphasis', 'mdv_tag', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x23 /* # */) return false;
    if (state.pos !== 0 && !/[\s([]/.test(state.src[state.pos - 1])) return false;
    const m = /^#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/u.exec(state.src.slice(state.pos, state.posMax));
    if (!m) return false;
    if (!silent) {
      const open = state.push('link_open', 'a', 1);
      open.attrSet('class', 'mdv-tag');
      open.attrSet('data-tag', m[1].toLowerCase());
      const txt = state.push('text', '', 0);
      txt.content = '#' + m[1];
      state.push('link_close', 'a', -1);
    }
    state.pos += m[0].length;
    return true;
  });
}

// 수식: 인라인 $...$ + 블록 $$...$$ → KaTeX. renderToString 동기 → 즉시 HTML.
function katexRender(tex, display) {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: display });
  } catch (e) {
    return `<code class="mdv-math-error" title="${md.utils.escapeHtml((e && e.message) || '')}">${md.utils.escapeHtml(tex)}</code>`;
  }
}
function mathPlugin(md) {
  // 인라인 $...$ (escape 룰 다음). 빈/공백시작 제외, \$ 이스케이프 존중.
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false;
    const start = state.pos + 1;
    if (state.src.charCodeAt(start) === 0x24) return false; // $$ → 블록
    let end = -1;
    for (let i = start; i < state.posMax; i++) {
      const c = state.src.charCodeAt(i);
      if (c === 0x5c /* \ */) { i++; continue; }
      if (c === 0x24) { end = i; break; }
    }
    if (end < 0) return false;
    const content = state.src.slice(start, end);
    if (!content.trim()) return false;
    if (!silent) {
      const tok = state.push('math_inline', '', 0);
      tok.content = content;
    }
    state.pos = end + 1;
    return true;
  });
  // 블록 $$...$$ (한 줄 또는 여러 줄)
  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const begin = state.bMarks[startLine] + state.tShift[startLine];
    if (state.src.slice(begin, begin + 2) !== '$$') return false;
    const startText = state.src.slice(begin, state.eMarks[startLine]).trim();
    let endLineIdx = -1;
    if (startText.length > 2 && startText.endsWith('$$')) {
      endLineIdx = startLine; // 한 줄 $$..$$
    } else {
      for (let l = startLine + 1; l < endLine; l++) {
        const t = state.src.slice(state.bMarks[l] + state.tShift[l], state.eMarks[l]).trim();
        if (t.endsWith('$$')) { endLineIdx = l; break; }
      }
    }
    if (endLineIdx < 0) return false;
    if (silent) return true;
    const raw = state.getLines(startLine, endLineIdx + 1, 0, false);
    const tok = state.push('math_block', '', 0);
    tok.block = true;
    tok.content = raw.replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, '');
    tok.map = [startLine, endLineIdx + 1];
    state.line = endLineIdx + 1;
    return true;
  });
  md.renderer.rules.math_inline = (tokens, idx) => katexRender(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="mdv-math-block">${katexRender(tokens[idx].content, true)}</div>\n`;
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
  highlight: highlightCode,
})
  .use(wikilinkPlugin)
  .use(diagramFencePlugin)
  .use(calloutPlugin)
  .use(mathPlugin)
  .use(tagPlugin)
  .use(imageRewritePlugin)
  .use(taskListPlugin);

const PURIFY_OPTS = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: ['use'],
  ADD_ATTR: ['target', 'data-target', 'data-raw', 'data-heading', 'data-callout', 'data-tag', 'type', 'checked', 'disabled'],
  // 기본 안전 스킴 + 커스텀 mdv-res (vault 이미지) 허용
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel|callto|cid|xmpp|data|mdv-res):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

/** @param env { resolveWikiLink?: (target)=>relPath|null } */
export function renderMarkdown(src, env = {}) {
  const rawHtml = md.render(src ?? '', env);
  return DOMPurify.sanitize(rawHtml, PURIFY_OPTS);
}
