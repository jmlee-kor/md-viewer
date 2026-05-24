'use strict';

// 위키링크 인덱스: 제목→경로 해석 맵 + 역방향(백링크) 맵.
// Obsidian 호환 해석: [[노트]], [[노트|별칭]], [[노트#헤딩]], [[폴더/노트]], ![[임베드]].

const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;

/** raw target 정규화 키: 소문자, .md 제거, 슬래시 통일, ./ 제거 */
function normKey(raw) {
  return String(raw)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
}

/** "노트#헤딩|별칭" → { target, heading, alias } */
function parseWikiTarget(inner) {
  let s = inner;
  let alias = null;
  let heading = null;
  const pipe = s.indexOf('|');
  if (pipe >= 0) {
    alias = s.slice(pipe + 1).trim();
    s = s.slice(0, pipe);
  }
  const hash = s.indexOf('#');
  if (hash >= 0) {
    heading = s.slice(hash + 1).trim();
    s = s.slice(0, hash);
  }
  return { target: s.trim(), heading, alias };
}

/** 트리에서 파일 노드만 평탄화 */
function flatten(tree, out = []) {
  for (const n of tree) {
    if (n.type === 'file') out.push({ relPath: n.relPath, name: n.name });
    else if (n.children) flatten(n.children, out);
  }
  return out;
}

/** resolve 맵: relPath(확장자 제거) + basename 둘 다 키로 등록 (먼저 등록된 것 우선) */
function buildResolveMap(files) {
  const resolve = {};
  for (const f of files) {
    const relNoExt = f.relPath.replace(/\.md$/i, '').toLowerCase();
    const base = relNoExt.split('/').pop();
    if (!(relNoExt in resolve)) resolve[relNoExt] = f.relPath;
    if (!(base in resolve)) resolve[base] = f.relPath;
  }
  return resolve;
}

/** target 을 relPath 로 해석 (없으면 null). 경로 우선, 실패 시 basename 폴백 */
function resolveTarget(resolve, rawTarget) {
  const key = normKey(rawTarget);
  if (resolve[key]) return resolve[key];
  const base = key.split('/').pop();
  return resolve[base] || null;
}

/**
 * 전체 vault 인덱스 구축.
 * @param files [{relPath, name}]
 * @param readNote (relPath) => Promise<string>
 * @returns { resolve, backlinks, titles }
 */
async function buildIndex(files, readNote) {
  const resolve = buildResolveMap(files);
  const backlinks = {}; // destRelPath -> [{from, alias}]
  const titles = {};
  const contents = {}; // relPath -> 원문 (전문 검색용. 렌더러로는 전송 안 함 — main 보관)

  for (const f of files) {
    titles[f.relPath] = f.relPath.replace(/\.md$/i, '').split('/').pop();
  }

  for (const f of files) {
    let src;
    try {
      src = await readNote(f.relPath);
    } catch {
      continue;
    }
    contents[f.relPath] = src; // 검색 인덱스로 재사용 (읽기 패스 1회 공유)
    WIKILINK_RE.lastIndex = 0;
    const seen = new Set();
    let m;
    while ((m = WIKILINK_RE.exec(src))) {
      const { target, alias } = parseWikiTarget(m[2]);
      if (!target) continue;
      const dest = resolveTarget(resolve, target);
      if (!dest || dest === f.relPath) continue; // 자기참조 제외
      const dedup = dest + '\n' + f.relPath;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      (backlinks[dest] ||= []).push({ from: f.relPath, alias: alias || null });
    }
  }

  return { resolve, backlinks, titles, contents };
}

/** 위키 임베드(![[...]]) 해석용 맵: 전체 파일(이미지 포함) basename·relPath(소문자)→relPath.
 *  .md 만 담는 resolve 맵과 별개 — 이미지는 확장자가 살아있어야 한다. */
function buildEmbedResolve(allFiles) {
  const map = {};
  for (const rel of allFiles || []) {
    const low = rel.toLowerCase();
    const base = low.split('/').pop();
    if (!(low in map)) map[low] = rel;
    if (!(base in map)) map[base] = rel;
  }
  return map;
}

