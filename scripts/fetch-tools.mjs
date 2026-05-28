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
// JRE 대신 JDK 를 받아 jlink 로 PlantUML 이 쓰는 모듈만 담은 슬림 런타임을 만든다
// (풀 JRE ~145MB → 슬림 ~50MB). jdeps/jlink 가 JDK 에만 있어 JDK 필요.
const JDK_URL =
  'https://api.adoptium.net/v3/binary/version/jdk-21.0.7%2B6/windows/x64/jdk/hotspot/normal/eclipse?project=jdk';
const JDK_FALLBACK =
  'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk';
const JAR_URL =
  'https://repo1.maven.org/maven2/net/sourceforge/plantuml/plantuml/1.2024.7/plantuml-1.2024.7.jar';
const GRAPHVIZ_VERSION = '12.2.1';
const GRAPHVIZ_URL =
  `https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/${GRAPHVIZ_VERSION}/windows_10_cmake_Release_Graphviz-${GRAPHVIZ_VERSION}-win64.zip`;

/** zip 다운로드 → Expand-Archive → 단일 최상위 폴더를 destDir 로 이동 */
async function downloadAndExtract(urls, label, destDir, zipName) {
  const zip = path.join(tools, zipName);
  const sz = await downloadFirst(urls, zip);
  console.log(`${label}: ${(sz / 1024 / 1024).toFixed(1)} MB, 압축 해제 …`);
  const tmpDir = path.join(tools, '_tmp_' + label);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${tmpDir}' -Force`]);
  const inner = fs.readdirSync(tmpDir)[0];
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.renameSync(path.join(tmpDir, inner), destDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
}

// curl 감지: Win10 1803+ System32 기본 포함. 사내 프록시/MITM 인증서 환경에서는
// curl 이 Windows 시스템 설정(프록시·인증서 저장소)을 따르므로 Node https 보다 안정적.
// 가능하면 curl 우선 사용, 없으면 Node https 로 폴백 (MDV_FETCH_NO_CURL=1 로 강제 비활성).
function detectCurl() {
  if (process.env.MDV_FETCH_NO_CURL === '1') return false;
  try { execFileSync('curl', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
const HAS_CURL = detectCurl();

// Windows IE 프록시 자동 감지 (사내 PC 에서 curl 이 시스템 IE 프록시를 자동으로
// 안 읽어 발생하는 curl(35) Recv reset 회피). 우선순위:
//   MDV_HTTPS_PROXY > HTTPS_PROXY/https_proxy > Windows 레지스트리(IE 프록시)
function getWindowsIEProxy() {
  if (process.platform !== 'win32') return null;
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const en = execFileSync('reg', ['query', key, '/v', 'ProxyEnable'], { encoding: 'utf8' });
    const enMatch = en.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i);
    if (!enMatch || parseInt(enMatch[1], 16) !== 1) return null;
    const sv = execFileSync('reg', ['query', key, '/v', 'ProxyServer'], { encoding: 'utf8' });
    const svMatch = sv.match(/ProxyServer\s+REG_SZ\s+(.+)/);
    if (!svMatch) return null;
    let p = svMatch[1].trim();
    if (p.includes('=')) {
      const map = Object.fromEntries(p.split(';').map((s) => { const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }));
      p = map.https || map.http || Object.values(map)[0];
    }
    if (!p) return null;
    return p.startsWith('http') ? p : `http://${p}`;
  } catch { return null; }
}
const PROXY = process.env.MDV_HTTPS_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || getWindowsIEProxy();
const CA = process.env.MDV_CA_BUNDLE || null;
const CURL_ENV = PROXY ? { ...process.env, HTTPS_PROXY: PROXY, HTTP_PROXY: PROXY } : process.env;

console.log(HAS_CURL ? '다운로드: curl (시스템 프록시/인증서 사용)' : '다운로드: Node https (curl 없음)');
if (PROXY) console.log(`  프록시: ${PROXY}`);
if (CA) console.log(`  CA 번들: ${CA}`);

function downloadCurl(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.tmp';
    try {
      const args = ['-fsSL', '--retry', '3', '--retry-connrefused', '--retry-delay', '2', '--max-time', '600'];
      if (CA) args.push('--cacert', CA);
      args.push('-o', tmp, url);
      execFileSync('curl', args, { stdio: ['ignore', 'inherit', 'inherit'], env: CURL_ENV });
      fs.renameSync(tmp, dest);
      resolve(fs.statSync(dest).size);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      reject(e);
    }
  });
}

