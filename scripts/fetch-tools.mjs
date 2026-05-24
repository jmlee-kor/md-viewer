// 외부 인터넷 PC에서 실행 → PlantUML 자동반입용 바이너리(JRE + plantuml.jar)를
// tools/ 에 받아둔다. electron-builder 가 이 tools/ 를 패키지에 번들(extraResources).
// tools/ 는 gitignore 라 커밋 안 됨 — 빌드 시점에 이 스크립트로 확보.
//
//   npm run tools:fetch
//
// 멱등: 이미 있으면 건너뜀. (Windows 빌드 전제 — Expand-Archive 사용)

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.join(root, 'tools');

// 고정 버전 (재현성). 갱신 시 여기만 바꾼다.
const JRE_URL =
  'https://api.adoptium.net/v3/binary/version/jdk-21.0.7%2B6/windows/x64/jre/hotspot/normal/eclipse?project=jdk';
const JRE_FALLBACK =
  'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk';
const JAR_URL =
  'https://repo1.maven.org/maven2/net/sourceforge/plantuml/plantuml/1.2024.7/plantuml-1.2024.7.jar';

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('redirect 과다'));
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
        }
        const tmp = dest + '.tmp';
        const file = fs.createWriteStream(tmp);
        res.pipe(file);
        file.on('finish', () => file.close(() => { fs.renameSync(tmp, dest); resolve(fs.statSync(dest).size); }));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function downloadFirst(urls, dest) {
  let lastErr;
  for (const u of urls) {
    try { return await download(u, dest); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

fs.mkdirSync(tools, { recursive: true });

// 1) plantuml.jar
const jar = path.join(tools, 'plantuml.jar');
if (fs.existsSync(jar)) {
  console.log('plantuml.jar 이미 있음 — 건너뜀');
} else {
  process.stdout.write('plantuml.jar 다운로드 … ');
  const sz = await download(JAR_URL, jar);
  console.log(`${(sz / 1024 / 1024).toFixed(1)} MB`);
}

// 2) JRE (zip 다운로드 → Expand-Archive → tools/jre)
const javaExe = path.join(tools, 'jre', 'bin', 'java.exe');
if (fs.existsSync(javaExe)) {
  console.log('JRE 이미 있음 — 건너뜀');
} else {
  process.stdout.write('JRE 다운로드 … ');
  const zip = path.join(tools, '_jre.zip');
  const sz = await downloadFirst([JRE_URL, JRE_FALLBACK], zip);
  console.log(`${(sz / 1024 / 1024).toFixed(1)} MB, 압축 해제 …`);
  const tmpDir = path.join(tools, '_jretmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${tmpDir}' -Force`]);
  const inner = fs.readdirSync(tmpDir)[0]; // 단일 최상위 폴더
  fs.rmSync(path.join(tools, 'jre'), { recursive: true, force: true });
  fs.renameSync(path.join(tmpDir, inner), path.join(tools, 'jre'));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  console.log('JRE 준비 완료: tools/jre');
}

console.log('PlantUML 자동반입 도구 준비 완료. (electron-builder 가 tools/ 를 번들합니다)');
