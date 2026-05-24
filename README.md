# md-viewer

사내 폐쇄망(외부 인터넷 차단) 환경에서 동작하는 Obsidian형 Markdown 뷰어.

## 설계 원칙

- **런타임 외부 의존 0** — 모든 라이브러리는 `vendor/` 에 포함되어 `git pull` 로 따라온다.
- **빌드는 외부 인터넷 PC에서만** — 폐쇄망 PC는 `git pull` + Electron 실행만.
- **Electron 채택** — Windows 10 다수 + WebView2 미보장 환경이라 Chromium 자체 번들 필요 (Tauri 아님).
- **보안 기본값** — contextIsolation/sandbox on, nodeIntegration off, 네트워크 차단(connect-src 'self'), 렌더 HTML DOMPurify 새니타이즈.

## 기능

- vault 폴더 트리 탐색 + Markdown 렌더링 (markdown-it + DOMPurify)
- 위키링크 `[[노트]]` / `[[노트|별칭]]` / `[[노트#헤딩]]` (Obsidian 호환) + 백링크 패널
- 파일 변경 라이브 갱신 (`fs.watch`, 의존성 0)
- 다이어그램
  - **Mermaid** · **draw.io**(보기 전용) · **D2**(WASM) — 렌더러에서 직접
  - **PlantUML** — main process에서 `java -jar plantuml.jar` (JRE/Graphviz 반입 필요)
- **Marp 슬라이드 모드** — frontmatter `marp: true` 노트를 슬라이드 덱으로

## 개발 (인터넷 되는 PC)

```bash
npm install        # dev 의존성
npm run vendor     # vendor/ 생성 (다운로드 + 번들)
npm start          # 앱 실행
npm test           # 단위 + 스모크 테스트
```

## 폐쇄망 배포

요약: 외부 PC에서 `npm run vendor` → 커밋/푸시. 폐쇄망에서 `git pull` +
Electron prebuilt 반입 후 `run.cmd`. PlantUML 은 `tools/` 에 JRE/jar 반입.

상세 절차는 **[DISTRIBUTION.md](DISTRIBUTION.md)** 참조.

## 구조

```
src/main/         Electron main process
  main.js           윈도우 + 보안 + vault IPC + 파일감시
  vault.js          재귀 .md 스캔 + path-traversal 방어 읽기
  link-index.js     위키링크 해석 + 백링크 인덱스
  plantuml.js       java -jar plantuml.jar -pipe IPC
  preload.js        contextBridge 안전 API (window.mdv)
src/renderer/     UI (Lit)
  app.js            앱 셸 (툴바/사이드바/노트뷰/백링크)
  tree.js           폴더 트리
  markdown.js       markdown-it + 위키링크 룰 + 다이어그램 fence 디스패처
  marp.js / deck.js Marp 슬라이드
  diagrams/         mermaid · drawio · d2 · plantuml 렌더러 + registry
vendor/           오프라인 vendored 라이브러리 (git 커밋 대상)
scripts/          vendor 생성(fetch/bundle) + 테스트 + 스모크
tools/            PlantUML 반입 바이너리 위치 (README 만 커밋)
```

## 테스트

```bash
npm run test:unit   # vault 스캔 + 링크 인덱스 (순수 node)
npm run smoke       # Electron 헤드리스 — 렌더/위키링크/다이어그램 4종/Marp 통합
```
