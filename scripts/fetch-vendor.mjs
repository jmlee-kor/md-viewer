// 외부 인터넷 PC에서 실행 → npm 으로 못 받는 vendor 자산을 내려받는다.
// (npm 패키지는 bundle-vendor.mjs 가 처리. 여기는 그 외 직접 다운로드 자산 전용)
//
//   npm run vendor:fetch
//
// 결과물(vendor/drawio-viewer.min.js 등)은 git 에 커밋되어 폐쇄망은 pull 로만 받는다.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'vendor');

// 직접 다운로드 대상. drawio 뷰어는 npm 배포본이 깔끔치 않아 공식 viewer 빌드를 받는다.
const ASSETS = [
  {
    out: 'drawio-viewer.min.js',
    url: 'https://viewer.diagrams.net/js/viewer.min.js',
    note: 'draw.io GraphViewer (mxGraph). rolling build — 고정이 필요하면 태그된 릴리스 URL 로 교체.',
  },
  {
    // CJK monospace 폰트: 코드/원본 보기에서 한글이 ASCII×2 폭으로 정렬되도록.
    // NanumGothicCoding (OFL) — Latin+Hangul 단일 파일이라 metrics 일관. google/fonts main.
    out: 'fonts/NanumGothicCoding-Regular.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/nanumgothiccoding/NanumGothicCoding-Regular.ttf',
    note: 'NanumGothicCoding Regular (OFL). 코드블록/원본보기 CJK 정렬용.',
  },
  {
    out: 'fonts/OFL.txt',
    url: 'https://github.com/google/fonts/raw/main/ofl/nanumgothiccoding/OFL.txt',
    note: 'NanumGothicCoding 라이선스 (SIL Open Font License 1.1).',
  },
];

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('redirect 과다'));
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(download(next, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
        }
        const tmp = dest + '.tmp';
        const file = fs.createWriteStream(tmp);
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          fs.renameSync(tmp, dest);
          resolve(fs.statSync(dest).size);
        }));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

fs.mkdirSync(vendorDir, { recursive: true });
for (const a of ASSETS) {
  const dest = path.join(vendorDir, a.out);
  fs.mkdirSync(path.dirname(dest), { recursive: true }); // 하위 디렉토리(fonts/) 대비
  process.stdout.write(`fetching ${a.out} … `);
  const size = await download(a.url, dest);
  console.log(`${(size / 1024 / 1024).toFixed(1)} MB`);
}
console.log('vendor 자산 다운로드 완료 (이 파일들을 git 커밋하세요)');
