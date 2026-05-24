'use strict';

// Electron main process.
// 책임: 윈도우 + 보안 기본값 + vault IPC + 링크 인덱스 + 파일 감시(fs.watch, 의존성 0).

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
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

// 네이티브 앱 메뉴바(File/Edit/View/Window) 제거 — 기능은 좌하단 플로팅 메뉴로 흡수.
Menu.setApplicationMenu(null);

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
let currentContents = {}; // relPath -> 원문 (전문 검색용, main 보관 — 렌더러로 전송 안 함)
let currentTitles = {};
/** @type {fs.FSWatcher | null} */
let watcher = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e1e',
    show: false,
    frame: false, // 커스텀 타이틀바 (드래그 영역 + min/max/close 는 렌더러에서)
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

  // 최대화 상태를 렌더러에 통지 (타이틀바 아이콘 토글용)
  const sendMax = () => mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized());
  mainWindow.on('maximize', sendMax);
  mainWindow.on('unmaximize', sendMax);
}

/** vault 스캔 + 인덱스 구축 → 렌더러로 보낼 payload */
async function loadVault(root) {
  currentVaultRoot = root;
  const tree = await vault.scanVault(root);
  const files = linkIndex.flatten(tree);
  const index = await linkIndex.buildIndex(files, (rel) => vault.readNote(root, rel));
  // 위키 임베드(![[...]]) 해석용: 전체 파일(이미지 포함) 맵
  const embedResolve = linkIndex.buildEmbedResolve(await vault.listFiles(root));
  // 본문(contents)은 검색용으로 main 에 보관하고 렌더러 payload 에서는 제외
  // (대용량 vault 에서 매 watch 변경마다 본문 전체를 IPC 로 보내는 비용 회피).
  currentContents = index.contents;
  currentTitles = index.titles;
  const { contents, ...rest } = index;
  const indexForRenderer = { ...rest, embedResolve };
  currentIndex = indexForRenderer;
  return { root, tree, index: indexForRenderer };
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

// --- IPC: 경로로 vault 열기 (최근 목록에서 재오픈, 다이얼로그 없이) ---
ipcMain.handle('vault:openPath', async (_e, root) => {
  if (!root || !fs.existsSync(root)) throw new Error(`vault 경로 없음: ${root}`);
  const data = await loadVault(root);
  startWatch(root);
  return data;
});

ipcMain.handle('note:read', async (_e, relPath) => {
  if (!currentVaultRoot) throw new Error('vault 미선택');
  return vault.readNote(currentVaultRoot, relPath);
});

// --- IPC: 전문 검색 (main 보관 contents in-memory 검색) ---
ipcMain.handle('vault:search', (_e, query) =>
  linkIndex.searchContent(currentContents, currentTitles, query)
);

// --- IPC: PlantUML 렌더 (java -jar plantuml.jar -pipe) ---
ipcMain.handle('plantuml:render', async (_e, src) => plantuml.render(src));

// --- Marp export: 자립형 HTML 빌드 + printToPDF (오프라인, marp-cli 미사용) ---
function buildMarpExportHtml(html, css) {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>\n' +
    css +
    '\nhtml,body{margin:0;padding:0;background:#fff;}' +
    '\n@page{margin:0;}' +
    '\n.marpit>section{break-after:page;}' +
    '\n.marpit>section:last-child{break-after:auto;}' +
    '\n</style></head><body>' +
    html +
    '</body></html>'
  );
}

// PNG(슬라이드별): 1280x720 offscreen 에서 각 슬라이드 스크롤+capturePage
async function renderMarpPngs(html, css) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  try {
    const full =
      '<!doctype html><html><head><meta charset="utf-8"><style>\n' +
      css +
      '\nhtml,body{margin:0;padding:0;overflow:hidden;}.marpit>section{width:1280px;height:720px;}' +
      '\n</style></head><body>' + html + '</body></html>';
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(full));
    await new Promise((r) => setTimeout(r, 350));
    const count = await win.webContents.executeJavaScript(
      'document.querySelectorAll(".marpit > section").length'
    );
    const pngs = [];
    for (let i = 0; i < count; i++) {
      await win.webContents.executeJavaScript(`window.scrollTo(0, ${i} * 720)`);
      await new Promise((r) => setTimeout(r, 60));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 720 });
      pngs.push(img.toPNG());
    }
    return pngs;
  } finally {
    win.destroy();
  }
}

// SVG(슬라이드별): inlineSVG html 에서 <svg> 추출 + css 인라인(standalone)
function splitMarpSvgs(svgHtml, css) {
  const svgs = svgHtml.match(/<svg[\s\S]*?<\/svg>/g) || [];
  return svgs.map((svg) => svg.replace(/(<svg[^>]*>)/, `$1<style>${css}</style>`));
}

async function renderMarpPdf(html, css) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true },
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildMarpExportHtml(html, css)));
    await new Promise((r) => setTimeout(r, 350)); // 폰트/레이아웃 안정화
    // 마프 기본 슬라이드 1280x720px ≈ 13.333in x 7.5in
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: 13.333, height: 7.5 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  } finally {
    win.destroy();
  }
}

ipcMain.handle('marp:export', async (e, { format, html, css, title }) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
  const base = (title || 'slides').replace(/[\\/:*?"<>|]/g, '_');
  if (format === 'html') {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: `${base}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, buildMarpExportHtml(html, css), 'utf8');
    return { ok: true, path: res.filePath };
  }
  if (format === 'pdf') {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: `${base}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const pdf = await renderMarpPdf(html, css);
    fs.writeFileSync(res.filePath, pdf);
    return { ok: true, path: res.filePath };
  }
  if (format === 'png' || format === 'svg') {
    // 슬라이드별 다중 파일 → 저장 위치(베이스 경로) 선택 후 <base>-N.<ext>
    const res = await dialog.showSaveDialog(win, {
      defaultPath: `${base}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const dir = path.dirname(res.filePath);
    const stem = path.basename(res.filePath).replace(new RegExp(`\\.${format}$`, 'i'), '');
    let n = 0;
    if (format === 'png') {
      const pngs = await renderMarpPngs(html, css);
      pngs.forEach((buf, i) => fs.writeFileSync(path.join(dir, `${stem}-${i + 1}.png`), buf));
      n = pngs.length;
    } else {
      const svgs = splitMarpSvgs(html, css);
      svgs.forEach((svg, i) => fs.writeFileSync(path.join(dir, `${stem}-${i + 1}.svg`), svg, 'utf8'));
      n = svgs.length;
    }
    return { ok: true, path: dir, count: n };
  }
  return { ok: false, error: `미지원 포맷: ${format}` };
});

// --- IPC: 창/보기 액션 (제거한 네이티브 메뉴 대체) ---
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 5;
ipcMain.handle('app:action', (e, name) => {
  const wc = e.sender;
  const win = BrowserWindow.fromWebContents(wc);
  switch (name) {
    case 'reload': wc.reload(); break;
    case 'devtools': wc.toggleDevTools(); break;
    case 'zoomIn': wc.setZoomLevel(Math.min(ZOOM_MAX, wc.getZoomLevel() + ZOOM_STEP)); break;
    case 'zoomOut': wc.setZoomLevel(Math.max(ZOOM_MIN, wc.getZoomLevel() - ZOOM_STEP)); break;
    case 'zoomReset': wc.setZoomLevel(0); break;
    case 'fullscreen': win?.setFullScreen(!win.isFullScreen()); break;
    case 'maximize': if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); break;
    case 'minimize': win?.minimize(); break;
    case 'close': win?.close(); break;
    case 'quit': app.quit(); break;
  }
});

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
