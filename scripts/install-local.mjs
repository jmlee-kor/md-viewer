// 빌드된 unpacked 앱을 안정적 사용자 위치로 설치 (PATH 등록 위치와 동일).
//   npm run install:local   (= dist 빌드 후 이 스크립트)
// PATH 등록은 1회만 하면 되며(설치 위치 고정), 재빌드 시 이 복사로 갱신.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
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

// 사용자 PATH 에 설치 폴더 등록 (Windows, 중복 방지, 최초 1회만 실제 추가)
if (process.platform === 'win32') {
  try {
    const ps = `$d='${dest.replace(/'/g, "''")}'; ` +
      `$c=[Environment]::GetEnvironmentVariable('Path','User'); ` +
      `if($c -notlike "*$d*"){ $n= if([string]::IsNullOrEmpty($c)){$d}else{$c.TrimEnd(';')+';'+$d}; ` +
      `[Environment]::SetEnvironmentVariable('Path',$n,'User'); 'ADDED' } else { 'EXISTS' }`;
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
    console.log(
      out === 'ADDED'
        ? 'PATH(User) 등록됨 — 새 터미널부터 `md-viewer` 로 실행 가능'
        : 'PATH(User) 에 이미 등록됨'
    );
  } catch (e) {
    console.warn('PATH 자동 등록 실패(수동 등록 필요):', e.message);
  }
} else {
  console.log(`PATH 에 추가하세요: ${dest}`);
}

console.log('PlantUML 은 번들된 tools(JRE+jar)로 자동 동작합니다 (설정 불필요).');
