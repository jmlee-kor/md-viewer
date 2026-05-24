// 외부 인터넷 PC에서 실행 → node_modules 의 라이브러리를 vendor/*.js (ESM) 로 번들.
// 폐쇄망은 이 vendor/ 산출물을 git pull 로만 받는다 (npm install 불필요).
//
//   npm run bundle:vendor
//
// 렌더러는 번들러 없이 <script type="module"> 에서 ../../vendor/<name>.js 를 import.

import esbuild from 'esbuild';
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

console.log('vendor 번들 완료');
