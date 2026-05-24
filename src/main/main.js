'use strict';

// Electron main process.
// 책임: 윈도우 생성 + 보안 기본값 + vault IPC. (PlantUML IPC 는 후속 단계에서 추가)

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const vault = require('./vault');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** 현재 열린 vault 루트 (절대경로). note:read 의 경로 검증 기준. */
let currentVaultRoot = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC: vault 열기 (폴더 선택 → 스캔 → 트리 반환) ---
ipcMain.handle('vault:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Vault 폴더 선택',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  currentVaultRoot = res.filePaths[0];
  const tree = await vault.scanVault(currentVaultRoot);
  return { root: currentVaultRoot, tree };
});

// --- IPC: 특정 경로의 vault 재스캔 (파일 감시 단계에서 사용 예정) ---
ipcMain.handle('vault:rescan', async () => {
  if (!currentVaultRoot) return null;
  const tree = await vault.scanVault(currentVaultRoot);
  return { root: currentVaultRoot, tree };
});

// --- IPC: 노트 읽기 (vault 내부 경로만) ---
ipcMain.handle('note:read', async (_e, relPath) => {
  if (!currentVaultRoot) throw new Error('vault 미선택');
  return vault.readNote(currentVaultRoot, relPath);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
