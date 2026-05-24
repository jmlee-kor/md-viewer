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

  win.webContents.on('did-fail-load', (_e, code, desc) => fail(`did-fail-load ${code} ${desc}`));
  win.webContents.on('console-message', (_e, level, message) => {
    // level>=2 = error. CSP 위반/모듈 로드 실패가 여기 잡힌다.
    if (level >= 2) fail(`renderer console error: ${message}`);
  });

  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

    const result = await win.webContents.executeJavaScript(`(async () => {
      await customElements.whenDefined('mdv-app');
      const el = document.querySelector('mdv-app');
      await el.updateComplete;
      const btn = el.shadowRoot.querySelector('[data-open]');
      const sample = window.__mdvTest.renderMarkdown('# 제목\\n\\n**굵게** 그리고 \`코드\`.\\n\\n<script>alert(1)<\\/script>');
      return {
        hasOpenApi: typeof window.mdv.openVault === 'function',
        hasReadApi: typeof window.mdv.readNote === 'function',
        btnText: btn && btn.textContent.trim(),
        mdHasH1: /<h1>제목<\\/h1>/.test(sample),
        mdStrong: /<strong>굵게<\\/strong>/.test(sample),
        mdSanitized: !/<script>/.test(sample),
      };
    })()`);

    console.log('result:', JSON.stringify(result));
    if (!result.hasOpenApi) fail('mdv.openVault 미노출');
    if (!result.hasReadApi) fail('mdv.readNote 미노출');
    if (result.btnText !== 'Vault 열기') fail(`버튼 텍스트 비정상: ${result.btnText}`);
    if (!result.mdHasH1) fail('markdown h1 렌더 실패');
    if (!result.mdStrong) fail('markdown strong 렌더 실패');
    if (!result.mdSanitized) fail('DOMPurify 살균 실패 — <script> 통과됨');
  } catch (e) {
    fail(String(e));
  }

  if (!failed) console.log('SMOKE PASS ✅');
  app.exit(failed ? 1 : 0);
});
