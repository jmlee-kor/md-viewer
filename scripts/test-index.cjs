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

  // --- 전문 검색 ---
  assert.ok(index.contents && index.contents['Diagrams.md'], 'buildIndex 가 contents 수집');

  const sr = linkIndex.searchContent(index.contents, index.titles, '다이어그램');
  assert.ok(sr.length >= 1, '본문 검색 결과 있음');
  const diag = sr.find((r) => r.relPath === 'Diagrams.md');
  assert.ok(diag, 'Diagrams.md 가 "다이어그램" 검색 결과에 포함');
  assert.ok(diag.snippets.length >= 1, '스니펫 생성됨');
  assert.ok(
    diag.snippets.some((s) => s.parts.some((p) => p.hit && /다이어그램/.test(p.text))),
    '스니펫에 하이라이트(hit) parts 존재'
  );

  // 제목 매치 우선 랭킹: basename "Diagrams" 검색 → Diagrams.md 가 titleHit + 최상위
  const sr2 = linkIndex.searchContent(index.contents, index.titles, 'diagrams');
  assert.ok(sr2[0] && sr2[0].relPath === 'Diagrams.md' && sr2[0].titleHit, '제목 매치 우선 랭킹');

  // AND 매칭: 모든 term 이 있어야 (둘 다 포함하는 Diagrams.md 는 히트)
  const sr3 = linkIndex.searchContent(index.contents, index.titles, '다이어그램 mermaid');
  assert.ok(sr3.some((r) => r.relPath === 'Diagrams.md'), 'AND 매칭 — 두 term 모두 포함 노트');

  // 경계: 결과 없음 / 최소 길이 미만
  assert.equal(linkIndex.searchContent(index.contents, index.titles, '존재안함zzqqxx').length, 0, '미존재어 → 0');
  assert.equal(linkIndex.searchContent(index.contents, index.titles, 'a').length, 0, '1글자 → 0(미검색)');

  // --- 쇼케이스 노트(Features/렌더링.md) + 태그 인덱스 ---
  assert.ok(index.contents['Features/렌더링.md'], '렌더링 데모 노트 인덱싱됨');
  assert.ok((index.tagIndex['데모'] || []).includes('Features/렌더링.md'), '#데모 태그 → 렌더링 노트');
  assert.ok((index.tagIndex['렌더링'] || []).includes('Features/렌더링.md'), '#렌더링 태그 → 렌더링 노트');

  console.log('INDEX TEST PASS ✅ (resolve 키', Object.keys(index.resolve).length, ', 백링크 대상', Object.keys(index.backlinks).length, ', 검색 contents', Object.keys(index.contents).length, ')');
})().catch((e) => {
  console.error('INDEX TEST FAIL:', e.message);
  process.exit(1);
});
