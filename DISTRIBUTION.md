# 배포 가이드 (오프라인 / 폐쇄망)

두 종류의 PC 역할로 나뉩니다.

- **메인테이너 PC** (외부 인터넷 O): 의존성 설치·vendor 번들 생성·커밋/푸시
- **폐쇄망 PC** (외부 인터넷 X): `git pull` + Electron 실행만

핵심 원칙: **런타임 외부 의존 0.** 모든 JS 라이브러리는 `vendor/` 에 커밋되어
`git pull` 로 따라옵니다. 폐쇄망에서 추가로 필요한 것은 **Electron 실행파일**과
(PlantUML 쓸 경우) **Java/Graphviz** 뿐입니다.

---

## A. 메인테이너 PC (외부 인터넷)

```bash
npm install            # dev 의존성 (electron, 번들 도구, 라이브러리)
npm run vendor         # vendor/ 생성: 다운로드(vendor:fetch) + 번들(bundle:vendor)
npm test               # 단위 + 스모크 (선택)
git add -A && git commit -m "vendor 갱신" && git push
```

`npm run vendor` 가 만드는 것:
- `vendor/lit.js · markdown-it.js · dompurify.js · mermaid.js · d2.js · marp.js` (esbuild 번들)
- `vendor/drawio-viewer.min.js` (draw.io 공식 viewer 다운로드)
- `vendor/fonts/NanumGothicCoding-Regular.ttf` (+ `OFL.txt`) — 코드/원본 보기 CJK 정렬 폰트

이 파일들은 **git 에 커밋**됩니다(약 19MB). 폐쇄망은 이걸 pull 로만 받습니다.

### Electron prebuilt 확보

`package.json` 의 electron 버전과 **동일한** prebuilt zip 을 받습니다:

```
electron-v<버전>-win32-x64.zip   (예: GitHub electron/electron releases)
```

이 zip 을 폐쇄망으로 반입합니다 (아래 B-2).

---

## B. 폐쇄망 PC (외부 인터넷 차단)

### 1. 소스 받기

```bash
git clone <사내 repo>/md-viewer.git
# 또는 이미 있으면: git pull
```
`vendor/` 가 함께 받아지므로 `npm install` **불필요**.

### 2. Electron 실행파일 배치

반입한 `electron-v...-win32-x64.zip` 을 `md-viewer\electron\` 에 풉니다
(→ `md-viewer\electron\electron.exe`). 그 후:

```bat
run.cmd
```

`run.cmd` 가 `.\electron\electron.exe` 로 앱을 실행합니다. 다른 위치에 두려면
환경변수로 지정: `set ELECTRON_EXE=C:\path\electron.exe & run.cmd`

### 3. (선택) PlantUML 활성화

PlantUML 다이어그램을 쓰려면 `tools/` 에 JRE + plantuml.jar (+ 필요 시
Graphviz) 를 반입합니다. 자세히는 [`tools/README.md`](tools/README.md).
미반입 시 PlantUML 블록만 안내 메시지로 표시되고 앱은 정상 동작합니다.

---

## 커밋 대상 / 비대상

| 항목 | git 커밋 | 비고 |
|------|:---:|------|
| `src/`, `scripts/`, `vendor/` | ✅ | 앱 + 라이브러리 |
| `node_modules/` | ❌ | 메인테이너 dev 전용 |
| `electron/` (prebuilt) | ❌ | 폐쇄망에 수동 반입 |
| `tools/` 바이너리 | ❌ | JRE/jar/Graphviz 수동 반입 (README 만 커밋) |

---

## (선택) 실행파일 패키징 + 어디서든 실행

`git pull + electron.exe` 대신 독립 실행파일로 만들려면 `electron-builder` 로
포장합니다. vendor/ 와 src/ 가 app.asar 에 포함됩니다.

```bash
npm install            # 의존성 (인터넷 필요)
npm run install:local  # 빌드 + %LOCALAPPDATA%\Programs\md-viewer 설치 + PATH 등록
```

`install:local` 이 **빌드 → 설치 → 사용자 PATH 등록** 을 한 번에 처리합니다
(PATH 는 중복 방지, 최초 1회만 실제 추가). **새 터미널**부터 어디서든
`md-viewer` 로 실행됩니다. 재빌드 시에도 `install:local` 만 다시 돌리면 됩니다
(PATH 는 이미 등록되어 있어 그대로).

### 패키징 모드의 PlantUML (자동반입)

`npm run dist` 는 빌드 전 `tools:fetch` 로 **JRE + plantuml.jar + Graphviz 를
자동 다운로드**해 패키지에 번들합니다(`extraResources` → `resources/tools/`).
따라서 **설치본은 설정 없이 PlantUML 전체(시퀀스 + 클래스/상태 등 dot 의존
다이어그램)가 동작**합니다. 패키징 모드의 tools 탐색 기준은 `process.resourcesPath`.

> 기본 권장은 여전히 위 git 방식입니다 — 업데이트가 `git pull` 한 번으로 끝나
> 폐쇄망에 더 적합합니다. 패키징은 단독 배포가 필요할 때의 선택지입니다.
