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

  // 백링크: Welcome 은 여러 노트에서 참조됨 (정확매칭 대신 포함검사 — vault 확장에 견고)
  const welcomeBack = (index.backlinks['Welcome.md'] || []).map((b) => b.from);
  for (const src of ['Diagrams.md', 'Projects/Roadmap.md', 'Slides.md']) {
    assert.ok(welcomeBack.includes(src), `Welcome 백링크에 ${src} 포함`);
  }

  // 같은 노트에서 같은 대상으로의 중복 링크는 1회로 dedup
  const fromCounts = {};
  welcomeBack.forEach((f) => (fromCounts[f] = (fromCounts[f] || 0) + 1));
  assert.ok(Object.values(fromCounts).every((c) => c === 1), '백링크 source dedup');

  // Diagrams 는 Welcome 에서 참조
  const diagBack = (index.backlinks['Diagrams.md'] || []).map((b) => b.from);
  assert.ok(diagBack.includes('Welcome.md'), 'Diagrams 백링크에 Welcome 포함');

  console.log('INDEX TEST PASS ✅ (resolve 키', Object.keys(index.resolve).length, ', 백링크 대상', Object.keys(index.backlinks).length, ')');
})().catch((e) => {
  console.error('INDEX TEST FAIL:', e.message);
  process.exit(1);
});
