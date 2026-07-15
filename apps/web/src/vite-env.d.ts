/// <reference types="vite/client" />

declare module "*.mjs?url" {
  const url: string;
  export default url;
}
declare module "*.onnx?url" {
  const url: string;
  export default url;
}

declare module "cm-chessboard/src/Chessboard.js" {
  export const COLOR: { white: "w"; black: "b" };
  export class Chessboard {
    constructor(element: HTMLElement, props?: Record<string, unknown>);
    setPosition(fen: string, animated?: boolean): Promise<void>;
    setOrientation(color: "w" | "b", animated?: boolean): Promise<void>;
    destroy(): void;
  }
}
