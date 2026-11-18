# Contributing

Thanks for helping! A few ground rules keep this project small and easy to review.

## Principles

* **Few dependencies.** The server uses only the Python standard library.
  The frontend is plain HTML, CSS and ES modules, with no build step. Third-party
  files go in `static/vendor/` with their license. Nothing loads from a CDN.
* **The browser never gets credentials.** Everything goes through
  `POST /api/rpc`. New RPC methods must be added to the allow-list in
  `server/serve.py` (read, change state, or dangerous).
* **Untrusted data stays text.** Peer user agents and similar values come from
  the network: build the DOM with `h()` from `static/js/dom.js` (which uses
  `textContent`), never `innerHTML` with node data.
* **Watch-only.** Never add a feature that handles private keys.
* **Both languages, both themes.** Put every user-facing string in
  `static/i18n/en.json` *and* `static/i18n/ja.json`, and check light and dark
  mode. Text must meet WCAG AA contrast (4.5:1).
* **Floresta specifics.** Read the RPC docs in
  [Floresta's doc/rpc](https://github.com/getfloresta/Floresta/tree/master/doc/rpc)
  and chapter 6 of [docs/DESIGN.md](docs/DESIGN.md). For example, `getblock`
  fetches from peers and can be slow, and `services` is a 16-digit hex string.

## Layout

```
server/serve.py           static files + /api/rpc relay
server/config.py          environment variables and flags
server/mock_florestad.py  fake florestad for development and tests
server/test_serve.py      unittest suite
static/js/                app.js (entry), router.js, rpc.js, store.js (5 s polling),
                          node.js (pure helpers), format.js, i18n.js, views/*.js
static/css/               tokens.css (design tokens, light + night), base, components, stage, views
tests/js/                 node --test unit tests for the pure helpers
```

## Checks

```bash
python3 -m unittest discover -s server
node --test tests/js/*.test.mjs
npx html-validate@9.5.0 static/index.html
```

CI runs the same checks (`.github/workflows/ci.yml`).

## Commits

One feature per commit, in the imperative mood, in English, for example
`Add peers view with utreexo highlight`. Keep the history easy to read.
