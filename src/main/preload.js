'use strict';

// Preload: 렌더러에 노출할 "안전한 API" 만 contextBridge 로 전달한다.
// 렌더러는 Node 에 직접 접근할 수 없고, 오직 window.mdv 로만 main 과 통신한다.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdv', {
  version: '0.3.4',
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
  /** 번들 sample-vault 경로 (없으면 null) — 첫 실행 데모 자동 열기 */
  samplePath: () => ipcRenderer.invoke('vault:samplePath'),
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

  // --- 자동 업데이트 (Phase 1: 감지 + 알림) ---
  /** 수동 확인 → { available, current, latest, notes, asset } | { ..., error } | { disabled } */
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  /** 새 버전 감지 푸시 구독 → 위 결과 객체. 해제 함수 반환 */
  onUpdateAvailable: (cb) => {
    const listener = (_e, info) => cb(info);
    ipcRenderer.on('update:available', listener);
    return () => ipcRenderer.removeListener('update:available', listener);
  },
  /** 원클릭 적용: 다운로드+추출+스왑 헬퍼 spawn 후 앱 종료 → { ok, phase } | { ok:false, error } */
  applyUpdate: (info) => ipcRenderer.invoke('update:apply', info),
  /** 적용 진행률 구독 → { phase:'download'|'extract'|'swap'|'error', received?, total?, error? }. 해제 함수 반환 */
  onUpdateProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },

  // --- 발표 이중 창 (발표자 메인 창 ↔ 청중 창) — 메인 프로세스 IPC 릴레이 ---
  /** 발표 시작: 청중 창 생성 + marp src 전달 */
  startPresent: (src) => ipcRenderer.invoke('present:open', src),
  /** 발표자 네비/블랭크 변경 → 청중 창 동기화 { index, blank } */
  updatePresent: (state) => ipcRenderer.send('present:state', state),
  /** 발표 종료(양쪽 정리) */
  endPresent: () => ipcRenderer.send('present:close'),
  /** (청중) 렌더러 준비됨 → 메인이 src+현재 state 푸시 */
  presentReady: () => ipcRenderer.send('present:ready'),
  /** (청중) marp src 수신. 해제 함수 반환 */
  onPresentSrc: (cb) => {
    const l = (_e, src) => cb(src);
    ipcRenderer.on('present:src', l);
    return () => ipcRenderer.removeListener('present:src', l);
  },
  /** (청중) state {index, blank} 수신. 해제 함수 반환 */
  onPresentState: (cb) => {
    const l = (_e, s) => cb(s);
    ipcRenderer.on('present:state', l);
    return () => ipcRenderer.removeListener('present:state', l);
  },
  /** (발표자) 청중 창이 닫혀 발표가 끝남 → 단일 창 복귀. 해제 함수 반환 */
  onPresentEnded: (cb) => {
    const l = () => cb();
    ipcRenderer.on('present:ended', l);
    return () => ipcRenderer.removeListener('present:ended', l);
  },
  /** (청중) 네비 의도 전달 → 메인 → 발표자(소스 오브 트루스)가 실행 후 양쪽 동기. action: next|prev|first|last|black|white */
  navPresent: (action) => ipcRenderer.send('present:nav', action),
  /** (발표자) 청중 창에서 온 네비 의도 수신. 해제 함수 반환 */
  onPresentNav: (cb) => {
    const l = (_e, action) => cb(action);
    ipcRenderer.on('present:nav', l);
    return () => ipcRenderer.removeListener('present:nav', l);
  },
});
