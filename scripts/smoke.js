'use strict';

// 헤드리스 스모크 테스트: 실제 창을 띄우지 않고(off-screen) index.html 을 로드해
// (1) 페이지 로드 성공, (2) preload 브리지(window.mdv) 연결, (3) 렌더러 상태 정상
// 을 검증하고 종료 코드로 결과를 보고한다. CI / 무디스플레이 환경용.

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.disableHardwareAcceleration(); // 헤드리스 GPU 이슈 회피

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

  win.webContents.on('did-fail-load', (_e, code, desc) =>
    fail(`did-fail-load ${code} ${desc}`)
  );
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) fail(`renderer console error: ${message}`);
  });

  try {
    await win.loadFile(
      path.join(__dirname, '..', 'src', 'renderer', 'index.html')
    );
    const bridge = await win.webContents.executeJavaScript(
      'window.mdv && window.mdv.version'
    );
    const status = await win.webContents.executeJavaScript(
      'document.getElementById("status").textContent'
    );
    console.log('preload bridge version:', bridge);
    console.log('renderer status text  :', status);
    if (!bridge) fail('window.mdv 미연결');
    if (!/정상/.test(status)) fail(`status 비정상: ${status}`);
  } catch (e) {
    fail(String(e));
  }

  if (!failed) console.log('SMOKE PASS ✅');
  app.exit(failed ? 1 : 0);
});
