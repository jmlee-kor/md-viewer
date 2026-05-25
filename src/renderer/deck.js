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
    _blank: { state: true }, // 'black' | 'white' | null
    _helpOpen: { state: true },
    _overview: { state: true },
    audience: { type: Boolean }, // 청중 창 모드: 크롬 숨김 + 항상 contain-fit + 키 무시(ESC만)
    _presenting: { state: true }, // (발표자) 청중 창 발표 진행 중
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
    /* 청중 창(audience): 크롬 숨기고 슬라이드만 검정 배경에 꽉 채운다.
       100vw/100vh 명시 — :host{height:100%}는 컨테이닝블록이 불확정이면 auto 로 풀려
       grid 1fr 가 슬라이드 자연높이로만 잡힘(전체화면 버그와 동일). 명시 치수로 확정. */
    :host([audience]) {
      background: #000;
      width: 100vw;
      height: 100vh;
    }
    :host([audience]) .navbar {
      display: none;
    }
    /* 발표 진행 중 표시 버튼(navbar/발표자 바 공통) */
    .navbar button.on,
    .pr-bar button.on {
      background: var(--accent, #569cd6);
      color: #fff;
    }
    /* 전체화면 재생 — vw/vh 로 명시 치수를 줘야 grid 1fr 가 화면을 채운다.
       (:host{height:100%} 는 fullscreen 시 컨테이닝블록이 불확정→auto 로 풀려
        stage 가 슬라이드 자연높이(720)로만 잡혀 _fit 이 scale=1 로 작게 남던 버그) */
    :host(:fullscreen) {
      background: #000;
      width: 100vw;
      height: 100vh;
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
      transform: translate(-50%, 160%); /* 하단 밖에서 대기 → visible 시 슬라이드인 */
      display: flex;
      align-items: center;
      gap: 0.8rem;
      background: rgba(20, 20, 20, 0.85);
      border: 1px solid #444;
      border-radius: 10px;
      padding: 6px 14px;
      color: #fff;
      opacity: 0;
      transition: opacity 0.25s, transform 0.25s ease;
      pointer-events: none;
    }
    .fs-controls.visible {
      opacity: 1;
      transform: translate(-50%, 0);
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
    .fs-clock {
      font-variant-numeric: tabular-nums;
      font-size: 0.9rem;
      opacity: 0.85;
      white-space: nowrap;
    }
    /* 하단 진행 바 — 컨트롤과 무관하게 항상 표시 */
    .fs-progress {
      position: fixed;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.12);
      z-index: 5;
    }
    .fs-progress-fill {
      height: 100%;
      background: #4aa3ff;
      transition: width 0.2s ease;
    }
    /* 슬라이드 번호 — 우하단 상시 */
    .fs-pageno {
      position: fixed;
      right: 14px;
      bottom: 14px;
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.85rem;
      font-variant-numeric: tabular-nums;
      background: rgba(20, 20, 20, 0.55);
      padding: 2px 8px;
      border-radius: 6px;
      z-index: 5;
      pointer-events: none;
    }
    .fs-numbuf {
      color: #4aa3ff;
      font-weight: 700;
    }
    /* 블랙/화이트 스크린 */
    .fs-blank {
      position: fixed;
      inset: 0;
      z-index: 20;
      cursor: pointer;
    }
    .fs-blank.black {
      background: #000;
    }
    .fs-blank.white {
      background: #fff;
    }
    /* 슬라이드 오버뷰 그리드 */
    .fs-overview {
      position: fixed;
      inset: 0;
      z-index: 15;
      background: rgba(10, 10, 10, 0.92);
      overflow: auto;
      padding: 24px;
    }
    .ov-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .ov-cell {
      position: relative;
      padding: 0;
      border: 2px solid #444;
      border-radius: 8px;
      background: #fff;
      cursor: pointer;
      overflow: hidden;
      aspect-ratio: 16 / 9;
    }
    .ov-cell.current {
      border-color: #4aa3ff;
      box-shadow: 0 0 0 3px rgba(74, 163, 255, 0.4);
    }
    .ov-thumb {
      width: 1280px;
      height: 720px;
      transform: scale(0.1875); /* 240/1280 */
      transform-origin: top left;
      pointer-events: none;
    }
    .ov-thumb section {
      display: block !important;
      width: 1280px;
      height: 720px;
    }
    .ov-no {
      position: absolute;
      right: 6px;
      bottom: 6px;
      background: rgba(20, 20, 20, 0.8);
      color: #fff;
      font-size: 0.8rem;
      padding: 1px 7px;
      border-radius: 5px;
    }
    /* 단축키 도움말 오버레이 */
    .fs-help {
      position: fixed;
      inset: 0;
      z-index: 18;
      background: rgba(10, 10, 10, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .help-card {
      background: #1d1f23;
      color: #eee;
      border: 1px solid #444;
      border-radius: 12px;
      padding: 22px 26px;
      max-width: 560px;
      cursor: default;
    }
    .help-card h3 {
      margin: 0 0 12px;
    }
    .help-card table {
      border-collapse: collapse;
    }
    .help-card td {
      padding: 4px 14px 4px 0;
      vertical-align: top;
      font-size: 0.92rem;
    }
    .help-card td.key {
      color: #4aa3ff;
      font-family: var(--mono, monospace);
      white-space: nowrap;
    }
    .help-close {
      margin-top: 14px;
      opacity: 0.55;
      font-size: 0.8rem;
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
    this._blank = null; // 블랙/화이트 스크린
    this._helpOpen = false; // 단축키 도움말
    this._overview = false; // 슬라이드 오버뷰 그리드
    this._numBuf = ''; // 번호 입력 버퍼(Enter 로 점프)
    this.audience = false;
    this._presenting = false;
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
      // document.fullscreenElement 는 shadow 경계서 호스트(mdv-app)로 리타게팅돼 이 deck 와
      // 절대 일치하지 않는다 → :fullscreen 의사클래스(리타게팅 없음)로 판정해야 정확.
      const isFs = this.matches(':fullscreen');
      const entering = isFs && !this._fullscreen;
      this._fullscreen = isFs;
      // 전체화면 재생 진입 시 경과 타이머 자동 시작 (발표자뷰 타이머와 공유)
      if (entering && !this._running) this._startTimer();
      const refit = () => {
        this._fit();
        if (this._presenter) this._updatePresenter();
      };
      requestAnimationFrame(() => requestAnimationFrame(refit));
      setTimeout(refit, 120); // backup (전체화면 전환 애니메이션 등)
    };
    document.addEventListener('fullscreenchange', this._fsHandler);
    // (발표자) 청중 창이 닫히면 발표 종료 → 단일 창 복귀
    if (!this.audience && window.mdv?.onPresentEnded) {
      this._endedUnsub = window.mdv.onPresentEnded(() => { this._presenting = false; });
    }
    // (발표자) 청중 창에서 온 네비 의도 실행 → _show/_blank 가 다시 청중으로 동기
    if (!this.audience && window.mdv?.onPresentNav) {
      this._navUnsub = window.mdv.onPresentNav((action) => this._onPresentNav(action));
    }
  }

  /** 청중 창에서 전달된 네비 실행 (발표자가 소스 오브 트루스). */
  _onPresentNav(action) {
    switch (action) {
      case 'next': this._show(this._index + 1); break;
      case 'prev': this._show(this._index - 1); break;
      case 'first': this._show(0); break;
      case 'last': this._show(this._count - 1); break;
      case 'black': this._blank = this._blank === 'black' ? null : 'black'; break;
      case 'white': this._blank = this._blank === 'white' ? null : 'white'; break;
    }
  }

  /** stage 가 실제로 리사이즈되는 정확한 순간(전체화면 전환 레이아웃 안정·창 크기 변경·
   *  사이드바 드래그)마다 _fit 재실행. fullscreenchange 의 rAF/타이머 추측 타이밍이
   *  실기기 전환 속도를 못 따라가 가끔 작게 남던 레이스를 ResizeObserver 로 확정 해소.
   *  발표자뷰 토글로 .stage 가 재생성되므로 매 렌더 현재 stage 로 재관찰. */
  _observeStage() {
    if (typeof ResizeObserver === 'undefined') return;
    const stage = this.renderRoot.querySelector('.stage');
    if (!stage || stage === this._observedStage) return;
    this._stageRO?.disconnect();
    this._stageRO = new ResizeObserver(() => this._fit());
    this._stageRO.observe(stage);
    this._observedStage = stage;
  }

  firstUpdated() {
    this._observeStage();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('resize', this._resizeHandler);
    document.removeEventListener('fullscreenchange', this._fsHandler);
    this._stageRO?.disconnect();
    this._endedUnsub?.();
    this._navUnsub?.();
    clearTimeout(this._controlsTimer);
    clearInterval(this._timerId);
  }

  updated(changed) {
    if (changed.has('src')) this._build();
    if (changed.has('_html') && this._html) this._applySlides();
    if (!this._presenter) this._observeStage(); // 슬라이드뷰 .stage(재)생성 시 관찰 갱신
    // 발표 중 블랙/화이트 스크린 변경 → 청중 창 동기화 (audience 는 _presenting=false 라 안 돌아옴)
    if (changed.has('_blank') && this._presenting && !this.audience) {
      window.mdv?.updatePresent?.({ blank: this._blank });
    }
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
    // 오버뷰 썸네일용 슬라이드별 HTML 캐시 (display 토글 전 원본 마크업).
    this._sectionHtmls = Array.from(this._slides).map((s) => s.outerHTML);
    this._show(this._index);
  }

  /** 오버뷰 셀에 넣을 i번째 슬라이드 HTML (이미 새니타이즈된 _html 의 부분) */
  _slideHtml(i) {
    return (this._sectionHtmls && this._sectionHtmls[i]) || '';
  }

  _show(i) {
    if (!this._slides || !this._slides.length) return;
    this._index = Math.max(0, Math.min(i, this._slides.length - 1));
    this._slides.forEach((s, idx) => {
      s.style.display = idx === this._index ? 'block' : 'none';
    });
    this._fit();
    // 발표 중이면 청중 창에 인덱스 동기화 (audience deck 은 _presenting=false 라 되돌아오지 않음)
    if (this._presenting && !this.audience) window.mdv?.updatePresent?.({ index: this._index });
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
    if (this._fullscreen || this.audience) {
      // 화면 꽉참(전체화면 재생 / 청중 창): 제한 축 기준 최대 확대(패딩/레터박스 최소화)
      scale = Math.min(stage.clientWidth / w, stage.clientHeight / h);
    } else {
      scale = Math.min(1, (stage.clientWidth - 32) / w);
    }
    cur.style.zoom = String(scale > 0 ? scale : 1);
  }

  /** 전체화면 재생 토글 (element fullscreen). Esc 는 브라우저가 종료 → fullscreenchange 동기화. */
  _toggleFullscreen() {
    if (this.matches(':fullscreen')) { // document.fullscreenElement 는 shadow 리타게팅돼 부정확
      document.exitFullscreen?.();
    } else {
      this.requestFullscreen?.().catch(() => {}); // 사용자 제스처 필요 — 실패 무시
    }
  }

  /** 전체화면 중 커서가 상/하단 가장자리(~80px hot-zone)에 들어오면 컨트롤 슬라이드인,
   *  벗어나면 짧은 유예 후 슬라이드아웃. 중앙 이동만으론 안 뜸(슬라이드 감상 방해 최소화). */
  _onMouseMove(e) {
    if (!this._fullscreen) return;
    const stage = this.renderRoot.querySelector('.stage');
    const rect = stage ? stage.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const HOT = 80; // 가장자리 핫존 두께(px)
    const y = e?.clientY ?? -1;
    const inHotZone = y >= rect.bottom - HOT || y <= rect.top + HOT;
    if (inHotZone) {
      clearTimeout(this._controlsTimer);
      this._controlsVisible = true;
    } else if (this._controlsVisible) {
      clearTimeout(this._controlsTimer); // 핫존 이탈 → 짧은 유예 후 숨김(플리커 방지)
      this._controlsTimer = setTimeout(() => (this._controlsVisible = false), 400);
    }
  }

  _onKey(e) {
    // 청중 창 deck 은 자체 네비 금지(발표자만 제어) — ESC 종료는 audience.js 가 처리.
    if (this.audience) return;
    // 입력 포커스(검색창 등) 중에는 무시 — composedPath 로 Shadow DOM 내부 실제 타겟 확인
    const real = e.composedPath()[0];
    if (real && (/^(INPUT|TEXTAREA|SELECT)$/.test(real.tagName) || real.isContentEditable)) return;
    const k = e.key;
    // 블랙/화이트 스크린 중엔 아무 키나 해제 (표준 발표 동작)
    if (this._blank) { e.preventDefault(); this._blank = null; return; }
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); this._show(this._index + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); this._show(this._index - 1); }
    else if (k === 'Home') { e.preventDefault(); this._show(0); }
    else if (k === 'End') { e.preventDefault(); this._show(this._count - 1); }
    else if (k === 'f' || k === 'F' || k === 'F11') { e.preventDefault(); this._toggleFullscreen(); }
    else if ((k === 'p' || k === 'P') && e.shiftKey) { e.preventDefault(); this._startPresentation(); } // Shift+P=이중 창 발표
    else if (k === 'p' || k === 'P') { e.preventDefault(); this._togglePresenter(); } // 전체화면 중에도 발표자뷰
    else if (k === 'g' || k === 'G') { e.preventDefault(); this._overview = !this._overview; }
    else if (k === 'b' || k === 'B') { e.preventDefault(); this._blank = this._blank === 'black' ? null : 'black'; }
    else if (k === 'w' || k === 'W') { e.preventDefault(); this._blank = this._blank === 'white' ? null : 'white'; }
    else if (k === '?' || k === 'h' || k === 'H') { e.preventDefault(); this._helpOpen = !this._helpOpen; }
    else if (k === 'Escape') {
      if (this._overview) this._overview = false;
      else if (this._helpOpen) this._helpOpen = false;
      else this._numBuf = '';
    } else if (/^[0-9]$/.test(k)) {
      this._numBuf += k; // 번호 입력 누적
    } else if (k === 'Enter') {
      if (this._numBuf) { const n = parseInt(this._numBuf, 10); this._numBuf = ''; if (n >= 1) this._show(n - 1); }
    }
  }

  /** 전체화면 슬라이드 클릭 → 다음 / Shift+클릭 → 이전 (마우스만으로 진행) */
  _onStageClick(e) {
    if (!this._fullscreen || e.button !== 0) return;
    this._show(this._index + (e.shiftKey ? -1 : 1));
  }

  _togglePresenter() {
    if (this._presenter) this._exitPresenter();
    else this._enterPresenter();
  }

  // --- 이중 창 발표 (청중 창 = 별도 BrowserWindow, 발표자 창 = 이 창의 발표자 뷰) ---
  /** 발표 시작: 청중 창 띄우고(현재 src 전달) 이 창은 발표자 뷰로 전환. */
  _startPresentation() {
    if (!window.mdv?.startPresent || this.audience) return;
    window.mdv.startPresent(this.src);
    this._presenting = true;
    if (!this._presenter) this._enterPresenter(); // 발표자 뷰(현재+다음+노트+타이머)
    window.mdv.updatePresent?.({ index: this._index, blank: this._blank });
  }

  /** 발표 종료: 청중 창 닫기(메인이 present:ended 로 _presenting 해제). */
  _stopPresentation() {
    window.mdv?.endPresent?.();
    this._presenting = false;
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
      <div class="stage" @mousemove=${this._onMouseMove} @click=${this._onStageClick}>${unsafeHTML(this._html)}</div>
      <div class="navbar">
        <button @click=${() => this._show(this._index - 1)} ?disabled=${this._index <= 0}>◀</button>
        <span class="counter">${this._count ? this._index + 1 : 0} / ${this._count}</span>
        <button @click=${() => this._show(this._index + 1)} ?disabled=${this._index >= this._count - 1}>▶</button>
        <span class="nav-sep"></span>
        <button data-fs @click=${this._toggleFullscreen} title="전체화면 재생 (F)">⛶</button>
        <button data-presenter @click=${this._enterPresenter} title="발표자 보기">👤</button>
        <button
          data-present
          class=${this._presenting ? 'on' : ''}
          @click=${this._presenting ? this._stopPresentation : this._startPresentation}
          title=${this._presenting ? '발표 종료' : '발표 시작 — 청중 창 (Shift+P)'}
        >
          ${this._presenting ? '⏹' : '🖥'}
        </button>
        <span class="nav-sep"></span>
        <button class="exp" data-export @click=${() => this._export('pdf')} title="PDF로 내보내기">PDF</button>
        <button class="exp" data-export @click=${() => this._export('png')} title="슬라이드별 PNG">PNG</button>
        <button class="exp" data-export @click=${() => this._export('svg')} title="슬라이드별 SVG">SVG</button>
        <button class="exp" data-export @click=${() => this._export('html')} title="HTML로 내보내기">HTML</button>
      </div>
      ${this._fullscreen
        ? html`
            <div class="fs-progress"><div class="fs-progress-fill" style="width:${this._count ? ((this._index + 1) / this._count) * 100 : 0}%"></div></div>
            <div class="fs-pageno">${this._index + 1} / ${this._count}${this._numBuf ? html`<span class="fs-numbuf"> → ${this._numBuf}</span>` : ''}</div>
            <div class="fs-controls ${this._controlsVisible ? 'visible' : ''}">
              <button @click=${() => this._show(this._index - 1)} ?disabled=${this._index <= 0}>◀</button>
              <span class="counter">${this._index + 1} / ${this._count}</span>
              <button @click=${() => this._show(this._index + 1)} ?disabled=${this._index >= this._count - 1}>▶</button>
              <span class="nav-sep"></span>
              <span class="fs-clock">${this._clock()} · ⏱ ${this._fmtTime(this._elapsed)}</span>
              <span class="nav-sep"></span>
              <button @click=${() => (this._overview = !this._overview)} title="슬라이드 오버뷰 (G)">▦</button>
              <button @click=${() => (this._helpOpen = !this._helpOpen)} title="단축키 도움말 (?)">?</button>
              <button @click=${this._togglePresenter} title="발표자 보기 (P)">👤</button>
              <button @click=${this._toggleFullscreen} title="종료 (Esc)">✕</button>
            </div>`
        : ''}
      ${this._overview ? this._renderOverview() : ''}
      ${this._helpOpen ? this._renderHelp() : ''}
      ${this._blank ? html`<div class="fs-blank ${this._blank}" @click=${() => (this._blank = null)}></div>` : ''}
    `;
  }

  /** 현재 시각 HH:MM (벽시계) */
  _clock() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /** 슬라이드 오버뷰: 전체 슬라이드 썸네일 그리드. 클릭/Enter 로 점프, G/Esc 로 닫기. */
  _renderOverview() {
    const items = [];
    for (let i = 0; i < this._count; i++) {
      items.push(html`
        <button
          class="ov-cell ${i === this._index ? 'current' : ''}"
          @click=${() => { this._show(i); this._overview = false; }}
          title="슬라이드 ${i + 1}"
        >
          <div class="ov-thumb">${unsafeHTML(this._slideHtml(i))}</div>
          <div class="ov-no">${i + 1}</div>
        </button>`);
    }
    return html`
      <div class="fs-overview" @click=${(e) => { if (e.target.classList.contains('fs-overview')) this._overview = false; }}>
        <div class="ov-grid">${items}</div>
      </div>`;
  }

  _renderHelp() {
    const rows = [
      ['→ / Space / PageDown / 클릭', '다음 슬라이드'],
      ['← / Backspace / PageUp / Shift+클릭', '이전 슬라이드'],
      ['Home / End', '처음 / 끝'],
      ['숫자 + Enter', '해당 번호로 점프'],
      ['F / F11', '전체화면 재생'],
      ['P', '발표자 보기'],
      ['G', '슬라이드 오버뷰'],
      ['B / W', '블랙 / 화이트 스크린'],
      ['? / H', '이 도움말'],
      ['Esc', '오버레이 닫기 / 전체화면 종료'],
    ];
    return html`
      <div class="fs-help" @click=${() => (this._helpOpen = false)}>
        <div class="help-card" @click=${(e) => e.stopPropagation()}>
          <h3>단축키</h3>
          <table>
            ${rows.map((r) => html`<tr><td class="key">${r[0]}</td><td>${r[1]}</td></tr>`)}
          </table>
          <div class="help-close">아무 곳이나 클릭하거나 ? 로 닫기</div>
        </div>
      </div>`;
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
          <button
            class=${this._presenting ? 'on' : ''}
            @click=${this._presenting ? this._stopPresentation : this._startPresentation}
            title=${this._presenting ? '발표 종료(청중 창 닫기)' : '발표 시작 — 청중 창 (Shift+P)'}
          >
            ${this._presenting ? '⏹ 발표 종료' : '🖥 발표 시작'}
          </button>
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