// --- 전문(full-text) 검색 ---
// buildIndex 가 모은 contents 를 재사용해 main process 에서 in-memory 검색한다.
// 멀티-term AND 매칭(공백 분리), 본문/제목 어디든 모든 term 포함 시 히트.
// 결과는 highlight 용 parts 배열을 담은 스니펫을 포함 — 렌더러는 텍스트로만 그려(살균 불필요).

const SNIPPET_CTX = 50; // 매치 주변 문맥 글자수 (긴 라인 트림)
const SNIPPET_MAX_LEN = 200;

/** 라인을 매치 구간 기준으로 {text, hit} 파트 배열로 분해 (하이라이트용). */
function highlightParts(line, terms) {
  const lower = line.toLowerCase();
  const ranges = [];
  for (const t of terms) {
    let i = 0;
    while ((i = lower.indexOf(t, i)) !== -1) {
      ranges.push([i, i + t.length]);
      i += t.length;
    }
  }
  if (!ranges.length) return [{ text: line, hit: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const parts = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) parts.push({ text: line.slice(pos, s), hit: false });
    parts.push({ text: line.slice(s, e), hit: true });
    pos = e;
  }
  if (pos < line.length) parts.push({ text: line.slice(pos), hit: false });
  return parts;
}

/** 긴 라인을 첫 매치 주변 창으로 트림 (앞뒤 … 표시). */
function trimAroundMatch(line, terms) {
  if (line.length <= SNIPPET_MAX_LEN) return line;
  const lower = line.toLowerCase();
  let first = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }
  if (first === -1) return line.slice(0, SNIPPET_MAX_LEN) + '…';
  const start = Math.max(0, first - SNIPPET_CTX);
  const end = Math.min(line.length, first + SNIPPET_MAX_LEN - SNIPPET_CTX);
  return (start > 0 ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : '');
}

/** term 이 등장하는 라인들을 스니펫으로 (최대 max개). */
function buildSnippets(text, terms, max) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let ln = 0; ln < lines.length && out.length < max; ln++) {
    const line = lines[ln].trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (terms.some((t) => lower.includes(t))) {
      out.push({ line: ln + 1, parts: highlightParts(trimAroundMatch(line, terms), terms) });
    }
  }
  return out;
}

/**
 * 전문 검색. @param contents relPath->원문, titles relPath->제목.
 * @returns [{ relPath, title, count, titleHit, snippets:[{line, parts:[{text,hit}]}] }] (랭킹순)
 */
function searchContent(contents, titles, query, opts = {}) {
  const maxResults = opts.maxResults || 50;
  const maxSnippets = opts.maxSnippets || 5;
  const q = String(query || '').trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.length || q.length < 2) return [];

  const results = [];
  for (const relPath of Object.keys(contents || {})) {
    const text = contents[relPath] || '';
    const lower = text.toLowerCase();
    const title = (titles && titles[relPath]) || relPath;
    const titleLower = title.toLowerCase();
    // AND: 모든 term 이 본문 또는 제목 어디든 있어야 히트
    if (!terms.every((t) => lower.includes(t) || titleLower.includes(t))) continue;

    let count = 0;
    for (const t of terms) {
      let i = 0;
      while ((i = lower.indexOf(t, i)) !== -1) {
        count++;
        i += t.length;
      }
    }
    const titleHit = terms.some((t) => titleLower.includes(t));
    results.push({ relPath, title, count, titleHit, snippets: buildSnippets(text, terms, maxSnippets) });
  }

  results.sort(
    (a, b) =>
      (b.titleHit - a.titleHit) || (b.count - a.count) || a.relPath.localeCompare(b.relPath)
  );
  return results.slice(0, maxResults);
}

module.exports = {
  flatten,
  buildIndex,
  resolveTarget,
  parseWikiTarget,
  normKey,
  searchContent,
  buildEmbedResolve,
  WIKILINK_RE,
};
