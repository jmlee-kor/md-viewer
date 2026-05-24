// draw.io 보기 전용 렌더러 (GraphViewer / viewer.min.js).
// mxGraph XML 을 SVG 로 렌더. 외부 리소스 로드는 차단(오프라인).
import { registerDiagram } from './registry.js';

let loaderPromise = null;

function loadViewer() {
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    // mxGraph 외부 리소스/스타일시트 자동 로드 차단 (폐쇄망)
    window.mxLoadResources = false;
    window.mxLoadStylesheets = false;
    window.RESOURCES_PATH = '';
    window.STENCIL_PATH = '';
    window.SHAPES_PATH = '';
    window.STYLE_PATH = '';
    window.PROXY_URL = '';
    window.DRAWIO_BASE_URL = '';

    const s = document.createElement('script');
    s.src = '../../vendor/drawio-viewer.min.js'; // index.html 기준 상대경로
    s.onload = () => resolve(window.GraphViewer);
    s.onerror = () => reject(new Error('drawio viewer 로드 실패'));
    document.head.appendChild(s);
  });
  return loaderPromise;
}

registerDiagram('drawio', async (src, el) => {
  const GraphViewer = await loadViewer();
  if (!GraphViewer) throw new Error('GraphViewer 미초기화');

  el.replaceChildren();
  const inner = document.createElement('div');
  inner.className = 'mxgraph';
  inner.style.maxWidth = '100%';
  inner.setAttribute(
    'data-mxgraph',
    JSON.stringify({ editable: false, nav: false, toolbar: null, resize: true, xml: src })
  );
  el.appendChild(inner);

  if (typeof GraphViewer.createViewerForElement === 'function') {
    GraphViewer.createViewerForElement(inner);
  } else {
    GraphViewer.processElements();
  }
  return undefined; // el 을 직접 채웠으므로 registry 가 건드리지 않게
});
