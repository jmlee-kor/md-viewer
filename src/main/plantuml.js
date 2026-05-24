'use strict';

// PlantUML 렌더 (main process). java -jar plantuml.jar -pipe 로 SVG 생성.
// 바이너리(JRE/plantuml.jar/Graphviz)는 npm 으로 못 받으므로 사용자가 반입한다.
// 위치 해석 우선순위: 환경변수 > mdv.config.json > tools/ 기본경로 > PATH.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.join(__dirname, '..', '..'); // src/main → 앱 루트
const IS_WIN = process.platform === 'win32';
const RENDER_TIMEOUT_MS = 20000;

function loadConfig() {
  try {
    const p = path.join(APP_ROOT, 'mdv.config.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    /* 잘못된 config 는 무시 */
  }
  return {};
}

function resolveJava(cfg) {
  if (process.env.MDV_JAVA) return process.env.MDV_JAVA;
  if (cfg.javaPath) return cfg.javaPath;
  const bundled = path.join(APP_ROOT, 'tools', 'jre', 'bin', IS_WIN ? 'java.exe' : 'java');
  if (fs.existsSync(bundled)) return bundled;
  return 'java'; // PATH 에서 탐색
}

function resolveJar(cfg) {
  if (process.env.MDV_PLANTUML_JAR) return process.env.MDV_PLANTUML_JAR;
  if (cfg.plantumlJar) return cfg.plantumlJar;
  return path.join(APP_ROOT, 'tools', 'plantuml.jar');
}

function resolveDot(cfg) {
  return process.env.MDV_GRAPHVIZ_DOT || cfg.graphvizDot || null;
}

/** @returns {Promise<{ok:true, svg:string} | {ok:false, error:string}>} */
function render(src) {
  const cfg = loadConfig();
  const jar = resolveJar(cfg);
  if (!fs.existsSync(jar)) {
    return Promise.resolve({
      ok: false,
      error: `plantuml.jar 없음: ${jar}\n→ tools/plantuml.jar 에 두거나 MDV_PLANTUML_JAR 환경변수로 경로 지정`,
    });
  }
  const java = resolveJava(cfg);
  const dot = resolveDot(cfg);

  const args = ['-Djava.awt.headless=true'];
  if (dot) args.push(`-DGRAPHVIZ_DOT=${dot}`);
  args.push('-jar', jar, '-tsvg', '-pipe', '-charset', 'UTF-8');

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(java, args, { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: `java 실행 실패: ${e.message}` });
      return;
    }

    let out = Buffer.alloc(0);
    let err = '';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: `PlantUML 렌더 시간초과 (${RENDER_TIMEOUT_MS}ms)` });
    }, RENDER_TIMEOUT_MS);

    child.stdout.on('data', (d) => (out = Buffer.concat([out, d])));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) =>
      finish({
        ok: false,
        error: `java 실행 실패: ${e.message}\n→ JRE 반입 후 PATH 또는 MDV_JAVA 환경변수 설정`,
      })
    );
    child.on('close', (code) => {
      const svg = out.toString('utf8');
      if (svg.includes('<svg')) finish({ ok: true, svg });
      else finish({ ok: false, error: err.trim() || `PlantUML 렌더 실패 (exit ${code})` });
    });

    child.stdin.on('error', () => {});
    child.stdin.write(src, 'utf8');
    child.stdin.end();
  });
}

module.exports = { render };
