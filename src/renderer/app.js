// 앱 셸: 툴바(vault 열기) + 사이드바(트리) + 노트 뷰 + 백링크 패널.
// 위키링크 클릭 이동 + 파일 변경 라이브 갱신.

import { LitElement, html, css, unsafeHTML } from '../../vendor/lit.js';
import './tree.js';
import { renderMarkdown, makeResolver } from './markdown.js';
import { hydrateDiagrams, registerDiagram } from './diagrams/index.js';
import { hasMarpFrontmatter, renderMarp } from './marp.js';
import { getSetting, setSetting } from './settings.js';
import { scrollbarCss } from './scrollbar-css.js';
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
    _menuOpen: { state: true },
    _rawView: { state: true },
    _recent: { state: true },
    _maximized: { state: true },
    _searchQuery: { state: true },
    _searchResults: { state: true },
  };

  static styles = [
    scrollbarCss,
    css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      position: relative;
      color: var(--fg, #d4d4d4);
    }
    /* 커스텀 타이틀바 (frameless) */
    .titlebar {
      flex: 0 0 auto;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #2d2f33;
      border-bottom: 1px solid #333;
      -webkit-app-region: drag;
      user-select: none;
    }
    .tb-title {
      padding-left: 10px;
      font-size: 0.78rem;
      color: var(--muted, #9aa0a6);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tb-controls {
      display: flex;
      height: 100%;
      -webkit-app-region: no-drag;
    }
    .tb-btn {
      width: 42px;
      height: 100%;
      border: 0;
      background: transparent;
      color: var(--fg, #d4d4d4);
      cursor: pointer;
      font-size: 0.85rem;
    }
    .tb-btn:hover {
      background: #3a3d41;
    }
    .tb-close:hover {
      background: #c4302b;
      color: #fff;
    }
    /* 좌하단 플로팅 메뉴 */
    .menu {
      position: absolute;
      left: 14px;
      bottom: 14px;
      z-index: 20;
    }
    .menu-toggle {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--accent, #569cd6);
      color: #fff;
      border: 0;
      cursor: pointer;
      font-size: 1.25rem;
      line-height: 1;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      transition: filter 0.15s, transform 0.15s;
    }
    .menu-toggle:hover {
      filter: brightness(1.1);
    }
    .menu.open .menu-toggle {
      transform: rotate(90deg);
    }
    .menu-panel {
      position: absolute;
      left: 0;
      bottom: 54px;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      min-width: 230px;
      max-width: 320px;
      padding: 0.8rem;
      background: #252526;
      border: 1px solid #3a3d41;
      border-radius: 10px;
      box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
      opacity: 0;
      transform: translateY(12px) scale(0.97);
      transform-origin: bottom left;
      pointer-events: none;
      transition: opacity 0.18s ease, transform 0.18s ease;
    }
    /* 토글-패널 사이 죽은 간격을 투명 브리지로 메워 hover 연속 유지 */
    .menu-panel::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: -16px;
      height: 16px;
    }
    .menu:hover .menu-panel,
    .menu.open .menu-panel {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    button[data-open] {
      background: var(--accent, #569cd6);
      color: #fff;
      border: 0;
      padding: 7px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    button[data-open]:hover {
      filter: brightness(1.1);
    }
    .vault-path {
      color: var(--muted, #9aa0a6);
      font-size: 0.78rem;
      word-break: break-all;
    }
    .tbtn,
    .menu-panel select {
      background: #3a3d41;
      color: var(--fg, #d4d4d4);
      border: 1px solid #4a4d51;
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .tbtn:hover {
      background: #45494e;
    }
    .menu-panel label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      color: var(--muted, #9aa0a6);
      font-size: 0.78rem;
    }
    .menu-panel label.checkrow {
      justify-content: flex-start;
      cursor: pointer;
    }
    .menu-sep {
      height: 1px;
      background: #3a3d41;
      margin: 0.15rem 0;
    }
    .menu-label {
      color: var(--muted, #9aa0a6);
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .recent-h {
      color: var(--muted, #9aa0a6);
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0.2rem 0;
    }
    .recent-item {
      display: flex;
      gap: 0.3rem;
      align-items: stretch;
    }
    .recent-open {
      flex: 1 1 auto;
      text-align: left;
      background: #2d2f33;
      color: var(--fg, #d4d4d4);
      border: 1px solid #3a3d41;
      border-radius: 5px;
      padding: 4px 8px;
      font-size: 0.8rem;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .recent-open:hover {
      background: #34373c;
    }
    .recent-rm {
      flex: 0 0 auto;
      background: transparent;
      color: var(--muted, #9aa0a6);
      border: 1px solid #3a3d41;
      border-radius: 5px;
      cursor: pointer;
      padding: 0 8px;
    }
    .recent-rm:hover {
      background: #a33636;
      color: #fff;
      border-color: #a33636;
    }
    .menu-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .iconbtn {
      flex: 1 1 auto;
      min-width: 34px;
      background: #3a3d41;
      color: var(--fg, #d4d4d4);
      border: 1px solid #4a4d51;
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 0.8rem;
      cursor: pointer;
    }
    .iconbtn:hover {
      background: #45494e;
    }
    .iconbtn.danger:hover {
      background: #a33636;
      border-color: #a33636;
      color: #fff;
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
      /* 하단 padding 으로 좌하단 플로팅 ☰ 버튼에 마지막 트리 항목이 가리지 않게 */
      padding: 0.6rem 0.6rem 64px;
      border-right: 1px solid #333;
      background: #1e1e1e;
    }
    .content {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
    }
    .view-scroll {
      flex: 1 1 auto;
      overflow: auto;
      min-height: 0;
    }
    /* 콘텐츠 상단 토글 바 */
    .view-bar {
      flex: 0 0 auto;
      display: flex;
      gap: 0.75rem;
      align-items: center;
      padding: 0.35rem 0.75rem;
      border-bottom: 1px solid #333;
      background: #232323;
    }
    .tabs {
      display: inline-flex;
      border: 1px solid #3a3d41;
      border-radius: 6px;
      overflow: hidden;
    }
    .tab {
      background: #2a2c2f;
      color: var(--muted, #9aa0a6);
      border: 0;
      padding: 3px 0;
      min-width: 36px;
      text-align: center;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .tab:hover {
      color: var(--fg, #d4d4d4);
    }
    .tab.active {
      background: var(--accent, #569cd6);
      color: #fff;
    }
    .note {
      padding: 1.5rem 2.5rem;
      max-width: 60rem;
    }
    /* 본문 내 검색 매치 하이라이트 (브라우저 기본 노랑 대신 accent 톤) */
    .note mark,
    .note mark.search-hit {
      background: rgba(86, 156, 214, 0.35);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
    .empty {
      color: var(--muted, #9aa0a6);
      padding: 2rem;
    }
    /* 사이드바 전문 검색 */
    .search {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      gap: 4px;
      align-items: center;
      background: #1e1e1e;
      padding-bottom: 0.5rem;
      margin-bottom: 0.3rem;
    }
    .search input {
      flex: 1 1 auto;
      min-width: 0;
      background: #2a2c2f;
      color: var(--fg, #d4d4d4);
      border: 1px solid #3a3d41;
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 0.85rem;
    }
    .search input:focus {
      outline: none;
      border-color: var(--accent, #569cd6);
    }
    .search-clear {
      background: none;
      border: 0;
      color: var(--muted, #9aa0a6);
      cursor: pointer;
      font-size: 0.9rem;
      padding: 2px 4px;
    }
    .search-clear:hover {
      color: var(--fg, #d4d4d4);
    }
    .sr-count {
      font-size: 0.72rem;
      color: var(--muted, #9aa0a6);
      padding: 0 0.3rem 0.3rem;
    }
    .search-results {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .sr-item {
      cursor: pointer;
      padding: 0.4rem 0.5rem;
      border-radius: 6px;
    }
    .sr-item:hover {
      background: #2a2c2f;
    }
    .sr-item.active {
      background: #2d3a4a;
    }
    .sr-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--fg, #d4d4d4);
    }
    .sr-path {
      font-size: 0.72rem;
      color: var(--muted, #9aa0a6);
      margin-bottom: 2px;
    }
    .sr-snip {
      font-size: 0.75rem;
      color: #b8bcc0;
      line-height: 1.5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sr-snip mark {
      background: rgba(86, 156, 214, 0.35);
      color: inherit;
      border-radius: 2px;
    }
    .sr-empty {
      color: var(--muted, #9aa0a6);
      font-size: 0.82rem;
      padding: 0.5rem;
    }
    .error {
      color: #f44747;
      padding: 1rem 2.5rem;
    }
    /* 원본(raw) 보기 */
    .raw {
      margin: 0;
      padding: 1rem 1.5rem;
      font-family: "Consolas", "D2Coding", monospace;
      font-size: 0.85rem;
      line-height: 1.6;
    }
    .raw-line {
      display: flex;
    }
    .raw .ln {
      flex: 0 0 3em;
      text-align: right;
      padding-right: 1em;
      color: var(--muted, #9aa0a6);
      user-select: none;
    }
    .raw code {
      white-space: pre-wrap;
      word-break: break-word;
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
    /* GFM 태스크리스트 다단계 상태 (읽기 전용, data-task: todo/done/doing/cancelled) */
    .note li.task-list-item {
      list-style: none;
    }
    .note .task-marker {
      display: inline-block;
      width: 1em;
      height: 1em;
      box-sizing: border-box;
      border: 1.5px solid var(--muted, #9aa0a6);
      border-radius: 3px;
      margin: 0 0.45em 0 -1.45em;
      vertical-align: -0.12em;
      position: relative;
    }
    .note .task-marker::after {
      position: absolute;
      inset: 0;
      text-align: center;
      line-height: 0.95em;
      font-size: 0.85em;
      font-weight: bold;
    }
    .note li[data-task='done'] .task-marker {
      background: var(--accent, #569cd6);
      border-color: var(--accent, #569cd6);
    }
    .note li[data-task='done'] .task-marker::after {
      content: '✓';
      color: #fff;
    }
    .note li[data-task='done'] {
      color: var(--muted, #9aa0a6);
      text-decoration: line-through;
    }
    .note li[data-task='doing'] .task-marker {
      border-color: #d8a657;
    }
    .note li[data-task='doing'] .task-marker::after {
      content: '/';
      color: #d8a657;
    }
    .note li[data-task='cancelled'] {
      color: var(--muted, #9aa0a6);
      text-decoration: line-through;
      opacity: 0.7;
    }
    .note li[data-task='cancelled'] .task-marker::after {
      content: '✕';
      color: var(--muted, #9aa0a6);
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
    .note .mdv-diagram-loading {
      color: var(--muted, #9aa0a6);
      font-size: 0.85rem;
      padding: 1rem;
      animation: mdv-pulse 1.2s ease-in-out infinite;
    }
    @keyframes mdv-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
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
  `,
  ];

  constructor() {
    super();
    this._tree = [];
    this._root = null;
    this._index = null;
    this._selected = null;
    this._noteHtml = '';
    this._backlinks = [];
    this._error = null;
    this._recent = getSetting('recentVaults', []);
    this._searchQuery = '';
    this._searchResults = [];
    this._searchTerms = [];
    this._searchTimer = null;
    this._resolver = makeResolver(null);
    this.addEventListener('mdv-select', (e) => this._onSelect(e.detail.relPath));
  }

  connectedCallback() {
    super.connectedCallback();
    // 파일 변경 라이브 갱신
    this._unsub = window.mdv.onVaultChanged((data) => this._applyVault(data, true));
    this._unsubMax = window.mdv.onMaximizeChange((isMax) => (this._maximized = isMax));
    // 다이얼로그/창 전환 등으로 포커스 잃으면 플로팅 메뉴 닫기
    this._onBlur = () => (this._menuOpen = false);
    window.addEventListener('blur', this._onBlur);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsubMax?.();
    window.removeEventListener('blur', this._onBlur);
  }

  firstUpdated() {
    // 시작 시 최근 vault 자동 로딩 (설정 on + 목록 있을 때)
    const last = this._recent[0];
    if (last && getSetting('autoOpenRecent', true)) this._autoOpen(last);
  }

  async _autoOpen(root) {
    try {
      const res = await window.mdv.openVaultPath(root);
      this._applyVault(res, false);
      this._addRecent(res.root);
    } catch {
      this._removeRecent(root); // 경로 사라짐 → 조용히 목록에서 제거 (시작 시 에러 표시 안 함)
    }
  }

  _onAutoOpenToggle(e) {
    setSetting('autoOpenRecent', e.target.checked);
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
    this._menuOpen = false;
    try {
      const res = await window.mdv.openVault();
      if (!res) return;
      this._applyVault(res, false);
      this._addRecent(res.root);
    } catch (err) {
      this._error = String(err);
    }
  }

  // --- 최근 vault 목록 (localStorage 영속) ---
  _addRecent(root) {
    this._recent = [root, ...this._recent.filter((p) => p !== root)].slice(0, 8);
    setSetting('recentVaults', this._recent);
  }

  _removeRecent(root) {
    this._recent = this._recent.filter((p) => p !== root);
    setSetting('recentVaults', this._recent);
  }

  async _openRecent(root) {
    this._error = null;
    try {
      const res = await window.mdv.openVaultPath(root);
      this._applyVault(res, false);
      this._addRecent(res.root);
      this._menuOpen = false;
    } catch (err) {
      this._error = String(err); // 경로 사라짐 등
      this._removeRecent(root);
    }
  }

  _vaultName(p) {
    return p.split(/[\\/]/).filter(Boolean).pop() || p;
  }

  /** 전문 검색 입력(디바운스) → main 에 검색 위임 → 결과 패널 갱신 */
  _onSearchInput(e) {
    const q = e.target.value;
    this._searchQuery = q;
    clearTimeout(this._searchTimer);
    if (!q.trim()) {
      this._searchResults = [];
      return;
    }
    this._searchTimer = setTimeout(async () => {
      try {
        this._searchResults = await window.mdv.searchVault(q);
      } catch {
        this._searchResults = [];
      }
    }, 150);
  }

  _clearSearch() {
    clearTimeout(this._searchTimer);
    this._searchQuery = '';
    this._searchResults = [];
  }

  /** 검색 결과에서 노트 열기 — 현재 검색어를 본문 하이라이트용으로 전달 */
  _openSearchResult(relPath) {
    const terms = this._searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    this._onSelect(relPath, terms);
  }

  async _onSelect(relPath, searchTerms = null) {
    this._selected = relPath;
    this._error = null;
    this._searchTerms = searchTerms || []; // 트리/위키링크/백링크 경로는 하이라이트 없음
    this._rawView = false; // 새 노트는 렌더 뷰 기본
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
    // 노트 article 이 (재)생성될 수 있는 변경: 새 노트(_noteHtml) / 원본↔렌더(_rawView)
    // / marp 평문↔덱(_marpAsPlain). 원본→렌더 복귀처럼 _noteHtml 문자열이 동일해도
    // article DOM 이 새로 생기므로 _rawView 변경에도 재hydrate 해야 한다.
    if (changed.has('_noteHtml') || changed.has('_rawView') || changed.has('_marpAsPlain')) {
      const note = this.renderRoot.querySelector('.note');
      if (note) {
        hydrateDiagrams(note); // placeholder dataset.hydrated 로 멱등
        this._setupHeadingFold(note); // heading dataset.mdvFold 로 멱등
        this._highlightSearch(note); // 검색어 본문 하이라이트(있으면) + 첫 매치 스크롤
      }
    }
  }

  /** 검색어를 노트 본문에서 <mark>로 하이라이트하고 첫 매치로 스크롤.
   *  Lit 이 article 재사용 + unsafeHTML 로 자식을 교체하면 마크가 사라지므로,
   *  멱등 키 가드 없이 매 렌더 기존 마크를 걷어내고 다시 칠한다. */
  _highlightSearch(noteEl) {
    const terms = (this._searchTerms || []).filter(Boolean);
    // 이전 하이라이트 제거 (article 재사용 대비)
    const old = noteEl.querySelectorAll('mark.search-hit');
    if (old.length) {
      old.forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
      noteEl.normalize();
    }
    if (!terms.length) return;

    const walker = document.createTreeWalker(noteEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('.mdv-diagram')) return NodeFilter.FILTER_REJECT; // SVG 보호
        const low = node.nodeValue.toLowerCase();
        return terms.some((t) => low.includes(t)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const targets = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n);

    let first = null;
    for (const textNode of targets) {
      const built = this._buildHighlight(textNode.nodeValue, terms);
      if (built) {
        if (!first) first = built.firstMark;
        textNode.replaceWith(built.frag);
      }
    }
    if (first) first.scrollIntoView({ block: 'center' });
  }

  /** 텍스트를 term 매치 기준으로 분해해 <mark.search-hit> 가 섞인 DocumentFragment 생성. */
  _buildHighlight(text, terms) {
    const low = text.toLowerCase();
    const ranges = [];
    for (const t of terms) {
      let i = 0;
      while ((i = low.indexOf(t, i)) !== -1) {
        ranges.push([i, i + t.length]);
        i += t.length;
      }
    }
    if (!ranges.length) return null;
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    const frag = document.createDocumentFragment();
    let pos = 0;
    let firstMark = null;
    for (const [s, e] of merged) {
      if (s > pos) frag.appendChild(document.createTextNode(text.slice(pos, s)));
      const mk = document.createElement('mark');
      mk.className = 'search-hit';
      mk.textContent = text.slice(s, e);
      if (!firstMark) firstMark = mk;
      frag.appendChild(mk);
      pos = e;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    return { frag, firstMark };
  }

  /** 노트 최상위 헤딩을 클릭 가능하게 만들어 섹션 접기/펼치기 */
  _setupHeadingFold(noteEl) {
    const headings = Array.from(noteEl.children).filter((el) => /^H[1-6]$/.test(el.tagName));
    for (const h of headings) {
      if (h.dataset.mdvFold === '1') continue; // 중복 리스너 방지 (멱등)
      h.dataset.mdvFold = '1';
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

  _setMarpPlain(plain) {
    if (this._marpAsPlain === plain) return;
    this._marpAsPlain = plain;
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

  /** 창/보기 액션 (제거한 네이티브 메뉴 대체) */
  _appAction(name) {
    window.mdv.appAction(name);
    this._menuOpen = false;
  }

  _toggleRaw() {
    this._rawView = !this._rawView;
  }

  /** 원문 마크다운 + 라인번호 (Lit 텍스트 보간으로 자동 이스케이프 → 새니타이즈 불필요) */
  _renderRaw() {
    const lines = (this._src || '').split('\n');
    return html`<pre class="raw">
${lines.map(
        (line, i) => html`<div class="raw-line"><span class="ln">${i + 1}</span><code>${line || ' '}</code></div>`
      )}</pre
    >`;
  }

  _renderTitlebar() {
    return html`
      <div class="titlebar">
        <span class="tb-title">md-viewer${this._selected ? ` — ${this._titleOf(this._selected)}` : ''}</span>
        <div class="tb-controls">
          <button class="tb-btn" title="최소화" @click=${() => this._appAction('minimize')}>—</button>
          <button
            class="tb-btn"
            title=${this._maximized ? '이전 크기로' : '최대화'}
            @click=${() => this._appAction('maximize')}
          >
            ${this._maximized ? '❐' : '▢'}
          </button>
          <button class="tb-btn tb-close" title="닫기" @click=${() => this._appAction('close')}>✕</button>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      ${this._renderTitlebar()}
      <div class="body">
        <aside class="sidebar">
          ${this._tree.length
            ? html`<div class="search">
                <input
                  type="search"
                  placeholder="vault 검색…"
                  .value=${this._searchQuery}
                  @input=${this._onSearchInput}
                  aria-label="전문 검색"
                />
                ${this._searchQuery
                  ? html`<button class="search-clear" title="검색 지우기" @click=${this._clearSearch}>✕</button>`
                  : ''}
              </div>`
            : ''}
          ${this._searchQuery.trim()
            ? this._renderSearchResults()
            : this._tree.length
              ? html`<mdv-tree .nodes=${this._tree} .selected=${this._selected}></mdv-tree>`
              : html`<div class="empty">vault 없음</div>`}
        </aside>
        <div class="content">
          ${this._selected ? this._renderViewBar() : ''}
          <div class="view-scroll">
            ${this._error
              ? html`<div class="error">${this._error}</div>`
              : this._selected && this._rawView
                ? this._renderRaw()
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
      </div>
      ${this._renderMenu()}
    `;
  }

  /** 콘텐츠 상단 토글 바: 렌더↔원본, (marp일 때) 슬라이드↔문서 */
  _renderViewBar() {
    return html`
      <div class="view-bar">
        <div class="tabs">
          <button class="tab ${!this._rawView ? 'active' : ''}" title="렌더 보기" @click=${() => (this._rawView = false)}>👁</button>
          <button class="tab ${this._rawView ? 'active' : ''}" title="원본 보기" @click=${() => (this._rawView = true)}>&lt;/&gt;</button>
        </div>
        ${this._marpSrc
          ? html`<div class="tabs">
              <button class="tab ${!this._marpAsPlain ? 'active' : ''}" title="슬라이드" @click=${() => this._setMarpPlain(false)}>▭</button>
              <button class="tab ${this._marpAsPlain ? 'active' : ''}" title="문서" @click=${() => this._setMarpPlain(true)}>≡</button>
            </div>`
          : ''}
      </div>
    `;
  }

  _renderMenu() {
    return html`
      <div class="menu ${this._menuOpen ? 'open' : ''}">
        <button
          class="menu-toggle"
          title="메뉴"
          @click=${() => (this._menuOpen = !this._menuOpen)}
        >
          ☰
        </button>
        <div class="menu-panel">
          <button data-open @click=${this._openVault}>Vault 열기</button>
          <div class="vault-path">${this._root ?? '폴더를 선택하세요'}</div>
          ${this._recent.length
            ? html`<div class="recent">
                <div class="recent-h">최근 vault</div>
                ${this._recent.map(
                  (p) => html`<div class="recent-item">
                    <button class="recent-open" title=${p} @click=${() => this._openRecent(p)}>
                      ${this._vaultName(p)}
                    </button>
                    <button class="recent-rm" title="목록에서 제거" @click=${() => this._removeRecent(p)}>
                      ✕
                    </button>
                  </div>`
                )}
              </div>`
            : ''}
          <label class="checkrow">
            <input
              type="checkbox"
              data-autoopen
              ?checked=${getSetting('autoOpenRecent', true)}
              @change=${this._onAutoOpenToggle}
            />
            시작 시 최근 vault 열기
          </label>
          <label
            >mermaid 테마
            <select @change=${this._onMermaidTheme}>
              ${MERMAID_THEMES.map(
                (t) =>
                  html`<option value=${t} ?selected=${getSetting('mermaidTheme', 'dark') === t}>
                    ${t}
                  </option>`
              )}
            </select>
          </label>
          <div class="menu-sep"></div>
          <div class="menu-label">보기</div>
          <div class="menu-actions" role="group" aria-label="보기">
            <button class="iconbtn" data-action title="축소" @click=${() => this._appAction('zoomOut')}>A−</button>
            <button class="iconbtn" data-action title="기본 배율" @click=${() => this._appAction('zoomReset')}>100%</button>
            <button class="iconbtn" data-action title="확대" @click=${() => this._appAction('zoomIn')}>A+</button>
            <button class="iconbtn" data-action title="전체화면" @click=${() => this._appAction('fullscreen')}>⛶</button>
            <button class="iconbtn" data-action title="새로고침" @click=${() => this._appAction('reload')}>↻</button>
            <button class="iconbtn" data-action title="개발자 도구" @click=${() => this._appAction('devtools')}>{ }</button>
          </div>
          <!-- 최소화/최대화/닫기는 커스텀 타이틀바로 이동 (중복 제거) -->
        </div>
      </div>
    `;
  }

  /** 전문 검색 결과 패널 (트리 대신). 스니펫은 텍스트로만 그려 살균 불필요. */
  _renderSearchResults() {
    const rs = this._searchResults;
    if (!rs.length) {
      return html`<div class="sr-empty">
        ${this._searchQuery.trim().length < 2 ? '2글자 이상 입력하세요' : '결과 없음'}
      </div>`;
    }
    return html`
      <div class="sr-count">${rs.length}개 노트</div>
      <div class="search-results">
        ${rs.map(
          (r) => html`<div
            class="sr-item ${this._selected === r.relPath ? 'active' : ''}"
            title=${r.relPath}
            @click=${() => this._openSearchResult(r.relPath)}
          >
            <div class="sr-title">${r.title}</div>
            ${r.relPath.includes('/') ? html`<div class="sr-path">${r.relPath}</div>` : ''}
            ${r.snippets.map(
              (s) => html`<div class="sr-snip">
                ${s.parts.map((p) => (p.hit ? html`<mark>${p.text}</mark>` : p.text))}
              </div>`
            )}
          </div>`
        )}
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
window.__mdvTest = { renderMarkdown, makeResolver, hydrateDiagrams, registerDiagram, hasMarpFrontmatter, renderMarp };
