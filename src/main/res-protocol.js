'use strict';

// 커스텀 프로토콜 mdv-res:// — vault 내부 파일(이미지 등)을 렌더러에 안전하게 서빙.
// 노트의 ![](상대경로) 이미지를 mdv-res://vault/<relPath> 로 바꿔 로드한다.
// path-traversal 방어 + vault 내부로만 제한.

const { protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
};

// app ready 이전에 호출해야 함 (privileged scheme 등록)
function registerPrivileged() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'mdv-res',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

// app ready 이후 호출. getRoot() 는 현재 vault 루트(절대경로) 반환.
function handle(getRoot) {
  protocol.handle('mdv-res', async (req) => {
    const root = getRoot();
    if (!root) return new Response('vault 미선택', { status: 404 });

    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const normRoot = path.resolve(root);
    const abs = path.resolve(normRoot, rel);
    if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const data = await fs.promises.readFile(abs);
      const mime = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': mime } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

module.exports = { registerPrivileged, handle };
