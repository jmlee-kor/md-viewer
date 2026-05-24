@echo off
REM 폐쇄망 실행 런처 — 수동 반입한 Electron prebuilt 로 앱 실행.
REM 기본: .\electron\electron.exe  (prebuilt zip 을 .\electron\ 에 푼 경우)
REM 변경: set ELECTRON_EXE=C:\path\to\electron.exe 후 run.cmd

setlocal
if "%ELECTRON_EXE%"=="" set "ELECTRON_EXE=%~dp0electron\electron.exe"

if not exist "%ELECTRON_EXE%" (
  echo [run] electron.exe 를 찾을 수 없습니다: %ELECTRON_EXE%
  echo [run] prebuilt zip 을 .\electron\ 에 풀거나 ELECTRON_EXE 환경변수로 지정하세요.
  exit /b 1
)

"%ELECTRON_EXE%" "%~dp0."
endlocal
