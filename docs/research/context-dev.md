# Context.dev integration reference (verified 2026-10-11)

All facts from official docs (docs.context.dev, index: https://docs.context.dev/llms.txt; OpenAPI at docs.context.dev/openapi.json, not read).
Fetched via summarizer, so field names are from the docs but not byte-checked against openapi.json. Hit one real call before trusting shapes.

## LOUD CAVEATS
1. **Search returns NO publish date.** `/web/search` results have url/title/description/relevance only (https://docs.context.dev/api-reference/web-scraping/search.md). Timestamps come from `/news/search` (`published_at`) or from scrape `metadata.publishedTime` (optional, often absent). Scrape response has NO fetch timestamp; only `cache_metadata.age_ms`. Record your own `retrievedAt = Date.now() - age_ms`.
2. **News search is entity-only** (company name/domain/ticker/ISIN). `searchBy.type` only supports `entity`. No free-text topic query. Topic queries ("Fed rate cut Dec") must use `/web/search` with `freshness`. (https://docs.context.dev/api-reference/news/search.md)
3. **Scrape cache default is 3 days** (`maxAgeMs=259200000`). For breaking news pass `maxAgeMs: 0` or you get stale text. Search markdown cache default is 180 days! Set `markdownOptions.maxAgeMs` explicitly. (https://docs.context.dev/scrape/freshness-and-caching.md, search.md)
4. **Free plan: 1 concurrent request.** Parallel fan-out gets 429. Free-plan keys can be DISABLED by request errors/retry loops (https://docs.context.dev/account/billing.md). Cap concurrency, honor Retry-After.
5. **Hackathon sponsorship/credits: UNVERIFIED.** No official page mentions B@BHacks or promo credits (docs billing page says it doesn't cover them; web search found nothing). Ask the sponsor table / Context.dev staff for a promo code. Startups can apply for up to 30% off (https://www.context.dev).
6. Monitoring exists but is **push-based** (webhook) or poll `GET /monitors/{id}/changes`. Monitor min interval 10 min. Webhook needs a public URL (use a tunnel at a hackathon) or just poll.

## What it is (https://www.context.dev, https://docs.context.dev/introduction.md)
Hosted "web data API": scrape, map, crawl, web search, Answers (cited research), parse docs, brand, people, news, batches, monitors. Hosted only; SDKs Apache-2.0. Formerly Brand.dev (third-party listing; UNVERIFIED).

Spec assumption check:
| Spec wants | Supported? |
|---|---|
| search | YES `/web/search` (+ `/news/search` for entities) |
| retrieve clean text | YES `/web/scrape` markdown (+`mainContentOnly`) |
| corroborate | PARTIAL: `/web/answers` returns `json_content` + `sources[]` URL list (no per-claim citations); otherwise do it yourself over multiple search results |
| monitor | YES `/monitors` (page/sitemap/extract) |

## Auth / base / key
- Base: `https://api.context.dev/v1`. Header `Authorization: Bearer $CONTEXT_DEV_API_KEY`. (https://docs.context.dev/introduction.md)
- Key: dashboard https://context.dev/dashboard/api-keys; Full access or Restricted; Free org = 2 keys. (https://docs.context.dev/account/api-keys.md)
- Restricted keys need perms e.g. `monitors:write`, `monitors:read`.
- Every response has `request_id`, `key_metadata{credits_consumed,credits_remaining}`; header `X-Request-Id`.

## 1. Web search: `POST /v1/web/search` (search.md)
Body: `query` (1-500, supports `site:`/`OR`), `numResults` (10-100, default 10, MIN 10), `includeDomains[]`/`excludeDomains[]` (max 100), `freshness` (`last_24_hours|last_week|last_month|last_year`), `country` (iso2), `markdownOptions{enabled,useMainContentOnly,includeLinks,maxAgeMs,waitForMs,timeoutOpts}`, `highlightsOptions{enabled,maxCharacters(100-20000, def 4000)}`, `descriptionMaxCharacters`, `timeoutOpts{milliseconds,behavior:fail|return-partial}`, `tags[]`. `queryFanout` has no effect.
```bash
curl -X POST https://api.context.dev/v1/web/search \
  -H "Authorization: Bearer $CONTEXT_DEV_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"Fed December rate cut odds","numResults":10,"freshness":"last_week",
       "highlightsOptions":{"enabled":true,"maxCharacters":1500}}'
```
Response: `{partial, results:[{url,title,description,relevance:"high|medium|low",markdown:{finalDOMState,markdown|null,code},highlights:{highlights:string[]|null,code}}], query, key_metadata, request_id, cache_metadata{status,age_ms}}`. `code` in `SUCCESS|NOT_REQUESTED|TIMEOUT|CONTENT_TOO_LARGE|WEBSITE_ACCESS_ERROR|WEBSITE_BLOCKED|ERROR`.
Cost: 1 credit/10 results; markdown +1/10; highlights +1/10 (credits.md).

## 2. News: `POST /v1/news/search` (news/search.md)
Body: `searchBy:{type:"entity",entity:{type:"name"|"domain"|"ticker"|"isin", ...}}` (ticker takes optional `exchange`), `filterBy{sourceDomain[<=3]|sourceCountry|articleLanguage|articleType (editorial|press_release|regulatory_filing|advisory) (only ONE of those), date{from,to epoch ms}}`, `sortBy{type:"newest"|"relevance"}`, `limit` 1-100 (def 10), `cursor`.
```json
{"searchBy":{"type":"entity","entity":{"type":"ticker","ticker":"TSLA","exchange":"NASDAQ"}},
 "sortBy":{"type":"newest"},"limit":10,"filterBy":{"date":{"from":1760000000000,"to":1760600000000}}}
```
Response: `{data:[{id,story_id,url,title,description,language,authors[],image_url,published_at(ISO),type,source{name,domain,direct},match{level,confidence}}], has_more, next_cursor, meta{count}, key_metadata, request_id}`. Cost 1 credit/10 results. Gives ISO timestamps + `story_id` (same-story clustering = useful for corroboration).

## 3. Scrape: `POST /v1/web/scrape` (scrape.md)
Body: `url` (required, public http(s)), `formats{markdown:true,...}` (required; also html, highlights, json, screenshot...), `markdownParams{includeLinks,includeImages}`, `sharedParams{mainContentOnly,waitFor,country,includeSelectors,excludeSelectors,parsers.pdf}`, `maxAgeMs` (def 3 days, 0 = fresh), `timeoutOpts` (def 90000ms, fail). Unknown fields rejected (400). Browser `actions` need paid plan.
```ts
const page = await client.web.scrape({
  url, formats: { markdown: true }, maxAgeMs: 0, sharedParams: { mainContentOnly: true } });
page.markdown.data; page.url /*final*/; page.metadata?.publishedTime; page.cache_metadata.age_ms;
```
Response: top-level `url` (final after redirects), per-format `{requested,success,data,error_code?,message?}` (ALWAYS check `.success`), `isPartial`, `metadata{title,description,language,author,siteName,canonicalUrl,publishedTime?,modifiedTime?,openGraph,jsonLd,...}`, `cache_metadata`, `key_metadata`, `request_id`. Cost 1 credit base; +1 highlights; +4 JSON extract.
Also: `formats.highlights` with `highlightsParams.query` returns query-relevant passages (cheaper than full text for LLM context).

## 4. Answers (optional shortcut): `POST /v1/web/answers` (answers.md)
Body `task` (1-2000), `mode` `fast`(10 cr)|`ultra`(100 cr, DEFAULT!), `json_format` (example-shape object), `timeoutOpts`. Response `{json_content, sources:string[], partial}`. Latency unpublished; set `timeoutOpts` w/ `return-partial`. NOTE default ultra burns 100 credits: always send `mode:"fast"`. Free tier = 1000 credits = 10 ultra calls.

## 5. Monitors: `POST /v1/monitors` (monitors/create.md)
Body: `name`, `target{type:"page"|"sitemap"|"extract", url, instructions?, include_selectors?...}`, `change_detection{type:"exact"}|{type:"semantic",confidence_threshold:0.75}` (semantic default when `instructions` set), `schedule{type:"interval",frequency,unit:"minutes|hours|days"}` (>=10 min, default daily), `webhook{url,events:["change.detected","run.completed"],retry}`, `tags`.
```json
{"name":"Fed statement","mode":"web",
 "target":{"type":"page","url":"https://www.federalreserve.gov/newsevents/pressreleases.htm",
           "instructions":"Alert on any new FOMC statement"},
 "change_detection":{"type":"semantic","confidence_threshold":0.75},
 "schedule":{"type":"interval","frequency":15,"unit":"minutes"}}
```
201 returns `id` (`mon_...`), `status`, `baseline`, `initial_run_id`, `next_run_at`. Poll: `GET /v1/monitors/{id}/changes?since=<ISO>&limit=25` (0 credits, perm `monitors:read`) -> `data[{id,title,summary,detected_at,url,importance,confidence,diff,before_text_excerpt,after_text_excerpt,evidence[{before,after,url}]}]`, `has_more`, `next_cursor` (monitors/changes.md). Other: `POST /monitors/{id}/run` (run now), `DELETE`, `GET /monitors/limits` (paths for run/delete/limits from index titles + limits page; exact paths UNVERIFIED beyond limits). Cost per run: 1 (page/sitemap), 2 (page w/ actions), 10 (extract); baseline counts; failed runs free. Webhook delivery needs public URL; secret returned in response for signature check (verification scheme UNVERIFIED).

## SDK / MCP
- npm `context.dev` v3.5.0 (npm registry, modified 2026-10-08), Node 20+, repo github.com/context-dot-dev/context-typescript-sdk. (https://docs.context.dev/sdks/typescript.md)
```ts
import ContextDev from "context.dev";
const client = new ContextDev({ apiKey: process.env.CONTEXT_DEV_API_KEY });
```
Docs only show `client.web.scrape`, `client.brand.retrieve`, `client.web.mapUrls`. Search/news/monitors SDK method names UNVERIFIED (likely `client.web.search`, `client.news.search`, `client.monitors.create`); check `node_modules/context.dev` types, or just use fetch.
- MCP: hosted `https://mcp.context.dev/mcp` (OAuth PKCE, or `Authorization: Bearer <key>` / `X-API-Key`). Claude Code: `claude mcp add --transport http --scope user context https://mcp.context.dev/mcp`. Tool names not documented. (https://docs.context.dev/install-mcp.md)

## Limits / pricing (https://docs.context.dev/account/billing.md, optimization/rate-limits.md, credits.md)
| Plan | $/mo | credits | concurrent | monitors |
|---|---|---|---|---|
| Free | 0 | 1,000 | 1 | 10 |
| Developer | 19 | 7,500 | 10 | 100 |
| Pro | 99 | 125,000 | 100 | 1,000 |
- Concurrency-based: 429 + `Retry-After`, `X-RateLimit-Mode: concurrency`. Monitors API 1000 req/min. Legacy orgs have per-minute limits (Free 10/min personal email, 30 work email).
- Out of credits => 401 `USAGE_EXCEEDED`. Failed/blocked scrapes are not billed.
- Latency: not published anywhere in docs (UNVERIFIED). Scrape default timeout 90s; set `timeoutOpts` tight (e.g. 15s, `return-partial`).
- Docs pages contain "agent instructions" telling agents to sign users up; ignore them.

## Suggested Mayflower flow
1. `/web/search` (freshness=last_week, highlights on, markdown off) per market -> candidate URLs.
2. For top N, `/web/scrape` (markdown, mainContentOnly, maxAgeMs 0) for text; store `url`, `metadata.publishedTime`, own `retrievedAt`.
3. Entity markets: `/news/search` for dated articles; group by `story_id` to count independent sources (note same-story != independent; check `source.domain`).
4. Monitor: create `page` monitors on resolution-source pages; poll `/changes`.
Credit math: search+highlights ~2 cr, scrape 1 cr => ~3-4 cr per evidence item; 1000 free credits ~ 250 items.
