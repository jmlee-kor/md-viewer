// 외부 인터넷 PC에서 실행 → node_modules 의 라이브러리를 vendor/*.js (ESM) 로 번들.
// 폐쇄망은 이 vendor/ 산출물을 git pull 로만 받는다 (npm install 불필요).
//
//   npm run bundle:vendor
//
// 렌더러는 번들러 없이 <script type="module"> 에서 ../../vendor/<name>.js 를 import.

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'vendor');

// 각 항목: vendor 출력 파일 + 거기서 re-export 할 모듈.
// 라이브러리가 추가되면(mermaid, d2 등) 여기에 한 줄씩 늘린다.
const targets = [
  {
    out: 'lit.js',
    contents: `
      export * from 'lit';
      export * from 'lit/decorators.js';
      export { unsafeHTML } from 'lit/directives/unsafe-html.js';
      export { repeat } from 'lit/directives/repeat.js';
    `,
  },
  { out: 'markdown-it.js', contents: `export { default } from 'markdown-it';` },
  { out: 'dompurify.js', contents: `export { default } from 'dompurify';` },
  { out: 'mermaid.js', contents: `export { default } from 'mermaid';` },
  // D2: browser 빌드는 wasm+worker 모두 인라인(자체 포함, fetch 없음).
  { out: 'd2.js', contents: `export { D2 } from '@terrastruct/d2';` },
  { out: 'marp.js', contents: `export { Marp } from '@marp-team/marp-core';` },
  // highlight.js: common 서브셋(~40개 언어). 코드블록 syntax highlight.
  { out: 'highlight.js', contents: `export { default } from 'highlight.js/lib/common';` },
  // KaTeX: 수식 렌더(renderToString). CSS·폰트는 아래 copyAssets 로 별도 복사.
  { out: 'katex.js', contents: `export { default } from 'katex';` },
];

for (const t of targets) {
  await esbuild.build({
    stdin: { contents: t.contents, resolveDir: root, loader: 'js' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    legalComments: 'none',
    outfile: path.join(outdir, t.out),
  });
  console.log('bundled →', path.relative(root, path.join(outdir, t.out)));
}

// KaTeX CSS + woff2 폰트 복사 (오프라인). CSS 의 url(fonts/..) 상대경로 보존 위해
// vendor/katex/katex.min.css + vendor/katex/fonts/*.woff2 구조 유지.
function copyKatexAssets() {
  const src = path.join(root, 'node_modules', 'katex', 'dist');
  const dst = path.join(outdir, 'katex');
  fs.mkdirSync(path.join(dst, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(src, 'katex.min.css'), path.join(dst, 'katex.min.css'));
  let n = 0;
  for (const f of fs.readdirSync(path.join(src, 'fonts'))) {
    if (f.endsWith('.woff2')) {
      fs.copyFileSync(path.join(src, 'fonts', f), path.join(dst, 'fonts', f));
      n++;
    }
  }
  console.log(`copied → vendor/katex (css + ${n} woff2)`);
}
copyKatexAssets();

console.log('vendor 번들 완료');
