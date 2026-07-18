/// <reference types="vite/client" />

declare module "*.onnx?url" {
  const url: string;
  export default url;
}
