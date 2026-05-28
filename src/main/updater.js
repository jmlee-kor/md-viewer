'use strict';

// 자동 업데이트 — Phase 1: 감지 + 알림.
// GitHub Releases API 를 main 프로세스 https(builtin)로 조회 → 현재 버전과 semver 비교.
// 설계: 런타임 node_modules 의존 0 (electron-updater 미사용). 네트워크는 main 에서만 →
//   렌더러 CSP(connect-src 'self')와 보안 모델 무훼손. 렌더러는 IPC 이벤트만 받는다.
// Phase 2 가 asset(zip) 다운로드 + 스테이징 스왑을 추가한다.

const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

// curl 감지: Win10 1803+ System32 기본 포함. 사내 프록시/MITM 인증서 환경에서는
// curl 이 시스템 프록시·인증서 저장소를 따라 ECONNRESET 등을 회피. 가능하면 curl 우선,
// 없으면 Node https 로 폴백 (MDV_UPDATE_NO_CURL=1 로 강제 비활성).
function detectCurl() {
  if (process.env.MDV_UPDATE_NO_CURL === '1') return false;
  try { execFileSync('curl', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
const HAS_CURL = detectCurl();

// Windows IE 프록시 자동 감지 — curl 은 Windows 시스템 프록시를 자동으로 안 읽으므로
// 레지스트리에서 직접 읽어 spawn env(HTTPS_PROXY)로 주입한다. (사내 PC에서 curl(35) 회피)
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
    // "host:port" 또는 "http=host:port;https=host:port" 양식 모두 대응
    if (p.includes('=')) {
      const map = Object.fromEntries(
        p.split(';').map((s) => { const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; })
      );
      p = map.https || map.http || Object.values(map)[0];
    }
    if (!p) return null;
    return p.startsWith('http') ? p : `http://${p}`;
  } catch { return null; }
}

/** 우선순위: MDV_HTTPS_PROXY env > mdv.config.json.httpsProxy > 표준 HTTPS_PROXY > Windows IE 프록시 */
function resolveProxyAndCa() {
  const cfg = readConfig();
  const proxy =
    process.env.MDV_HTTPS_PROXY ||
    cfg.httpsProxy ||
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    getWindowsIEProxy();
  const ca = process.env.MDV_CA_BUNDLE || cfg.caBundle || null;
  return { proxy, ca };
}

/** curl 실행을 위한 env + 추가 args(--cacert) 빌드 */
function curlEnvAndArgs() {
  const { proxy, ca } = resolveProxyAndCa();
  const env = { ...process.env };
  if (proxy) { env.HTTPS_PROXY = proxy; env.HTTP_PROXY = proxy; }
  const extraArgs = ca ? ['--cacert', ca] : [];
  return { env, extraArgs };
}

/** GitHub API 에러 본문(JSON {message})을 추출해 사용자 친화 메시지로 변환 */
function formatHttpError(status, body) {
  let msg = (body || '').trim() || `HTTP ${status}`;
  try {
    const j = JSON.parse(body);
    if (j && j.message) msg = `${j.message} (HTTP ${status})`;
  } catch { /* JSON 아니면 raw 사용 */ }
  return msg;
}

const DEFAULT_REPO = 'jmlee-kor/md-viewer';
const DEFAULT_INTERVAL_H = 6; // 주기 확인 간격(시간)
// 패키징 zip 에셋 이름 매칭(Phase 3 dist:release 산출물). Phase 2 다운로드가 이걸로 선택.
const ASSET_RE = /win.*\.zip$/i;

// 설정 파일(mdv.config.json) 기준 경로 — plantuml.js 와 동일하게 main 이 주입.
let baseDir = process.cwd();
function setBaseDir(dir) {
  baseDir = dir;
}

/** mdv.config.json 읽기(없거나 무효면 {}). */
function readConfig() {
  try {
    const p = path.join(baseDir, 'mdv.config.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch {
    /* 무효 config 무시 */
  }
  return {};
}

/** 해석 우선순위: 환경변수 > mdv.config.json > 기본값 (plantuml.js 패턴). */
function getConfig() {
  const cfg = readConfig();
  const enabledRaw = process.env.MDV_UPDATE_ENABLED ?? cfg.updateEnabled;
  const enabled = !(enabledRaw === false || enabledRaw === 'false' || enabledRaw === '0');
  return {
    repo: process.env.MDV_UPDATE_REPO || cfg.updateRepo || DEFAULT_REPO,
    token: process.env.MDV_UPDATE_TOKEN || cfg.updateToken || null,
    intervalH: Number(process.env.MDV_UPDATE_INTERVAL_H || cfg.updateIntervalH || DEFAULT_INTERVAL_H),
    enabled,
  };
}

/**
 * semver 비교. "v" 접두 허용, pre-release 라벨은 무시(단순화).
 * a>b → 1, a<b → -1, 같으면 0.
 */
function compareSemver(a, b) {
  const parse = (s) =>
    String(s).replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** GET URL → JSON. curl(시스템 프록시·인증서) 우선, 없으면 Node https. 테스트는 transport 주입. */
function httpsGetJson(url, headers = {}) {
  return HAS_CURL ? httpsGetJsonCurl(url, headers) : httpsGetJsonNode(url, headers);
}

/** curl 로 JSON GET. --fail 미사용 → 상태코드를 -w 로 stdout 말미에 추가해 분리. */
function httpsGetJsonCurl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const SENTINEL = '\n__MDV_HTTP_STATUS__:';
    const { env, extraArgs } = curlEnvAndArgs();
    const args = [
      '-sSL', '--retry', '3', '--retry-connrefused', '--retry-delay', '2', '--max-time', '60',
      ...extraArgs,
      '-H', 'User-Agent: md-viewer',
      '-H', 'Accept: application/vnd.github+json',
    ];
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    args.push('-w', `${SENTINEL}%{http_code}`, url);
    let out = '', err = '';
    const child = spawn('curl', args, { windowsHide: true, env });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `curl exit ${code}`));
      const idx = out.lastIndexOf(SENTINEL);
      if (idx < 0) return reject(new Error('curl: status 센티넬 없음'));
      const status = parseInt(out.slice(idx + SENTINEL.length).trim(), 10);
      const body = out.slice(0, idx);
      if (status === 200) {
        try { return resolve(JSON.parse(body)); } catch (e) { return reject(e); }
      }
      const e = new Error(formatHttpError(status, body));
      e.statusCode = status;
      reject(e);
    });
  });
}

