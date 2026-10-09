# AGENTS.md

## Layout
- `be/` — Go backend, a single `package main` (module name `okidoki/be2` intentionally
  does not match the repo). HTTP API + serves the built SPA.
- `fe/` — React 19 frontend bootstrapped with Create React App.
- Root `Makefile` and `.github/workflows/release.yml` orchestrate builds.

## Commands
- Backend dev: `make run-be` (`cd be && go run ./...`), listens on `:8080`, data in `be/data/`.
- Frontend dev: `make run-fe` (CRA dev server on `:3000`); it proxies `/api` to `:8080`
  via the `"proxy"` field in `fe/package.json`.
- Static assets: `make build-static` — builds `fe`, copies `fe/build` -> `be/static`.
- Release binaries: `make build-be` — runs build-static, then cross-compiles to `bin/`.
- There are NO Go tests, NO frontend tests, and NO lint/format/typecheck config.
  Do not assume or add test commands.

## Critical build gotcha
`be/main.go` contains `//go:embed static/*`. `be/static` is gitignored and absent after
a fresh clone, so `go build`/`go run` in `be/` fails until at least one file exists there.
Run `make build-static` first (needs `npm ci` in `fe/`), or create `be/static/` with a
placeholder before compiling the backend.

## Architecture
- Storage is git-backed files under `data/`: each doc is `data/docs/<id>/<title>.md`.
  The directory name is a generated slug (title transliterated, lowercased,
  non-alphanumerics stripped); the `.md` filename is the title. Renaming a doc renames
  both file and directory. A git repo is initialized in `data/`; commits happen on
  create/update(commit)/delete/move/restore.
- `SearchEngine` is an in-memory index rebuilt from storage at startup. Any handler that
  mutates documents must call `search.DeleteDocument` then `IndexDocument` itself.
- Favorites / last-viewed (`Metadata`) are gob-persisted to `data/metadata`.
- The editor lives in `fe/src/editor/` (TipTap v3 + `@tiptap/markdown`), not a third-party
  editor. It is deliberately limited to Markdown/GFM: no panels, HTML, or custom nodes
  without a markdown parser/serializer. `value`/`onChange` are markdown strings.
- File/image uploads go through the editor's `onUploadFile` callback (`fe/src/editor/upload.js`),
  which calls `POST /api/upload` (multipart `file` + `path` for a document or `draft` for a
  draft). Attachments are stored next to the doc's `.md` and referenced by relative path;
  served via `GET /api/docfile/{docPath}/{name}` and `GET /api/draftfile/{draftId}/{name}`.
  Draft attachments live in `data/drafts/<id>/` and are moved into the new doc folder on
  create, so relative links stay valid. Upload UI buttons were removed; insertion is via
  drag&drop / paste only. Non-image files become markdown links (`[name](name)`). The
  backend returns `Document.Attachments` (files next to the `.md`), and a link is rendered
  as an "attachment" chip (class `rte-attachment`, see `AttachmentLink` in
  `fe/src/editor/extensions.js`) only if its target is in that list. Regular links are
  always normalized to absolute (`ya.ru` -> `https://ya.ru`). The server serves non-image
  attachments with `Content-Disposition: attachment`, and a chip click downloads via
  fetch->blob (no new tab). Images are real `image` nodes and stay inline.
- Image display size is persisted in markdown as a URL fragment on the image path:
  `![alt](photo.png#w=540&h=290)`. The `src` node attribute is always fragment-free (so
  `resolveAsset` works); the fragment is parsed/rendered by the custom image extension in
  `fe/src/editor/extensions.js`. Resize handles: bottom-right corner keeps aspect ratio,
  bottom/right edges change one side only.
- Storage code must distinguish the document's `.md` file from attachment files in the same
  folder (`readDocument`/`getTitle`/`getChildren`); a sibling file is never the document.
- Git ignores service data: `commitChanges` stages only `docs/` (not `drafts/`/`metadata`),
  and `NewGitStorage` untracks already-committed service files on startup. Only document
  operations create commits.
- `GitStorage.writeMu` serializes all mutations (create/update/delete/move/restore + commit);
  go-git is not concurrency-safe. Compound git mutations (e.g. `moveDraftAttachments`) take
  `LockWrites`/`UnlockWrites`. Read paths are not locked.
- Upload size cap is configurable via env `OKIDOKI_MAX_UPLOAD_MB` (default 2048 = 2 GiB).
- Input safety: document paths from URL params go through `cleanRelPath`; titles are validated
  (`validateTitle`: non-empty, no `/\:*?"<>|`, length cap); draft IDs must match `^[A-Za-z0-9_-]+$`.
- `SearchEngine` keys docs by their slash doc path (no `data/` prefix); tokenization strips
  markdown punctuation. `GetDocument`'s `Uncommitted` flag uses a short-TTL git-status cache.
- Deleting a document with children is rejected unless `DELETE /api/document/{path}?recursive=true`;
  recursive delete also cleans the search index and favorites for the whole subtree. Move/rename
  reindexes the affected subtree.
- API routes are registered in `be/main.go` (gorilla/mux). The frontend calls relative
  `/api/...`; unknown paths fall back to `index.html` (SPA).
- Frontend API calls go through `fe/src/api.js` (`fetchJSON`/`apiFetch`/`apiPath`) — path
  segments are encoded, errors handled uniformly. Cross-document fetches use sequence-guard
  refs (`docRequestRef`, `relatedRequestRef`, …) to drop stale responses.
- Notifications live in `fe/src/hooks/useNotifications.js`.

## Conventions
- Code, comments, log messages, and internal error strings are in English. User-facing UI
  text lives only in the i18n catalogs (`fe/src/i18n/en.js`, `ru.js`) and is rendered via
  `useI18n().t(key)` — never hardcode UI strings in components.
- The interface language and search stemmer languages are set by `OKIDOKI_LANG` (`ru`/`en`,
  default `ru`). The backend maps it to snowball languages and exposes it to the SPA through
  `GET /api/config` (`{ lang, searchLangs }`); the provider in `fe/src/i18n/` reads it once.
  Document content and tokenization stay language-agnostic (Unicode `\p{L}\p{N}`).
- Design system: single ink-blue theme. Tokens live in `fe/src/tokens.css`
  (`:root { --accent / --text / --surface / --bg / --border / --danger / --success /
  --warning / --star / --sp-* / --r-* / --fs-* / --sh-* ... }`), imported first by
  `fe/src/App.css`. Use tokens, never raw hex/spacing. Accent = `#0052cc`.
- One icon set: `@radix-ui/react-icons` only (lucide removed). The few glyphs Radix
  lacks (`undo`/`redo`, ordered list) are local inline-SVG components in
  `fe/src/editor/Toolbar.js`. No emoji/unicode glyphs as icons.
- Root-page sections (Drafts/Favorites/Last Viewed) share `.section-container` +
  `.section-item`; empty states use `.empty-section`.
- Release = push a `v*` tag; CI runs `make build-be` and uploads the five binaries to a
  GitHub release. The `Dockerfile` is a multi-stage build from source (Node builds the SPA,
  Go embeds it); `docker-compose.yaml` builds it locally — no published release required.
