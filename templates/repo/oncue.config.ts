import { defineConfig } from "oncue";

// Every field is optional. See https://github.com/scalvert/oncue#configuration
export default defineConfig({
  // Small label on title, statement, and end scenes.
  brandLabel: "__NAME__",
  theme: {
    colors: {
      // accent: "#4F46E5",
    },
  },
  // Spoken forms captions show as written: "docs dot example dot com" -> "docs.example.com".
  captions: { spoken: ["docs dot example dot com"] },
});