function httpsGetJsonNode(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'md-viewer', Accept: 'application/vnd.github+json', ...headers } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(httpsGetJsonNode(res.headers.location, headers));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            const err = new Error(formatHttpError(res.statusCode, body));
            err.statusCode = res.statusCode;
            return reject(err);
          }
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

/**
 * 최신 릴리스 확인 후 현재 버전과 비교.
 * @param {string} currentVersion 현재 앱 버전 (app.getVersion())
 * @param {(url:string, headers:object)=>Promise<object>} transport 테스트 주입용. 기본 httpsGetJson.
 * @returns {Promise<{available:boolean, current:string, latest?:string, notes?:string,
 *   asset?:{name:string,url:string,size:number}|null, disabled?:boolean, error?:string}>}
 */
async function checkForUpdate(currentVersion, transport = httpsGetJson) {
  const cfg = getConfig();
  if (!cfg.enabled) return { available: false, current: currentVersion, disabled: true };
  const url = `https://api.github.com/repos/${cfg.repo}/releases/latest`;
  const headers = cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {};
  try {
    const rel = await transport(url, headers);
    const latest = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
    if (!latest) return { available: false, current: currentVersion, error: '릴리스 태그 없음' };
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const a = assets.find((x) => ASSET_RE.test(x.name || ''));
    const asset = a ? { name: a.name, url: a.browser_download_url, size: a.size } : null;
    return {
      available: compareSemver(latest, currentVersion) > 0,
      current: currentVersion,
      latest,
      notes: rel.body || '',
      asset,
    };
  } catch (e) {
    // 릴리스가 아직 하나도 없으면 GitHub 는 404 → 오류가 아니라 '릴리스 없음(최신)' 으로 처리.
    if (e && e.statusCode === 404) {
      return { available: false, current: currentVersion, latest: null, noRelease: true };
    }
    let error = String((e && e.message) || e);
    // 사용자 친화 힌트 추가
    if (e && e.statusCode === 403 && /rate limit/i.test(error)) {
      error += '\n→ MDV_UPDATE_TOKEN 에 GitHub 토큰 설정 시 5000/hr 로 증가 (gh auth token 으로 얻을 수 있음)';
    } else if (/(ECONNRESET|connection was reset|curl.*\(35\)|TLS)/i.test(error)) {
      error += '\n→ 사내 프록시·MITM 환경이면 MDV_HTTPS_PROXY / MDV_CA_BUNDLE 설정을 확인하세요';
    }
    return { available: false, current: currentVersion, error };
  }
}

