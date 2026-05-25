// D2 렌더러. @terrastruct/d2 browser 빌드(wasm+worker 인라인, 완전 오프라인).
// 기본 레이아웃 dagre. WebAssembly 인스턴스화는 CSP 'wasm-unsafe-eval' + worker-src blob: 필요.
import { D2 } from '../../../vendor/d2.js';
import { registerDiagram } from './registry.js';

let instance = null;
function getD2() {
  if (!instance) instance = new D2();
  return instance;
}

registerDiagram('d2', async (src) => {
  const d2 = getD2();
  const result = await d2.compile(src);
  let svg = await d2.render(result.diagram, {
    ...result.renderOptions,
    noXMLTag: true, // HTML 직접 임베드용
  });
  // D2 외부 <svg> 는 width/height 없이 viewBox 만 → 블록 컨테이너에서 폭을 가득
  // 채우고 aspect 비율로 세로가 거대해져 "빈 영역"처럼 보인다(다른 엔진은 width/height
  // 출력). viewBox 크기를 width/height 로 박아 자연 크기 렌더(.note CSS max-width:100%
  // 로 컨테이너보다 넓을 때만 축소).
  svg = svg.replace(/^(<svg\b[^>]*?)(\s*>)/i, (m, head, end) => {
    if (/\bwidth\s*=/.test(head)) return m;
    const vb = /viewBox\s*=\s*"([-\d.\s]+)"/i.exec(head);
    if (!vb) return m;
    const p = vb[1].trim().split(/\s+/).map(Number);
    if (p.length < 4 || !(p[2] > 0) || !(p[3] > 0)) return m;
    return `${head} width="${Math.round(p[2])}" height="${Math.round(p[3])}"${end}`;
  });
  return svg; // SVG 문자열
});
