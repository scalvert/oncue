import { defineConfig } from "oncue";

/**
 * A complete example: Acme's developer videos. Everything here is fictional. The tests run against
 * this repo, so it exercises every part of the config.
 */
export default defineConfig({
  brandLabel: "Acme Developers",
  theme: {
    colors: { accent: "#0F766E", highlight: "#FDE047", info: "#38BDF8" },
    backdrop: {
      glows: [
        [253, 224, 71],
        [94, 234, 212],
        [56, 189, 248],
      ],
    },
  },
  captions: { spoken: ["docs dot acme dot dev"] },
  metadata: {
    approvals: {
      product: { who: "Product", required: true, blocksHosting: false },
      legal: { who: "Legal" },
    },
    unnumberedSeriesTags: true,
  },
  checks: {
    redact: [
      {
        // Real tenant hosts never land in committed captures; the demo tenant and placeholders can.
        pattern: /[a-z0-9{}<>_-]+\.acme-cloud\.dev/g,
        allow: ["demo.acme-cloud.dev", "{tenant}.acme-cloud.dev"],
        normalize: (t) => t.replace(/%2[Ff]/g, "/"),
        message: (found) => `unredacted tenant host(s) ${found.join(", ")}. Use {tenant}.acme-cloud.dev.`,
      },
    ],
  },
});
