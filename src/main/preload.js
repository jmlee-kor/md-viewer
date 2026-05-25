'use strict';

// Preload: 렌더러에 노출할 "안전한 API" 만 contextBridge 로 전달한다.
// 렌더러는 Node 에 직접 접근할 수 없고, 오직 window.mdv 로만 main 과 통신한다.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdv', {
  version: '0.1.0',
  /** vault 폴더 선택 → { root, tree } | null */
  openVault: () => ipcRenderer.invoke('vault:open'),
  /** 현재 vault 재스캔 → { root, tree } | null */
  rescan: () => ipcRenderer.invoke('vault:rescan'),
  /** 경로로 vault 열기 (최근 목록 재오픈) → { root, tree, index } */
  openVaultPath: (root) => ipcRenderer.invoke('vault:openPath', root),
  /** vault 내부 노트 읽기 → 원문 문자열 */
  readNote: (relPath) => ipcRenderer.invoke('note:read', relPath),
  /** 전문 검색 → [{relPath, title, count, titleHit, snippets}] (랭킹순) */
  searchVault: (query) => ipcRenderer.invoke('vault:search', query),
  /** PlantUML 원문 → { ok, svg } | { ok:false, error } */
  renderPlantUML: (src) => ipcRenderer.invoke('plantuml:render', src),
  /** PlantUML 도구(java/jar/graphviz) 해석 상태 → { baseDir, java, jar, dot } */
  plantumlStatus: () => ipcRenderer.invoke('plantuml:status'),
  /** Marp export: format(pdf|html) + {html, css, title} → { ok, path } | { canceled } */
  exportMarp: (payload) => ipcRenderer.invoke('marp:export', payload),
  /** 다이어그램 export: { format(png|svg), data(Uint8Array|string), name } → { ok, path } | { canceled } */
  exportDiagram: (payload) => ipcRenderer.invoke('diagram:export', payload),
  /** 창/보기 액션 (reload, devtools, zoom in·out·reset, fullscreen, maximize, minimize, close, quit) */
  appAction: (name) => ipcRenderer.invoke('app:action', name),
  /** 최대화 상태 변경 구독 → boolean. 해제 함수 반환 */
  onMaximizeChange: (cb) => {
    const listener = (_e, isMax) => cb(isMax);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
  /** vault 파일 변경 구독 → { root, tree, index }. 해제 함수 반환 */
  onVaultChanged: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('vault:changed', listener);
    return () => ipcRenderer.removeListener('vault:changed', listener);
  },
  // 후속: renderPlantUML(src) 등 추가 예정
});
