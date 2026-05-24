// 렌더러 진입점.
// 스켈레톤 단계: preload 가 노출한 window.mdv 가 정상 연결됐는지만 확인한다.
// 후속 단계에서 Lit 컴포넌트(사이드바/노트뷰/백링크 패널)를 여기서 마운트한다.

const statusEl = document.getElementById("status");

if (window.mdv && window.mdv.version) {
  statusEl.textContent = `정상 — preload 연결됨 (mdv v${window.mdv.version})`;
  statusEl.style.color = "#6a9955";
} else {
  statusEl.textContent = "오류 — preload 브리지(window.mdv) 미연결";
  statusEl.style.color = "#f44747";
}
