# WeChat article studio — detail page

![The studio panel: copy on the left, a live phone preview in the middle, theme swatches on the right](preview.svg)

## What it is

A DeepSeek Harness (DSH) sidebar bundle for turning Markdown into WeChat Official Account articles: live phone preview, content-driven theme selection, image handling, AI copy/layout edits, and draft publishing.

## Architecture

- `index.js` — Host entry. Registers the `POST /wechat-studio/api` route, the `/wechat-studio` exact route, and four agent tools (`status`, `ai_edit`, `save_draft`, …). Loads `cordis.patch.yml` through the bundle manifest.
- `host/` — Node-only half:
  - `wechat.js` — WeChat API client (`token`, `stable_token`, image upload, draft add/list/delete, freepublish).
  - `service.js` — action layer with credential reads, token caching, image download/upload, draft and publish actions.
  - `http.js` — JSON body limits, same-origin checks, error responses.
  - `ai.js` — model call, prompt construction, JSON contract validation, design override sanitizing.
- `src/` — browser half, concatenated into `client.js` by `build.mjs`:
  - `engine.mjs` — Markdown parsing, topic detection, theme ranking, design composition.
  - `themes.mjs` — 13 themes × 2 variants.
  - `render.mjs` — one node tree projected both to React (preview) and to inline-style HTML (clipboard/publish).
  - `docparse.mjs` — `.docx` ZIP/XML parsing, `.html` → Markdown, embedded image extraction.
  - `bridge.mjs` — host calls, clipboard, image compression.
  - `images.mjs` — image registry: editor text keeps `wsimg://id` refs, data URLs live in IndexedDB, refs are expanded before parsing/rendering/publishing.
  - `ui.mjs` — three-pane panel, editor, preview, design controls, publish panel, AI chat.

## Data flow

1. Editor text is parsed locally; `composeDesign` resolves the theme/variant/overrides into concrete styles.
2. The same node tree feeds the live preview and the copy/publish HTML, so they cannot drift.
3. Publishing: data URLs are compressed and uploaded to the WeChat CDN, remote images are imported; then a draft is created and optionally submitted for publish.
4. AI edits return structured JSON (`reply`, optional `text`, `design`, `meta`). The panel consumes an SSE variant (`aiEditStream`) for live character progress; long articles can be rewritten section by section with a client-side toggle.
5. Images are inserted as registry refs; before parsing/rendering/publishing the panel expands refs to data URLs. Exports expand refs so the result is portable; deleting drafts prunes unreferenced images.

## Security

- Credentials live in the DSH credential store; the page only sees the AppID prefix.
- The HTTP route requires a custom header plus same-origin `Origin`/`Host`/`Sec-Fetch-Site` checks.
- Remote image import rejects localhost, private/link-local ranges and cloud metadata addresses, including redirect targets.
- Local storage quota failures surface a warning; generated covers are not persisted.

## Limits

- WeChat draft/publish APIs need a verified account and an IP allowlist.
- Image content is capped at 1MB per image (we re-encode to ~900KB).
- Long articles (>7,000 chars) get design-only AI edits.
- Tables, nested lists and formulas are not supported; Word images outside the body are skipped.
- The preview is an iPhone-shaped approximation, not a pixel-perfect WeChat renderer.
