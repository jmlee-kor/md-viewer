// Mermaid 렌더러. securityLevel:'strict' 로 라벨 XSS 방지.
import mermaid from '../../../vendor/mermaid.js';
import { registerDiagram } from './registry.js';

let initialized = false;
function init() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
  });
  initialized = true;
}

let counter = 0;

registerDiagram('mermaid', async (src) => {
  init();
  const id = `mmd-${Date.now()}-${counter++}`;
  const { svg } = await mermaid.render(id, src);
  return svg; // SVG 문자열 (mermaid 가 strict 모드로 살균)
});
