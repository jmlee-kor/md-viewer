'use strict';
// README용 대표 기능 스크린샷 생성. sample-vault 로 일관된 화면을 캡처한다.
//   npx electron scripts/capture-screenshots.js
// 결과: docs/screenshots/*.png (repo 동봉). 앱 실행이 필요해 dev 전용 스크립트.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const vault = require('../src/main/vault');
const linkIndex = require('../src/main/link-index');
const plantuml = require('../src/main/plantuml');
const resProtocol = require('../src/main/res-protocol');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'sample-vault');
const OUT = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

let contents = {}, titles = {};
ipcMain.handle('vault:openPath', async (_e, root) => {
  const tree = await vault.scanVault(root);
  const index = await linkIndex.buildIndex(linkIndex.flatten(tree), (r) => vault.readNote(root, r));
  contents = index.contents; titles = index.titles;
  const embedResolve = linkIndex.buildEmbedResolve(await vault.listFiles(root));
  const { contents: _c, ...rest } = index;
  return { root, tree, index: { ...rest, embedResolve } };
});
ipcMain.handle('note:read', (_e, r) => vault.readNote(SAMPLE, r));
ipcMain.handle('vault:search', (_e, q) => linkIndex.searchContent(contents, titles, q));
ipcMain.handle('vault:samplePath', () => SAMPLE);
ipcMain.handle('plantuml:render', (_e, s) => plantuml.render(s));
ipcMain.handle('plantuml:status', () => plantuml.status());
plantuml.setBaseDir(ROOT);
resProtocol.registerPrivileged();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  resProtocol.handle(() => SAMPLE);
  const win = new BrowserWindow({
    width: 1280, height: 860, show: false, backgroundColor: '#1e1e1e',
    webPreferences: { preload: path.join(ROOT, 'src/main/preload.js'), contextIsolation: true, sandbox: true },
  });
  await win.loadFile(path.join(ROOT, 'src/renderer/index.html'));
  await sleep(400); // 컴포넌트 + 자동열기(sample) 대기

  const drive = (js) => win.webContents.executeJavaScript(`(async()=>{const el=document.querySelector('mdv-app');${js}})()`);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log('captured', name);
  };

  // 1) 렌더 뷰 (콜아웃/수식/코드)
  await drive(`el._onSelect('Features/렌더링.md'); await el.updateComplete;`);
  await sleep(900);
  await shot('rendering.png');

  // 2) 다이어그램
  await drive(`el._onSelect('Diagrams.md'); await el.updateComplete;`);
  await sleep(1500);
  await shot('diagrams.png');

  // 3) 전문 검색 + 하이라이트
  await drive(`el._searchQuery='다이어그램'; el._searchResults = await window.mdv.searchVault('다이어그램'); await el.updateComplete;`);
  await sleep(500);
  await shot('search.png');

  // 4) 그래프 뷰
  await drive(`el._searchQuery=''; el._searchResults=[]; el._openGraph(); await el.updateComplete;`);
  await sleep(700);
  await shot('graph.png');
  await drive(`el._closeGraph();`);

  // 5) Marp 슬라이드
  await drive(`el._onSelect('Slides.md'); await el.updateComplete;`);
  await sleep(900);
  await shot('marp.png');

  app.quit();
});
