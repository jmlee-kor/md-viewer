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
  const svg = await d2.render(result.diagram, {
    ...result.renderOptions,
    noXMLTag: true, // HTML 직접 임베드용
  });
  return svg; // SVG 문자열
});
