// 청중 창 부트스트랩: 앱 셸 없이 mdv-deck 하나만 띄우고, 메인 IPC 릴레이로
// 발표자 창의 src/슬라이드 인덱스/블랭크를 받아 현재 슬라이드만 전체화면으로 보여준다.

import './deck.js';

const deck = document.createElement('mdv-deck');
deck.setAttribute('audience', ''); // 청중 모드: 항상 contain-fit(창 꽉참) + 크롬 숨김
document.body.appendChild(deck);

// 발표자 → 메인 → 청중: src 수신 시 덱 재빌드
window.mdv.onPresentSrc((src) => {
  if (typeof src === 'string') deck.src = src;
});

// 슬라이드 인덱스 + 블랙/화이트 동기화
window.mdv.onPresentState((state) => {
  if (!state) return;
  if (typeof state.index === 'number') {
    // 덱이 아직 슬라이드를 빌드 중일 수 있어 updateComplete 후 적용
    deck.updateComplete.then(() => deck._show(state.index));
  }
  deck._blank = state.blank || null;
});

// ESC = 발표 전체 종료(양쪽 정리). 청중 창은 이 한 키만 처리.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    window.mdv.endPresent();
  }
});

// 렌더러 준비 완료 통지 → 메인이 현재 src+state 푸시
window.mdv.presentReady();
