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

// 실행 중인 인스턴스가 .exe/.asar 를 잠그면 복사가 실패하고도 옛 바이너리가 남는다
// (이전엔 조용히 통과 → 새 코드가 설치 안 됨). 먼저 종료시키고, 복사 후 검증한다.
if (process.platform === 'win32') {
  try {
    execFileSync('taskkill', ['/IM', 'md-viewer.exe', '/F'], { stdio: 'pipe' });
    console.log('실행 중이던 md-viewer 종료(파일 잠금 해제)');
    // 종료 후 핸들 해제 + AV 초기 스캔 settling
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500']);
  } catch {
    /* 실행 중이 아니면 taskkill 가 비0 종료 — 무시 */
  }
}

// rmSync + cpSync 대신 robocopy /MIR — 파일 단위 재시도(/R:30 /W:1)로 AV 스캔 잠금
// 회피. exit 0~7 = 성공, 8+ = 실패 (헬퍼와 동일 패턴).
if (process.platform === 'win32') {
  fs.mkdirSync(dest, { recursive: true });
  let rc = 0;
  try {
    execFileSync(
      'robocopy',
      [src, dest, '/MIR', '/R:30', '/W:1', '/MT:1', '/NP', '/NFL', '/NDL', '/NJH', '/NJS'],
      { stdio: 'inherit' }
    );
  } catch (e) {
    rc = (e && typeof e.status === 'number') ? e.status : 16;
  }
  if (rc > 7) {
    console.error(`robocopy 실패 (exit ${rc}) — AV 가 너무 적극적이면 일시 OFF 후 재시도`);
    process.exit(1);
  }
} else {
  // 비-Windows (드물지만 안전망)
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

// 복사 검증: 핵심 산출물(app.asar)이 src 와 동일 크기인지 확인. 불일치면 실패로 종료.
const relCheck = path.join('resources', 'app.asar');
const srcAsar = path.join(src, relCheck);
const destAsar = path.join(dest, relCheck);
if (fs.existsSync(srcAsar)) {
  const a = fs.statSync(srcAsar).size;
  const b = fs.existsSync(destAsar) ? fs.statSync(destAsar).size : -1;
  if (a !== b) {
    console.error(
      `설치 검증 실패: app.asar 크기 불일치 (빌드 ${a} vs 설치 ${b}).\n` +
        `→ md-viewer 가 아직 실행 중이라 파일이 잠겼을 수 있습니다. 앱 완전 종료 후 다시 시도하세요.`
    );
    process.exit(1);
  }
}
console.log(`설치 완료: ${dest} (app.asar 검증 OK)`);

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

// 시작메뉴 바로가기 (작업표시줄 핀 고정이 named exe 에 묶이게)
if (process.platform === 'win32') {
  try {
    const exe = path.join(dest, 'md-viewer.exe');
    const startMenu = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Microsoft', 'Windows', 'Start Menu', 'Programs'
    );
    const lnk = path.join(startMenu, 'md-viewer.lnk');
    const q = (s) => s.replace(/'/g, "''");
    const ps =
      `$w=New-Object -ComObject WScript.Shell; ` +
      `$s=$w.CreateShortcut('${q(lnk)}'); ` +
      `$s.TargetPath='${q(exe)}'; $s.WorkingDirectory='${q(dest)}'; ` +
      `$s.IconLocation='${q(exe)},0'; $s.Description='md-viewer'; $s.Save()`;
    execFileSync('powershell', ['-NoProfile', '-Command', ps]);
    console.log('시작메뉴 바로가기 생성: md-viewer (여기서 실행/핀 고정 권장)');
  } catch (e) {
    console.warn('바로가기 생성 실패:', e.message);
  }
}

console.log('PlantUML 은 번들된 tools(JRE+jar)로 자동 동작합니다 (설정 불필요).');
