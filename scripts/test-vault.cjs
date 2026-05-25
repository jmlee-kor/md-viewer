'use strict';

// vault.js 단위 테스트 (Electron 불필요, 순수 node). 스캔 + 경로 안전성 검증.

const assert = require('node:assert');
const path = require('node:path');
const vault = require('../src/main/vault');

const ROOT = path.join(__dirname, '..', 'sample-vault');

(async () => {
  const tree = await vault.scanVault(ROOT);

  // 최상위에 Diagrams.md, Welcome.md (파일) + Projects (디렉토리) 존재
  const names = tree.map((n) => n.name);
  assert.ok(names.includes('Welcome.md'), 'Welcome.md 스캔됨');
  assert.ok(names.includes('Diagrams.md'), 'Diagrams.md 스캔됨');
  assert.ok(names.includes('Projects'), 'Projects 디렉토리 스캔됨');

  // 디렉토리가 파일보다 먼저 정렬
  assert.equal(tree[0].type, 'dir', '디렉토리 우선 정렬');

  // 중첩 노트 relPath 가 슬래시 구분
  const projects = tree.find((n) => n.name === 'Projects');
  assert.equal(projects.children[0].relPath, 'Projects/Roadmap.md', '중첩 relPath');

  // 노트 읽기
  const content = await vault.readNote(ROOT, 'Welcome.md');
  assert.ok(content.includes('md-viewer 데모 vault'), 'Welcome 본문 읽힘');

  // path traversal 차단
  await assert.rejects(
    () => vault.readNote(ROOT, '../../package.json'),
    /접근 거부/,
    'vault 밖 접근 거부'
  );

  console.log('VAULT TEST PASS ✅ (노드:', tree.length, '최상위 항목)');
})().catch((e) => {
  console.error('VAULT TEST FAIL:', e.message);
  process.exit(1);
});
