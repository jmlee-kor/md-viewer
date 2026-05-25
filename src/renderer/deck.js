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
    _presenter: { state: true },
    _elapsed: { state: true },
    _running: { state: true },
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
    /* 발표자(presenter) 뷰 */
    .presenter {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100%;
      background: #1a1a1a;
      color: var(--fg, #d4d4d4);
    }
    .pr-bar {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      padding: 0.5rem 0.9rem;
      background: #252526;
      border-bottom: 1px solid #333;
    }
    .pr-timer {
      font-size: 1.3rem;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      min-width: 4.5rem;
    }
    .pr-bar button {
      background: #3a3d41;
      color: #fff;
      border: 0;
      padding: 4px 12px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 1rem;
    }
    .pr-bar button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .pr-bar .counter {
      min-width: 5rem;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .pr-body {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 0.8rem;
      padding: 0.8rem;
      min-height: 0;
    }
    .pr-current {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #000;
      border-radius: 6px;
      min-width: 0;
    }
    .pr-side {
      display: grid;
      grid-template-rows: 1fr 1fr;
      gap: 0.8rem;
      min-height: 0;
    }
    .pr-next-wrap,
    .pr-notes-wrap {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .pr-label {
      font-size: 0.72rem;
      color: var(--muted, #9aa0a6);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.3rem;
    }
    .pr-next {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #000;
      border-radius: 6px;
      min-height: 0;
    }
    .pr-notes {
      flex: 1 1 auto;
      overflow: auto;
      background: #232323;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 0.7rem;
      font-size: 0.95rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      min-height: 0;
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
    this._presenter = false; // 발표자 뷰
    this._elapsed = 0; // 경과 초
    this._running = false;
    this._timerId = null;
    this._comments = []; // 슬라이드별 발표자 노트
    this._keyHandler = (e) => this._onKey(e);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._keyHandler);
    this._resizeHandler = () => this._fit();
    window.addEventListener('resize', this._resizeHandler);
    // 전체화면 진입/종료(Esc 포함)를 상태에 동기화.
    // fullscreenchange 시점엔 아직 뷰포트가 이전 크기 → 즉시 _fit 하면 작게 남는다.
    // rAF 2회로 레이아웃(전체화면 실치수) 안정화 후 재맞춤. backup 으로 짧은 지연도.
    this._fsHandler = () => {
      this._fullscreen = document.fullscreenElement === this;
      const refit = () => {
        this._fit();
        if (this._presenter) this._updatePresenter();
      };
      requestAnimationFrame(() => requestAnimationFrame(refit));
      setTimeout(refit, 120); // backup (전체화면 전환 애니메이션 등)
    };
    document.addEventListener('fullscreenchange', this._fsHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('resize', this._resizeHandler);
    document.removeEventListener('fullscreenchange', this._fsHandler);
    clearTimeout(this._controlsTimer);
    clearInterval(this._timerId);
  }

  updated(changed) {
    if (changed.has('src')) this._build();
    if (changed.has('_html') && this._html) this._applySlides();
    // 발표자 뷰: 진입/슬라이드 이동 시 현재·다음 패널 갱신
    if (this._presenter && (changed.has('_presenter') || changed.has('_index') || changed.has('_html'))) {
      this.updateComplete.then(() => this._updatePresenter());
    }
  }

  _build() {
    try {
      const { html: h, css: c, comments } = renderMarp(this.src);
      this._html = h;
      this._css = c;
      this._comments = comments || [];
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
      // 화면 꽉참: 제한 축 기준 최대 확대(패딩/레터박스 최소화)
      scale = Math.min(stage.clientWidth / w, stage.clientHeight / h);
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
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      this._togglePresenter(); // 전체화면 중에도 발표자뷰 토글 (단일 흐름)
    }
  }

  _togglePresenter() {
    if (this._presenter) this._exitPresenter();
    else this._enterPresenter();
  }

  // --- 발표자(presenter) 모드 ---
  _enterPresenter() {
    this._presenter = true;
    this._resetTimer();
    this._startTimer();
  }

  _exitPresenter() {
    this._presenter = false;
    this._pauseTimer();
    this.updateComplete.then(() => {
      if (this._html) this._applySlides(); // 일반 .stage 슬라이드 재바인딩
    });
  }

  _startTimer() {
    if (this._timerId) return;
    this._running = true;
    this._timerId = setInterval(() => (this._elapsed += 1), 1000);
  }

  _pauseTimer() {
    this._running = false;
    clearInterval(this._timerId);
    this._timerId = null;
  }

  _toggleTimer() {
    this._running ? this._pauseTimer() : this._startTimer();
  }

  _resetTimer() {
    this._elapsed = 0;
  }

  _fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  /** 발표자 뷰의 현재/다음 슬라이드 패널을 인덱스에 맞춰 표시 + 패널 크기에 맞춤 */
  _paneShow(sel, index) {
    const pane = this.renderRoot.querySelector(sel);
    if (!pane) return;
    const secs = pane.querySelectorAll('section');
    secs.forEach((s, i) => {
      s.style.display = i === index ? 'block' : 'none';
      s.style.zoom = '1';
    });
    const cur = secs[index];
    if (!cur) return;
    const w = cur.offsetWidth || 1280;
    const h = cur.offsetHeight || 720;
    const box = pane.getBoundingClientRect();
    const scale = Math.min((box.width - 8) / w, (box.height - 8) / h);
    cur.style.zoom = String(scale > 0 ? scale : 1);
  }

  _updatePresenter() {
    this._paneShow('.pr-current', this._index);
    this._paneShow('.pr-next', this._index + 1);
  }

  /** 현재 슬라이드의 발표자 노트 (marp 주석) */
  _currentNotes() {
    const c = this._comments && this._comments[this._index];
    return c && c.length ? c.join('\n') : '';
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
    if (this._presenter) return this._renderPresenter();
    return html`
      <style>${this._css}</style>
      <div class="stage" @mousemove=${this._onMouseMove}>${unsafeHTML(this._html)}</div>
      <div class="navbar">
        <button @click=${() => this._show(this._index - 1)} ?disabled=${this._index <= 0}>◀</button>
        <span class="counter">${this._count ? this._index + 1 : 0} / ${this._count}</span>
        <button @click=${() => this._show(this._index + 1)} ?disabled=${this._index >= this._count - 1}>▶</button>
        <span class="nav-sep"></span>
        <button data-fs @click=${this._toggleFullscreen} title="전체화면 재생 (F)">⛶</button>
        <button data-presenter @click=${this._enterPresenter} title="발표자 보기">👤</button>
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
            <button @click=${this._togglePresenter} title="발표자 보기 (P)">👤</button>
            <button @click=${this._toggleFullscreen} title="종료 (Esc)">✕</button>
          </div>`
        : ''}
    `;
  }

  /** 발표자 뷰: 현재 슬라이드(크게) + 다음 슬라이드(미리보기) + 노트 + 타이머 */
  _renderPresenter() {
    const notes = this._currentNotes();
    const last = this._index >= this._count - 1;
    return html`
      <style>${this._css}</style>
      <div class="presenter">
        <div class="pr-bar">
          <span class="pr-timer">${this._fmtTime(this._elapsed)}</span>
          <button @click=${this._toggleTimer} title=${this._running ? '일시정지' : '시작'}>
            ${this._running ? '⏸' : '▶'}
          </button>
          <button @click=${this._resetTimer} title="타이머 리셋">↺</button>
          <span class="nav-sep"></span>
          <button @click=${() => this._show(this._index - 1)} ?disabled=${this._index <= 0}>◀</button>
          <span class="counter">${this._count ? this._index + 1 : 0} / ${this._count}</span>
          <button @click=${() => this._show(this._index + 1)} ?disabled=${last}>▶</button>
          <span class="nav-sep"></span>
          <button @click=${this._toggleFullscreen} title="전체화면 (F)">⛶</button>
          <button @click=${this._exitPresenter} title="발표자 보기 종료">✕</button>
        </div>
        <div class="pr-body">
          <div class="pr-current">${unsafeHTML(this._html)}</div>
          <div class="pr-side">
            <div class="pr-next-wrap">
              <div class="pr-label">다음 ${last ? '(끝)' : ''}</div>
              <div class="pr-next">${unsafeHTML(this._html)}</div>
            </div>
            <div class="pr-notes-wrap">
              <div class="pr-label">발표자 노트</div>
              <div class="pr-notes">${notes || '(노트 없음 — 슬라이드에 <!-- 메모 --> 주석 추가)'}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('mdv-deck', MdvDeck);
