'use strict';

// Electron main process.
// 책임: 윈도우 생성 + 보안 기본값. (vault 스캔/인덱싱/PlantUML IPC 는 후속 단계에서 이 파일에 붙는다.)

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e1e',
    show: false, // ready-to-show 까지 깜빡임 방지
    webPreferences: {
      // --- 보안 기본값 (이 세 줄이 핵심) ---
      contextIsolation: true, // 렌더러와 preload 의 JS 컨텍스트 분리
      nodeIntegration: false, // 렌더러에서 Node API 직접 접근 차단
      sandbox: true, // 렌더러 프로세스 샌드박스
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // macOS: dock 클릭 시 창 없으면 재생성 (사내는 Windows 이지만 관례상 둠)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Windows/Linux 는 모든 창 닫히면 종료
  if (process.platform !== 'darwin') app.quit();
});
