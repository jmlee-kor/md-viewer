// 공유 스크롤바 스타일. Shadow DOM 별로 적용해야 하므로 각 컴포넌트 static styles 에 포함.
import { css } from '../../vendor/lit.js';

export const scrollbarCss = css`
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: #3a3d41;
    border: 2px solid transparent;
    border-radius: 7px;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #565b60;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-corner {
    background: transparent;
  }
`;
