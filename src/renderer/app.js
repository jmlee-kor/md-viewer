// 앱 셸: 툴바(vault 열기) + 사이드바(트리) + 노트 뷰.
// 렌더러 진입점이자 <mdv-app> 정의.

import { LitElement, html, css, unsafeHTML } from '../../vendor/lit.js';
import './tree.js';
import { renderMarkdown } from './markdown.js';

class MdvApp extends LitElement {
  static properties = {
    _root: { state: true },
    _tree: { state: true },
    _selected: { state: true },
    _noteHtml: { state: true },
    _error: { state: true },
  };

  static styles = css`
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100%;
      color: var(--fg, #d4d4d4);
    }
    .toolbar {
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
    .vault-path {
      color: var(--muted, #9aa0a6);
      font-size: 0.8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .body {
      display: grid;
      grid-template-columns: 280px 1fr;
      min-height: 0;
    }
    .sidebar {
      overflow: auto;
      padding: 0.6rem;
      border-right: 1px solid #333;
      background: #1e1e1e;
    }
    .note {
      overflow: auto;
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
    /* 렌더된 노트 본문 스타일 (shadow DOM 안이라 여기서 정의) */
    .note :first-child {
      margin-top: 0;
    }
    .note h1,
    .note h2 {
      border-bottom: 1px solid #333;
      padding-bottom: 0.2em;
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
  `;

  constructor() {
    super();
    this._tree = [];
    this._root = null;
    this._selected = null;
    this._noteHtml = '';
    this._error = null;
    this.addEventListener('mdv-select', (e) => this._onSelect(e.detail.relPath));
  }

  async _openVault() {
    this._error = null;
    try {
      const res = await window.mdv.openVault();
      if (!res) return; // 취소
      this._root = res.root;
      this._tree = res.tree;
      this._selected = null;
      this._noteHtml = '';
    } catch (err) {
      this._error = String(err);
    }
  }

  async _onSelect(relPath) {
    this._selected = relPath;
    this._error = null;
    try {
      const src = await window.mdv.readNote(relPath);
      this._noteHtml = renderMarkdown(src);
    } catch (err) {
      this._error = String(err);
      this._noteHtml = '';
    }
  }

  render() {
    return html`
      <div class="toolbar">
        <button data-open @click=${this._openVault}>Vault 열기</button>
        <span class="vault-path">${this._root ?? '폴더를 선택하세요'}</span>
      </div>
      <div class="body">
        <aside class="sidebar">
          ${this._tree.length
            ? html`<mdv-tree .nodes=${this._tree} .selected=${this._selected}></mdv-tree>`
            : html`<div class="empty">vault 없음</div>`}
        </aside>
        <main>
          ${this._error
            ? html`<div class="error">${this._error}</div>`
            : this._noteHtml
              ? html`<article class="note">${unsafeHTML(this._noteHtml)}</article>`
              : html`<div class="empty">노트를 선택하세요</div>`}
        </main>
      </div>
    `;
  }
}

customElements.define('mdv-app', MdvApp);

// 헤드리스 스모크/디버그용 훅 (GUI 다이얼로그 없이 렌더 파이프라인 검증)
window.__mdvTest = { renderMarkdown };
