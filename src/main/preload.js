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
  /** vault 내부 노트 읽기 → 원문 문자열 */
  readNote: (relPath) => ipcRenderer.invoke('note:read', relPath),
  /** PlantUML 원문 → { ok, svg } | { ok:false, error } */
  renderPlantUML: (src) => ipcRenderer.invoke('plantuml:render', src),
  /** 창/보기 액션 (reload/devtools/zoomIn/zoomOut/zoomReset/fullscreen/minimize/close/quit) */
  appAction: (name) => ipcRenderer.invoke('app:action', name),
  /** vault 파일 변경 구독 → { root, tree, index }. 해제 함수 반환 */
  onVaultChanged: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('vault:changed', listener);
    return () => ipcRenderer.removeListener('vault:changed', listener);
  },
  // 후속: renderPlantUML(src) 등 추가 예정
});
