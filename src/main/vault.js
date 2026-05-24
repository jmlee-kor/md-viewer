'use strict';

// vault 스캔 + 안전한 노트 읽기. main process 전용.

const fs = require('node:fs/promises');
const path = require('node:path');

// 스캔에서 제외할 디렉토리 (Obsidian 메타·VCS·의존성)
const IGNORE_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules']);

/**
 * 디렉토리를 재귀 스캔해 .md 트리를 만든다.
 * 노드: { name, type:'dir'|'file', relPath, children? }
 */
async function scanDir(absDir, root) {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const nodes = [];

  for (const e of entries) {
    if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
    const abs = path.join(absDir, e.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');

    if (e.isDirectory()) {
      const children = await scanDir(abs, root);
      if (children.length) nodes.push({ name: e.name, type: 'dir', relPath: rel, children });
    } else if (e.isFile() && /\.md$/i.test(e.name)) {
      nodes.push({ name: e.name, type: 'file', relPath: rel });
    }
  }

  // 디렉토리 먼저, 그 다음 파일. 각각 이름순.
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko');
  });
  return nodes;
}

async function scanVault(root) {
  return scanDir(root, root);
}

/**
 * vault 내부 경로만 읽기 허용 (path traversal 방어).
 */
async function readNote(root, relPath) {
  const normRoot = path.resolve(root);
  const abs = path.resolve(normRoot, relPath);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`vault 밖 접근 거부: ${relPath}`);
  }
  return fs.readFile(abs, 'utf8');
}

module.exports = { scanVault, readNote };
