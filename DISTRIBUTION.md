# 배포 가이드 (오프라인 / 폐쇄망)

핵심 원칙: **런타임 외부 의존 0.** 모든 JS 라이브러리·폰트는 `vendor/` 에
커밋되어 따라옵니다. 빌드/번들 생성만 인터넷 PC에서 합니다.

배포 방식은 두 가지입니다. **대부분은 ① 로컬 설치를 권장**합니다.

---

## ① 권장: 로컬 설치 (`install:local`)

인터넷 되는 PC에서 한 줄로 **빌드 → 설치 → PATH 등록**까지 끝냅니다.
Chromium(Electron)과 PlantUML 도구(JRE+jar+Graphviz)가 **자동 번들**되어
설치본은 **설정 없이 모든 기능**(다이어그램 4종·Marp·검색 등)이 동작합니다.

```bash
npm install            # dev 의존성 (최초 1회)
npm run install:local  # 빌드 + %LOCALAPPDATA%\Programs\md-viewer 설치 + 사용자 PATH 등록
```

- **새 터미널**부터 어디서든 `md-viewer` 로 실행. 시작 메뉴 바로가기도 생성됩니다.
- 재빌드는 `install:local` 만 다시 실행(PATH 는 이미 등록 — 중복 추가 안 함).
- 폐쇄망 타깃이면 빌드 산출물 폴더(`dist/win-unpacked/`)를 통째로 복사해도 됩니다.

> PlantUML 자동반입: `npm run dist` 가 빌드 전 `tools:fetch` 로 JRE +
> plantuml.jar + Graphviz 를 받아 `extraResources`(→ `resources/tools/`)로
> 번들합니다. 패키징 모드 tools 탐색 기준은 `process.resourcesPath`.

---

## ② 대안: git pull + Electron prebuilt (순수 폐쇄망)

빌드를 돌릴 수 없는 폐쇄망 타깃용. 소스(+커밋된 `vendor/`)만 받고 Electron
실행파일만 반입합니다.

```bash
git clone <사내 repo>/md-viewer.git   # 또는 git pull
```
`vendor/` 가 함께 받아지므로 `npm install` **불필요**.

`package.json` 의 electron 버전과 **동일한** prebuilt zip
(`electron-v<버전>-win32-x64.zip`)을 `md-viewer\electron\` 에 풀고:

```bat
run.cmd
```
`run.cmd` 가 `.\electron\electron.exe` 로 실행합니다(다른 위치는
`set ELECTRON_EXE=C:\path\electron.exe & run.cmd`).

PlantUML 은 `tools/` 에 JRE + plantuml.jar (+ Graphviz) 를 수동 반입
(자세히는 [`tools/README.md`](tools/README.md)). 미반입 시 PlantUML 블록만
안내 메시지로 표시되고 앱은 정상 동작합니다.

---

## 메인테이너: vendor 갱신 (인터넷 PC)

라이브러리/폰트를 바꿨을 때만 필요합니다.

```bash
npm run vendor   # vendor/ 생성: 다운로드(vendor:fetch) + esbuild 번들(bundle:vendor)
npm test         # 단위 + 스모크
git add -A && git commit -m "vendor 갱신" && git push
```

`npm run vendor` 산출물(약 19MB, **git 커밋 대상**):
- `vendor/lit.js · markdown-it.js · dompurify.js · mermaid.js · d2.js · marp.js · highlight.js · katex.js` (esbuild 번들)
- `vendor/drawio-viewer.min.js` (draw.io 공식 viewer)
- `vendor/fonts/NanumGothicCoding-Regular.ttf` (CJK 정렬 폰트) · `vendor/katex/` (CSS + woff2)

---

## 메인테이너: 자동 업데이트 릴리스 발행 (GitHub Releases)

설치본은 GitHub Releases 를 주기적으로 확인해 새 버전을 배너로 알리고, 사용자가
**"지금 업데이트"** 를 누르면 zip 을 받아 교체 후 재시작합니다(인터넷 전제 —
폐쇄망 타깃은 ①/② 수동 배포 유지).

새 버전 발행 절차:

```bash
# 1) 버전 올리기 (package.json + preload.js 의 version 동일하게)
#    예: 0.2.0 → 0.3.0

