# LandingAI v2

AI landing page generator with live URLs, a full inline editor and real publishing.

## Run
```bash
npm install
cp .env.example .env      # add GROQ_API_KEY for AI copy (optional)
npm start                 # http://localhost:3000
npm test                  # API/security checks plus a mocked Groq call
```
Without `GROQ_API_KEY` the app still works but uses a built-in template writer
(the editor shows a notice saying so). The key stays on the server.

## How it maps to the spec
| Spec | Where |
|---|---|
| Inputs: audience, problem, purpose, 2 colours, optional images, CTA URL, sections | `public/index.html`, `public/js/generator.js` |
| AI generation | `lib/llm.js` (Groq `openai/gpt-oss-120b` -> validated JSON, template fallback) |
| Dynamic page URL | `/p/:id` (published) and `/edit/:id` (editor), in `server.js` |
| Rendered landing page, CTA focus | `public/js/render.js` + `public/css/page.css` (header, hero, about, closing CTA band and footer all carry the CTA) |
| Inline edit: text, icons, images, videos, CTA, sections | `public/js/editor.js` |
| Publish | snapshot to public URL; Unpublish; "unpublished changes" tracking |

## Ask AI (prompt-based editing)
Editor toolbar -> **✨ Ask AI**. The user describes a bigger change ("make it dark and premium", "add a pricing section",
"move reviews above features", "rewrite for students") and the page updates. Small tweaks still use inline editing and Settings.

- `POST /api/pages/:id/modify {prompt}` - needs `GROQ_API_KEY` or `ANTHROPIC_API_KEY`; edit token required; 30/hour/IP.
- `POST /api/pages/:id/undo` - restores the snapshot taken before the last AI change (last 10 are kept).
- The model returns a **change set** (`design`, `order`, `ops`), never HTML/CSS. `lib/modify.js` validates every value against
  allow-lists, applies it to a copy of the page, then `sanitizeDoc` runs as usual. Unknown values are skipped and reported.
- **Design settings** (`doc.theme` + `doc.tone`): preset (professional, friendly, bold, minimal, urgent, luxury, playful, techy),
  mode, font pair, corner radius, spacing, hero layout, card style, button style, plus the two brand colours.
  Each maps to a root class (`lp-m-dark`, `lp-r-pill`, ...) styled in `public/css/page.css`. To add an option: add it to
  `THEME_OPTIONS` in `render.js`, add its CSS, done - the AI prompt picks it up automatically.
- The AI cannot change links, images or videos. AI-written products/testimonials are flagged as samples (publish confirmation).

## Design notes
- **One renderer.** `render.js` runs on the server and in the editor, so preview = published page. One stylesheet (`page.css`).
- **Edit key.** Creating a page returns a secret edit token (kept in this browser's localStorage and passed once in the URL fragment). Open `/edit/<id>#t=<token>` to edit from another device. There are no user accounts, so add auth before multi-user use.
- **Security.** All text is escaped; URLs are allow-listed (http/https/mailto/tel); uploads are verified by file signature (no SVG); published pages ship with a strict CSP; the contact form has a honeypot and rate limit; generation is rate limited (10/hour/IP).
- **Sample content.** AI testimonials and product prices are placeholders; those sections show a banner and Publish asks for confirmation until you mark them replaced.
- **Storage.** JSON files in `data/` (pages, uploads, leads). Fine for a prototype; swap `lib/store.js` for a database to scale.
