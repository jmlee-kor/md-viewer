// 릴리스 에셋 패키징 (Phase 3).
//   npm run dist:release   (= npm run dist 후 이 스크립트)
// dist/win-unpacked 을 단일 zip(+sha256)으로 묶어 GitHub Release 에 올린다.
// 자동 업데이트(updater.ASSET_RE = /win.*\.zip$/i)가 이 이름을 매칭해 다운로드한다.
// zip 루트에 md-viewer.exe 가 직접 오도록 win-unpacked 의 '내용'을 담는다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unpacked = path.join(root, 'dist', 'win-unpacked');
const ASSET = 'md-viewer-win-x64.zip';
const out = path.join(root, 'dist', ASSET);

if (!fs.existsSync(path.join(unpacked, 'md-viewer.exe'))) {
  console.error(`빌드 결과 없음: ${unpacked}\\md-viewer.exe\n→ 먼저 npm run dist`);
  process.exit(1);
}

console.log('zip 생성 중 (win-unpacked 내용 → ' + ASSET + ')…');
fs.rmSync(out, { force: true });
// PowerShell Compress-Archive: '\*' 로 폴더 내용만 담아 zip 루트에 exe 가 오게 한다.
execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${unpacked}\\*' -DestinationPath '${out}' -CompressionLevel Optimal -Force`,
  ],
  { stdio: 'inherit' }
);

const buf = fs.readFileSync(out);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
fs.writeFileSync(`${out}.sha256`, `${sha}  ${ASSET}\n`, 'utf8');

const mb = (buf.length / 1024 / 1024).toFixed(1);
console.log(`완료: ${out} (${mb} MB)`);
console.log(`sha256: ${sha}`);
console.log('\n발행:');
console.log(`  gh release create v<버전> --repo jmlee-kor/md-viewer --target main \\`);
console.log(`    --title "v<버전>" --notes "..." "${out}" "${out}.sha256"`);
