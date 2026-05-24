# tools/ — PlantUML 실행에 필요한 반입 바이너리

PlantUML 은 Java 기반이라 npm/git 으로 받을 수 없습니다. 폐쇄망 PC에 아래를
**수동 반입**하세요. (다른 다이어그램 — Mermaid·draw.io·D2 — 은 반입 불필요)

## 필요 항목

| 항목 | 위치(기본) | 대안 |
|------|-----------|------|
| plantuml.jar | `tools/plantuml.jar` | 환경변수 `MDV_PLANTUML_JAR` |
| JRE (Java 실행) | `tools/jre/bin/java(.exe)` | PATH 의 `java` 또는 `MDV_JAVA` |
| Graphviz (dot) | — | `MDV_GRAPHVIZ_DOT` 또는 PATH 의 `dot` |

> 이 디렉토리의 바이너리는 git 에 커밋하지 않습니다(.gitignore). 배포 시 각
> PC 에서 한 번 반입하면 됩니다.

## 설정 우선순위

환경변수 > `mdv.config.json`(앱 루트) > `tools/` 기본경로 > PATH

`mdv.config.json` 예시:

```json
{
  "javaPath": "C:/jre/bin/java.exe",
  "plantumlJar": "C:/tools/plantuml.jar",
  "graphvizDot": "C:/Graphviz/bin/dot.exe"
}
```

## 다이어그램별 Graphviz 필요 여부

- **불필요**: 시퀀스, 간트, 마인드맵 등 (PlantUML 내장 엔진)
- **필요**: 클래스, 컴포넌트, 상태, 활동 등 (레이아웃에 dot 사용)

Graphviz 가 없으면 dot 필요 다이어그램은 "Cannot find Graphviz" 에러 이미지가
표시됩니다(앱은 정상 동작). 전체 품질을 원하면 Graphviz 를 반입하세요.

## 획득처 (외부 인터넷 PC)

- plantuml.jar: https://plantuml.com/download (또는 GitHub releases)
- JRE: Temurin/Adoptium 등 portable JRE zip
- Graphviz: https://graphviz.org/download/ (Windows zip)
