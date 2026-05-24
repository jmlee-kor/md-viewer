// PlantUML 렌더러. main process(java -jar plantuml.jar)에 IPC 위임 → SVG 회신.
import { registerDiagram } from './registry.js';

registerDiagram('plantuml', async (src) => {
  const r = await window.mdv.renderPlantUML(src);
  if (!r || !r.ok) throw new Error((r && r.error) || 'PlantUML 렌더 실패');
  return r.svg; // SVG 문자열
});
