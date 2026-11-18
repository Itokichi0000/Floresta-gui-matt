# Vendored third-party files

Everything the UI needs is served from this folder, so the browser never
talks to a CDN. This keeps your node usage private and lets the UI work on
an offline node box.

| Folder | What | Version | License |
|---|---|---|---|
| `fonts/m-plus-rounded-1c/` | M PLUS Rounded 1c, weights 500 and 800 (latin, latin-ext, japanese subsets, woff2) | @fontsource/m-plus-rounded-1c 5.3.0 | SIL OFL 1.1 (`LICENSE`) |
| `fonts/jetbrains-mono/` | JetBrains Mono, weights 500 and 700 (latin, latin-ext, woff2) | @fontsource/jetbrains-mono 5.3.0 | SIL OFL 1.1 (`LICENSE`) |
| `lucide/sprite.svg` | A small subset of Lucide icons packed as an SVG sprite | lucide-static 1.74.0 | ISC (`LICENSE`) |

`fonts/fonts.css` declares the `@font-face` rules. To add an icon, copy its
`<svg>` body from `lucide-static/icons/<name>.svg` into a new `<symbol id="<name>">`
in `lucide/sprite.svg`.
