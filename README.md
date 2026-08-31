# Recipeboy

A tiny, no-login recipe box for friends. Paste a recipe URL or unstructured recipe text; Recipeboy stores a normalized version with ingredients, steps, timing, yield, source, a copyable shopping list, and a shared “I made this” count.

The static frontend is hosted by GitHub Pages at [bensonperry.com/recipeboy](https://bensonperry.com/recipeboy/). A small Cloudflare Worker uses D1 for shared storage and extracts schema.org Recipe data from pasted links.

If a recipe site blocks the direct importer, the Worker retries through Jina Reader and normalizes its recipe markdown.

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
