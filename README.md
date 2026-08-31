# Recipeboy

A tiny, no-login recipe box for friends. Paste a recipe URL or unstructured recipe text; Recipeboy stores a normalized version with ingredients, steps, timing, yield, source, a copyable shopping list, and a shared “I made this” count.

The static frontend is hosted by GitHub Pages at [bensonperry.com/recipeboy](https://bensonperry.com/recipeboy/). A small Cloudflare Worker uses D1 for shared storage and extracts schema.org Recipe data from pasted links.

Recipeboy first reads standard schema.org `Recipe` data, which is published by most dedicated recipe sites. If a site blocks the direct importer, the Worker retries through Jina Reader and normalizes its recipe markdown. Cooking articles that link to a same-site recipe are followed automatically.

Reddit OAuth importing is implemented, but it requires a Reddit-approved legacy Data API client. Reddit currently restricts new legacy clients to valid moderation use cases, so Recipeboy does not have credentials. If Reddit approves this use case in the future, configure the issued client as Worker secrets:

```sh
npx wrangler secret put REDDIT_CLIENT_ID --config worker/wrangler.toml
npx wrangler secret put REDDIT_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler secret put REDDIT_USER_AGENT --config worker/wrangler.toml
```

Use a descriptive user agent such as `web:recipeboy:v1.0.0 (by /u/your_username)`. The credentials never reach the browser or the recipe database.

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
