'use strict';

// 헤드리스 스모크 테스트: off-screen 으로 index.html 로드 후
// (1) ESM 모듈 로딩(CSP 통과), (2) Lit <mdv-app> 렌더 + 'Vault 열기' 버튼,
// (3) preload IPC API 노출, (4) markdown→sanitize 파이프라인 동작 을 검증한다.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const plantuml = require('../src/main/plantuml');
const resProtocol = require('../src/main/res-protocol');
const vault = require('../src/main/vault');
const linkIndex = require('../src/main/link-index');

const SAMPLE_VAULT = path.join(__dirname, '..', 'sample-vault');

// 실제 main.js 와 동일하게 PlantUML IPC 핸들러 등록 (전체 경로 검증용)
ipcMain.handle('plantuml:render', (_e, src) => plantuml.render(src));

// vault IPC (전문 검색/노트 읽기 전체 경로 검증용). main.js 와 동일 모듈 사용.
let smokeContents = {};
let smokeTitles = {};
ipcMain.handle('vault:openPath', async (_e, root) => {
  const tree = await vault.scanVault(root);
  const files = linkIndex.flatten(tree);
  const index = await linkIndex.buildIndex(files, (rel) => vault.readNote(root, rel));
  smokeContents = index.contents;
  smokeTitles = index.titles;
  const embedResolve = linkIndex.buildEmbedResolve(await vault.listFiles(root));
  const { contents, ...rest } = index;
  return { root, tree, index: { ...rest, embedResolve } };
});
ipcMain.handle('note:read', (_e, rel) => vault.readNote(SAMPLE_VAULT, rel));
ipcMain.handle('vault:search', (_e, q) => linkIndex.searchContent(smokeContents, smokeTitles, q));

// mdv-res 프로토콜 (privileged 등록은 ready 이전)
resProtocol.registerPrivileged();

app.disableHardwareAcceleration();

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('SMOKE FAIL:', msg);
};