# 2) 패키징 에셋 생성: dist/md-viewer-win-x64.zip (+ .sha256)
npm run dist:release

# 3) 커밋/푸시 후 릴리스 발행 (gh CLI)
git commit -am "vX.Y.Z" && git push
gh release create vX.Y.Z --repo jmlee-kor/md-viewer --target main \
  --title "vX.Y.Z" --notes "변경점…" \
  dist/md-viewer-win-x64.zip dist/md-viewer-win-x64.zip.sha256
```

- 에셋 이름은 `updater.ASSET_RE`(`/win.*\.zip$/i`)에 매칭되어야 자동 다운로드됩니다
  (`md-viewer-win-x64.zip` 권장). zip 루트에 `md-viewer.exe` 가 직접 와야 합니다
  (`pack-release.mjs` 가 그렇게 만듭니다).
- 설치본은 시작 8초 후 + 주기적으로 `releases/latest` 와 자기 버전을 비교합니다.
- **적용 메커니즘**: 실행 중 자기 파일을 잠그므로, 다운로드·추출 후 분리 헬퍼
  (`apply-update.ps1`, `extraResources` 로 번들)가 앱 종료를 기다렸다가 설치
  디렉토리를 교체(백업→스왑→`app.asar` 검증→재실행, 실패 시 롤백)합니다.

확인 동작 재정의 (환경변수 또는 기준 경로의 `mdv.config.json`):

| 환경변수 | `mdv.config.json` | 기본값 |
|------|------|------|
| `MDV_UPDATE_REPO` | `updateRepo` | `jmlee-kor/md-viewer` |
| `MDV_UPDATE_INTERVAL_H` | `updateIntervalH` | `6` (시간) |
| `MDV_UPDATE_TOKEN` | `updateToken` | (없음; 비공개 repo 용) |
| `MDV_UPDATE_ENABLED` | `updateEnabled` | `true` |

> 릴리스가 하나도 없으면(404) 오류가 아니라 "최신"으로 표시됩니다.
> 사용자는 배너의 **건너뛰기**로 특정 버전 알림을 끌 수 있습니다(설정에서 해제).

---

## (대안) PlantUML 도구를 Chocolatey 로 설치

자동 번들(①) 대신 인터넷 PC에서 Chocolatey 로 의존성을 설치할 수도 있습니다.
**choco 는 인터넷이 필요**하므로 비폐쇄망/빌드 PC 용 대안입니다. 폐쇄망은
①의 자동 번들을 그대로 쓰세요.

```powershell
choco install temurin   # JRE (Java)
choco install plantuml  # plantuml.jar (보통 PATH 의 plantuml 래퍼)
choco install graphviz  # dot
```

설치 후 md-viewer 가 찾도록 경로를 연동합니다. `plantuml.js` 해석 순서:
**환경변수 > `mdv.config.json` > 번들 `tools/` > PATH**.

```bat
set MDV_JAVA=C:\path\to\java.exe
set MDV_PLANTUML_JAR=C:\ProgramData\chocolatey\lib\plantuml\tools\plantuml.jar
set MDV_GRAPHVIZ_DOT=C:\Program Files\Graphviz\bin\dot.exe
```

또는 기준 경로(baseDir)의 `mdv.config.json`:

```json
{ "javaPath": "...", "plantumlJar": "...", "graphvizDot": "..." }
```

> 현재 해석 상태는 앱 좌하단 **☰ 메뉴 → 설정**에서 확인할 수 있습니다.

---

## 커밋 대상 / 비대상

| 항목 | git 커밋 | 비고 |
|------|:---:|------|
| `src/`, `scripts/`, `vendor/` | ✅ | 앱 + 라이브러리 + 폰트 |
| `sample-vault/` | ✅ | 데모 vault |
| `node_modules/` | ❌ | 메인테이너 dev 전용 |
| `electron/` (prebuilt) | ❌ | ② 방식에서 수동 반입 |
| `tools/` 바이너리 | ❌ | 자동 번들(①) 또는 수동/choco 반입 (README 만 커밋) |
