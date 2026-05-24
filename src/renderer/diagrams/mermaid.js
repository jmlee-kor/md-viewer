// Mermaid 렌더러. securityLevel:'strict' 로 라벨 XSS 방지.
// 테마는 사용자 설정(mermaidTheme)에서 읽어 렌더마다 적용 → 옵션 변경 즉시 반영.
import mermaid from '../../../vendor/mermaid.js';
import { registerDiagram } from './registry.js';
import { getSetting } from '../settings.js';

let counter = 0;

registerDiagram('mermaid', async (src) => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: getSetting('mermaidTheme', 'dark'), // default/dark/neutral/forest
    fontFamily: '"Segoe UI", system-ui, sans-serif',
  });
  const id = `mmd-${Date.now()}-${counter++}`;
  const { svg } = await mermaid.render(id, src);
  return svg; // SVG 문자열 (mermaid 가 strict 모드로 살균)
});