/**
 * 릴리스 에셋(zip) 을 파일로 다운로드. curl(시스템 프록시) 우선, 없으면 Node http/https.
 * GitHub 에셋 URL 은 objects.githubusercontent.com 으로 302 리다이렉트 → 따라감.
 * @param {string} url
 * @param {string} dest 저장 경로
 * @param {{token?:string, headers?:object, onProgress?:(received:number,total:number)=>void}} opts
 * @returns {Promise<{path:string, size:number}>}
 */
function downloadFile(url, dest, opts = {}) {
  return HAS_CURL ? downloadFileCurl(url, dest, opts) : downloadFileNode(url, dest, opts);
}

/** curl 로 다운로드. 진행률은 임시 파일 크기 폴링(curl 의 진행 출력 파싱은 fragile). */
function downloadFileCurl(url, dest, { token, headers = {}, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    fs.rmSync(dest, { force: true });
    const { env, extraArgs } = curlEnvAndArgs();
    const args = [
      '-fsSL', '--retry', '3', '--retry-connrefused', '--retry-delay', '2', '--max-time', '3600',
      ...extraArgs,
      '-o', dest,
      '-H', 'User-Agent: md-viewer',
    ];
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    if (token) args.push('-H', `Authorization: Bearer ${token}`); // curl 은 redirect 시 자동으로 Auth 떨어뜨림
    args.push(url);
    let err = '';
    const child = spawn('curl', args, { windowsHide: true, env });
    child.stderr.on('data', (d) => (err += d));
    let timer = null;
    if (onProgress) {
      timer = setInterval(() => {
        try { onProgress(fs.statSync(dest).size, 0); } catch { /* 파일 아직 없음 */ }
      }, 500);
    }
    child.on('error', (e) => { if (timer) clearInterval(timer); reject(e); });
    child.on('close', (code) => {
      if (timer) clearInterval(timer);
      if (code !== 0) return reject(new Error(err.trim() || `curl exit ${code}`));
      try {
        const sz = fs.statSync(dest).size;
        if (onProgress) onProgress(sz, sz);
        resolve({ path: dest, size: sz });
      } catch (e) { reject(e); }
    });
  });
}

function downloadFileNode(url, dest, opts = {}) {
  const { token, headers = {}, onProgress } = opts;
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http://') ? http : https;
    const reqHeaders = { 'User-Agent': 'md-viewer', Accept: 'application/octet-stream', ...headers };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    const req = mod.get(url, { headers: reqHeaders }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // 리다이렉트 시 Authorization 은 떨어뜨림(서명된 S3/CDN URL — 토큰 불필요·거부될 수 있음)
        return resolve(downloadFileNode(res.headers.location, dest, { headers, onProgress }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress(received, total);
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ path: dest, size: received })));
      out.on('error', (e) => reject(e));
      res.on('error', (e) => reject(e));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('download timeout')));
  });
}

module.exports = {
  checkForUpdate,
  compareSemver,
  getConfig,
  setBaseDir,
  httpsGetJson,
  downloadFile,
  ASSET_RE,
};
