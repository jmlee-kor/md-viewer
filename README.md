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
- 전문(full-text) 검색 — 사이드바 검색 + 결과 패널(스니펫·하이라이트), 인덱스 본문 재사용
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

## 보안 모델

**전제: vault 콘텐츠를 완전히 신뢰하지는 않는다.** 악성으로 크래프트된
`.md`(또는 그 안의 다이어그램 소스)를 열어도 코드 실행/데이터 유출이
없어야 한다. 방어선은 다층(defense-in-depth)으로 구성된다.

- **렌더러 격리** — contextIsolation/sandbox on, nodeIntegration off,
  preload contextBridge 로만 제한된 API 노출. 렌더러에서 임의 코드가 돌아도
  Node/FS 에 직접 도달 불가.
- **네트워크 차단** — CSP `connect-src 'self'`. 외부로의 비콘/유출 불가.
- **인라인 핸들러 차단** — CSP `script-src` 에 `unsafe-inline` 없음 → SVG
  내 `onload=` 등 인라인 이벤트 핸들러가 실행되지 않음. (단 ELK 레이아웃을
  쓰는 D2 때문에 `unsafe-eval` 은 허용 — 위 격리/네트워크 차단으로 상쇄.)
- **노트 본문 살균** — markdown-it 출력은 DOMPurify 통과(`markdown.js`).
- **다이어그램 SVG 살균** (`diagrams/registry.js`) — 엔진별 신뢰 차등:
  - **신뢰(면제)**: `mermaid`(securityLevel:strict 로 자체 살균) — 추가
    살균 시 foreignObject htmlLabels 가 제거돼 라벨이 사라지므로 면제.
  - **신뢰않음(살균)**: `d2`(WASM)·`plantuml`(java jar) 산출 SVG 문자열은
    `el.innerHTML` 주입 전 DOMPurify 통과 → script/이벤트핸들러/`javascript:`
    링크 제거. 두 엔진은 `<text>` 기반이라 foreignObject 손실 없음(검증됨).
- **잔여 리스크**: `draw.io`(GraphViewer)는 mxgraph XML 을 DOM 에 직접 렌더해
  살균 경로를 거치지 않는다. 보기 전용 벤더 뷰어 + 위 CSP/격리로 완화하나,
  신뢰않는 drawio 다이어그램은 표면이 남는다(향후 산출 서브트리 후살균 검토).

## 테스트

```bash
npm run test:unit   # vault 스캔 + 링크 인덱스 (순수 node)
npm run smoke       # Electron 헤드리스 — 렌더/위키링크/다이어그램 4종/Marp 통합
```
