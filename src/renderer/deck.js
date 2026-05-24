// Marp 슬라이드 덱 뷰어. src(원문) → 슬라이드들, 한 장씩 표시 + 이전/다음 네비게이션.
import { LitElement, html, css, unsafeHTML } from '../../vendor/lit.js';
import { renderMarp, renderMarpSvg } from './marp.js';
import { scrollbarCss } from './scrollbar-css.js';

class MdvDeck extends LitElement {
  static properties = {
    src: { type: String },
    _index: { state: true },
    _count: { state: true },
    _html: { state: true },
    _css: { state: true },
    _error: { state: true },
    _fullscreen: { state: true },
    _controlsVisible: { state: true },
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
    /* 전체화면 재생 */
    :host(:fullscreen) {
      background: #000;
    }
    :host(:fullscreen) .navbar {
      display: none;
    }
    :host(:fullscreen) .stage {
      padding: 0;
    }
    .fs-controls {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 0.8rem;
      background: rgba(20, 20, 20, 0.85);
      border: 1px solid #444;
      border-radius: 10px;
      padding: 6px 14px;
      color: #fff;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    }
    .fs-controls.visible {
      opacity: 1;
      pointer-events: auto;
    }
    .fs-controls button {
      background: #3a3d41;
      color: #fff;
      border: 0;
      padding: 4px 12px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 1rem;
    }
    .fs-controls button:disabled {
      opacity: 0.4;
      cursor: default;
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
    this._fullscreen = false;
    this._controlsVisible = false;
    this._controlsTimer = null;
    this._keyHandler = (e) => this._onKey(e);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._keyHandler);
    this._resizeHandler = () => this._fit();
    window.addEventListener('resize', this._resizeHandler);
    // 전체화면 진입/종료(Esc 포함)를 상태에 동기화
    this._fsHandler = () => {
      this._fullscreen = document.fullscreenElement === this;
      this._fit();
    };
    document.addEventListener('fullscreenchange', this._fsHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('resize', this._resizeHandler);
    document.removeEventListener('fullscreenchange', this._fsHandler);
    clearTimeout(this._controlsTimer);
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

  /** 현재 슬라이드를 스테이지에 맞게 zoom 스케일. 일반=너비맞춤(축소만),
   *  전체화면=화면에 꽉 맞춤(contain: 너비·높이 중 작은 배율, 확대도 허용). */
  _fit() {
    const stage = this.renderRoot.querySelector('.stage');
    const cur = this._slides && this._slides[this._index];
    if (!stage || !cur) return;
    cur.style.zoom = '1';
    const w = cur.offsetWidth || 1280;
    const h = cur.offsetHeight || 720;
    let scale;
    if (this._fullscreen) {
      scale = Math.min((stage.clientWidth - 8) / w, (stage.clientHeight - 8) / h);
    } else {
      scale = Math.min(1, (stage.clientWidth - 32) / w);
    }
    cur.style.zoom = String(scale > 0 ? scale : 1);
  }

  /** 전체화면 재생 토글 (element fullscreen). Esc 는 브라우저가 종료 → fullscreenchange 동기화. */
  _toggleFullscreen() {
    if (document.fullscreenElement === this) {
      document.exitFullscreen?.();
    } else {
      this.requestFullscreen?.().catch(() => {}); // 사용자 제스처 필요 — 실패 무시
    }
  }

  /** 전체화면 중 마우스 이동 시 컨트롤 잠깐 표시 후 자동 숨김 */
  _onMouseMove() {
    if (!this._fullscreen) return;
    this._controlsVisible = true;
    clearTimeout(this._controlsTimer);
    this._controlsTimer = setTimeout(() => (this._controlsVisible = false), 2000);
  }

  _onKey(e) {
    // 입력 포커스(검색창 등) 중에는 무시 — composedPath 로 Shadow DOM 내부 실제 타겟 확인
    const real = e.composedPath()[0];
    if (real && (/^(INPUT|TEXTAREA|SELECT)$/.test(real.tagName) || real.isContentEditable)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') this._show(this._index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this._show(this._index - 1);
    else if (e.key === 'f' || e.key === 'F' || e.key === 'F11') {
      e.preventDefault();
      this._toggleFullscreen();
    }
  }

  _title() {
    const m = /^#\s+(.+)$/m.exec(this.src || '');
    return m ? m[1].trim() : 'slides';
  }

  _export(format) {
    const payload = { format, title: this._title() };
    if (format === 'svg') {
      const r = renderMarpSvg(this.src); // inlineSVG 슬라이드
      payload.html = r.html;
      payload.css = r.css;
    } else {
      payload.html = this._html; // sections (pdf/html/png)
      payload.css = this._css;
    }
    window.mdv.exportMarp(payload);
  }

  render() {
    if (this._error) return html`<div class="error">Marp 렌더 실패: ${this._error}</div>`;
    return html`
      <style>${this._css}</style>
      <div class="stage" @mousemove=${this._onMouseMove}>${unsafeHTML(this._html)}</div>
      <div class="navbar">
        <button @click=${() => this._show(this._index - 1)} ?disabled=${this._index <= 0}>◀</button>
        <span class="counter">${this._count ? this._index + 1 : 0} / ${this._count}</span>
        <button @click=${() => this._show(this._index + 1)} ?disabled=${this._index >= this._count - 1}>▶</button>
        <span class="nav-sep"></span>
        <button data-fs @click=${this._toggleFullscreen} title="전체화면 재생 (F)">⛶</button>
        <span class="nav-sep"></span>
        <button class="exp" data-export @click=${() => this._export('pdf')} title="PDF로 내보내기">PDF</button>
        <button class="exp" data-export @click=${() => this._export('png')} title="슬라이드별 PNG">PNG</button>
        <button class="exp" data-export @click=${() => this._export('svg')} title="슬라이드별 SVG">SVG</button>
        <button class="exp" data-export @click=${() => this._export('html')} title="HTML로 내보내기">HTML</button>
      </div>
      ${this._fullscreen
        ? html`<div class="fs-controls ${this._controlsVisible ? 'visible' : ''}">
            <button @click=${() => this._show(this._index - 1)} ?disabled=${this._index <= 0}>◀</button>
            <span class="counter">${this._index + 1} / ${this._count}</span>
            <button @click=${() => this._show(this._index + 1)} ?disabled=${this._index >= this._count - 1}>▶</button>
            <span class="nav-sep"></span>
            <button @click=${this._toggleFullscreen} title="종료 (Esc)">✕</button>
          </div>`
        : ''}
    `;
  }
}

customElements.define('mdv-deck', MdvDeck);
