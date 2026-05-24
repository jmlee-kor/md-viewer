// 다이어그램 엔진 등록 진입점. 여기에 import 하면 해당 엔진이 레지스트리에 등록된다.
// 후속: ./drawio.js, ./d2.js 추가.
import './mermaid.js';
import './drawio.js';
import './d2.js';
import './plantuml.js';

export { hydrateDiagrams } from './registry.js';
