# Recipeboy

A tiny shared recipe box for friends. Paste a recipe URL or unstructured recipe text; Recipeboy stores a normalized version with ingredients, steps, timing, yield, source, a copyable shopping list, a permalink, meal photos, ratings, and separate per-person “I cooked this” and “I ate this” records. Friends can review and upload meal photos as either a cook or a taster. Eating never increments the cook count or cooking leaderboard. Recipe cards distinguish who added a recipe from the friends who cooked it, and the stats page celebrates the top contributors, cooks, and reviewers.

The compact Add recipe button lives over the hero sun, opens the importer in a modal, and moves into the persistent navigation bar after it scrolls out of reach. The same button element is reparented between two slots so there is never a duplicate action or conflicting focus target. Closing the modal preserves an unsaved draft; successful imports clear it and open the saved recipe. Signed-out visitors can browse, and Add recipe starts sign-in before opening the form.

Reviews require an explicit cooked/ate choice in the current UI. The Worker records that choice and its participation record atomically. Repeated actions or review edits do not double-count people. Historical reviews are left unclassified and all previous cook counts are preserved. Apply `worker/migrations/0007_recipe_eats.sql` once to an existing database before deploying this version. The Feed includes eating as a distinct activity.

### Metadata cleanup

`0008_recipe_metadata_cleanup.sql` is a guarded, repeat-safe repair of the existing recipe box, including the requested halal-cart legacy-count correction. Unknown yields are now blank instead of zero; plain numeric yields display as servings. Numeric-string durations are accepted on import. Existing recipe content and social records are preserved.

Missing metadata was reviewed against the saved ingredients/method and, for Arroz Caldo, its [linked Panlasang Pinoy recipe](https://panlasangpinoy.com/chicken-arroz-caldo-recipe-glutinous-rice-porridge/). `metadataEstimates` lists approximate fields, displayed with **≈**, rather than presenting inferred values as source facts. Salpicowww's 500 g beef suggests about four servings; Shepherd’s Pie's 1 lb meat and 3 cups mash suggests four to six. Timing estimates cover preparation and the stated cooking stages: salmon about 30 minutes; Shepherd’s Pie about 60; Arroz Caldo about 70 (its source describes a 35–50 minute simmer but gives no total); pumpkin pie about 5½ hours including roasting, chilling, draining, and cooling. The quantity-free salmon note intentionally has no serving count. Unchanged metadata retains its original values. Editing an estimated field clears only that field's estimate marker.

The recipe box is shared by signed-in friends. Clerk handles browser sign-in and the Worker verifies every session JWT before allowing recipe reads or writes. Mutation endpoints are also rate-limited, oversized requests and recipe pages are rejected, redirects are revalidated before fetching, and deleted recipes are soft-deleted so the UI can offer Undo. All recipe content is escaped before browser rendering and is never executed as code.

The static frontend is hosted by GitHub Pages at [recipeboy.bensonperry.com](https://recipeboy.bensonperry.com/). A small Cloudflare Worker uses D1 for shared recipe data, R2 for compressed cooking photos, and extracts schema.org Recipe data from pasted links.

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

Local browser testing can use `?auth=dev` with the Worker started using `--var RECIPEBOY_AUTH_DISABLED:1`. That bypass is accepted only by the local Worker process; production defaults to rejecting requests unless a Clerk JWT verifies successfully.

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

Photo uploads use the `recipeboy-photos` R2 bucket bound as `PHOTOS` in `worker/wrangler.toml`. The browser downsizes uploads before sending them; the Worker accepts JPEG, PNG, and WebP files up to 8 MB and caps each recipe at 12 photos.

Recipeboy has its own Clerk application and production instance on `recipeboy.bensonperry.com`, so Recipeboy accounts are separate from Biblioplex accounts. The Worker needs Clerk's PEM public verification key as `CLERK_JWT_KEY`; it is public key material but is stored as a Worker secret. `CLERK_ISSUER` and `CLERK_AUTHORIZED_PARTIES` live in `worker/wrangler.toml`.
