'use strict';

// Electron main process.
// 책임: 윈도우 + 보안 기본값 + vault IPC + 링크 인덱스 + 파일 감시(fs.watch, 의존성 0).

const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const vault = require('./vault');
const linkIndex = require('./link-index');
const plantuml = require('./plantuml');
const updater = require('./updater');
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
// 자동 업데이트 설정(mdv.config.json) 기준 경로 — 패키징본/dev 동일 규칙.
updater.setBaseDir(
  app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..')
);

/** @type {BrowserWindow | null} */
let mainWindow = null;
let currentVaultRoot = null;
let currentIndex = null;
let currentContents = {}; // relPath -> 원문 (전문 검색용, main 보관 — 렌더러로 전송 안 함)
let currentTitles = {};
// 증분 인덱싱 캐시: relPath -> {mtimeMs, src, parsed}. loadVault 가 변경 파일만 재read/parse.
let indexCache = new Map();
/** @type {fs.FSWatcher | null} */
let watcher = null;
/** 발표 청중 창 + 동기화 상태 (발표자 메인 창이 src/index/blank 를 릴레이) */
let audienceWindow = null;
let presentState = { src: '', index: 0, blank: null };

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
    closeAudience(); // 발표자 창 닫히면 청중 창도 정리
  });

  // 최대화 상태를 렌더러에 통지 (타이틀바 아이콘 토글용)
  const sendMax = () => mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized());
  mainWindow.on('maximize', sendMax);
  mainWindow.on('unmaximize', sendMax);
}

/**
 * vault 스캔 + 인덱스 구축 → 렌더러로 보낼 payload.
 * @param changed 변경 파일 relPath Set | null. 주어지면 증분(변경 파일만 read/parse),
 *   null 이면 mtime stat 폴백(수동 rescan) — 단 캐시가 비었으면 어느 쪽이든 전체 read(cold).
 */
