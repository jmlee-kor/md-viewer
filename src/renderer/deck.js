// Marp 슬라이드 덱 뷰어. src(원문) → 슬라이드들, 한 장씩 표시 + 이전/다음 네비게이션.
import { LitElement, html, css, unsafeHTML } from '../../vendor/lit.js';
import { renderMarp } from './marp.js';
import { scrollbarCss } from './scrollbar-css.js';

class MdvDeck extends LitElement {
  static properties = {
    src: { type: String },
    _index: { state: true },
    _count: { state: true },
    _html: { state: true },
    _css: { state: true },
    _error: { state: true },
  };

  static styles = [
    scrollbarCss,
    css`
    :host {
      display: grid;
      grid-template-rows: 1fr auto;
      height: 100%;
      background: #111;
    }
    .stage {
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      min-height: 0;
    }
    .stage section {
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
    }
    .navbar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 0.5rem;
      background: #252526;
      border-top: 1px solid #333;
      color: var(--fg, #d4d4d4);
    }
    .navbar button {
      background: #3a3d41;
      color: #fff;
      border: 0;
      padding: 4px 14px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 1rem;
    }
    .navbar button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .counter {
      min-width: 5rem;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .nav-sep {
      width: 1px;
      height: 20px;
      background: #444;
      margin: 0 0.3rem;
    }
    .navbar button.exp {
      font-size: 0.78rem;
      padding: 4px 10px;
      background: #2d2f33;
      border: 1px solid #4a4d51;
    }
    .navbar button.exp:hover {
      background: var(--accent, #569cd6);
    }
    .error {
      color: #f44747;
      padding: 1.5rem;
    }
  `,
  ];

  constructor() {
    super();
    this._index = 0;
    this._count = 0;
    this._html = '';
    this._css = '';
    this._error = null;
    this._slides = null;
    this._keyHandler = (e) => this._onKey(e);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._keyHandler);
    this._resizeHandler = () => this._fit();
    window.addEventListener('resize', this._resizeHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('resize', this._resizeHandler);
  }

  updated(changed) {
    if (changed.has('src')) this._build();
    if (changed.has('_html') && this._html) this._applySlides();
  }

  _build() {
    try {
      const { html: h, css: c } = renderMarp(this.src);
      this._html = h;
      this._css = c;
      this._index = 0;
      this._error = null;
    } catch (e) {
      this._error = (e && e.message) || String(e);
    }
  }

  _applySlides() {
    const stage = this.renderRoot.querySelector('.stage');
    if (!stage) return;
    this._slides = stage.querySelectorAll('section');
    this._count = this._slides.length;
    this._show(this._index);
  }

  _show(i) {
    if (!this._slides || !this._slides.length) return;
    this._index = Math.max(0, Math.min(i, this._slides.length - 1));
    this._slides.forEach((s, idx) => {
      s.style.display = idx === this._index ? 'block' : 'none';
    });
    this._fit();
  }

  /** 현재 슬라이드를 스테이지 너비에 맞게 zoom 스케일 (1280px 기준 축소만) */
  _fit() {
    const stage = this.renderRoot.querySelector('.stage');
    const cur = this._slides && this._slides[this._index];
    if (!stage || !cur) return;
    cur.style.zoom = '1';
    const w = cur.offsetWidth || 1280;
    const scale = Math.min(1, (stage.clientWidth - 32) / w);
    cur.style.zoom = String(scale);
  }

  _onKey(e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') this._show(this._index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this._show(this._index - 1);
  }

  _title() {
    const m = /^#\s+(.+)$/m.exec(this.src || '');
    return m ? m[1].trim() : 'slides';
  }

  _export(format) {
    window.mdv.exportMarp({ format, html: this._html, css: this._css, title: this._title() });
  }

  render() {
    if (this._error) return html`<div class="error">Marp 렌더 실패: ${this._error}</div>`;
    return html`
      <style>${this._css}</style>
      <div class="stage">${unsafeHTML(this._html)}</div>
      <div class="navbar">
        <button @click=${() => this._show(this._index - 1)} ?disabled=${this._index <= 0}>◀</button>
        <span class="counter">${this._count ? this._index + 1 : 0} / ${this._count}</span>
        <button @click=${() => this._show(this._index + 1)} ?disabled=${this._index >= this._count - 1}>▶</button>
        <span class="nav-sep"></span>
        <button class="exp" data-export @click=${() => this._export('pdf')} title="PDF로 내보내기">PDF</button>
        <button class="exp" data-export @click=${() => this._export('html')} title="HTML로 내보내기">HTML</button>
      </div>
    `;
  }
}

customElements.define('mdv-deck', MdvDeck);
