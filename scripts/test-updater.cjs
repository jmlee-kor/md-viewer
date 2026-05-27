'use strict';

// updater.js 순수 단위 테스트 (네트워크 없음 — transport 주입).
// 실행: node scripts/test-updater.cjs

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const u = require('../src/main/updater');

// --- semver 비교 ---
assert.strictEqual(u.compareSemver('0.2.0', '0.1.0'), 1, '0.2.0 > 0.1.0');
assert.strictEqual(u.compareSemver('0.1.0', '0.2.0'), -1, '0.1.0 < 0.2.0');
assert.strictEqual(u.compareSemver('0.1.0', '0.1.0'), 0, '동일');
assert.strictEqual(u.compareSemver('v1.0.0', '0.9.9'), 1, 'v 접두 + major 우위');
assert.strictEqual(u.compareSemver('1.2.0', '1.10.0'), -1, '숫자 비교(문자열 아님)');
assert.strictEqual(u.compareSemver('1.0.0-beta', '1.0.0'), 0, 'pre-release 라벨 무시');

(async () => {
  // --- 새 버전 가용 + 패키징 에셋 매칭 ---
  const newer = async () => ({
    tag_name: 'v0.2.0',
    body: '릴리스 노트',
    assets: [
      { name: 'README.txt', browser_download_url: 'http://x/r.txt', size: 1 },
      { name: 'md-viewer-win-x64.zip', browser_download_url: 'http://x/a.zip', size: 999 },
    ],
  });
  const r = await u.checkForUpdate('0.1.0', newer);
  assert.strictEqual(r.available, true, '새 버전 감지');
  assert.strictEqual(r.latest, '0.2.0', 'tag → latest (v 제거)');
  assert.ok(r.asset && /win.*\.zip$/i.test(r.asset.name), 'win zip 에셋 선택');
  assert.strictEqual(r.asset.size, 999, '에셋 메타 전달');

  // --- 동일 버전: 가용 아님 ---
  const same = await u.checkForUpdate('0.2.0', async () => ({ tag_name: 'v0.2.0', assets: [] }));
  assert.strictEqual(same.available, false, '동일 버전이면 미가용');

  // --- 더 낮은 릴리스(롤백 상황): 미가용 ---
  const older = await u.checkForUpdate('0.3.0', async () => ({ tag_name: 'v0.2.0', assets: [] }));
  assert.strictEqual(older.available, false, '현재가 더 높으면 미가용');

  // --- 네트워크/파싱 오류는 throw 하지 않고 error 필드로 ---
  const errd = await u.checkForUpdate('0.1.0', async () => {
    throw new Error('네트워크 끊김');
  });
  assert.strictEqual(errd.available, false, '오류 시 미가용');
  assert.ok(errd.error, '오류 메시지 보존');

  // --- 비활성화(MDV_UPDATE_ENABLED=false) ---
  process.env.MDV_UPDATE_ENABLED = 'false';
  const off = await u.checkForUpdate('0.1.0', newer);
  assert.strictEqual(off.disabled, true, '비활성화 시 disabled');
  assert.strictEqual(off.available, false, '비활성화 시 미가용');
  delete process.env.MDV_UPDATE_ENABLED;

  // --- downloadFile: localhost http 스트림 + 진행률 + 크기 ---
  const payload = Buffer.from('PK fake-zip '.repeat(500));
  const server = http.createServer((_req, res) => {
    res.setHeader('content-length', String(payload.length));
    res.end(payload);
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const dest = path.join(os.tmpdir(), `mdv-dl-test-${process.pid}.bin`);
  let progressCalls = 0;
  let lastTotal = 0;
  const dl = await u.downloadFile(`http://127.0.0.1:${port}/asset.zip`, dest, {
    onProgress: (recv, total) => {
      progressCalls++;
      lastTotal = total;
    },
  });
  assert.strictEqual(dl.size, payload.length, '다운로드 바이트 == payload');
  assert.strictEqual(fs.statSync(dest).size, payload.length, '저장 파일 크기 일치');
  assert.ok(progressCalls > 0, 'onProgress 호출됨');
  assert.strictEqual(lastTotal, payload.length, 'content-length 전달');
  fs.unlinkSync(dest);
  server.close();

  // --- 스왑 헬퍼 번들 대상 존재 ---
  assert.ok(fs.existsSync(path.join(__dirname, 'apply-update.ps1')), 'apply-update.ps1 존재(extraResources 번들 대상)');

  console.log('test-updater OK');
})().catch((e) => {
  console.error('test-updater FAIL:', e.message);
  process.exit(1);
});