app.whenReady().then(async () => {
  resProtocol.handle(() => SAMPLE_VAULT);
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
    },
  });

  // 외부 리소스 차단은 의도된 오프라인 동작(버그 아님) → 무해 처리
  const BENIGN = /math4\/es5\/startup\.js|viewer\.diagrams\.net|Electron Security Warning/;
  win.webContents.on('did-fail-load', (_e, code, desc) => fail(`did-fail-load ${code} ${desc}`));
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !BENIGN.test(message)) fail(`renderer console error: ${message}`);
  });

  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

    const result = await win.webContents.executeJavaScript(`(async () => {
      await customElements.whenDefined('mdv-app');
      const el = document.querySelector('mdv-app');
      await el.updateComplete;
      const btn = el.shadowRoot.querySelector('[data-open]');
      const sample = window.__mdvTest.renderMarkdown('# 제목\\n\\n**굵게** 그리고 \`코드\`.\\n\\n<script>alert(1)<\\/script>');
      const resolver = window.__mdvTest.makeResolver({ diagrams: 'Diagrams.md' });
      const wl = window.__mdvTest.renderMarkdown('[[Diagrams]] · [[없음]] · [[Diagrams|별칭]]', { resolveWikiLink: resolver });

      // GFM 태스크리스트 다단계 상태
      const tl = window.__mdvTest.renderMarkdown('- [ ] 할일\\n- [x] 완료\\n- [/] 진행\\n- [-] 취소');
      const taskOk = /class="task-marker"/.test(tl)
        && /data-task="todo"/.test(tl) && /data-task="done"/.test(tl)
        && /data-task="doing"/.test(tl) && /data-task="cancelled"/.test(tl);

      // 콜아웃 (> [!type] 제목)
      const co = window.__mdvTest.renderMarkdown('> [!warning] 주의사항\\n> 본문 내용');
      const calloutOk = /mdv-callout mdv-callout-warning/.test(co)
        && /mdv-callout-title">주의사항/.test(co) && /본문 내용/.test(co);

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      // Mermaid: ~~~ fence(백틱 회피) → placeholder → hydrate → svg
      const dd = document.createElement('div');
      dd.style.width = '600px';
      dd.innerHTML = window.__mdvTest.renderMarkdown('~~~mermaid\\ngraph TD\\n  A[시작]-->B[끝]\\n~~~');
      document.body.appendChild(dd);
      const diagPlaceholder = !!dd.querySelector('.mdv-diagram[data-lang="mermaid"]');
      await window.__mdvTest.hydrateDiagrams(dd);
      const mermaidSvg = !!dd.querySelector('.mdv-diagram svg');
      const mermaidErr = dd.querySelector('.mdv-diagram-msg')?.textContent || null;
      // 살균이 라벨을 깨지 않았는지: 노드 텍스트("시작"/"끝")가 살균 후에도 살아있어야 함.
      // mermaid foreignObject(htmlLabels) 사용 시 살균이 내용을 지우면 빈 다이어그램이 됨.
      const mermaidFO = !!dd.querySelector('.mdv-diagram foreignObject, .mdv-diagram foreignobject');
      const mermaidLabelOk = /시작/.test(dd.querySelector('.mdv-diagram')?.textContent || '');

      // draw.io: mxGraph XML → GraphViewer SVG (script 비동기 로드 → 폴링)
      const dx = document.createElement('div');
      dx.style.width = '600px';
      dx.innerHTML = window.__mdvTest.renderMarkdown('~~~drawio\\n' + ${JSON.stringify(
        '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
          '<mxCell id="2" value="Hi" style="rounded=1;" vertex="1" parent="1">' +
          '<mxGeometry x="20" y="20" width="100" height="40" as="geometry"/></mxCell></root></mxGraphModel>'
      )} + '\\n~~~');
      document.body.appendChild(dx);
      await window.__mdvTest.hydrateDiagrams(dx);
      for (let i = 0; i < 40; i++) { if (dx.querySelector('.mdv-diagram svg')) break; await sleep(100); }
      const drawioSvg = !!dx.querySelector('.mdv-diagram svg');
      const drawioErr = dx.querySelector('.mdv-diagram-msg')?.textContent || null;

      // D2: wasm+worker(인라인) → SVG (wasm 초기화로 시간 소요 → 폴링)
      const d2div = document.createElement('div');
      d2div.style.width = '600px';
      d2div.innerHTML = window.__mdvTest.renderMarkdown('~~~d2\\nx -> y\\n~~~');
      document.body.appendChild(d2div);
      await window.__mdvTest.hydrateDiagrams(d2div);
      for (let i = 0; i < 100; i++) { if (d2div.querySelector('.mdv-diagram svg')) break; await sleep(100); }
      const d2Svg = !!d2div.querySelector('.mdv-diagram svg');
      const d2Err = d2div.querySelector('.mdv-diagram-msg')?.textContent || null;
      // 살균이 d2 라벨을 깨지 않았는지: 노드 텍스트(x,y)가 살균 후에도 남아야 함.
      const d2Text = d2div.querySelector('.mdv-diagram svg')?.textContent || '';
      const d2LabelOk = /x/.test(d2Text) && /y/.test(d2Text);
      const d2FO = !!d2div.querySelector('.mdv-diagram foreignObject, .mdv-diagram foreignobject');

      // PlantUML: main process IPC(java -jar). 배선 필수, 실제 렌더는 java/jar 반입 시.
      const plantumlWired = typeof window.mdv.renderPlantUML === 'function';
      const pu = document.createElement('div');
      pu.style.width = '600px';
      pu.innerHTML = window.__mdvTest.renderMarkdown('~~~plantuml\\n@startuml\\nAlice -> Bob: hi\\n@enduml\\n~~~');
      document.body.appendChild(pu);
      await window.__mdvTest.hydrateDiagrams(pu);
      for (let i = 0; i < 80; i++) {
        if (pu.querySelector('.mdv-diagram svg') || pu.querySelector('.mdv-diagram-msg')) break;
        await sleep(100);
      }
      const plantumlSvg = !!pu.querySelector('.mdv-diagram svg');
      const plantumlErr = pu.querySelector('.mdv-diagram-msg')?.textContent?.split('\\n')[0] || null;

      // PlantUML Graphviz(dot) 의존 다이어그램 실검증: 클래스 다이어그램은 dot 필요.
      // tools/graphviz 번들로 렌더되면 svg, 미반입이면 에러메시지(배선만 확인).
      const puc = document.createElement('div');
      puc.style.width = '600px';
      puc.innerHTML = window.__mdvTest.renderMarkdown(
        '~~~plantuml\\n@startuml\\nclass Animal\\nclass Dog\\nAnimal <|-- Dog\\n@enduml\\n~~~'
      );
      document.body.appendChild(puc);
      await window.__mdvTest.hydrateDiagrams(puc);
      for (let i = 0; i < 80; i++) {
        if (puc.querySelector('.mdv-diagram svg') || puc.querySelector('.mdv-diagram-msg')) break;
        await sleep(100);
      }
      const plantumlDotSvg = !!puc.querySelector('.mdv-diagram svg');
      const plantumlDotErr = puc.querySelector('.mdv-diagram-msg')?.textContent?.split('\\n')[0] || null;

      // 다이어그램 SVG 산출물 새니타이즈: 신뢰않는 엔진(d2/plantuml 류)이 문자열 SVG 에
      // 악성 페이로드(script/onload/javascript:)를 섞어도 주입 전 제거되는지 검증.
      // (trusted 미지정 → registry 가 sanitizeDiagramSvg 통과시킴)
      window.__mdvTest.registerDiagram('eviltest', async () =>
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<script>window.__xssScript=1<\\/script>' +
        '<rect width="10" height="10" onload="window.__xssOnload=1"/>' +
        '<a href="javascript:window.__xssJs=1">x</a>' +
        '<text>안전라벨</text>' +
        '</svg>');
      const ev = document.createElement('div');
      ev.innerHTML = '<div class="mdv-diagram" data-lang="eviltest"><code class="mdv-diagram-src">x</code></div>';
      document.body.appendChild(ev);
      await window.__mdvTest.hydrateDiagrams(ev);
      const evHtml = ev.querySelector('.mdv-diagram')?.innerHTML || '';
      const sanitizeStripScript = !/<script/i.test(evHtml) && !window.__xssScript;
      const sanitizeStripHandler = !/onload/i.test(evHtml) && !window.__xssOnload;
      const sanitizeStripJsHref = !/javascript:/i.test(evHtml) && !window.__xssJs;
      const sanitizeKeepsBenign = /안전라벨/.test(evHtml); // 무해 콘텐츠는 보존
      const diagramSanitizeOk =
        sanitizeStripScript && sanitizeStripHandler && sanitizeStripJsHref && sanitizeKeepsBenign;

      // Marp: frontmatter 감지 + 슬라이드 렌더(2장) + 새니타이즈(script 제거)
      const marpDoc = '---\\nmarp: true\\n---\\n\\n# 슬라이드 1\\n\\n---\\n\\n# 슬라이드 2';
      const marpDetected = window.__mdvTest.hasMarpFrontmatter(marpDoc);
      const notMarp = window.__mdvTest.hasMarpFrontmatter('# 그냥 노트');
      const marpOut = window.__mdvTest.renderMarp(marpDoc);
      const marpSectionCount = (marpOut.html.match(/<section/g) || []).length;
      const marpHasCss = marpOut.css.length > 100;

      // 로컬 이미지: 상대경로 → mdv-res 치환 + 프로토콜이 실제 파일 서빙
      const imgHtml = window.__mdvTest.renderMarkdown('![x](assets/logo.svg)', { noteDir: '' });
      const imgRewritten = imgHtml.includes('src="mdv-res://vault/assets/logo.svg"');
      // 실제 앱과 동일하게 <img> 로드로 검증 (fetch 는 Electron 의 file:// CORS 로 막힘)
      const imgServed = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = 'mdv-res://vault/assets/logo.svg';
        setTimeout(() => resolve(false), 3000);
      });
      const evilMarp = window.__mdvTest.renderMarp('---\\nmarp: true\\n---\\n\\n[x](javascript:alert(1))\\n\\n<script>alert(2)<\\/script>');
      // 실행 가능한 위협만 검사: <script> 태그 + javascript: href (단순 텍스트 아님)
      const marpNoScript = !/<script/.test(evilMarp.html);
      const marpNoJsHref = !/href\\s*=\\s*["']?\\s*javascript:/i.test(evilMarp.html);
      const marpSanitized = marpNoScript && marpNoJsHref;

      // 독립 스크롤: 사이드바/콘텐츠가 각자 bounded scroll container 이고 독립적인가
      const appEl = document.querySelector('mdv-app');
      const sb = appEl.shadowRoot.querySelector('.sidebar');
      const ct = appEl.shadowRoot.querySelector('.view-scroll'); // 스크롤 컨테이너 (상단 토글바 분리 후)
      const tall = () => { const d = document.createElement('div'); d.style.height = '3000px'; d.textContent = '.'; return d; };
      sb.appendChild(tall());
      ct.appendChild(tall());
      void sb.offsetHeight; void ct.offsetHeight; // 강제 reflow
      const sbBounded = sb.clientHeight > 0 && sb.clientHeight < 2500;
      const ctBounded = ct.clientHeight > 0 && ct.clientHeight < 2500;
      const sbScrolls = sb.scrollHeight > sb.clientHeight + 200;
      const ctScrolls = ct.scrollHeight > ct.clientHeight + 200;
      sb.scrollTop = 400;
      const scrollIndependent = sb.scrollTop > 0 && ct.scrollTop === 0;
      const scrollOk = sbBounded && ctBounded && sbScrolls && ctScrolls && scrollIndependent;

      // 파일 트리 depth 들여쓰기: 중첩 mdv-tree 가 좌측 들여쓰기를 가지는가
      const t = document.createElement('mdv-tree');
      t.nodes = [{ type: 'dir', name: 'F', relPath: 'F', children: [{ type: 'file', name: 'a.md', relPath: 'F/a.md' }] }];
      document.body.appendChild(t);
      await t.updateComplete;
      const nestedTree = t.shadowRoot.querySelector('details > mdv-tree');
      const treeIndent = !!nestedTree && parseFloat(getComputedStyle(nestedTree).paddingLeft) > 0;

      // 플로팅 메뉴: 토글 버튼/패널 존재 + 클릭 시 open
      const menuToggle = appEl.shadowRoot.querySelector('.menu-toggle');
      const menuPanel = appEl.shadowRoot.querySelector('.menu-panel');
      if (menuToggle) menuToggle.click();
      await appEl.updateComplete;
      const menuOk = !!menuToggle && !!menuPanel && !!appEl.shadowRoot.querySelector('.menu.open');

      // 네이티브 메뉴 대체: appAction API 노출 + 플로팅 패널에 액션 버튼들
      const appActionApi = typeof window.mdv.appAction === 'function';
      const actionBtnCount = appEl.shadowRoot.querySelectorAll('.menu [data-action]').length;
      const menuActionsOk = appActionApi && actionBtnCount >= 5; // 보기 액션 6개 (창 액션은 타이틀바로 이동)
      const autoOpenOk = !!appEl.shadowRoot.querySelector('.menu [data-autoopen]');

      // md 원본(raw) 보기: 상태 주입 → 라인번호 pre, 렌더 아님
      appEl._src = '# 제목\\n본문줄';
      appEl._selected = 'x.md';
      appEl._rawView = true;
      await appEl.updateComplete;
      const rawEl = appEl.shadowRoot.querySelector('.raw');
      const rawOk = !!rawEl && rawEl.querySelectorAll('.raw-line').length === 2 && !rawEl.querySelector('h1') && /제목/.test(rawEl.textContent);

      // 최근 vault 리스트: API + 메뉴 항목(basename 표시)
      const recentApi = typeof window.mdv.openVaultPath === 'function';
      appEl._recent = ['D:/foo/MyVault', 'C:/x/Other'];
      appEl._menuOpen = true;
      await appEl.updateComplete;
      const recentItems = appEl.shadowRoot.querySelectorAll('.recent-item').length;
      const recentName = appEl.shadowRoot.querySelector('.recent-open')?.textContent.trim();
      const recentOk = recentApi && recentItems === 2 && recentName === 'MyVault';

      // 전문 검색: 실제 sample-vault 열기 → main 검색 IPC → 결과 패널 렌더 + 하이라이트
      const searchApi = typeof window.mdv.searchVault === 'function';
      await window.mdv.openVaultPath(${JSON.stringify(SAMPLE_VAULT)}); // main 측 contents 채움
      const searchRaw = await window.mdv.searchVault('다이어그램');
      const searchHasResult =
        Array.isArray(searchRaw) &&
        searchRaw.some((r) => r.relPath === 'Diagrams.md') &&
        searchRaw.some((r) => r.snippets.some((s) => s.parts.some((p) => p.hit)));
      // 미존재어는 0건
      const searchEmpty = (await window.mdv.searchVault('존재안함zzqqxx')).length === 0;
      // UI: 결과 패널(.sr-item) + 스니펫 하이라이트(mark) 렌더
      appEl._tree = [{ name: 'Diagrams.md', type: 'file', relPath: 'Diagrams.md' }];
      appEl._searchQuery = '다이어그램';
      appEl._searchResults = searchRaw;
      await appEl.updateComplete;
      const srItems = appEl.shadowRoot.querySelectorAll('.sr-item').length;
      const srMark = !!appEl.shadowRoot.querySelector('.sr-snip mark');
      // 본문 하이라이트: 검색 결과 클릭으로 노트 열면 본문에 <mark.search-hit> + 첫매치 스크롤
      appEl._searchQuery = '다이어그램';
      appEl._openSearchResult('Diagrams.md'); // → _onSelect(terms) → readNote(IPC) → 렌더
      for (let i = 0; i < 30; i++) {
        if (appEl.shadowRoot.querySelector('.note mark.search-hit')) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const noteMark = appEl.shadowRoot.querySelector('.note mark.search-hit');
      const noteHiOk = !!noteMark && /다이어그램/.test(noteMark.textContent);

      // 매치 네비 + 횟수 표시: 다중 매치, 현재 매치 .current, ‹ n/m ›, _gotoMatch 순환
      const matchTotal = appEl._searchMatchTotal;
      await appEl.updateComplete;
      const navBar = !!appEl.shadowRoot.querySelector('.view-bar .match-nav');
      const navCountTxt = appEl.shadowRoot.querySelector('.match-count')?.textContent.trim();
      const curBefore = appEl._searchMatchIdx;
      appEl._gotoMatch(1); // 다음 매치
      await appEl.updateComplete;
      const movedNext = matchTotal > 1 ? appEl._searchMatchIdx === curBefore + 1 : true;
      const curMarkOk = !!appEl.shadowRoot.querySelector('.note mark.search-hit.current');
      const hitsBadge = !!appEl.shadowRoot.querySelector('.sr-hits'); // 결과 패널 매치횟수 배지
      const navOk =
        matchTotal >= 1 && navBar && /^\\d+\\/\\d+$/.test(navCountTxt || '') && movedNext && curMarkOk && hitsBadge;

      // 검색 해제(✕) → 본문 마크 제거 (잔존 버그 회귀 가드)
      appEl._clearSearch();
      await appEl.updateComplete;
      const clearedOk =
        !appEl.shadowRoot.querySelector('.note mark.search-hit') &&
        appEl._searchTerms.length === 0 &&
        appEl._searchMatchTotal === 0;

      const searchOk =
        searchApi && searchHasResult && searchEmpty && srItems >= 1 && srMark && noteHiOk && navOk && clearedOk;
      appEl._searchQuery = ''; // 이후 테스트 위해 복원
      appEl._searchResults = [];
      appEl._searchTerms = [];
      appEl._selected = null;
      appEl._noteHtml = '';
      await appEl.updateComplete;

      // 사이드바 splitter: 핸들 존재 + 너비 갱신(.body grid 인라인) + 더블클릭 리셋
      const splitterEl = appEl.shadowRoot.querySelector('.splitter');
      appEl._sidebarWidth = 340;
      await appEl.updateComplete;
      const bodyCols = appEl.shadowRoot.querySelector('.body').getAttribute('style') || '';
      const widthApplied = /340px/.test(bodyCols);
      appEl._resetSidebarWidth();
      await appEl.updateComplete;
      const splitterOk = !!splitterEl && widthApplied && appEl._sidebarWidth === 280;

      // Ctrl+휠 줌: ctrl+wheel(up) → _appAction('zoomIn') 호출(브라우저 기본 줌 대신)
      let zoomCalled = null;
      const origAppAction = appEl._appAction.bind(appEl);
      appEl._appAction = (n) => { zoomCalled = n; };
      window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true }));
      const wheelZoomOk = zoomCalled === 'zoomIn';
      appEl._appAction = origAppAction;

      // CJK monospace 폰트: @font-face(vendor TTF) 로드 가능 + .raw/.note code 에 적용
      let fontFaceOk = false;
      try {
        await document.fonts.load('14px NanumGothicCoding'); // 실패 시 throw (파일 경로/유효성)
        fontFaceOk = document.fonts.check('14px NanumGothicCoding');
      } catch {}
      appEl._marpSrc = null;
      appEl._error = null;
      appEl._selected = 'Welcome.md';
      appEl._src = '# 한글 abc 정렬';
      appEl._rawView = true;
      await appEl.updateComplete;
      const rawFont = getComputedStyle(appEl.shadowRoot.querySelector('.raw')).fontFamily || '';
      const cjkFontOk = fontFaceOk && /NanumGothicCoding/i.test(rawFont);
      appEl._rawView = false;
      appEl._selected = null;
      appEl._src = '';
      await appEl.updateComplete;

      // 헤딩 앵커: 위키링크 data-heading 방출 + _scrollToHeading 정규화 매칭
      const wlH = window.__mdvTest.renderMarkdown('[[Diagrams#Mermaid]]', {
        resolveWikiLink: window.__mdvTest.makeResolver({ diagrams: 'Diagrams.md' }),
      });
      const dataHeadingOk = /data-heading="Mermaid"/.test(wlH);
      const hProbe = document.createElement('div');
      hProbe.innerHTML = '<h2> 둘러보기 </h2><h3>다른 섹션</h3>';
      const headingFound = appEl._scrollToHeading(hProbe, '둘러보기'); // 공백/대소문자 정규화
      const headingMiss = appEl._scrollToHeading(hProbe, '없는헤딩');
      const headingAnchorOk = dataHeadingOk && headingFound === true && headingMiss === false;

      // Ctrl+P 빠른 전환기: 단축키 오픈 + 퍼지 필터 + Enter 선택
      appEl._tree = [
        { name: 'Welcome.md', type: 'file', relPath: 'Welcome.md' },
        { name: 'Diagrams.md', type: 'file', relPath: 'Diagrams.md' },
        { name: 'Projects', type: 'dir', relPath: 'Projects', children: [
          { name: 'Roadmap.md', type: 'file', relPath: 'Projects/Roadmap.md' } ] },
      ];
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true }));
      await appEl.updateComplete;
      const paletteOpened = appEl._paletteOpen && !!appEl.shadowRoot.querySelector('.palette');
      appEl._paletteQuery = 'road';
      appEl._paletteIdx = 0;
      await appEl.updateComplete;
      const pItems = appEl.shadowRoot.querySelectorAll('.palette-item');
      const fuzzyOk = pItems.length >= 1 && /Roadmap/.test(pItems[0].textContent);
      let openedRel = null;
      const origSel = appEl._onSelect.bind(appEl);
      appEl._onSelect = (rel) => { openedRel = rel; };
      appEl.shadowRoot.querySelector('.palette-input')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));
      const enterOk = openedRel === 'Projects/Roadmap.md' && appEl._paletteOpen === false;
      appEl._onSelect = origSel;
      const paletteOk = paletteOpened && fuzzyOk && enterOk;
      appEl._paletteOpen = false;
      await appEl.updateComplete;

      // 위키 임베드: 이미지(![[logo.svg]]) + 노트 transclusion(![[Welcome]])
      const vd = await window.mdv.openVaultPath(${JSON.stringify(SAMPLE_VAULT)});
      appEl._index = vd.index;
      appEl._resolver = window.__mdvTest.makeResolver(vd.index.resolve);
      appEl._marpSrc = null;
      appEl._rawView = false;
      appEl._error = null;
      appEl._selected = 'Diagrams.md';
      appEl._curDir = '';
      appEl._searchTerms = [];
      appEl._src = '![[assets/logo.svg]]\\n\\n![[Welcome]]';
      appEl._renderNoteHtml();
      await appEl.updateComplete;
      for (let i = 0; i < 30; i++) {
        if (appEl.shadowRoot.querySelector('.mdv-embed-img') &&
            appEl.shadowRoot.querySelector('.mdv-transclusion')) break;
        await sleep(50);
      }
      const embedImg = appEl.shadowRoot.querySelector('.mdv-embed-img');
      const imgEmbedOk = !!embedImg && /mdv-res:.*logo\\.svg/i.test(embedImg.src);
      const transEl = appEl.shadowRoot.querySelector('.mdv-transclusion');
      const transOk = !!transEl && transEl.textContent.trim().length > 0;
      const embedOk = imgEmbedOk && transOk;

      // 커스텀 타이틀바: 바 + 컨트롤 3개(min/max/close) + 최대화 구독 API
      const titlebar = appEl.shadowRoot.querySelector('.titlebar');
      const tbBtns = appEl.shadowRoot.querySelectorAll('.tb-controls .tb-btn').length;
      const titlebarOk = !!titlebar && tbBtns === 3 && typeof window.mdv.onMaximizeChange === 'function';

      // Marp export: exportMarp API + 덱 navbar export 버튼(PDF/HTML)
      const deckEl = document.createElement('mdv-deck');
      deckEl.src = '---\\nmarp: true\\n---\\n# S1\\n\\n---\\n\\n# S2';
      document.body.appendChild(deckEl);
      await deckEl.updateComplete;
      await new Promise((r) => setTimeout(r, 80));
      await deckEl.updateComplete;
      const exportBtns = deckEl.shadowRoot.querySelectorAll('[data-export]').length;
      const marpExportOk = typeof window.mdv.exportMarp === 'function' && exportBtns === 4; // PDF/PNG/SVG/HTML

      // Marp 전체화면 재생: 재생 버튼 + 키 가드 + 전체화면 컨트롤 렌더 (실제 진입은 헤드리스 불가)
      const fsBtn = !!deckEl.shadowRoot.querySelector('[data-fs]');
      // 입력 포커스 중 키 무시(composedPath 가드): _onKey 가 INPUT 타겟이면 슬라이드 이동 안 함
      const idxBefore = deckEl._index;
      const fakeInput = document.createElement('input');
      deckEl._onKey({ key: 'ArrowRight', composedPath: () => [fakeInput], preventDefault() {} });
      const keyGuardOk = deckEl._index === idxBefore;
      // _fullscreen 상태면 fs-controls 렌더 + mousemove 로 visible
      deckEl._fullscreen = true;
      await deckEl.updateComplete;
      const fsCtrlEl = deckEl.shadowRoot.querySelector('.fs-controls');
      deckEl._onMouseMove();
      await deckEl.updateComplete;
      const fsControlsOk = !!fsCtrlEl && deckEl.shadowRoot.querySelector('.fs-controls.visible') !== null;
      deckEl._fullscreen = false;
      deckEl._controlsVisible = false;
      await deckEl.updateComplete;
      const marpFsOk = fsBtn && keyGuardOk && fsControlsOk;

      // Marp presenter 모드: 노트 추출 + 현재/다음 패널 + 타이머 + 종료
      deckEl.src = '---\\nmarp: true\\n---\\n# A\\n\\n<!-- 첫 슬라이드 노트 -->\\n\\n---\\n\\n# B';
      await deckEl.updateComplete;
      await new Promise((r) => setTimeout(r, 80));
      await deckEl.updateComplete;
      deckEl._enterPresenter();
      await deckEl.updateComplete;
      await new Promise((r) => setTimeout(r, 60));
      await deckEl.updateComplete;
      const prEl = !!deckEl.shadowRoot.querySelector('.presenter');
      const prCur = !!deckEl.shadowRoot.querySelector('.pr-current section');
      const prNext = !!deckEl.shadowRoot.querySelector('.pr-next section');
      const prNotesOk = /첫 슬라이드 노트/.test(deckEl.shadowRoot.querySelector('.pr-notes')?.textContent || '');
      const prTimerFmt = /^\\d\\d:\\d\\d$/.test((deckEl.shadowRoot.querySelector('.pr-timer')?.textContent || '').trim());
      const prRunning = deckEl._running === true;
      deckEl._exitPresenter();
      await deckEl.updateComplete;
      const prExited = !deckEl.shadowRoot.querySelector('.presenter');
      const presenterOk = prEl && prCur && prNext && prNotesOk && prTimerFmt && prRunning && prExited;

      // 다이어그램 zoom/pan 라이트박스: 클릭 오픈 + 휠 줌 + export API + 닫기
      const dWrap = document.createElement('div');
      dWrap.className = 'mdv-diagram';
      const innerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      innerSvg.setAttribute('width', '1280');
      innerSvg.setAttribute('height', '720');
      dWrap.appendChild(innerSvg);
      appEl._onNoteClick({ target: innerSvg, preventDefault() {} }); // 다이어그램 클릭 경로
      await appEl.updateComplete;
      const lbEl = appEl.shadowRoot.querySelector('.lb-overlay');
      const lbHasSvg = !!appEl.shadowRoot.querySelector('.lb-content svg');
      const scaleBefore = appEl._lb.scale;
      appEl._lbWheel({ deltaY: -100, clientX: 100, clientY: 100, preventDefault() {} });
      const zoomChanged = appEl._lb.scale !== scaleBefore;
      const exportApiOk = typeof window.mdv.exportDiagram === 'function';
      appEl._closeLightbox();
      await appEl.updateComplete;
      const lbClosed = !appEl.shadowRoot.querySelector('.lb-overlay');
      const lightboxOk = !!lbEl && lbHasSvg && zoomChanged && exportApiOk && lbClosed;

      // 다이어그램 메모이즈: 같은 소스 두 번째 hydrate 는 캐시 히트로 svg 즉시
      const mk1 = document.createElement('div');
      mk1.innerHTML = window.__mdvTest.renderMarkdown('~~~mermaid\\ngraph TD\\n  X-->Y\\n~~~');
      document.body.appendChild(mk1);
      await window.__mdvTest.hydrateDiagrams(mk1);
      const mk2 = document.createElement('div');
      mk2.innerHTML = window.__mdvTest.renderMarkdown('~~~mermaid\\ngraph TD\\n  X-->Y\\n~~~');
      document.body.appendChild(mk2);
      await window.__mdvTest.hydrateDiagrams(mk2); // 캐시 히트 경로
      const memoizeOk = !!mk1.querySelector('.mdv-diagram svg') && !!mk2.querySelector('.mdv-diagram svg');

      // [버그] 원본↔렌더 토글 후 다이어그램 재hydrate: mermaid 노트 → 렌더→원본→렌더
      appEl._marpSrc = null;
      appEl._selected = 'd.md';
      appEl._curDir = '';
      appEl._rawView = false;
      appEl._src = '~~~mermaid\\ngraph TD\\n  A-->B\\n~~~';
      appEl._renderNoteHtml();
      await appEl.updateComplete;
      const waitSvg = async () => {
        for (let i = 0; i < 40; i++) {
          if (appEl.shadowRoot.querySelector('.note .mdv-diagram svg')) return true;
          await sleep(100);
        }
        return false;
      };
      const svgBefore = await waitSvg();
      appEl._rawView = true; // 원본 보기
      await appEl.updateComplete;
      appEl._rawView = false; // 렌더 복귀
      await appEl.updateComplete;
      const svgAfter = await waitSvg();
      const reHydrateOk = svgBefore && svgAfter;

      // 콘텐츠 상단 토글 바: 노트 선택 시 렌더/원본 탭 노출
      const viewBarOk = appEl.shadowRoot.querySelectorAll('.view-bar .tab').length >= 2;

      return {
        hasOpenApi: typeof window.mdv.openVault === 'function',
        hasReadApi: typeof window.mdv.readNote === 'function',
        hasOnChange: typeof window.mdv.onVaultChanged === 'function',
        btnText: btn && btn.textContent.trim(),
        mdHasH1: /<h1>제목<\\/h1>/.test(sample),
        mdStrong: /<strong>굵게<\\/strong>/.test(sample),
        mdSanitized: !/<script>/.test(sample),
        wlResolved: wl.includes('data-target="Diagrams.md"'),
        wlBroken: /wikilink broken/.test(wl),
        wlAlias: wl.includes('별칭'),
        diagPlaceholder,
        mermaidSvg,
        mermaidErr,
        drawioSvg,
        drawioErr,
        d2Svg,
        d2Err,
        plantumlWired,
        plantumlSvg,
        plantumlErr,
        plantumlDotSvg,
        plantumlDotErr,
        calloutOk,
        marpDetected,
        notMarp,
        marpSectionCount,
        marpHasCss,
        marpSanitized,
        imgRewritten,
        imgServed,
        scrollOk,
        treeIndent,
        taskOk,
        menuOk,
        menuActionsOk,
        actionBtnCount,
        autoOpenOk,
        rawOk,
        recentOk,
        searchOk,
        splitterOk,
        wheelZoomOk,
        cjkFontOk,
        headingAnchorOk,
        paletteOk,
        embedOk,
        titlebarOk,
        marpExportOk,
        marpFsOk,
        presenterOk,
        lightboxOk,
        reHydrateOk,
        viewBarOk,
        memoizeOk,
        diagramSanitizeOk,
        sanitizeDiag: { sanitizeStripScript, sanitizeStripHandler, sanitizeStripJsHref, sanitizeKeepsBenign },
        mermaidFO, mermaidLabelOk, d2LabelOk, d2FO,
        scrollDiag: {
          hostDisp: getComputedStyle(appEl).display, // flex 여야 함 (document display:block 덮어쓰기 회귀 감지)
          bodyH: appEl.shadowRoot.querySelector('.body').clientHeight,
          sbC: sb.clientHeight, sbS: sb.scrollHeight, ctC: ct.clientHeight,
        },
      };
    })()`);

    console.log('result:', JSON.stringify(result));
    if (!result.hasOpenApi) fail('mdv.openVault 미노출');
    if (!result.hasReadApi) fail('mdv.readNote 미노출');
    if (!result.hasOnChange) fail('mdv.onVaultChanged 미노출');
    if (result.btnText !== 'Vault 열기') fail(`버튼 텍스트 비정상: ${result.btnText}`);
    if (!result.mdHasH1) fail('markdown h1 렌더 실패');
    if (!result.mdStrong) fail('markdown strong 렌더 실패');
    if (!result.mdSanitized) fail('DOMPurify 새니타이즈 실패 — <script> 통과됨');
    if (!result.wlResolved) fail('위키링크 해결 실패 — data-target 없음');
    if (!result.wlBroken) fail('미해결 위키링크 broken 표시 실패');
    if (!result.wlAlias) fail('위키링크 별칭 렌더 실패');
    if (!result.diagPlaceholder) fail('다이어그램 fence placeholder 생성 실패');
    if (!result.mermaidSvg) fail(`mermaid SVG 렌더 실패 (${result.mermaidErr || '원인 미상'})`);
    if (!result.drawioSvg) fail(`drawio SVG 렌더 실패 (${result.drawioErr || '원인 미상'})`);
    if (!result.d2Svg) fail(`d2 SVG 렌더 실패 (${result.d2Err || '원인 미상'})`);
    // PlantUML: IPC 배선은 필수. 실제 렌더는 java/jar 반입 여부에 따름(svg 또는 클린 에러)
    if (!result.plantumlWired) fail('renderPlantUML API 미노출');
    if (!result.plantumlSvg && !result.plantumlErr) fail('PlantUML IPC 응답 이상 (svg/에러 모두 없음)');
    console.log(result.plantumlSvg ? 'PlantUML: 실제 렌더 ✅' : `PlantUML: 배선 OK, 렌더 보류 (${result.plantumlErr})`);
    // dot 의존(클래스) 다이어그램: svg(번들 graphviz) 또는 클린 에러(미반입). svg/에러 둘 다 없으면 이상
    if (!result.plantumlDotSvg && !result.plantumlDotErr) fail('PlantUML dot 다이어그램 응답 이상');
    console.log(
      result.plantumlDotSvg
        ? 'PlantUML Graphviz(dot): 클래스 다이어그램 렌더 ✅'
        : `PlantUML Graphviz(dot): 렌더 보류 (${result.plantumlDotErr})`
    );
    if (!result.marpDetected) fail('Marp frontmatter 감지 실패');
    if (result.notMarp) fail('Marp 오탐지 (일반 노트를 marp로 판정)');
    if (result.marpSectionCount !== 2) fail(`Marp 슬라이드 수 이상: ${result.marpSectionCount} (기대 2)`);
    if (!result.marpHasCss) fail('Marp CSS 미생성');
    if (!result.marpSanitized) fail('Marp 새니타이즈 실패 — <script> 통과');
    if (!result.imgRewritten) fail('로컬 이미지 src → mdv-res 치환 실패');
    if (!result.imgServed) fail('mdv-res 프로토콜 이미지 서빙 실패');
    if (!result.scrollOk) fail(`독립 스크롤 실패 — ${JSON.stringify(result.scrollDiag)}`);
    if (!result.treeIndent) fail('파일 트리 중첩 들여쓰기 실패');
    if (!result.taskOk) fail('GFM 태스크리스트 체크박스 렌더 실패');
    if (!result.calloutOk) fail('콜아웃(> [!type]) 렌더 실패');
    if (!result.menuOk) fail('플로팅 메뉴 토글/패널 실패');
    if (!result.menuActionsOk) fail(`창/보기 액션 메뉴 실패 (appAction API/버튼수=${result.actionBtnCount})`);
    if (!result.autoOpenOk) fail('시작 시 자동열기 토글 체크박스 없음');
    if (!result.rawOk) fail('md 원본(raw) 보기 렌더 실패');
    if (!result.recentOk) fail('최근 vault 리스트 실패');
    if (!result.searchOk) fail('전문 검색 실패 (IPC/결과/하이라이트/결과패널)');
    if (!result.splitterOk) fail('사이드바 splitter 너비 조절/리셋 실패');
    if (!result.wheelZoomOk) fail('Ctrl+휠 줌 실패 (ctrl+wheel → zoomIn 미호출)');
    if (!result.cjkFontOk) fail('CJK monospace 폰트 실패 (@font-face 로드/적용)');
    if (!result.headingAnchorOk) fail('헤딩 앵커 스크롤 실패 (data-heading/매칭)');
    if (!result.paletteOk) fail('Ctrl+P 빠른 전환기 실패 (오픈/퍼지/Enter)');
    if (!result.embedOk) fail('위키 임베드 실패 (이미지/transclusion)');
    if (!result.titlebarOk) fail('커스텀 타이틀바 실패');
    if (!result.marpExportOk) fail('Marp export(API/덱 버튼) 실패');
    if (!result.marpFsOk) fail('Marp 전체화면 재생 실패 (재생버튼/키가드/fs컨트롤)');
    if (!result.presenterOk) fail('Marp presenter 모드 실패 (패널/노트/타이머/종료)');
    if (!result.lightboxOk) fail('다이어그램 라이트박스 실패 (오픈/줌/export API/닫기)');
    if (!result.reHydrateOk) fail('원본↔렌더 토글 후 다이어그램 재hydrate 실패');
    if (!result.viewBarOk) fail('콘텐츠 상단 토글 바 탭 실패');
    if (!result.memoizeOk) fail('다이어그램 메모이즈(캐시 히트) 실패');
    if (!result.diagramSanitizeOk) fail(`다이어그램 SVG 새니타이즈 실패 — ${JSON.stringify(result.sanitizeDiag)}`);
    if (!result.mermaidLabelOk) fail('mermaid 라벨 손실 — 살균이 foreignObject htmlLabels 를 제거함(trusted 면제 회귀)');
    if (!result.d2LabelOk) fail('d2 라벨 손실 — 살균이 노드 텍스트를 제거함');
    console.log(`다이어그램 라벨: mermaid(FO=${result.mermaidFO}) OK, d2(FO=${result.d2FO}) OK`);
  } catch (e) {
    fail(String(e));
  }

  if (!failed) console.log('SMOKE PASS ✅');
  app.exit(failed ? 1 : 0);
});
