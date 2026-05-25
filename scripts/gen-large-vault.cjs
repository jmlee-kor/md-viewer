'use strict';

// 대용량 vault 성능 측정용 합성 vault 생성기 (gitignore 대상).
// 사용: node scripts/gen-large-vault.cjs [파일수=3000] [출력경로]
// 폴더 트리(깊이 분산) + 위키링크/태그/헤딩이 섞인 노트를 생성한다.

const fs = require('node:fs');
const path = require('node:path');

const COUNT = parseInt(process.argv[2] || '3000', 10);
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', '.large-vault'));
const FOLDERS = 40; // 1차 폴더 수 (각 폴더 안에 하위 폴더도 일부)
const TAGS = ['프로젝트', '회의', '아이디어', 'todo', '레퍼런스', '일지', '버그', '설계'];

function noteBody(i, total) {
  const tag = TAGS[i % TAGS.length];
  const link1 = `note-${(i + 1) % total}`;
  const link2 = `note-${(i + 7) % total}`;
  return [
    `# 노트 ${i}`,
    '',
    `#${tag} #idx-${i % 100}`,
    '',
    `## 개요`,
    `이것은 ${i}번째 합성 노트입니다. 검색/인덱싱 성능 측정용 더미 본문.`,
    `관련 노트: [[${link1}]] 그리고 [[${link2}|별칭 ${i}]].`,
    '',
    '## 상세',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(8),
    '',
    '## 체크리스트',
    '- [ ] 항목 A',
    '- [x] 항목 B',
    '- [/] 항목 C',
    '',
    '```js',
    `const x = ${i}; // 코드 블록 (태그 추출 제외 대상)`,
    '```',
    '',
    `자세한 내용은 [[note-${(i + 13) % total}#상세]] 참고.`,
  ].join('\n');
}

function main() {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (let f = 0; f < FOLDERS; f++) {
    const sub = f % 4 === 0 ? path.join(`folder-${f}`, `sub-${f}`) : `folder-${f}`;
    fs.mkdirSync(path.join(OUT, sub), { recursive: true });
  }
  for (let i = 0; i < COUNT; i++) {
    const f = i % FOLDERS;
    const sub = f % 4 === 0 ? path.join(`folder-${f}`, `sub-${f}`) : `folder-${f}`;
    fs.writeFileSync(path.join(OUT, sub, `note-${i}.md`), noteBody(i, COUNT));
  }
  console.log(`생성: ${COUNT} 노트 → ${OUT} (${Date.now() - t0}ms)`);
}

main();
