// 렌더러 사용자 설정 (localStorage 영속). 다이어그램 옵션 등.
const KEY = 'mdv-settings';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

let store = load();

export function getSetting(key, fallback) {
  return key in store ? store[key] : fallback;
}

export function setSetting(key, value) {
  store[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* 저장 실패는 무시 (세션 한정으로 동작) */
  }
}
