# md-viewer

사내 폐쇄망(외부 인터넷 차단) 환경에서 동작하는 Obsidian형 Markdown 뷰어.

## 설계 원칙

- **런타임 외부 의존 0** — 모든 라이브러리는 `vendor/` 에 포함되어 `git pull` 로 따라온다.
- **빌드는 외부 인터넷 PC에서만** — 폐쇄망 PC는 `git pull` + Electron 실행만.
- **Electron 채택** — Windows 10 다수 + WebView2 미보장 환경이라 Chromium 자체 번들 필요 (Tauri 아님).

## 기능 (계획)

- vault 폴더 트리 탐색 + Markdown 렌더링
- 위키링크 `[[ ]]` (Obsidian 호환) + 백링크 패널
- 다이어그램: Mermaid · draw.io(보기) · D2(WASM) · PlantUML(JRE+Graphviz) · Marp 슬라이드

## 개발 (인터넷 되는 PC)

```bash
npm install      # electron 등 dev 의존성
npm start        # 앱 실행
```

## 폐쇄망 배포

1. 외부 PC: `npm run bundle:vendor` 로 `vendor/*.js` 생성 → git 커밋/푸시
2. 외부 PC: Electron prebuilt zip (`electron-vX-win32-x64.zip`) 수동 확보
3. 폐쇄망: `git pull` + prebuilt zip 반입 → `electron.exe <앱폴더>` 실행

## 구조

```
src/main/      Electron main process (윈도우, vault 스캔, PlantUML IPC)
src/main/preload.js   contextBridge 안전 API (window.mdv)
src/renderer/  UI (Lit 컴포넌트, markdown 렌더링)
vendor/        오프라인 vendored 라이브러리 (커밋 대상)
scripts/       vendor 번들 생성 스크립트
```
