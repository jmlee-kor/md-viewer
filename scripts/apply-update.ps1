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

# 백업 폴더 삭제 재시도: 방금 종료시킨 옛 프로세스의 파일 핸들이 늦게 풀려
# Remove-Item 이 바로는 실패할 수 있다 → 짧게 여러 번 재시도.
function Remove-WithRetry($path, $tries = 8, $delayMs = 500) {
  for ($i = 0; $i -lt $tries; $i++) {
    if (-not (Test-Path $path)) { return $true }
    try { Remove-Item -Recurse -Force $path -ErrorAction Stop; return $true }
    catch { Start-Sleep -Milliseconds $delayMs }
  }
  return (-not (Test-Path $path))
}

# robocopy 로 폴더 이동/복사: 파일 단위 재시도(/R:30 /W:1 = 파일당 최대 30s)로
# 안티바이러스가 추출/종료 직후 스캔하며 일부 파일을 잡아도 전체가 실패하지 않는다.
# Move-Item 은 폴더 단위라 한 파일만 잡혀도 전체 실패 → robocopy 가 본질적으로 더 강인.
function Robocopy-Tree($from, $to, $label, [switch]$Move) {
  $rcArgs = @($from, $to, '/E')
  if ($Move) { $rcArgs += '/MOVE' }
  # /R:30 /W:1 = 파일당 30회×1s 재시도(AV 잠금 대응), /MT:1 = 단일 스레드(AV 경합 회피)
  # /NP /NFL /NDL /NJH /NJS = 출력 최소화
  $rcArgs += '/R:30','/W:1','/MT:1','/NP','/NFL','/NDL','/NJH','/NJS'
  # & 네이티브 호출 (Start-Process 는 ArgumentList 파싱이 불안정해 args 가 누락된 사례 실측)
  & robocopy @rcArgs | Out-Null
  $rc = $LASTEXITCODE
  # robocopy exit: 0-7 = 성공(복사/추가/누락 등 단계 차이), 8+ = 실패
  if ($rc -gt 7) { throw "robocopy 실패 [$label] (exit $rc) $from -> $to" }
  Log "$label : robocopy OK (exit $rc) - $from -> $to"
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
  Start-Sleep -Milliseconds 1500  # 파일 핸들 해제 + AV 초기 스캔 settling

  # 2) 스테이징 루트 확인 (.exe 가 직접 들어있어야 함)
  if (-not (Test-Path (Join-Path $Staged $Exe))) {
    throw "staged 루트에 $Exe 없음: $Staged"
  }

  # 3) 기존 설치 백업: install -> .bak (robocopy /MOVE, 파일 단위 AV 재시도)
  if (Test-Path $backup) {
    if (-not (Remove-WithRetry $backup)) { throw "이전 백업 제거 실패: $backup" }
  }
  if (Test-Path $Install) { Robocopy-Tree $Install $backup '백업' -Move }
  if (Test-Path $Install) { Remove-WithRetry $Install | Out-Null } # 빈 source root 잔존 정리

  # 4) staged -> install (robocopy /MOVE, 파일 단위 AV 재시도)
  Robocopy-Tree $Staged $Install '스왑' -Move
  if (Test-Path $Staged) { Remove-WithRetry $Staged | Out-Null }

  # 5) 검증: 핵심 산출물 존재 (install-local 의 app.asar 검증 교훈)
  if (-not (Test-Path (Join-Path $Install 'resources\app.asar'))) {
    throw "스왑 후 app.asar 없음"
  }
  if (-not (Test-Path (Join-Path $Install $Exe))) {
    throw "스왑 후 $Exe 없음"
  }

  # 6) 성공 → 재실행(먼저) + 백업 제거(재시도)
  Log "swap OK → relaunch"
  Start-Process -FilePath (Join-Path $Install $Exe)
  # 백업 삭제는 재실행 뒤에 — 핸들 해제까지 재시도, 그래도 남으면 다음 업데이트가 정리(무해).
  if (-not (Remove-WithRetry $backup)) { Log "backup 잔류(파일 잠금) — 다음 업데이트가 정리: $backup" }
  Log "done"
  exit 0
}
catch {
  Log "FAIL: $_"
  # 롤백: 새 Install 이 partial 일 수 있음 → 제거 후 robocopy 로 .bak 복원(파일 단위 재시도)
  try {
    if (Test-Path $backup) {
      if (Test-Path $Install) { Remove-WithRetry $Install | Out-Null }
      Robocopy-Tree $backup $Install '롤백' -Move
      Log "rolled back to backup"
    }
    # 어느 쪽이든 기존(복원된) 앱은 재실행 시도
    if (Test-Path (Join-Path $Install $Exe)) { Start-Process -FilePath (Join-Path $Install $Exe) }
  } catch {
    Log "rollback FAIL: $_"
  }
  exit 1
}
