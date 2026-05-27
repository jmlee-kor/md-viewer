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

/** 기본 transport: GitHub API GET → JSON. 테스트는 주입으로 대체(네트워크 없이 검증). */
function httpsGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'md-viewer', Accept: 'application/vnd.github+json', ...headers } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(httpsGetJson(res.headers.location, headers));
        }
        if (res.statusCode !== 200) {
          res.resume();
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
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
    return { available: false, current: currentVersion, error: String((e && e.message) || e) };
  }
}

/**
 * 릴리스 에셋(zip) 을 파일로 스트림 다운로드. http/https 모두 지원(테스트는 localhost http).
 * GitHub 에셋 URL 은 objects.githubusercontent.com 으로 302 리다이렉트 → 따라감.
 * @param {string} url
 * @param {string} dest 저장 경로
 * @param {{token?:string, headers?:object, onProgress?:(received:number,total:number)=>void}} opts
 * @returns {Promise<{path:string, size:number}>}
 */
function downloadFile(url, dest, opts = {}) {
  const { token, headers = {}, onProgress } = opts;
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http://') ? http : https;
    const reqHeaders = { 'User-Agent': 'md-viewer', Accept: 'application/octet-stream', ...headers };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    const req = mod.get(url, { headers: reqHeaders }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // 리다이렉트 시 Authorization 은 떨어뜨림(서명된 S3/CDN URL — 토큰 불필요·거부될 수 있음)
        return resolve(downloadFile(res.headers.location, dest, { headers, onProgress }));
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
