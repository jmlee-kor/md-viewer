'use strict';

// 아이콘 생성: assets/icon.svg 를 Electron(Chromium)으로 래스터화 → ico/png.
// sharp 등 네이티브 의존 없이 이미 있는 Electron 으로 렌더한다.
//   npm run make:icon

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const pngToIcoMod = require('png-to-ico');
const pngToIco = pngToIcoMod.default || pngToIcoMod;

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
const svg = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
const html =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>' +
  '</head><body>' + svg + '</body></html>';

app.disableHardwareAcceleration();

async function run() {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400)); // 렌더 안정화

  const img = await win.webContents.capturePage();
  if (img.isEmpty()) {
    console.error('캡처 실패 (빈 이미지)');
    app.exit(1);
    return;
  }

  const sizes = [256, 128, 64, 48, 32, 16];
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG());

  fs.writeFileSync(path.join(assets, 'icon.png'), pngs[0]); // 256 (window/linux)
  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico);

  console.log(`icon.png (${pngs[0].length}B) / icon.ico (${ico.length}B) 생성, 캡처크기 ${JSON.stringify(img.getSize())}`);
}

app.whenReady().then(run).then(
  () => app.exit(0),
  (e) => {
    console.error('ICON FAIL:', e && e.stack ? e.stack : e);
    app.exit(1);
  }
);
