'use strict';

// 헤드리스 스모크 테스트: off-screen 으로 index.html 로드 후
// (1) ESM 모듈 로딩(CSP 통과), (2) Lit <mdv-app> 렌더 + 'Vault 열기' 버튼,
// (3) preload IPC API 노출, (4) markdown→sanitize 파이프라인 동작 을 검증한다.

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.disableHardwareAcceleration();

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('SMOKE FAIL:', msg);
};

app.whenReady().then(async () => {
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
  } catch (e) {
    fail(String(e));
  }

  if (!failed) console.log('SMOKE PASS ✅');
  app.exit(failed ? 1 : 0);
});