async function loadVault(root, changed = null) {
  if (root !== currentVaultRoot) indexCache = new Map(); // vault 전환 시 캐시 무효화(relPath 기준)
  currentVaultRoot = root;
  const tree = await vault.scanVault(root);
  const files = linkIndex.flatten(tree);
  const index = await linkIndex.buildIndex(files, (rel) => vault.readNote(root, rel), {
    cache: indexCache,
    stat: linkIndex.makeStat(root),
    changed, // fs.watch 가 준 변경 목록(있으면 stat 도 생략)
  });
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
  const dirty = new Set(); // 디바운스 창 동안 변경된 .md relPath 누적
  let sawNull = false; // filename 미보고 이벤트 — 신뢰 불가 → mtime 폴백
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (filename) {
        // 비-md(이미지 등) 변경은 매 loadVault 의 scanVault/listFiles 재스캔으로 반영되므로
        // 인덱스 changed-set 에는 .md 만 누적. (스캔이 tree/embedResolve 를 항상 최신화)
        const rel = String(filename).split(path.sep).join('/');
        if (/\.md$/i.test(rel)) dirty.add(rel);
      } else {
        sawNull = true; // 일부 플랫폼/이벤트는 filename 미보고 → 신뢰 불가 → mtime 폴백
      }
      clearTimeout(timer);
      timer = setTimeout(async () => {
        // 변경 목록을 신뢰할 수 있으면(모든 이벤트가 filename 보고) changed-set 증분, 아니면 mtime 폴백
        const changed = sawNull ? null : new Set(dirty);
        dirty.clear();
        sawNull = false;
        try {
          const data = await loadVault(root, changed);
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

// --- IPC: PlantUML 도구 상태 (설정 UI 표시용) ---
ipcMain.handle('plantuml:status', () => plantuml.status());

// --- IPC: 번들 sample-vault 경로 (첫 실행 데모 자동 열기용) ---
ipcMain.handle('vault:samplePath', () => {
  const p = app.isPackaged
    ? path.join(process.resourcesPath, 'sample-vault') // extraResources
    : path.join(__dirname, '..', '..', 'sample-vault'); // dev: 프로젝트 루트
  return fs.existsSync(p) ? p : null;
});

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

// --- IPC: 다이어그램 export (PNG bytes / SVG 문자열) ---
ipcMain.handle('diagram:export', async (e, { format, data, name }) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
  const base = (name || 'diagram').replace(/[\\/:*?"<>|]/g, '_');
  const res = await dialog.showSaveDialog(win, {
    defaultPath: `${base}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  if (format === 'svg') fs.writeFileSync(res.filePath, String(data), 'utf8');
  else fs.writeFileSync(res.filePath, Buffer.from(data)); // png: Uint8Array(ArrayBuffer)
  return { ok: true, path: res.filePath };
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

// --- 발표 이중 창: 청중 창 생성 + 발표자↔청중 동기화 릴레이 ---
function closeAudience() {
  if (audienceWindow && !audienceWindow.isDestroyed()) audienceWindow.close();
}

ipcMain.handle('present:open', (_e, src) => {
  presentState = { src: src || '', index: 0, blank: null };
  if (audienceWindow && !audienceWindow.isDestroyed()) {
    // 이미 발표 중이면 src 만 갱신하고 청중 창 포커스
    audienceWindow.webContents.send('present:src', presentState.src);
    audienceWindow.focus();
    return true;
  }
  // 보조 모니터가 있으면 거기 fullscreen, 없으면 기본 디스플레이 fullscreen(단일 폴백)
  const primary = screen.getPrimaryDisplay();
  const target = screen.getAllDisplays().find((d) => d.id !== primary.id) || primary;
  audienceWindow = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    fullscreen: true,
    backgroundColor: '#000',
    frame: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  audienceWindow.loadFile(path.join(__dirname, '..', 'renderer', 'audience.html'));
  audienceWindow.once('ready-to-show', () => {
    audienceWindow?.showInactive(); // 포커스 안 뺏고 표시 → 발표자 창에서 바로 키보드 조작
    mainWindow?.focus(); // 발표자(컨트롤) 창 포커스 유지
  });
  audienceWindow.on('closed', () => {
    audienceWindow = null;
    mainWindow?.webContents.send('present:ended'); // 발표자 단일 창 복귀
  });
  return true;
});

// (청중) 준비 완료 → 현재 src + state 푸시
ipcMain.on('present:ready', () => {
  if (!audienceWindow || audienceWindow.isDestroyed()) return;
  audienceWindow.webContents.send('present:src', presentState.src);
  audienceWindow.webContents.send('present:state', { index: presentState.index, blank: presentState.blank });
});

// (발표자) 네비/블랭크 변경 → 청중 창 릴레이
ipcMain.on('present:state', (_e, state) => {
  presentState = { ...presentState, ...(state || {}) };
  if (audienceWindow && !audienceWindow.isDestroyed()) {
    audienceWindow.webContents.send('present:state', { index: presentState.index, blank: presentState.blank });
  }
});

// (청중) 네비 의도 → 발표자 창으로 릴레이 (발표자 deck 이 실행 후 인덱스/블랭크 동기)
ipcMain.on('present:nav', (_e, action) => mainWindow?.webContents.send('present:nav', action));

ipcMain.on('present:close', closeAudience);

// --- 자동 업데이트: 주기 확인 + 알림 (Phase 1) ---
let updateTimer = null;

/**
 * 최신 릴리스 확인. 새 버전이면 메인 창에 update:available 푸시.
 * @param manual 수동 확인(설정 패널)이면 결과를 그대로 반환(가용 여부 무관 표시용).
 */
async function runUpdateCheck(manual = false) {
  const result = await updater.checkForUpdate(app.getVersion());
  if (result.available && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:available', result);
  }
  if (manual) return result;
  return null;
}

// 수동 확인(설정 패널의 "지금 확인") — 가용 여부와 무관하게 현재/최신/에러를 반환.
ipcMain.handle('update:check', () => runUpdateCheck(true));

// powershell Expand-Archive 로 zip 추출 (fetch-tools.mjs 와 동일 방식, 런타임 의존 0).
function extractZip(zip, destDir) {
  return new Promise((resolve, reject) => {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    execFile(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${destDir}' -Force`],
      { windowsHide: true },
      (err) => (err ? reject(err) : resolve(destDir))
    );
  });
}

// 추출 결과에서 실제 앱 루트(<exe> 가 직접 있는 디렉토리) 탐색. zip 이 한 겹 폴더로 감싼 경우 대응.
function findAppRoot(dir, exe) {
  if (fs.existsSync(path.join(dir, exe))) return dir;
  for (const name of fs.readdirSync(dir)) {
    const sub = path.join(dir, name);
    if (fs.statSync(sub).isDirectory() && fs.existsSync(path.join(sub, exe))) return sub;
  }
  return null;
}

// 새 버전 다운로드 → 추출 → 분리 헬퍼(powershell)가 종료 후 스왑+재실행. 앱은 종료.
// 실행 중 자기 파일 잠금을 피하려 반드시 종료 후 헬퍼가 교체한다([[feedback_verify_install_artifact_updated]]).
ipcMain.handle('update:apply', async (_e, info) => {
  if (!app.isPackaged) {
    return { ok: false, error: '개발 모드에서는 자동 적용을 지원하지 않습니다 (패키징 설치본 전용).' };
  }
  const asset = info?.asset;
  if (!asset?.url) return { ok: false, error: '다운로드할 패키징 에셋이 릴리스에 없습니다.' };

  const exe = path.basename(app.getPath('exe')); // md-viewer.exe
  const installDir = path.dirname(app.getPath('exe'));
  const work = path.join(app.getPath('temp'), 'md-viewer-update');
  const zip = path.join(work, 'download.zip');
  const extracted = path.join(work, 'extracted');
  const send = (p) => mainWindow?.webContents.send('update:progress', p);

  try {
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });

    // 1) 다운로드 (진행률 → 렌더러)
    send({ phase: 'download', received: 0, total: asset.size || 0 });
    const cfg = updater.getConfig();
    await updater.downloadFile(asset.url, zip, {
      token: cfg.token,
      onProgress: (received, total) => send({ phase: 'download', received, total: total || asset.size || 0 }),
    });
    // 크기 검증(릴리스 메타가 있으면)
    const got = fs.statSync(zip).size;
    if (asset.size && got !== asset.size) {
      throw new Error(`다운로드 크기 불일치: ${got} ≠ ${asset.size}`);
    }

    // 2) 추출 + 앱 루트 탐색
    send({ phase: 'extract' });
    await extractZip(zip, extracted);
    const stagedRoot = findAppRoot(extracted, exe);
    if (!stagedRoot) throw new Error(`추출물에서 ${exe} 를 찾지 못함`);

    // 3) 분리 헬퍼 실행 (앱 종료 후 스왑) → 앱 종료
    const helper = app.isPackaged
      ? path.join(process.resourcesPath, 'apply-update.ps1')
      : path.join(__dirname, '..', '..', 'scripts', 'apply-update.ps1');
    send({ phase: 'swap' });

    // 단순 detached spawn 으로는 Electron 의 Job Object(kill-on-close)가 앱 종료 시
    // 자식 powershell 까지 죽인다(실측). cmd `start` 로 job 에서 breakaway 시켜
    // 앱이 종료돼도 헬퍼가 살아남아 스왑·재실행하게 한다.
    const logPath = path.join(work, 'apply.log');
    const launchCmd = path.join(work, 'launch.cmd');
    const q = (s) => `"${s}"`;
    fs.writeFileSync(
      launchCmd,
      '@echo off\r\n' +
        `powershell -NoProfile -ExecutionPolicy Bypass -File ${q(helper)} ` +
        `-OwnerPid ${process.pid} -Staged ${q(stagedRoot)} -Install ${q(installDir)} ` +
        `-Exe ${q(exe)} -Log ${q(logPath)}\r\n`,
      'utf8'
    );
    const child = spawn('cmd.exe', ['/c', 'start', '""', '/min', launchCmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {}); // spawn 실패해도 앱은 곧 종료 — 조용히 무시
    child.unref();

    // 헬퍼가 우리 종료를 기다리도록 약간의 여유 후 종료
    setTimeout(() => app.quit(), 800);
    return { ok: true, phase: 'restarting' };
  } catch (err) {
    send({ phase: 'error', error: String((err && err.message) || err) });
    return { ok: false, error: String((err && err.message) || err) };
  }
});

function startUpdateChecks() {
  const cfg = updater.getConfig();
  if (!cfg.enabled) return;
  // 시작 직후 1회(창 로드 여유 8s) + 주기 반복.
  setTimeout(() => runUpdateCheck(false), 8000);
  const ms = Math.max(1, cfg.intervalH) * 3600 * 1000;
  updateTimer = setInterval(() => runUpdateCheck(false), ms);
}

app.whenReady().then(() => {
  resProtocol.handle(() => currentVaultRoot);
  createWindow();
  startUpdateChecks();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (watcher) watcher.close();
  if (updateTimer) clearInterval(updateTimer);
  if (process.platform !== 'darwin') app.quit();
});
