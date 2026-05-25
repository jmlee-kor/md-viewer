'use strict';

// 인덱싱 성능 벤치 — 대용량 vault 의 매-저장 비용(loadVault 핵심부) 측정.
// 사용: node scripts/bench-index.cjs [vault경로=.large-vault]
// ① 전체 인덱싱(cold) ② 1개 파일만 바뀐 상황의 재인덱싱(현재=전체 / 증분=캐시)

const path = require('node:path');
const fs = require('node:fs/promises');
const vault = require('../src/main/vault.js');
const linkIndex = require('../src/main/link-index.js');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '.large-vault'));

async function timed(label, fn) {
  const t0 = process.hrtime.bigint();
  const r = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${label.padEnd(34)} ${ms.toFixed(1)} ms`);
  return { r, ms };
}

async function main() {
  const tree = await vault.scanVault(ROOT);
  const files = linkIndex.flatten(tree);
  console.log(`vault: ${files.length} 노트 @ ${ROOT}\n`);

  const readNote = (rel) => vault.readNote(ROOT, rel);
  const supportsCache = typeof linkIndex.makeStat === 'function';
  const statNote = supportsCache ? linkIndex.makeStat(ROOT) : null;

  // ① cold: 캐시 없이 전체 인덱싱 (현재 매 저장 비용)
  let cache = supportsCache ? new Map() : null;
  const cold = await timed('① cold (전체 read+parse)', () =>
    supportsCache
      ? linkIndex.buildIndex(files, readNote, { cache, stat: statNote })
      : linkIndex.buildIndex(files, readNote)
  );

  // ② 1개 파일 변경 — 앱 경로(fs.watch 가 변경 파일명을 줌): changed Set 으로 stat 도 생략
  if (supportsCache && files.length) {
    const relChanged = files[Math.floor(files.length / 2)].relPath;
    const target = path.resolve(ROOT, relChanged);
    const now = new Date();
    await fs.utimes(target, now, now);
    const warmChanged = await timed('② warm 증분 (changed Set, 앱)', () =>
      linkIndex.buildIndex(files, readNote, { cache, stat: statNote, changed: new Set([relChanged]) })
    );
    // ③ 변경 목록을 모를 때(수동 rescan) — mtime stat 폴백
    const warmStat = await timed('③ warm 증분 (mtime stat 폴백)', () =>
      linkIndex.buildIndex(files, readNote, { cache, stat: statNote })
    );
    console.log(
      `\n증분 speedup: changed-set ${(cold.ms / warmChanged.ms).toFixed(1)}× ` +
        `(${cold.ms.toFixed(0)}→${warmChanged.ms.toFixed(0)}ms), ` +
        `mtime-폴백 ${(cold.ms / warmStat.ms).toFixed(1)}× (${warmStat.ms.toFixed(0)}ms)`
    );
  } else {
    // 증분 미지원(현재): 재호출도 동일 비용임을 확인
    await timed('② 재인덱싱 (캐시 없음=동일)', () => linkIndex.buildIndex(files, readNote));
    console.log('\n(증분 미지원 — buildIndex 캐시 옵션 추가 후 speedup 측정)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
