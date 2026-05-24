'use strict';

// 헤드리스 스모크 테스트: off-screen 으로 index.html 로드 후
// (1) ESM 모듈 로딩(CSP 통과), (2) Lit <mdv-app> 렌더 + 'Vault 열기' 버튼,
// (3) preload IPC API 노출, (4) markdown→sanitize 파이프라인 동작 을 검증한다.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const plantuml = require('../src/main/plantuml');
const resProtocol = require('../src/main/res-protocol');

const SAMPLE_VAULT = path.join(__dirname, '..', 'sample-vault');

// 실제 main.js 와 동일하게 PlantUML IPC 핸들러 등록 (전체 경로 검증용)
ipcMain.handle('plantuml:render', (_e, src) => plantuml.render(src));
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

      // Marp: frontmatter 감지 + 슬라이드 렌더(2장) + 살균(script 제거)
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
        marpDetected,
        notMarp,
        marpSectionCount,
        marpHasCss,
        marpSanitized,
        imgRewritten,
        imgServed,
      };
    })()`);

    console.log('result:', JSON.stringify(result));
    if (!result.hasOpenApi) fail('mdv.openVault 미노출');
    if (!result.hasReadApi) fail('mdv.readNote 미노출');
    if (!result.hasOnChange) fail('mdv.onVaultChanged 미노출');
    if (result.btnText !== 'Vault 열기') fail(`버튼 텍스트 비정상: ${result.btnText}`);
    if (!result.mdHasH1) fail('markdown h1 렌더 실패');
    if (!result.mdStrong) fail('markdown strong 렌더 실패');
    if (!result.mdSanitized) fail('DOMPurify 살균 실패 — <script> 통과됨');
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
    if (!result.marpDetected) fail('Marp frontmatter 감지 실패');
    if (result.notMarp) fail('Marp 오탐지 (일반 노트를 marp로 판정)');
    if (result.marpSectionCount !== 2) fail(`Marp 슬라이드 수 이상: ${result.marpSectionCount} (기대 2)`);
    if (!result.marpHasCss) fail('Marp CSS 미생성');
    if (!result.marpSanitized) fail('Marp 살균 실패 — <script> 통과');
    if (!result.imgRewritten) fail('로컬 이미지 src → mdv-res 치환 실패');
    if (!result.imgServed) fail('mdv-res 프로토콜 이미지 서빙 실패');
  } catch (e) {
    fail(String(e));
  }

  if (!failed) console.log('SMOKE PASS ✅');
  app.exit(failed ? 1 : 0);
});
