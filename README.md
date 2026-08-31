# Recipeboy

A tiny, no-login recipe box for friends. Paste a recipe URL or unstructured recipe text; Recipeboy stores a normalized version with ingredients, steps, timing, yield, source, a copyable shopping list, and a shared “I made this” count.

The public API is intentionally anonymous, but mutation endpoints are rate-limited for ordinary human use, oversized requests and recipe pages are rejected, redirects are revalidated before fetching, and deleted recipes are soft-deleted so the UI can offer Undo. All recipe content is escaped before browser rendering and is never executed as code.

The static frontend is hosted by GitHub Pages at [bensonperry.com/recipeboy](https://bensonperry.com/recipeboy/). A small Cloudflare Worker uses D1 for shared storage and extracts schema.org Recipe data from pasted links.

Recipeboy first reads standard schema.org `Recipe` data, which is published by most dedicated recipe sites. If a site blocks the direct importer, the Worker retries through Jina Reader and normalizes its recipe markdown. Cooking articles that link to a same-site recipe are followed automatically.

Pasted recipe text—including text sent by the bookmarklet—is cleaned by the low-cost OpenAI model through a strict recipe schema. The model is told to preserve only facts in the paste, omit equipment and unrelated commentary, and treat section labels as organization rather than titles or numbered steps. If the API is unavailable or rejects the input, Recipeboy automatically falls back to its deterministic plaintext parser.

Reddit links use OpenAI web search as a paid fallback because Reddit blocks anonymous server readers. The search result is constrained to Reddit and returned through a strict recipe schema before Recipeboy normalizes and stores it. Configure the API key as an encrypted Worker secret:

```sh
npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.toml
```

The default model is `gpt-5.4-nano`; override it with the `OPENAI_RECIPE_MODEL` Worker variable if needed. Plaintext cleanup uses model tokens only; Reddit imports also add the web-search tool fee. Occasional friend-group imports should cost only a small amount. Add prepaid credit and set a low project budget in the OpenAI Platform billing dashboard.

Reddit OAuth importing is also implemented, but it requires a Reddit-approved legacy Data API client. If Reddit approves this use case in the future, configure the issued client as Worker secrets:

```sh
npx wrangler secret put REDDIT_CLIENT_ID --config worker/wrangler.toml
npx wrangler secret put REDDIT_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler secret put REDDIT_USER_AGENT --config worker/wrangler.toml
```

Use a descriptive user agent such as `web:recipeboy:v1.0.0 (by /u/your_username)`. The credentials never reach the browser or the recipe database.

The optional “Save to Recipeboy” bookmarklet avoids API cost entirely. It captures selected or visible recipe text in the current browser tab, opens Recipeboy, and submits the text with the original source URL. The captured text travels in the new tab's URL fragment, which is not sent to GitHub Pages.

## Local development

```sh
npm install
npm run dev
```

Run `npm run dev:api` separately for the Worker. The production frontend points to the deployed Worker.

The mascot source was generated with ImageGen and deterministically quantized and traced to a five-color SVG:

```sh
python -m pip install -r requirements-dev.txt
python scripts/vectorize-mascot.py
```

## Deploy the API

```sh
npx wrangler d1 execute recipeboy-db --remote --file worker/schema.sql
npm run deploy:api
```

Existing databases should apply each file in `worker/migrations` once before deploying the corresponding Worker version.
