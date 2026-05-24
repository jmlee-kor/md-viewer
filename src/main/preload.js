'use strict';

// Preload: 렌더러에 노출할 "안전한 API" 만 contextBridge 로 전달한다.
// 렌더러는 Node 에 직접 접근할 수 없고, 오직 window.mdv 로만 main 과 통신한다.
// (vault 열기 / 파일 읽기 / PlantUML 렌더 등은 후속 단계에서 여기에 추가)

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('mdv', {
  // 스켈레톤 단계 placeholder — 동작 확인용
  version: '0.1.0',
  // 후속 단계에서 추가될 API 예시(주석):
  //   openVault: () => ipcRenderer.invoke('vault:open'),
  //   readNote: (relPath) => ipcRenderer.invoke('note:read', relPath),
  //   renderPlantUML: (src) => ipcRenderer.invoke('plantuml:render', src),
});
