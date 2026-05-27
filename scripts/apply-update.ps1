<#
  자동 업데이트 스왑 헬퍼 (Phase 2).
  실행 중인 md-viewer 가 자기 자신(.exe/app.asar)을 잠그므로, 앱이 이 스크립트를
  detached 로 띄우고 종료한다. 이 스크립트가 앱 종료를 기다린 뒤 설치 디렉토리를
  스테이징 빌드로 교체하고 검증 후 재실행한다. 실패 시 백업을 되돌린다.

  main.js 가 다음 인자로 spawn:
    powershell -NoProfile -ExecutionPolicy Bypass -File apply-update.ps1 \
      -OwnerPid <앱 main PID> -Staged <새 빌드 루트> -Install <설치 디렉토리> [-Exe md-viewer.exe] [-Log <경로>]
#>
param(
  [Parameter(Mandatory=$true)][int]$OwnerPid,
  [Parameter(Mandatory=$true)][string]$Staged,
  [Parameter(Mandatory=$true)][string]$Install,
  [string]$Exe = 'md-viewer.exe',
  [string]$Log
)

$ErrorActionPreference = 'Stop'
function Log($m) {
  $line = "$(Get-Date -Format o) $m"
  if ($Log) { $line | Out-File -FilePath $Log -Append -Encoding utf8 }
}

$backup = "$Install._bak"

try {
  # 1) 앱 종료 대기 (owner PID 사라질 때까지, 최대 ~20s)
  Log "wait for pid=$OwnerPid to exit"
  for ($i = 0; $i -lt 100; $i++) {
    if (-not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 200
  }
  # 잔여 동일 이름 프로세스(렌더러/GPU 등)도 정리 — 보통 main 종료 시 같이 죽지만 안전.
  $name = $Exe -replace '\.exe$',''
  Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800   # 파일 핸들 해제 여유

  # 2) 스테이징 루트 확인 (.exe 가 직접 들어있어야 함)
  if (-not (Test-Path (Join-Path $Staged $Exe))) {
    throw "staged 루트에 $Exe 없음: $Staged"
  }

  # 3) 기존 설치 백업 (같은 볼륨이면 Move 는 즉시)
  if (Test-Path $backup) { Remove-Item -Recurse -Force $backup }
  if (Test-Path $Install) { Move-Item -Path $Install -Destination $backup -Force }

  # 4) 스테이징 → 설치 위치로 이동(스왑)
  Move-Item -Path $Staged -Destination $Install -Force

  # 5) 검증: 핵심 산출물 존재 (install-local 의 app.asar 검증 교훈)
  if (-not (Test-Path (Join-Path $Install 'resources\app.asar'))) {
    throw "스왑 후 app.asar 없음"
  }
  if (-not (Test-Path (Join-Path $Install $Exe))) {
    throw "스왑 후 $Exe 없음"
  }

  # 6) 성공 → 백업 제거 + 재실행
  Remove-Item -Recurse -Force $backup -ErrorAction SilentlyContinue
  Log "swap OK → relaunch"
  Start-Process -FilePath (Join-Path $Install $Exe)
  Log "done"
  exit 0
}
catch {
  Log "FAIL: $_"
  # 롤백: 새 Install 이 불완전하면 제거하고 백업 복원
  try {
    if (Test-Path $backup) {
      if (Test-Path $Install) { Remove-Item -Recurse -Force $Install -ErrorAction SilentlyContinue }
      Move-Item -Path $backup -Destination $Install -Force
      Log "rolled back to backup"
    }
    # 어느 쪽이든 기존(복원된) 앱은 재실행 시도
    if (Test-Path (Join-Path $Install $Exe)) { Start-Process -FilePath (Join-Path $Install $Exe) }
  } catch {
    Log "rollback FAIL: $_"
  }
  exit 1
}
