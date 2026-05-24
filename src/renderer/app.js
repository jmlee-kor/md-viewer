// 앱 셸: 툴바(vault 열기) + 사이드바(트리) + 노트 뷰 + 백링크 패널.
// 위키링크 클릭 이동 + 파일 변경 라이브 갱신.

import { LitElement, html, css, unsafeHTML } from '../../vendor/lit.js';
import './tree.js';
import { renderMarkdown, makeResolver } from './markdown.js';
import { hydrateDiagrams } from './diagrams/index.js';
import { hasMarpFrontmatter, renderMarp } from './marp.js';
import { getSetting, setSetting } from './settings.js';
import './deck.js';

const MERMAID_THEMES = ['dark', 'default', 'neutral', 'forest'];

class MdvApp extends LitElement {
  static properties = {
    _root: { state: true },
    _tree: { state: true },
    _index: { state: true },
    _selected: { state: true },
    _noteHtml: { state: true },
    _backlinks: { state: true },
    _error: { state: true },
    _marpSrc: { state: true },
    _marpAsPlain: { state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      color: var(--fg, #d4d4d4);
    }
    .toolbar {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.4rem 0.75rem;
      border-bottom: 1px solid #333;
      background: #252526;
    }
    button[data-open] {
      background: var(--accent, #569cd6);
      color: #fff;
      border: 0;
      padding: 5px 12px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    button[data-open]:hover {
      filter: brightness(1.1);
    }
    .spacer {
      flex: 1;
    }
    .tbtn,
    .toolbar select {
      background: #3a3d41;
      color: var(--fg, #d4d4d4);
      border: 1px solid #4a4d51;
      padding: 4px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .tbtn:hover {
      background: #45494e;
    }
    .toolbar label {
      color: var(--muted, #9aa0a6);
      font-size: 0.78rem;
    }
    .vault-path {
      color: var(--muted, #9aa0a6);
      font-size: 0.8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .body {
      flex: 1 1 auto;
      min-height: 0;
      display: grid;
      grid-template-columns: 280px 1fr;
      grid-template-rows: 100%;
      overflow: hidden;
    }
    .sidebar {
      overflow: auto;
      min-height: 0;
      min-width: 0;
      padding: 0.6rem;
      border-right: 1px solid #333;
      background: #1e1e1e;
    }
    .content {
      overflow: auto;
      min-height: 0;
      min-width: 0;
    }
    .note {
      padding: 1.5rem 2.5rem;
      max-width: 60rem;
    }
    .empty {
      color: var(--muted, #9aa0a6);
      padding: 2rem;
    }
    .error {
      color: #f44747;
      padding: 1rem 2.5rem;
    }
    /* 백링크 패널 */
    .backlinks {
      margin: 0 2.5rem 2rem;
      max-width: 60rem;
      border-top: 1px solid #333;
      padding-top: 1rem;
    }
    .backlinks h3 {
      font-size: 0.85rem;
      color: var(--muted, #9aa0a6);
      margin: 0 0 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .backlinks ul {
      margin: 0;
      padding-left: 1.1rem;
    }
    .backlinks a {
      color: var(--accent, #569cd6);
      cursor: pointer;
    }
    .backlinks .none {
      color: var(--muted, #9aa0a6);
      font-size: 0.85rem;
    }
    /* 렌더된 노트 본문 스타일 */
    .note :first-child {
      margin-top: 0;
    }
    .note h1,
    .note h2 {
      border-bottom: 1px solid #333;
      padding-bottom: 0.2em;
    }
    /* 헤딩 접기/펼치기 */
    .note .mdv-h {
      cursor: pointer;
      position: relative;
    }
    .note .mdv-h::before {
      content: '▾';
      position: absolute;
      left: -1em;
      top: 0.15em;
      font-size: 0.7em;
      color: var(--muted, #9aa0a6);
      opacity: 0;
      transition: opacity 0.1s;
    }
    .note .mdv-h:hover::before,
    .note .mdv-h.mdv-collapsed::before {
      opacity: 1;
    }
    .note .mdv-h.mdv-collapsed::before {
      content: '▸';
    }
    .note code {
      background: #2d2d2d;
      padding: 0.15em 0.4em;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .note pre {
      background: #2d2d2d;
      padding: 0.9rem;
      border-radius: 6px;
      overflow: auto;
    }
    .note pre code {
      background: none;
      padding: 0;
    }
    .note blockquote {
      border-left: 3px solid var(--accent, #569cd6);
      margin: 0;
      padding-left: 1rem;
      color: var(--muted, #9aa0a6);
    }
    .note a {
      color: var(--accent, #569cd6);
    }
    .note table {
      border-collapse: collapse;
    }
    .note th,
    .note td {
      border: 1px solid #444;
      padding: 0.4em 0.7em;
    }
    .note img {
      max-width: 100%;
    }
    /* GFM 태스크리스트 체크박스 (읽기 전용) */
    .note li.task-list-item {
      list-style: none;
    }
    .note .task-checkbox {
      margin: 0 0.45em 0 -1.4em;
      vertical-align: middle;
      cursor: default;
    }
    .note li.task-done {
      color: var(--muted, #9aa0a6);
      text-decoration: line-through;
    }
    /* 다이어그램 */
    .note .mdv-diagram {
      margin: 1rem 0;
      text-align: center;
    }
    .note .mdv-diagram svg {
      max-width: 100%;
      height: auto;
    }
    .note .mdv-diagram-error {
      text-align: left;
    }
    .note .mdv-diagram-msg {
      color: #f0a000;
      font-size: 0.85rem;
      margin-bottom: 0.4rem;
    }
    /* 위키링크 */
    .note a.wikilink {
      text-decoration: none;
      border-bottom: 1px dashed var(--accent, #569cd6);
    }
    .note a.wikilink.broken {
      color: #c97b7b;
      border-bottom-color: #c97b7b;
      cursor: help;
    }
  `;

  constructor() {
    super();
    this._tree = [];
    this._root = null;
    this._index = null;
    this._selected = null;
    this._noteHtml = '';
    this._backlinks = [];
    this._error = null;
    this._resolver = makeResolver(null);
    this.addEventListener('mdv-select', (e) => this._onSelect(e.detail.relPath));
  }

  connectedCallback() {
    super.connectedCallback();
    // 파일 변경 라이브 갱신
    this._unsub = window.mdv.onVaultChanged((data) => this._applyVault(data, true));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
  }

  _applyVault(data, keepSelection) {
    this._root = data.root;
    this._tree = data.tree;
    this._index = data.index;
    this._resolver = makeResolver(data.index?.resolve);
    if (keepSelection && this._selected) {
      this._onSelect(this._selected); // 현재 노트 재렌더 (내용 변경 반영)
    } else {
      this._selected = null;
      this._noteHtml = '';
      this._backlinks = [];
    }
  }

  async _openVault() {
    this._error = null;
    try {
      const res = await window.mdv.openVault();
      if (!res) return;
      this._applyVault(res, false);
    } catch (err) {
      this._error = String(err);
    }
  }

  async _onSelect(relPath) {
    this._selected = relPath;
    this._error = null;
    try {
      const src = await window.mdv.readNote(relPath);
      this._src = src;
      this._curDir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
      if (hasMarpFrontmatter(src)) {
        // 슬라이드 모드: 일반 노트 뷰 대신 덱으로 (문서 토글 가능)
        this._marpSrc = src;
        this._marpAsPlain = false;
        this._noteHtml = '';
        this._backlinks = [];
      } else {
        this._marpSrc = null;
        this._backlinks = (this._index?.backlinks?.[relPath]) || [];
        this._renderNoteHtml();
      }
    } catch (err) {
      this._error = String(err);
      this._noteHtml = '';
      this._marpSrc = null;
      this._backlinks = [];
    }
  }

  updated(changed) {
    // 노트 HTML 이 새로 그려진 뒤 다이어그램 렌더 + 헤딩 접기 설정.
    if (changed.has('_noteHtml') && this._noteHtml) {
      const note = this.renderRoot.querySelector('.note');
      if (note) {
        hydrateDiagrams(note);
        this._setupHeadingFold(note);
      }
    }
  }

  /** 노트 최상위 헤딩을 클릭 가능하게 만들어 섹션 접기/펼치기 */
  _setupHeadingFold(noteEl) {
    const headings = Array.from(noteEl.children).filter((el) => /^H[1-6]$/.test(el.tagName));
    for (const h of headings) {
      h.classList.add('mdv-h');
      h.addEventListener('click', (e) => {
        if (e.target.closest('a')) return; // 헤딩 내 링크 클릭은 제외
        this._toggleHeading(h);
      });
    }
  }

  _toggleHeading(h) {
    const level = Number(h.tagName[1]);
    const collapsed = h.classList.toggle('mdv-collapsed');
    let el = h.nextElementSibling;
    while (el && !(/^H[1-6]$/.test(el.tagName) && Number(el.tagName[1]) <= level)) {
      el.style.display = collapsed ? 'none' : '';
      el = el.nextElementSibling;
    }
  }

  _onNoteClick(e) {
    const a = e.target.closest?.('a.wikilink');
    if (!a) return;
    e.preventDefault();
    const target = a.getAttribute('data-target');
    if (target) this._onSelect(target); // 해결된 링크만 이동
  }

  /** 현재 상태(일반 노트 / marp 평문)에 맞춰 _noteHtml 재계산. 덱 모드면 비움. */
  _renderNoteHtml() {
    const showNote = (this._selected && !this._marpSrc) || (this._marpSrc && this._marpAsPlain);
    if (!showNote || !this._src) {
      this._noteHtml = '';
      return;
    }
    // marp 평문 뷰면 frontmatter 제거
    const body = this._marpSrc
      ? this._src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      : this._src;
    this._noteHtml = renderMarkdown(body, {
      resolveWikiLink: this._resolver,
      noteDir: this._curDir || '',
    });
  }

  /** marp 노트: 슬라이드 덱 ↔ 일반 마크다운 뷰 전환 */
  _toggleMarpView() {
    this._marpAsPlain = !this._marpAsPlain;
    this._renderNoteHtml();
  }

  /** mermaid 테마 변경 → 설정 저장 + 보이는 노트 다이어그램 재렌더(강제 rebuild) */
  _onMermaidTheme(e) {
    setSetting('mermaidTheme', e.target.value);
    if (!this._noteHtml) return;
    const html = this._noteHtml;
    this._noteHtml = ''; // 1차: 비우기
    this.updateComplete.then(() => {
      this._noteHtml = html; // 2차: 같은 placeholder HTML 재설정 → fresh hydrate (새 테마)
    });
  }

  _titleOf(relPath) {
    return this._index?.titles?.[relPath] || relPath.replace(/\.md$/i, '');
  }

  render() {
    return html`
      <div class="toolbar">
        <button data-open @click=${this._openVault}>Vault 열기</button>
        <span class="vault-path">${this._root ?? '폴더를 선택하세요'}</span>
        <span class="spacer"></span>
        ${this._marpSrc
          ? html`<button class="tbtn" @click=${this._toggleMarpView}>
              ${this._marpAsPlain ? '◫ 슬라이드로' : '▤ 문서로'}
            </button>`
          : ''}
        <label
          >mermaid
          <select @change=${this._onMermaidTheme}>
            ${MERMAID_THEMES.map(
              (t) =>
                html`<option value=${t} ?selected=${getSetting('mermaidTheme', 'dark') === t}>
                  ${t}
                </option>`
            )}
          </select>
        </label>
      </div>
      <div class="body">
        <aside class="sidebar">
          ${this._tree.length
            ? html`<mdv-tree .nodes=${this._tree} .selected=${this._selected}></mdv-tree>`
            : html`<div class="empty">vault 없음</div>`}
        </aside>
        <div class="content">
          ${this._error
            ? html`<div class="error">${this._error}</div>`
            : this._marpSrc
              ? this._marpAsPlain
                ? html`<article class="note" @click=${this._onNoteClick}>
                    ${unsafeHTML(this._noteHtml)}
                  </article>`
                : html`<mdv-deck .src=${this._marpSrc}></mdv-deck>`
              : this._selected
                ? html`
                    <article class="note" @click=${this._onNoteClick}>
                      ${unsafeHTML(this._noteHtml)}
                    </article>
                    ${this._renderBacklinks()}
                  `
                : html`<div class="empty">노트를 선택하세요</div>`}
        </div>
      </div>
    `;
  }

  _renderBacklinks() {
    return html`
      <section class="backlinks">
        <h3>백링크 (${this._backlinks.length})</h3>
        ${this._backlinks.length
          ? html`<ul>
              ${this._backlinks.map(
                (b) => html`<li>
                  <a @click=${() => this._onSelect(b.from)}>${this._titleOf(b.from)}</a>
                  ${b.alias ? html`<span class="none"> — "${b.alias}"</span>` : ''}
                </li>`
              )}
            </ul>`
          : html`<div class="none">이 노트를 참조하는 노트가 없습니다.</div>`}
      </section>
    `;
  }
}

customElements.define('mdv-app', MdvApp);

// 헤드리스 스모크/디버그용 훅
window.__mdvTest = { renderMarkdown, makeResolver, hydrateDiagrams, hasMarpFrontmatter, renderMarp };
