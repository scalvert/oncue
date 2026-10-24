// The composition the render page mounts: the built-in Explainer, or the repo's own (config
// `composition`). src/render/page.ts resolves it when it bundles the page.
declare module "oncue:composition" {
  import type React from "react";
  import type { ExplainerProps } from "../src/props";
  const Composition: React.ComponentType<ExplainerProps>;
  export default Composition;
}
