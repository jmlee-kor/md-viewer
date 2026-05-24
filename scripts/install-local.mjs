// 빌드된 unpacked 앱을 안정적 사용자 위치로 설치 (PATH 등록 위치와 동일).
//   npm run install:local   (= dist 빌드 후 이 스크립트)
// PATH 등록은 1회만 하면 되며(설치 위치 고정), 재빌드 시 이 복사로 갱신.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'dist', 'win-unpacked');
const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const dest = path.join(localApp, 'Programs', 'md-viewer');

if (!fs.existsSync(src)) {
  console.error(`빌드 결과 없음: ${src}\n→ 먼저 npm run dist`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`설치 완료: ${dest}`);
console.log('PATH 에 위 폴더가 있으면 어디서든 `md-viewer` 로 실행됩니다.');
console.log('PlantUML 사용 시 tools/ (jre, plantuml.jar) 를 이 폴더에 두세요.');
