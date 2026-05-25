// 폴더 트리 컴포넌트. 재귀적으로 자신을 중첩 렌더한다.
// 파일 클릭 시 'mdv-select' 이벤트를 bubbles+composed 로 올려보내 mdv-app 이 받는다.
//
// 대용량 vault: 전체 노드 수가 LAZY_THRESHOLD 를 넘으면 lazy 모드 — 접힌 폴더의
// children(<mdv-tree>)을 DOM 에 마운트하지 않고(펼칠 때만), 폴더를 기본 접힘으로 둔다
// (선택 노트의 조상 폴더만 자동 펼침). 작은 vault 는 기존처럼 전부 펼친 상태 유지.

import { LitElement, html, css } from '../../vendor/lit.js';

const LAZY_THRESHOLD = 400;

function countNodes(nodes, cap) {
  let n = 0;
  for (const node of nodes || []) {
    n++;
    if (node.children) n += countNodes(node.children, cap);
    if (n > cap) return n; // 임계 초과만 알면 됨 — 더 셀 필요 없음
  }
  return n;
}

export class MdvTree extends LitElement {
  static properties = {
    nodes: { type: Array },
    selected: { type: String },
    lazy: { type: Boolean }, // 부모가 전달(대용량). 루트에서 미지정이면 노드 수로 자동 판정.
    _ver: { state: true }, // 폴더 펼침/접힘 토글 시 재렌더 트리거
  };

  static styles = css`
    :host {
      display: block;
      font-size: 0.88rem;
      line-height: 1.7;
    }
    ul {
      list-style: none;
      margin: 0;
      padding-left: 0;
    }
    /* 중첩 트리 들여쓰기: 각 레벨은 별도 mdv-tree(shadow)라 ul 패딩이 누적되지 않음.
       자식 mdv-tree 요소 자체에 들여쓰기 + 좌측 가이드라인을 줘 depth 를 표현. */
    details > mdv-tree {
      display: block;
      padding-left: 0.8rem;
      margin-left: 0.4rem;
      border-left: 1px solid #333;
    }
    .file {
      cursor: pointer;
      padding: 1px 6px;
      border-radius: 4px;
      color: var(--fg, #d4d4d4);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .file.active {
      background: var(--accent, #569cd6);
      color: #fff;
    }
    summary {
      cursor: pointer;
      padding: 1px 4px;
      color: var(--muted, #9aa0a6);
      user-select: none;
    }
    summary:hover {
      color: var(--fg, #d4d4d4);
    }
  `;

  constructor() {
    super();
    this.nodes = [];
    this.selected = null;
    this.lazy = undefined; // 루트는 undefined → _isLazy 가 노드 수로 판정
    this._state = new Map(); // relPath → 사용자 토글 펼침 상태(명시값이 기본값 우선)
    this._ver = 0;
  }

  /** lazy 모드 여부: 명시(부모 전달) 우선, 루트는 전체 노드 수로 자동 판정. */
  _isLazy() {
    if (this.lazy !== undefined) return this.lazy;
    return countNodes(this.nodes, LAZY_THRESHOLD) > LAZY_THRESHOLD;
  }

  /** 폴더 기본 펼침 여부: 소형=항상 펼침, 대형=선택 노트의 조상 폴더만. */
  _defaultOpen(node) {
    if (!this._isLazy()) return true;
    return !!(this.selected && this.selected.startsWith(node.relPath + '/'));
  }

  /** 현재 폴더 펼침 상태: 사용자 토글값 우선, 없으면 기본값. */
  _isOpen(node) {
    const s = this._state.get(node.relPath);
    return s === undefined ? this._defaultOpen(node) : s;
  }

  _onToggle(node, e) {
    const open = e.target.open;
    if (open === this._isOpen(node)) return; // 변화 없음(중복 이벤트) — 재렌더 생략
    this._state.set(node.relPath, open);
    this._ver++; // children 마운트/언마운트 위해 재렌더
  }

  render() {
    const lazy = this._isLazy();
    return html`<ul>
      ${this.nodes.map((n) => this._renderNode(n, lazy))}
    </ul>`;
  }

  _renderNode(node, lazy) {
    if (node.type === 'dir') {
      const open = this._isOpen(node);
      return html`<li>
        <details ?open=${open} @toggle=${(e) => this._onToggle(node, e)}>
          <summary>${node.name}</summary>
          ${open
            ? html`<mdv-tree
                .nodes=${node.children}
                .selected=${this.selected}
                .lazy=${lazy}
              ></mdv-tree>`
            : ''}
        </details>
      </li>`;
    }
    const label = node.name.replace(/\.md$/i, '');
    const active = node.relPath === this.selected;
    return html`<li
      class="file ${active ? 'active' : ''}"
      title=${node.relPath}
      @click=${() => this._select(node.relPath)}
    >
      ${label}
    </li>`;
  }

  _select(relPath) {
    this.dispatchEvent(
      new CustomEvent('mdv-select', {
        detail: { relPath },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define('mdv-tree', MdvTree);