function downloadNode(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('redirect 과다'));
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(downloadNode(new URL(res.headers.location, url).toString(), dest, redirects + 1));
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

function download(url, dest) {
  return HAS_CURL ? downloadCurl(url, dest) : downloadNode(url, dest);
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

// 2) 슬림 Java 런타임: JDK 다운로드 → jdeps 로 PlantUML 모듈 산출 → jlink 로 tools/jre 생성
//    bin/java.exe 경로는 풀 JRE 와 동일 → plantuml.js 변경 불필요.
const javaExe = path.join(tools, 'jre', 'bin', 'java.exe');
if (fs.existsSync(javaExe)) {
  console.log('java 런타임 이미 있음 — 건너뜀');
} else {
  process.stdout.write('JDK 다운로드 … ');
  const zip = path.join(tools, '_jdk.zip');
  const sz = await downloadFirst([JDK_URL, JDK_FALLBACK], zip);
  console.log(`${(sz / 1024 / 1024).toFixed(1)} MB, 압축 해제 …`);
  const jdkTmp = path.join(tools, '_jdktmp');
  fs.rmSync(jdkTmp, { recursive: true, force: true });
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${jdkTmp}' -Force`]);
  const jdkDir = path.join(jdkTmp, fs.readdirSync(jdkTmp)[0]); // 단일 최상위 폴더
  const jdeps = path.join(jdkDir, 'bin', 'jdeps.exe');
  const jlink = path.join(jdkDir, 'bin', 'jlink.exe');

  // PlantUML 이 쓰는 모듈을 jdeps 로 산출(reflective 누락 대비 안전 모듈 union).
  let detected = [];
  try {
    const out = execFileSync(
      jdeps,
      ['--print-module-deps', '--ignore-missing-deps', '--multi-release', '21', jar],
      { encoding: 'utf8' }
    ).trim();
    detected = out.split(',').map((s) => s.trim()).filter(Boolean);
    console.log('jdeps 모듈:', detected.join(',') || '(없음)');
  } catch (e) {
    console.warn('jdeps 실패 → 안전 모듈셋만 사용:', e.message);
  }
  // PlantUML 런타임 안전 보강(jdeps 는 정적 의존만 봐서 reflective/런타임 의존 누락).
  // 실측: PlantUML Run.main 이 즉시 java.util.logging 사용 → java.logging 필수.
  // AWT/이미지(java.desktop), XML(SVG), 스크립팅, JMX, JNDI, 환경설정, sun.misc 포함.
  const safe = [
    'java.base', 'java.desktop', 'java.datatransfer', 'java.logging', 'java.xml',
    'java.scripting', 'java.management', 'java.naming', 'java.prefs', 'jdk.unsupported',
  ];
  const modules = Array.from(new Set([...detected, ...safe])).join(',');
  console.log('jlink add-modules:', modules);

  fs.rmSync(path.join(tools, 'jre'), { recursive: true, force: true });
  execFileSync(
    jlink,
    ['--add-modules', modules, '--output', path.join(tools, 'jre'), '--strip-debug', '--no-header-files', '--no-man-pages', '--compress=2'],
    { stdio: 'inherit' }
  );
  fs.rmSync(jdkTmp, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  console.log('슬림 java 런타임 준비 완료: tools/jre');
}

// 3) Graphviz (dot) — 클래스/상태/컴포넌트 등 dot 레이아웃 다이어그램용
const dotExe = path.join(tools, 'graphviz', 'bin', 'dot.exe');
if (fs.existsSync(dotExe)) {
  console.log('Graphviz 이미 있음 — 건너뜀');
} else {
  process.stdout.write('Graphviz 다운로드 … ');
  await downloadAndExtract([GRAPHVIZ_URL], 'graphviz', path.join(tools, 'graphviz'), '_gv.zip');
  try {
    execFileSync(dotExe, ['-c']); // 플러그인 등록 (config6 생성)
    console.log('Graphviz 준비 완료 (dot -c 플러그인 등록)');
  } catch (e) {
    console.warn('dot -c 실패(첫 렌더 시 재시도될 수 있음):', e.message);
  }
}

console.log('PlantUML 자동반입 도구 준비 완료. (electron-builder 가 tools/ 를 번들합니다)');
