# Google Fonts (bundled)

The two typefaces the videos use, bundled so renders don't fetch fonts from Google at render time.
Both are under the SIL Open Font License 1.1 (see the OFL-*.txt files next to them), which allows
bundling and redistributing them.

| File | Family | Source |
|---|---|---|
| `dm-sans-v17-latin.woff2` | DM Sans (variable, latin) | `fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2` |
| `jetbrains-mono-v24-latin.woff2` | JetBrains Mono (variable, latin) | `fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwE.woff2` |

These are the exact files the approved renders used, so text renders identically.
`composer/render/fonts/` loads them (weights 400/500/700 and 400/500).
