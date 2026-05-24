// 폴더 트리 컴포넌트. 재귀적으로 자신을 중첩 렌더한다.
// 파일 클릭 시 'mdv-select' 이벤트를 bubbles+composed 로 올려보내 mdv-app 이 받는다.

import { LitElement, html, css } from '../../vendor/lit.js';

export class MdvTree extends LitElement {
  static properties = {
    nodes: { type: Array },
    selected: { type: String },
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
  }

  render() {
    return html`<ul>
      ${this.nodes.map((n) => this._renderNode(n))}
    </ul>`;
  }

  _renderNode(node) {
    if (node.type === 'dir') {
      return html`<li>
        <details open>
          <summary>${node.name}</summary>
          <mdv-tree .nodes=${node.children} .selected=${this.selected}></mdv-tree>
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
