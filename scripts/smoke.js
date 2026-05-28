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
const updater = require('../src/main/updater');

const SAMPLE_VAULT = path.join(__dirname, '..', 'sample-vault');

// 실제 main.js 와 동일하게 PlantUML IPC 핸들러 등록 (전체 경로 검증용)
ipcMain.handle('plantuml:render', (_e, src) => plantuml.render(src));
ipcMain.handle('plantuml:status', () => plantuml.status());

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
ipcMain.handle('vault:samplePath', () => SAMPLE_VAULT);
// 발표 이중 창: 실제 청중 창은 안 띄우고 invoke 만 성공 처리(렌더러 콘솔 에러 방지). send 채널은 핸들러 불요.
ipcMain.handle('present:open', () => true);

// 자동 업데이트: mock transport(네트워크 없이) 로 새 버전 응답 → checkUpdate 전체 경로 검증.
ipcMain.handle('update:check', () =>
  updater.checkForUpdate('0.1.0', async () => ({
    tag_name: 'v9.9.9',
    body: '릴리스 노트',
    assets: [{ name: 'md-viewer-win-x64.zip', browser_download_url: 'http://x/a.zip', size: 7 }],
  }))
);
// 적용은 실제 스왑 없이 스텁(헤드리스에선 dev 모드라 main 도 ok:false). 렌더러 경로만 검증.
ipcMain.handle('update:apply', () => ({ ok: false, error: 'smoke-stub' }));

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
      const taskHtml = window.__mdvTest.renderMarkdown('- [ ] 할일\\n- [x] 완료\\n- [/] 진행\\n- [-] 취소');
      const taskOk = /class="task-marker"/.test(taskHtml)
        && /data-task="todo"/.test(taskHtml) && /data-task="done"/.test(taskHtml)
        && /data-task="doing"/.test(taskHtml) && /data-task="cancelled"/.test(taskHtml);

      // 콜아웃 (> [!type] 제목) — 본문 중복 렌더 안 됨(정확히 1회)
      const co = window.__mdvTest.renderMarkdown('> [!warning] 주의사항\\n> 본문콘텐츠X');
      const coBodyCount = (co.match(/본문콘텐츠X/g) || []).length;
      const calloutOk = /mdv-callout mdv-callout-warning/.test(co)
        && /mdv-callout-title">주의사항/.test(co) && coBodyCount === 1;

      // 코드 syntax highlight (highlight.js) — ~~~ fence(백틱 회피)
      const hl = window.__mdvTest.renderMarkdown('~~~js\\nconst x = 1;\\n~~~');
      const highlightOk = /class="hljs"/.test(hl) && /hljs-keyword/.test(hl);

      // 수식 (KaTeX) — 인라인 $...$ + 블록 $$...$$ (백슬래시 회피 위해 단순식)
      const mi = window.__mdvTest.renderMarkdown('등가 $E=mc^2$ 식');
      const mb = window.__mdvTest.renderMarkdown('$$a^2 + b^2 = c^2$$');
      const mathOk = /class="katex"/.test(mi) && /mdv-math-block/.test(mb) && /katex/.test(mb);

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
      // [버그] D2 거대 빈영역 방지: 외부 svg 에 width 속성 박혀 자연 크기로 렌더되는지
      const d2El = d2div.querySelector('.mdv-diagram svg');
      const d2Sized = !!d2El && d2El.hasAttribute('width') && d2El.hasAttribute('height');

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
      // 오프라인: 이모지/화살표가 twemoji CDN 이미지로 바뀌지 않아야 (폐쇄망 로드 실패 방지)
      const marpEmoji = window.__mdvTest.renderMarp('---\\nmarp: true\\n---\\n# 화살표 ◀ ▶ 😀');
      const marpOfflineOk = !/jsdelivr|twemoji/.test(marpEmoji.html);

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
      const sb = appEl.shadowRoot.querySelector('.sidebar-scroll'); // 검색박스 분리 후 스크롤 영역
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

      // 대용량 트리 lazy: >400 노드면 폴더 기본 접힘 + 펼칠 때만 children 마운트, 선택 조상은 자동 펼침
      // (이 in-page 스크립트는 외부 템플릿 리터럴이라 백틱/[달러]{} 금지 — 문자열 연결 사용)
      const bigKids = [];
      for (let i = 0; i < 5; i++) {
        const fileNodes = [];
        for (let j = 0; j < 120; j++) fileNodes.push({ type: 'file', name: 'n' + i + '-' + j + '.md', relPath: 'D' + i + '/n' + i + '-' + j + '.md' });
        bigKids.push({ type: 'dir', name: 'D' + i, relPath: 'D' + i, children: fileNodes });
      }
      const bigTree = document.createElement('mdv-tree'); // 총 5+600=605 노드 > 400 → lazy
      bigTree.nodes = bigKids;
      bigTree.selected = 'D2/n2-3.md'; // D2 는 선택 조상 → 자동 펼침
      document.body.appendChild(bigTree);
      await bigTree.updateComplete;
      const lazyOn = bigTree._isLazy() === true;
      const dets = [...bigTree.shadowRoot.querySelectorAll('li > details')];
      const d0 = dets.find((d) => (d.querySelector('summary') || {}).textContent === 'D0');
      const d2 = dets.find((d) => (d.querySelector('summary') || {}).textContent === 'D2');
      const d0Collapsed = !!d0 && !d0.open && !d0.querySelector('mdv-tree'); // 접힘 + children 미마운트
      const d2AutoOpen = !!d2 && d2.open && !!d2.querySelector('mdv-tree'); // 선택 조상 자동 펼침 + 마운트
      d0.open = true; d0.dispatchEvent(new Event('toggle')); // 사용자 펼침
      await bigTree.updateComplete;
      const d0Mounts = !!d0.querySelector('mdv-tree'); // 펼치면 children 마운트
      const treeLazyOk = lazyOn && d0Collapsed && d2AutoOpen && d0Mounts;

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

      // 아웃라인(TOC) 패널: 헤딩 목차 빌드 + 패널 렌더
      appEl._marpSrc = null;
      appEl._rawView = false;
      appEl._error = null;
      appEl._selected = 'toc.md';
      appEl._src = '# 제목1\\n\\n## 절1\\n\\n## 절2\\n\\n### 소절';
      appEl._tocOpen = true;
      appEl._renderNoteHtml();
      await appEl.updateComplete;
      await appEl.updateComplete; // _buildToc 가 _toc(reactive) 설정 → 후속 렌더 대기
      await sleep(30);
      await appEl.updateComplete;
      const tocItems = appEl.shadowRoot.querySelectorAll('.toc-panel .toc-item').length;
      const tocOk = !!appEl.shadowRoot.querySelector('.toc-panel') && tocItems === 4 && appEl._toc.length === 4;
      appEl._tocOpen = false;
      appEl._selected = null;
      appEl._src = '';
      await appEl.updateComplete;

      // 태그: #tag 칩 렌더 + 필터 결과 패널
      const tg = window.__mdvTest.renderMarkdown('관련 #프로젝트 항목 #todo');
      const tagChipOk = /class="mdv-tag"/.test(tg) && /data-tag="프로젝트"/.test(tg) && /#프로젝트/.test(tg);
      appEl._tree = [{ name: 'A.md', type: 'file', relPath: 'A.md' }];
      appEl._index = {
        tagIndex: { proj: ['A.md', 'B.md'] },
        titles: { 'A.md': 'A', 'B.md': 'B' },
        resolve: {}, backlinks: {},
      };
      appEl._tagFilter = 'proj';
      await appEl.updateComplete;
      const tagFilterOk = appEl.shadowRoot.querySelector('.tagfilter-head')
        && appEl.shadowRoot.querySelectorAll('.search-results .sr-item').length === 2;
      appEl._tagFilter = null;
      await appEl.updateComplete;
      const tagOk = tagChipOk && !!tagFilterOk;

      // 테마 토글 + 폰트 배율 (document 레벨 적용)
      const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      appEl._applyTheme('light');
      const themeLightOk = document.documentElement.dataset.theme === 'light';
      const lightBtnOk = cssVar('--btn') === '#e2e5ea'; // 버튼 팔레트도 라이트로 전환
      // 라이트 모드 가시성: 코드 하이라이트/콜아웃/태그/에러 의미색이 라이트 팔레트로 전환
      const lightVisOk = cssVar('--hl-comment') === '#6e7781' && cssVar('--hl-keyword') === '#cf222e'
        && cssVar('--cl-tip') === '#1a7f64' && cssVar('--cl-warn') === '#9a6700'
        && cssVar('--tag-fg') === '#1a7f64' && cssVar('--danger-fg') === '#cf222e';
      appEl._applyTheme('dark');
      const themeDarkOk = !document.documentElement.dataset.theme;
      const darkBtnOk = cssVar('--btn') === '#3a3d41';
      const darkVisOk = cssVar('--hl-comment') === '#8b949e' && cssVar('--cl-tip') === '#4ec9b0'; // 다크 복귀
      appEl._applyFontScale(1.25);
      const fontScaleOk = cssVar('--font-scale') === '1.25';
      appEl._applyFontScale(1);
      const themeOk = themeLightOk && themeDarkOk && fontScaleOk && lightBtnOk && darkBtnOk
        && lightVisOk && darkVisOk;

      // mermaid 테마 'auto' 옵션 + 재렌더(_rerenderNote: 캐시 무효화→재hydrate)
      appEl._menuOpen = true;
      await appEl.updateComplete;
      const mermaidAutoOpt = Array.from(appEl.shadowRoot.querySelectorAll('option')).some((o) => o.value === 'auto');
      appEl._menuOpen = false;
      appEl._marpSrc = null;
      appEl._rawView = false;
      appEl._searchTerms = [];
      appEl._selected = 'm.md';
      appEl._src = '~~~mermaid\\ngraph TD\\n  A-->B\\n~~~';
      appEl._renderNoteHtml();
      for (let i = 0; i < 40; i++) { if (appEl.shadowRoot.querySelector('.note .mdv-diagram svg')) break; await sleep(50); }
      const reBefore = !!appEl.shadowRoot.querySelector('.note .mdv-diagram svg');
      appEl._rerenderNote();
      await appEl.updateComplete;
      for (let i = 0; i < 40; i++) { if (appEl.shadowRoot.querySelector('.note .mdv-diagram svg')) break; await sleep(50); }
      const reAfter = !!appEl.shadowRoot.querySelector('.note .mdv-diagram svg');
      const mermaidAutoOk = mermaidAutoOpt && reBefore && reAfter;
      appEl._selected = null;
      appEl._src = '';
      await appEl.updateComplete;

      // 노트 스크롤 위치 기억: 재방문 시 저장값을 복원 대상(_pendingScroll)으로
      appEl._marpSrc = null;
      appEl._searchTerms = [];
      appEl._scrollPos.set('Welcome.md', 99);
      appEl._selected = null;
      const selPromise = appEl._onSelect('Welcome.md'); // 동기부에서 _pendingScroll 설정
      const scrollMemOk = appEl._pendingScroll === 99;
      await selPromise;
      await appEl.updateComplete;

      // 라이브 인플레이스 갱신 시 스크롤 위치 유지 (파일 감시 재렌더가 맨 위로 안 튐)
      appEl._marpSrc = null; appEl._searchTerms = []; appEl._selected = 'Welcome.md';
      // ① _onSelect 라이브 경로: liveScroll → _pendingScroll, 렌더 뷰 보존
      appEl._rawView = false;
      const lp1 = appEl._onSelect('Welcome.md', null, null, false, 137);
      const liveScrollKeep = appEl._pendingScroll === 137 && appEl._rawView === false;
      await lp1;
      // ② 원본 보기 중 라이브 갱신: 뷰 모드(_rawView) 보존 + 스크롤 유지
      appEl._rawView = true; appEl._selected = 'Welcome.md';
      const lp2 = appEl._onSelect('Welcome.md', null, null, false, 200);
      const liveKeepsRaw = appEl._rawView === true && appEl._pendingScroll === 200;
      await lp2; appEl._rawView = false;
      // ③ _applyVault(keepSelection) 이 현재 .view-scroll scrollTop 을 캡처해 전달
      let liveApplyFwd = false;
      const vsLive = appEl.shadowRoot.querySelector('.view-scroll');
      if (vsLive) {
        Object.defineProperty(vsLive, 'scrollTop', { configurable: true, writable: true, value: 88 });
        appEl._selected = 'Welcome.md'; appEl._marpSrc = null;
        appEl._applyVault({ root: appEl._root, tree: appEl._tree, index: appEl._index }, true);
        liveApplyFwd = appEl._pendingScroll === 88;
      }
      const liveUpdateScrollOk = liveScrollKeep && liveKeepsRaw && liveApplyFwd;
      await appEl.updateComplete;

      // 원본↔렌더 뷰 전환 시 스크롤 비율 보존 (높이체계 상이→근사 매핑)
      appEl._marpSrc = null; appEl._searchTerms = []; appEl._rawView = false;
      await appEl._onSelect('Welcome.md'); await appEl.updateComplete;
      let toggleRatioOk = false, toggleRestoreOk = false;
      const vsT = appEl.shadowRoot.querySelector('.view-scroll');
      if (vsT) {
        // 렌더 뷰 가정: scrollHeight 1000, client 200 → range 800, scrollTop 400 → 비율 0.5
        Object.defineProperty(vsT, 'scrollHeight', { configurable: true, get: () => 1000 });
        Object.defineProperty(vsT, 'clientHeight', { configurable: true, get: () => 200 });
        let st = 400;
        Object.defineProperty(vsT, 'scrollTop', { configurable: true, get: () => st, set: (v) => { st = v; } });
        appEl._toggleRaw(); // 비율 캡처 후 _rawView 토글
        toggleRatioOk = Math.abs(appEl._pendingViewRatio - 0.5) < 0.001 && appEl._rawView === true;
        await appEl.updateComplete; // updated()서 비율 복원: 0.5 * 800 = 400
        toggleRestoreOk = Math.abs(st - 400) < 1;
      }
      appEl._rawView = false; await appEl.updateComplete;
      const viewScrollSyncOk = toggleRatioOk && toggleRestoreOk;

      // 재시작 시 마지막 노트+스크롤 복원 (vault root 별 settings 영속)
      const savedIndex = appEl._index;
      appEl._root = 'VROOT';
      appEl._selected = 'Welcome.md';
      appEl._saveLastNote('Welcome.md', 250);
      const lsRaw = JSON.parse(localStorage.getItem('mdv-settings') || '{}');
      const rec = (lsRaw.lastNotes || {})['VROOT'];
      const persistOk = !!rec && rec.relPath === 'Welcome.md' && rec.scroll === 250;
      // 복원: _index.titles 에 있는 노트만, _pendingScroll 을 저장값으로
      appEl._marpSrc = null; appEl._searchTerms = [];
      appEl._index = { titles: { 'Welcome.md': 'Welcome' }, resolve: {}, backlinks: {} };
      appEl._selected = null;
      appEl._restoreLastNote('VROOT');
      const restoreOk = appEl._selected === 'Welcome.md' && appEl._pendingScroll === 250;
      // 미존재(삭제/경로변경) 노트는 조용히 폴백 — 복원 안 함
      appEl._index = { titles: { 'Other.md': 'Other' }, resolve: {}, backlinks: {} };
      appEl._selected = null;
      appEl._restoreLastNote('VROOT');
      const restoreFallbackOk = appEl._selected === null;
      const lastNoteOk = persistOk && restoreOk && restoreFallbackOk;
      appEl._index = savedIndex; // 후속 테스트 위해 원복
      await appEl.updateComplete;

      // 뒤로/앞으로 히스토리 (_selected 는 _onSelect 동기부에서 설정 → await 불필요)
      appEl._history = [];
      appEl._histIdx = -1;
      appEl._selected = null;
      appEl._marpSrc = null;
      await appEl._onSelect('Welcome.md');
      await appEl._onSelect('Diagrams.md');
      await appEl._onSelect('Projects/Roadmap.md');
      const histOpen = appEl._histIdx === 2 && appEl._history.length === 3;
      appEl._goBack();
      const histBack1 = appEl._selected === 'Diagrams.md' && appEl._histIdx === 1;
      appEl._goBack();
      const histBack2 = appEl._selected === 'Welcome.md' && appEl._histIdx === 0;
      appEl._goForward();
      const histFwd = appEl._selected === 'Diagrams.md' && appEl._histIdx === 1;
      await appEl._onSelect('Slides.md'); // forward 가지 절단
      const histTrunc = appEl._history.length === 3 && appEl._history[2] === 'Slides.md' && appEl._histIdx === 2;
      const historyOk = histOpen && histBack1 && histBack2 && histFwd && histTrunc;
      appEl._marpSrc = null;
      appEl._selected = null;
      await appEl.updateComplete;

      // 그래프 뷰: 노드(노트)+엣지(링크) SVG 렌더 + 닫기
      const gvd = await window.mdv.openVaultPath(${JSON.stringify(SAMPLE_VAULT)});
      appEl._index = gvd.index;
      appEl._tree = gvd.tree;
      appEl._openGraph();
      await appEl.updateComplete;
      const gNodes = appEl.shadowRoot.querySelectorAll('.graph-svg .g-node').length;
      const gEdges = appEl.shadowRoot.querySelectorAll('.graph-svg .g-edge').length;
      const graphRendered = !!appEl.shadowRoot.querySelector('.graph-svg') && gNodes >= 3 && gEdges >= 1;
      appEl._closeGraph();
      await appEl.updateComplete;
      const graphOk = graphRendered && !appEl.shadowRoot.querySelector('.graph-overlay');

      // 링크 hover 미리보기: _showPreview 가 대상 노트 미리보기 생성
      const fakeA = document.createElement('a');
      fakeA.className = 'wikilink';
      fakeA.setAttribute('data-target', 'Welcome.md');
      appEl._hoverAnchor = fakeA;
      await appEl._showPreview(fakeA);
      await appEl.updateComplete;
      const hoverOk = !!appEl._hoverPreview
        && appEl._hoverPreview.title === 'Welcome'
        && /<h1|환영|데모/.test(appEl._hoverPreview.html)
        && !!appEl.shadowRoot.querySelector('.hover-preview');
      appEl._hidePreview();
      await appEl.updateComplete;

      // breadcrumb(상위 경로) + 사이드바 구조(검색박스 flex 고정 + 스크롤 영역 분리)
      appEl._root = 'D:/MyVault';
      appEl._tree = [{ name: 'Projects', type: 'dir', relPath: 'Projects', children: [
        { name: 'Roadmap.md', type: 'file', relPath: 'Projects/Roadmap.md' }] }];
      appEl._marpSrc = null;
      appEl._rawView = false;
      appEl._selected = 'Projects/Roadmap.md';
      appEl._src = '# 로드맵';
      appEl._renderNoteHtml();
      await appEl.updateComplete;
      await sleep(20);
      await appEl.updateComplete;
      const bcText = appEl.shadowRoot.querySelector('.breadcrumb')?.textContent || '';
      const bcSegs = appEl.shadowRoot.querySelectorAll('.breadcrumb .bc-seg').length;
      const breadcrumbOk = bcSegs === 3 && /MyVault/.test(bcText) && /Projects/.test(bcText) && /Roadmap/.test(bcText);
      const sidebarOk = !!appEl.shadowRoot.querySelector('.sidebar > .search')
        && !!appEl.shadowRoot.querySelector('.sidebar-scroll');
      const breadcrumbAllOk = breadcrumbOk && sidebarOk;

      // 설정 패널: PlantUML 도구 상태(java/jar/dot 3행) 표시 + 닫기
      await appEl._openSettings();
      await appEl.updateComplete;
      const setRows = appEl.shadowRoot.querySelectorAll('.set-panel .set-row').length; // PlantUML 3행 + 자동 업데이트 2행
      const setUpdateSection = !!appEl.shadowRoot.querySelector('.set-panel .set-check'); // "지금 확인" 버튼
      const setShown =
        !!appEl.shadowRoot.querySelector('.set-panel') && setRows >= 3 && !!appEl._settingsData && setUpdateSection;
      appEl._closeSettings();
      await appEl.updateComplete;
      const settingsOk = setShown && !appEl.shadowRoot.querySelector('.set-overlay');

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
      // [버그] 꽉참: 전체화면 _fit 이 stage 에 정확히 맞춤(확대 캡/패딩 없음)
      const fsSlide = deckEl.shadowRoot.querySelector('.stage section');
      let fsFillOk = false;
      if (fsSlide) {
        fsSlide.style.zoom = '1';
        const sw = fsSlide.offsetWidth, sh = fsSlide.offsetHeight;
        const st = deckEl.shadowRoot.querySelector('.stage');
        deckEl._fit(); // _fullscreen=true 상태
        const z = parseFloat(fsSlide.style.zoom);
        const expected = Math.min(st.clientWidth / sw, st.clientHeight / sh);
        fsFillOk = sw > 0 && Math.abs(z - expected) < 0.02; // min(1) 캡/패딩 없이 stage 꽉
      }
      // [버그 재오픈] 실기기 꽉참: :host(:fullscreen) 가 100vw/100vh 명시해야 grid 1fr 가
      // 화면을 채운다(미명시 시 stage 가 슬라이드 자연높이 720 으로만 잡혀 _fit scale=1→작게 남음).
      // 헤드리스 offscreen 은 실제 :fullscreen 진입 불가 → 스타일시트 규칙으로 회귀 잠금.
      let fsHostFillOk = false;
      try {
        let cssText = '';
        for (const s of (deckEl.shadowRoot.adoptedStyleSheets || [])) {
          for (const rule of s.cssRules) cssText += rule.cssText + '\\n';
        }
        const blk = cssText.match(/:host\\(:fullscreen\\)\\s*\\{[^}]*\\}/);
        fsHostFillOk = !!blk && /height:\\s*100vh/.test(blk[0]) && /width:\\s*100vw/.test(blk[0]);
      } catch (e) { fsHostFillOk = false; }
      // stage ResizeObserver 부착(전체화면 전환 레이아웃 안정 시 _fit 재실행 — 타이밍 레이스 해소)
      const fsObserverOk = !!deckEl._stageRO && typeof deckEl._observeStage === 'function';
      deckEl._fullscreen = false;
      deckEl._controlsVisible = false;
      await deckEl.updateComplete;
      const marpFsOk = fsBtn && keyGuardOk && fsControlsOk && fsFillOk && fsHostFillOk && fsObserverOk;

      // 전체화면 발표 UI 보강: 점프키 / 블랙·화이트 / 오버뷰 / 도움말 / 진행바·번호 / 클릭내비
      deckEl.src = '---\\nmarp: true\\n---\\n# A\\n\\n---\\n\\n# B\\n\\n---\\n\\n# C';
      await deckEl.updateComplete;
      await new Promise((r) => setTimeout(r, 80));
      await deckEl.updateComplete;
      const body = document.body;
      const key = (k, extra = {}) => deckEl._onKey({ key: k, composedPath: () => [body], preventDefault() {}, ...extra });
      // Home/End
      key('End'); const endOk = deckEl._index === deckEl._count - 1;
      key('Home'); const homeOk = deckEl._index === 0;
      // 숫자 + Enter 점프 (3번 → index 2)
      key('3'); key('Enter'); const numJumpOk = deckEl._index === 2 && deckEl._numBuf === '';
      // Space 다음 / Backspace 이전 (경계에서)
      key('Home'); key(' '); const spaceNextOk = deckEl._index === 1;
      key('Backspace'); const backPrevOk = deckEl._index === 0;
      // 블랙/화이트 토글 + 아무 키나 해제
      key('b'); const blackOk = deckEl._blank === 'black';
      key('ArrowRight'); const blankAnyKeyClears = deckEl._blank === null && deckEl._index === 0; // 해제만, 이동X
      key('w'); const whiteOk = deckEl._blank === 'white'; key('w'); const whiteToggleOff = deckEl._blank === null;
      // 오버뷰 토글 + 그리드 셀 수 == 슬라이드 수
      key('g'); deckEl._fullscreen = true; await deckEl.updateComplete;
      const ovCells = deckEl.shadowRoot.querySelectorAll('.fs-overview .ov-cell').length;
      const overviewOk = deckEl._overview === true && ovCells === deckEl._count;
      // 오버뷰 셀 클릭 → 점프 + 닫힘
      const cell1 = deckEl.shadowRoot.querySelectorAll('.fs-overview .ov-cell')[1];
      cell1 && cell1.click(); await deckEl.updateComplete;
      const ovClickOk = deckEl._index === 1 && deckEl._overview === false;
      // 도움말 오버레이
      key('?'); await deckEl.updateComplete;
      const helpOk = deckEl._helpOpen === true && !!deckEl.shadowRoot.querySelector('.fs-help .help-card');
      key('Escape'); const helpEscOk = deckEl._helpOpen === false;
      // 진행 바 + 슬라이드 번호 상시 (전체화면)
      await deckEl.updateComplete;
      const progFill = deckEl.shadowRoot.querySelector('.fs-progress .fs-progress-fill');
      const pageNo = deckEl.shadowRoot.querySelector('.fs-pageno');
      const expectPct = ((deckEl._index + 1) / deckEl._count) * 100;
      const progressOk = !!progFill && Math.abs(parseFloat(progFill.style.width) - expectPct) < 0.5 && !!pageNo;
      // 클릭 내비: 전체화면 stage 클릭 → 다음, Shift+클릭 → 이전
      deckEl._index = 0;
      deckEl._onStageClick({ button: 0, shiftKey: false }); const clickNextOk = deckEl._index === 1;
      deckEl._onStageClick({ button: 0, shiftKey: true }); const clickPrevOk = deckEl._index === 0;
      // 클럭 표시
      const clockOk = /^\\d\\d:\\d\\d$/.test(deckEl._clock());
      // 컨트롤 가시성: 가장자리 hot-zone 진입 시만 출현(중앙 이동은 무반응)
      const stageEl2 = deckEl.shadowRoot.querySelector('.stage');
      stageEl2.getBoundingClientRect = () => ({ top: 0, bottom: 800, left: 0, right: 1280, width: 1280, height: 800 });
      deckEl._controlsVisible = false;
      deckEl._onMouseMove({ clientY: 400 }); // 중앙 → 안 뜸
      const hotCenterNo = deckEl._controlsVisible === false;
      deckEl._onMouseMove({ clientY: 770 }); // 하단 핫존(>720) → 뜸
      const hotBottomYes = deckEl._controlsVisible === true;
      deckEl._controlsVisible = false;
      deckEl._onMouseMove({ clientY: 30 }); // 상단 핫존(<80) → 뜸
      const hotTopYes = deckEl._controlsVisible === true;
      const edgeHoverOk = hotCenterNo && hotBottomYes && hotTopYes;
      deckEl._fullscreen = false; deckEl._overview = false; deckEl._helpOpen = false; deckEl._blank = null;
      await deckEl.updateComplete;
      const presentUiOk = endOk && homeOk && numJumpOk && spaceNextOk && backPrevOk && blackOk
        && blankAnyKeyClears && whiteOk && whiteToggleOff && overviewOk && ovClickOk && helpOk
        && helpEscOk && progressOk && clickNextOk && clickPrevOk && clockOk && edgeHoverOk;

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
      // 통합: 발표자 바에 전체화면 버튼(⛶) + P 키 토글
      const prHasFsBtn = !!deckEl.shadowRoot.querySelector('.pr-bar button[title^="전체화면"]');
      deckEl._exitPresenter();
      await deckEl.updateComplete;
      const prExited = !deckEl.shadowRoot.querySelector('.presenter');
      deckEl._onKey({ key: 'p', composedPath: () => [document.body], preventDefault() {} }); // P 토글 진입
      const pKeyOpens = deckEl._presenter === true;
      deckEl._onKey({ key: 'p', composedPath: () => [document.body], preventDefault() {} });
      const pKeyCloses = deckEl._presenter === false;
      const presenterOk = prEl && prCur && prNext && prNotesOk && prTimerFmt && prRunning && prExited
        && prHasFsBtn && pKeyOpens && pKeyCloses;

      // 발표 이중 창(1단계): preload API + 청중 deck(크롬 숨김/contain-fit/키무시) + 발표 시작 트리거
      const presentApiOk = ['startPresent', 'updatePresent', 'endPresent', 'presentReady',
        'onPresentSrc', 'onPresentState', 'onPresentEnded', 'navPresent', 'onPresentNav']
        .every((k) => typeof window.mdv[k] === 'function');
      // 청중 deck: audience 속성 → navbar 숨김 + contain-fit + 자체 키 네비 무시
      const audDeck = document.createElement('mdv-deck');
      audDeck.setAttribute('audience', '');
      audDeck.src = '---\\nmarp: true\\n---\\n# A\\n\\n---\\n\\n# B';
      document.body.appendChild(audDeck);
      await audDeck.updateComplete;
      await new Promise((r) => setTimeout(r, 80));
      await audDeck.updateComplete;
      const audNavbar = audDeck.shadowRoot.querySelector('.navbar');
      const audNavbarHidden = !audNavbar || getComputedStyle(audNavbar).display === 'none';
      const audSec = audDeck.shadowRoot.querySelector('.stage section');
      let audFitOk = false;
      if (audSec) {
        audSec.style.zoom = '1';
        const sw = audSec.offsetWidth, sh = audSec.offsetHeight;
        const stg = audDeck.shadowRoot.querySelector('.stage');
        audDeck._fit(); // audience 라 contain-fit
        const z = parseFloat(audSec.style.zoom);
        const expected = Math.min(stg.clientWidth / sw, stg.clientHeight / sh);
        audFitOk = sw > 0 && Math.abs(z - expected) < 0.02;
      }
      const aidx = audDeck._index;
      audDeck._onKey({ key: 'ArrowRight', composedPath: () => [document.body], preventDefault() {} });
      const audKeyIgnored = audDeck._index === aidx; // 청중 deck 은 자체 키 네비 안 함
      audDeck._show(1); // present:state 처럼 외부 인덱스 반영은 동작
      const audShowOk = audDeck._index === 1;
      audDeck.remove();
      // 발표 시작 트리거: 버튼 존재 + _startPresentation 이 _presenting=true + 발표자 뷰 진입
      // (window.mdv 는 contextBridge 라 함수 교체 불가 → 실제 present:open invoke, 메인 스텁이 성공 처리)
      const presentBtn = !!deckEl.shadowRoot.querySelector('[data-present]');
      deckEl._presenting = false;
      deckEl._startPresentation();
      const triggerOk = presentBtn && deckEl._presenting === true && deckEl._presenter === true;
      deckEl._presenting = false;
      deckEl._exitPresenter();
      await deckEl.updateComplete;
      // 청중→발표자 네비 전달: _onPresentNav 가 발표자 deck 을 실제 이동/블랭크 (소스 오브 트루스)
      deckEl._presenting = false; deckEl._blank = null;
      deckEl._show(0);
      deckEl._onPresentNav('next'); const navNext = deckEl._index === 1;
      deckEl._onPresentNav('last'); const navLast = deckEl._index === deckEl._count - 1;
      deckEl._onPresentNav('first'); const navFirst = deckEl._index === 0;
      deckEl._onPresentNav('black'); const navBlack = deckEl._blank === 'black';
      deckEl._onPresentNav('black'); const navBlackOff = deckEl._blank === null;
      const presentNavOk = navNext && navLast && navFirst && navBlack && navBlackOff;
      deckEl._blank = null;
      const presentDualOk = presentApiOk && audNavbarHidden && audFitOk && audKeyIgnored && audShowOk && triggerOk && presentNavOk;

      // 전체화면 ↑/↓ 키 + 플레인 휠 슬라이드 네비 (Ctrl+휠=줌 양보, 비재생=무시)
      deckEl._presenting = false; deckEl._fullscreen = true; deckEl._blank = null;
      deckEl._show(0);
      const kev = (key) => deckEl._onKey({ key, composedPath: () => [document.body], preventDefault() {} });
      kev('ArrowDown'); const arrowDownOk = deckEl._index === 1;
      kev('ArrowUp'); const arrowUpOk = deckEl._index === 0;
      const wev = (deltaY, ctrlKey) => { deckEl._lastWheel = 0; deckEl._onWheel({ deltaY, ctrlKey, preventDefault() {} }); };
      wev(100, false); const wheelNextOk = deckEl._index === 1;
      wev(-100, false); const wheelPrevOk = deckEl._index === 0;
      wev(100, true); const wheelCtrlYield = deckEl._index === 0; // Ctrl+휠은 앱 줌에 양보(네비 X)
      deckEl._fullscreen = false; wev(100, false); const wheelWindowedYield = deckEl._index === 0; // 비재생=무시
      const wheelNavOk = arrowDownOk && arrowUpOk && wheelNextOk && wheelPrevOk && wheelCtrlYield && wheelWindowedYield;

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
      // [버그] 배경 클릭=닫기(드래그 아닐 때), 다이어그램 클릭=유지
      appEl._lbDragged = false;
      appEl._lbStageClick({ target: document.createElement('div') }); // content 밖 = 배경
      const bgCloses = appEl._lightboxOpen === false;
      appEl._openLightbox(innerSvg);
      await appEl.updateComplete;
      appEl._lbStageClick({ target: appEl.shadowRoot.querySelector('.lb-content') }); // content = 유지
      const contentKeeps = appEl._lightboxOpen === true;
      appEl._closeLightbox();
      await appEl.updateComplete;
      const lbClosed = !appEl.shadowRoot.querySelector('.lb-overlay');
      const lightboxOk = !!lbEl && lbHasSvg && zoomChanged && exportApiOk && bgCloses && contentKeeps && lbClosed;

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

      // 번들 sample-vault 경로 API (첫 실행 데모 자동 열기용)
      const sp = await window.mdv.samplePath();
      const samplePathOk = !!sp && /sample-vault/.test(sp);

      // vault 열기 로딩 표시
      appEl._vaultLoading = true;
      await appEl.updateComplete;
      const loadingShown = !!appEl.shadowRoot.querySelector('.vault-loading');
      appEl._vaultLoading = false;
      await appEl.updateComplete;
      const vaultLoadingOk = loadingShown && !appEl.shadowRoot.querySelector('.vault-loading');

      // 자동 업데이트: 수동 확인 IPC(mock) + 배너 렌더 + 닫기
      const updApiOk =
        typeof window.mdv.checkUpdate === 'function' && typeof window.mdv.onUpdateAvailable === 'function';
      const upd = await window.mdv.checkUpdate();
      const updCheckOk = !!(
        upd && upd.available && upd.latest === '9.9.9' && upd.asset && /win.*\\.zip$/i.test(upd.asset.name)
      );
      appEl._update = upd;
      appEl._updateDismissed = false;
      await appEl.updateComplete;
      const banner = appEl.shadowRoot.querySelector('.update-banner');
      const updBannerOk = !!(banner && banner.textContent.includes('9.9.9'));
      appEl._dismissUpdate();
      await appEl.updateComplete;
      const updDismissOk = !appEl.shadowRoot.querySelector('.update-banner');
      const updateOk = updApiOk && updCheckOk && updBannerOk && updDismissOk;

      // 자동 업데이트 Phase 2: 적용 버튼 + 진행률 + 에러 경로
      const updApplyApiOk =
        typeof window.mdv.applyUpdate === 'function' && typeof window.mdv.onUpdateProgress === 'function';
      appEl._update = { available: true, latest: '9.9.9', current: '0.1.0', asset: { name: 'md-viewer-win-x64.zip', url: 'http://x/a.zip', size: 10 } };
      appEl._updateApplying = false;
      appEl._updateProgress = null;
      appEl._updateDismissed = false;
      await appEl.updateComplete;
      const applyBtn = appEl.shadowRoot.querySelector('.update-banner .ub-apply');
      const applyBtnOk = !!applyBtn && applyBtn.textContent.includes('지금 업데이트');
      // 진행률 표시(다운로드 50%)
      appEl._updateApplying = true;
      appEl._updateProgress = { phase: 'download', received: 50, total: 100 };
      await appEl.updateComplete;
      const progOk = /50%/.test(appEl.shadowRoot.querySelector('.update-banner').textContent);
      // 적용 호출 → 스텁이 ok:false → 에러 상태 + 배너 에러 표기
      appEl._updateApplying = false;
      await appEl._applyUpdate();
      await appEl.updateComplete;
      const applyErrOk =
        appEl._updateProgress?.phase === 'error' &&
        /적용 실패/.test(appEl.shadowRoot.querySelector('.update-banner').textContent);
      const updateApplyOk = updApplyApiOk && applyBtnOk && progOk && applyErrOk;

      // skip-version: '건너뛰기' → 해당 버전 배너 숨김, '해제' → 복귀
      appEl._updateApplying = false;
      appEl._updateProgress = null;
      appEl._updateDismissed = false;
      appEl._update = { available: true, latest: '9.9.9', current: '0.1.0' };
      await appEl.updateComplete;
      const beforeSkip = !!appEl.shadowRoot.querySelector('.update-banner');
      appEl._skipUpdate();
      await appEl.updateComplete;
      const afterSkip = !appEl.shadowRoot.querySelector('.update-banner');
      appEl._clearSkip();
      await appEl.updateComplete;
      const afterClear = !!appEl.shadowRoot.querySelector('.update-banner');
      const updateSkipOk = beforeSkip && afterSkip && afterClear;

      // 업데이트 에러 인라인 가이드 (rate limit / network 분류)
      appEl._update = { available: false, current: '0.3.7', error: 'API rate limit exceeded for 1.2.3.4 (HTTP 403)' };
      await appEl._openSettings();
      await appEl.updateComplete;
      const rateG = appEl.shadowRoot.querySelector('.err-guide');
      const rateGuideOk = !!rateG && /사용량 초과/.test(rateG.textContent) && /setx MDV_UPDATE_TOKEN/.test(rateG.textContent);
      appEl._closeSettings(); await appEl.updateComplete;

      appEl._update = { available: false, current: '0.3.7', error: 'curl (35) Recv failure: connection was reset' };
      await appEl._openSettings();
      await appEl.updateComplete;
      const netG = appEl.shadowRoot.querySelector('.err-guide');
      const netGuideOk = !!netG && /네트워크/.test(netG.textContent) && /MDV_HTTPS_PROXY/.test(netG.textContent);
      appEl._closeSettings(); await appEl.updateComplete;

      // 분류 안 되는 에러는 가이드 미표시
      appEl._update = { available: false, current: '0.3.7', error: '랜덤 알 수 없는 오류' };
      await appEl._openSettings();
      await appEl.updateComplete;
      const noGuideOk = !appEl.shadowRoot.querySelector('.err-guide');
      appEl._closeSettings(); await appEl.updateComplete;
      appEl._update = null; // 정리

      // 복사 IPC 노출 확인
      const copyApiOk = typeof window.mdv.copy === 'function';

      const updateErrorGuideOk = rateGuideOk && netGuideOk && noGuideOk && copyApiOk;

      // 설정 패널에서 바로 업데이트 적용 버튼 (가용 + 에셋 + 적용중 아님일 때만 표시)
      appEl._update = { available: true, latest: '9.9.9', current: '0.3.12', asset: { name: 'md-viewer-win-x64.zip', url: 'http://x/a.zip', size: 10 } };
      appEl._updateApplying = false;
      appEl._updateDismissed = false;
      await appEl._openSettings();
      await appEl.updateComplete;
      const setApplyBtn = appEl.shadowRoot.querySelector('.set-panel .set-apply');
      const setApplyShow = !!setApplyBtn && /지금 업데이트/.test(setApplyBtn.textContent);
      appEl._updateApplying = true;
      await appEl.updateComplete;
      const setApplyHidden = !appEl.shadowRoot.querySelector('.set-panel .set-apply');
      appEl._updateApplying = false;
      // 클릭 시 설정 닫힘
      await appEl.updateComplete;
      const btn2 = appEl.shadowRoot.querySelector('.set-panel .set-apply');
      btn2?.click();
      await appEl.updateComplete;
      const setApplyClosed = !appEl._settingsOpen;
      const updateSettingsApplyOk = setApplyShow && setApplyHidden && setApplyClosed;
      // 정리
      appEl._updateApplying = false;
      appEl._update = null;
      await appEl.updateComplete;

      // Ctrl+A: 컨텐츠(.note) 만 선택, 메뉴/사이드바 미포함
      appEl._marpSrc = null;
      appEl._selected = 'select-test.md';
      appEl._rawView = false;
      appEl._curDir = '';
      appEl._noteHtml = '<p>SELECT-ALL-MARKER-XYZ</p>';
      appEl._paletteOpen = false; appEl._settingsOpen = false; appEl._lightboxOpen = false; appEl._graphOpen = false;
      await appEl.updateComplete;
      window.getSelection().removeAllRanges();
      appEl._handleSelectAll({ preventDefault: () => {} });
      const selText = String(window.getSelection());
      const selContentOnlyOk =
        selText.includes('SELECT-ALL-MARKER-XYZ') &&
        !selText.includes('vault 검색') &&
        !selText.includes('Vault 열기');
      // 모달 열려있으면 skip(기본 동작 보존)
      window.getSelection().removeAllRanges();
      appEl._paletteOpen = true;
      appEl._handleSelectAll({ preventDefault: () => {} });
      const selSkipOnModalOk = window.getSelection().toString() === '';
      appEl._paletteOpen = false;
      const selectAllOk = selContentOnlyOk && selSkipOnModalOk;

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
        highlightOk,
        mathOk,
        marpDetected,
        notMarp,
        marpSectionCount,
        marpHasCss,
        marpSanitized,
        marpOfflineOk,
        imgRewritten,
        imgServed,
        scrollOk,
        treeIndent,
        treeLazyOk,
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
        tocOk,
        tagOk,
        themeOk,
        mermaidAutoOk,
        scrollMemOk,
        liveUpdateScrollOk,
        viewScrollSyncOk,
        lastNoteOk,
        historyOk,
        graphOk,
        hoverOk,
        breadcrumbAllOk,
        settingsOk,
        vaultLoadingOk,
        samplePathOk,
        paletteOk,
        embedOk,
        titlebarOk,
        marpExportOk,
        marpFsOk,
        presentUiOk,
        presenterOk,
        presentDualOk,
        wheelNavOk,
        lightboxOk,
        reHydrateOk,
        viewBarOk,
        memoizeOk,
        updateOk,
        updateApplyOk,
        updateSkipOk,
        updateErrorGuideOk,
        updateSettingsApplyOk,
        selectAllOk,
        diagramSanitizeOk,
        sanitizeDiag: { sanitizeStripScript, sanitizeStripHandler, sanitizeStripJsHref, sanitizeKeepsBenign },
        mermaidFO, mermaidLabelOk, d2LabelOk, d2FO, d2Sized,
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
    if (!result.marpOfflineOk) fail('Marp 이모지 twemoji CDN 의존 (오프라인 위반)');
    if (!result.imgRewritten) fail('로컬 이미지 src → mdv-res 치환 실패');
    if (!result.imgServed) fail('mdv-res 프로토콜 이미지 서빙 실패');
    if (!result.scrollOk) fail(`독립 스크롤 실패 — ${JSON.stringify(result.scrollDiag)}`);
    if (!result.treeIndent) fail('파일 트리 중첩 들여쓰기 실패');
    if (!result.treeLazyOk) fail('대용량 트리 lazy 마운트 실패 (접힘 기본/지연 마운트/선택 조상 자동펼침)');
    if (!result.taskOk) fail('GFM 태스크리스트 체크박스 렌더 실패');
    if (!result.calloutOk) fail('콜아웃(> [!type]) 렌더 실패');
    if (!result.highlightOk) fail('코드 syntax highlight 실패 (hljs 토큰)');
    if (!result.mathOk) fail('수식(KaTeX) 렌더 실패');
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
    if (!result.tocOk) fail('아웃라인(TOC) 패널 실패');
    if (!result.tagOk) fail('태그 #tag 칩/필터 실패');
    if (!result.themeOk) fail('테마 토글/폰트 배율 실패');
    if (!result.mermaidAutoOk) fail('mermaid auto 테마/재렌더 실패');
    if (!result.scrollMemOk) fail('노트 스크롤 위치 기억 실패');
    if (!result.liveUpdateScrollOk) fail('라이브 갱신 스크롤 위치 유지 실패 (캡처/복원/뷰모드 보존)');
    if (!result.viewScrollSyncOk) fail('원본↔렌더 전환 스크롤 비율 보존 실패');
    if (!result.lastNoteOk) fail('재시작 마지막 노트+스크롤 복원 실패 (영속/복원/폴백)');
    if (!result.historyOk) fail('뒤로/앞으로 히스토리 실패');
    if (!result.graphOk) fail('그래프 뷰 실패 (노드/엣지 렌더)');
    if (!result.hoverOk) fail('링크 hover 미리보기 실패');
    if (!result.breadcrumbAllOk) fail('breadcrumb/사이드바 구조 실패');
    if (!result.settingsOk) fail('설정 패널(PlantUML 도구 상태) 실패');
    if (!result.vaultLoadingOk) fail('vault 열기 로딩 표시 실패');
    if (!result.samplePathOk) fail('번들 sample-vault 경로 API 실패');
    if (!result.paletteOk) fail('Ctrl+P 빠른 전환기 실패 (오픈/퍼지/Enter)');
    if (!result.embedOk) fail('위키 임베드 실패 (이미지/transclusion)');
    if (!result.titlebarOk) fail('커스텀 타이틀바 실패');
    if (!result.marpExportOk) fail('Marp export(API/덱 버튼) 실패');
    if (!result.marpFsOk) fail('Marp 전체화면 재생 실패 (재생버튼/키가드/fs컨트롤)');
    if (!result.presentUiOk) fail('전체화면 발표 UI 실패 (점프키/블랙·화이트/오버뷰/도움말/진행바/클릭내비)');
    if (!result.presenterOk) fail('Marp presenter 모드 실패 (패널/노트/타이머/종료)');
    if (!result.presentDualOk) fail('발표 이중 창 1단계 실패 (preload API/청중 deck/시작 트리거)');
    if (!result.wheelNavOk) fail('전체화면 ↑/↓·휠 네비 실패 (Ctrl+휠 양보/비재생 무시 포함)');
    if (!result.lightboxOk) fail('다이어그램 라이트박스 실패 (오픈/줌/export API/닫기)');
    if (!result.reHydrateOk) fail('원본↔렌더 토글 후 다이어그램 재hydrate 실패');
    if (!result.viewBarOk) fail('콘텐츠 상단 토글 바 탭 실패');
    if (!result.memoizeOk) fail('다이어그램 메모이즈(캐시 히트) 실패');
    if (!result.updateOk) fail('자동 업데이트 실패 (checkUpdate IPC/배너 렌더/닫기)');
    if (!result.updateApplyOk) fail('자동 업데이트 적용 실패 (applyUpdate API/지금 업데이트 버튼/진행률/에러 경로)');
    if (!result.updateSkipOk) fail('자동 업데이트 버전 건너뛰기/해제 실패');
    if (!result.updateErrorGuideOk) fail('업데이트 에러 인라인 가이드 실패 (rate-limit/network 분류, 미분류 미표시, copy API)');
    if (!result.updateSettingsApplyOk) fail('설정 패널 "지금 업데이트" 버튼 실패 (가용 시 표시/적용중 숨김/클릭 시 설정 닫힘)');
    if (!result.selectAllOk) fail('Ctrl+A 컨텐츠 한정 선택 실패 (.note만 선택/모달 시 skip)');
    if (!result.diagramSanitizeOk) fail(`다이어그램 SVG 새니타이즈 실패 — ${JSON.stringify(result.sanitizeDiag)}`);
    if (!result.mermaidLabelOk) fail('mermaid 라벨 손실 — 살균이 foreignObject htmlLabels 를 제거함(trusted 면제 회귀)');
    if (!result.d2LabelOk) fail('d2 라벨 손실 — 살균이 노드 텍스트를 제거함');
    if (!result.d2Sized) fail('d2 svg width/height 누락 — 거대 빈영역 회귀');
    console.log(`다이어그램 라벨: mermaid(FO=${result.mermaidFO}) OK, d2(FO=${result.d2FO}) OK`);
  } catch (e) {
    fail(String(e));
  }

  if (!failed) console.log('SMOKE PASS ✅');
  app.exit(failed ? 1 : 0);
});
