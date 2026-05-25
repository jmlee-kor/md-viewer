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

  // --- 증분 인덱싱 정확성: 캐시+changed 재빌드 == 변경 후 전체 재빌드 ---
  const fs = require('node:fs');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-inc-'));
  try {
    fs.writeFileSync(path.join(tmp, 'a.md'), '# A\n#alpha\n[[b]] 링크');
    fs.writeFileSync(path.join(tmp, 'b.md'), '# B\n#beta\n[[c]]');
    fs.writeFileSync(path.join(tmp, 'c.md'), '# C\n#gamma');
    const read = (rel) => vault.readNote(tmp, rel);
    const stat = linkIndex.makeStat(tmp);
    const fileList = linkIndex.flatten(await vault.scanVault(tmp));

    const cache = new Map();
    await linkIndex.buildIndex(fileList, read, { cache, stat }); // cold(캐시 채움)
    assert.equal(cache.size, 3, '증분 캐시 3개 채움');

    // a.md 변경: 태그/링크 교체 (#alpha→#delta, [[b]]→[[c]])
    await new Promise((r) => setTimeout(r, 10));
    fs.writeFileSync(path.join(tmp, 'a.md'), '# A\n#delta\n[[c]] 변경됨');

    const inc = await linkIndex.buildIndex(fileList, read, {
      cache, stat, changed: new Set(['a.md']),
    });
    // 변경 후 상태를 캐시 없이 새로 전체 빌드
    const full = await linkIndex.buildIndex(fileList, read);

    assert.deepEqual(inc.backlinks, full.backlinks, '증분 backlinks == 전체 backlinks');
    assert.deepEqual(inc.tagIndex, full.tagIndex, '증분 tagIndex == 전체 tagIndex');
    assert.deepEqual(inc.contents, full.contents, '증분 contents == 전체 contents');
    // 검증: 변경 반영 — #delta 등장, #alpha 소멸, c 백링크에 a 추가
    assert.ok(inc.tagIndex['delta'] && !inc.tagIndex['alpha'], '태그 변경 반영(delta 추가/alpha 제거)');
    assert.ok((inc.backlinks['c.md'] || []).some((x) => x.from === 'a.md'), 'a→c 링크 반영');

    // 파일 삭제 시 캐시 정리
    fs.rmSync(path.join(tmp, 'c.md'));
    const fileList2 = linkIndex.flatten(await vault.scanVault(tmp));
    await linkIndex.buildIndex(fileList2, read, { cache, stat, changed: new Set(['c.md']) });
    assert.ok(!cache.has('c.md'), '삭제 파일 캐시 정리됨');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('INDEX TEST PASS ✅ (resolve 키', Object.keys(index.resolve).length, ', 백링크 대상', Object.keys(index.backlinks).length, ', 검색 contents', Object.keys(index.contents).length, ', 증분 정확성 ✅)');
})().catch((e) => {
  console.error('INDEX TEST FAIL:', e.message);
  process.exit(1);
});
