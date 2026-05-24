'use strict';

// Electron main process.
// 책임: 윈도우 + 보안 기본값 + vault IPC + 링크 인덱스 + 파일 감시(fs.watch, 의존성 0).

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vault = require('./vault');
const linkIndex = require('./link-index');
const plantuml = require('./plantuml');
const resProtocol = require('./res-protocol');

// Windows 작업표시줄 identity. 이게 없으면 "electron" 으로 그룹/표시된다.
// build.appId 와 동일하게 맞춰 핀 고정·아이콘이 md-viewer 로 안정화.
const APP_ID = 'com.local.md-viewer';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// privileged scheme 등록은 app ready 이전이어야 함
resProtocol.registerPrivileged();

// PlantUML tools/ 탐색 기준: 패키징 시 resourcesPath(extraResources 번들 위치),
// dev 시 프로젝트 루트. → 패키징본은 번들된 tools/(jre+jar)로 자동 동작.
plantuml.setBaseDir(
  app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..')
);

/** @type {BrowserWindow | null} */
let mainWindow = null;
let currentVaultRoot = null;
let currentIndex = null;
/** @type {fs.FSWatcher | null} */
let watcher = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e1e',
    show: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
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

/** vault 스캔 + 인덱스 구축 → 렌더러로 보낼 payload */
async function loadVault(root) {
  currentVaultRoot = root;
  const tree = await vault.scanVault(root);
  const files = linkIndex.flatten(tree);
  currentIndex = await linkIndex.buildIndex(files, (rel) => vault.readNote(root, rel));
  return { root, tree, index: currentIndex };
}

/** 재귀 파일 감시. 변경 시 디바운스 후 재스캔 → 렌더러 통지. (Node 빌트인, 의존성 0) */
function startWatch(root) {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  let timer = null;
  try {
    watcher = fs.watch(root, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const data = await loadVault(root);
          mainWindow?.webContents.send('vault:changed', data);
        } catch {
          /* vault 삭제 등 — 무시 */
        }
      }, 250);
    });
  } catch {
    /* recursive 미지원 플랫폼 등 — 감시 없이 동작 */
  }
}

ipcMain.handle('vault:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Vault 폴더 선택',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const data = await loadVault(res.filePaths[0]);
  startWatch(res.filePaths[0]);
  return data;
});

ipcMain.handle('vault:rescan', async () => {
  if (!currentVaultRoot) return null;
  return loadVault(currentVaultRoot);
});

ipcMain.handle('note:read', async (_e, relPath) => {
  if (!currentVaultRoot) throw new Error('vault 미선택');
  return vault.readNote(currentVaultRoot, relPath);
});

// --- IPC: PlantUML 렌더 (java -jar plantuml.jar -pipe) ---
ipcMain.handle('plantuml:render', async (_e, src) => plantuml.render(src));

app.whenReady().then(() => {
  resProtocol.handle(() => currentVaultRoot);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (watcher) watcher.close();
  if (process.platform !== 'darwin') app.quit();
});
