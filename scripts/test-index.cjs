'use strict';

// link-index.js 단위 테스트 (순수 node). 위키링크 해석 + 백링크 검증.

const assert = require('node:assert');
const path = require('node:path');
const vault = require('../src/main/vault');
const linkIndex = require('../src/main/link-index');

const ROOT = path.join(__dirname, '..', 'sample-vault');

(async () => {
  const tree = await vault.scanVault(ROOT);
  const files = linkIndex.flatten(tree);
  const index = await linkIndex.buildIndex(files, (rel) => vault.readNote(ROOT, rel));

  // 해석: basename / 경로 / 미해결
  assert.equal(linkIndex.resolveTarget(index.resolve, 'Diagrams'), 'Diagrams.md', 'basename 해석');
  assert.equal(
    linkIndex.resolveTarget(index.resolve, 'Projects/Roadmap'),
    'Projects/Roadmap.md',
    '경로 해석'
  );
  assert.equal(linkIndex.resolveTarget(index.resolve, 'Diagrams|별칭'.split('|')[0]), 'Diagrams.md', '별칭 분리 후 해석');
  assert.equal(linkIndex.resolveTarget(index.resolve, '없는노트'), null, '미해결 → null');

  // 백링크: Welcome 은 Diagrams · Roadmap · Slides 에서 참조됨
  const welcomeBack = (index.backlinks['Welcome.md'] || []).map((b) => b.from).sort();
  assert.deepEqual(
    welcomeBack,
    ['Diagrams.md', 'Projects/Roadmap.md', 'Slides.md'],
    'Welcome 백링크 = Diagrams + Roadmap + Slides'
  );

  // Diagrams 는 Welcome 에서 참조 (중복 링크는 1회로 dedup)
  const diagBack = (index.backlinks['Diagrams.md'] || []).map((b) => b.from);
  assert.deepEqual(diagBack, ['Welcome.md'], 'Diagrams 백링크 = Welcome (dedup)');

  console.log('INDEX TEST PASS ✅ (resolve 키', Object.keys(index.resolve).length, ', 백링크 대상', Object.keys(index.backlinks).length, ')');
})().catch((e) => {
  console.error('INDEX TEST FAIL:', e.message);
  process.exit(1);
});
