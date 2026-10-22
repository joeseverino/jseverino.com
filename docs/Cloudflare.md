# Cloudflare

The site runs on Cloudflare: one Worker with static assets, built by Astro's
Cloudflare adapter, one D1 database, Turnstile, and the zone in front of it. The
repo holds the Worker's config ([`wrangler.jsonc`](../wrangler.jsonc)) and a
desired-state file for the zone and account.
[`bin/cloudflare.ts`](../bin/cloudflare.ts) checks the live state against it and
applies the difference.

## What runs where

| Layer | Lives in | Applied by |
|---|---|---|
| Response headers, cache rules | [`public/_headers`](../public/_headers) | every deploy |
| Redirects | [`public/_redirects`](../public/_redirects) | every deploy |
| Which requests start the Worker, 404 and trailing-slash handling, D1 binding, compatibility date | [`wrangler.jsonc`](../wrangler.jsonc) | every deploy |
| Contact form, CSP reports | [`src/pages/api/`](../src/pages/api/), handlers in [`src/lib/api/`](../src/lib/api/) | every deploy |
| Preview proxy | [`src/integrations/sitedrift-route.ts`](../src/integrations/sitedrift-route.ts) | every deploy |
| Zone settings, HSTS, DNSSEC, bot management, WAF custom rules, rate limit | [`cloudflare/zone.json`](../cloudflare/zone.json) | `mise run cloudflare apply` |
| API Shield, Turnstile hostnames | [`cloudflare/zone.json`](../cloudflare/zone.json) | `mise run cloudflare apply` |
| Preview Access application and its Service Auth policies | dashboard (checked by `cloudflare check`, never applied) | [Preview access](#preview-access) |
| The Worker's secret, its custom domain, Web Analytics mode, the D1 database | dashboard or wrangler | by hand ([Standing up the Worker](#standing-up-the-worker)) |

[`cloudflare/zone.json`](../cloudflare/zone.json) is validated by
[`cloudflare/zone.schema.json`](../cloudflare/zone.schema.json), whose
descriptions say why each value is what it is. It holds no account or zone ID:
the tool looks both up from the zone name at runtime.

### Worker routing

Every page is prerendered and served as a static asset without starting the
Worker. `run_worker_first` in [`wrangler.jsonc`](../wrangler.jsonc) sends only
`/api/*` and `/__sitedrift/*` to it, the routes that set `prerender = false`.
`not_found_handling: "404-page"` answers a miss anywhere with the root
`404.html`, which carries the same policy as every page, and
`html_handling: "auto-trailing-slash"` redirects `/about` to `/about/` with a
307. Static asset requests are not billed as Worker requests.

The adapter writes the static site to `dist/client/` and the Worker with its
deploy config to `dist/server/` (`wrangler.json`, which `wrangler deploy`
reads). [`bin/build-csp.ts`](../bin/build-csp.ts) writes the
Content-Security-Policy into `dist/client/_headers` at build time, so it does not
depend on the Worker. The assets layer applies `_headers` to static assets only,
so [`src/middleware.ts`](../src/middleware.ts) gives every response the Worker
renders the `/*` rule's security headers, with a policy that has no hashes.

[`check-headers.ts`](../tests/audits/check-headers.ts) fails the publish gate if
the built `_headers` has a leftover placeholder, lists a path twice, lacks a
`Content-Security-Policy` on `/*`, or lacks the detach-plus-set override on
`/contact/*`. The edge suite proves the routing and the headers under
`astro preview`, which serves the build in the local Workers runtime.

## Platform limits

| Feature | Limit | Used |
|---|---|---|
| WAF custom rules | 5, no regex | 2 here, 2 made in the dashboard; one stays free for an incident |
| Rate-limiting rules | 1; path and verified-bot fields; per IP; 10 s period; 10 s block | 1: `/api/*`, 15 requests per 10 s |
| API Shield schema validation | Block is the only action | Block on `POST /api/contact` |
| Workers Rate Limiting binding | available to the Worker | not used yet: the contact and report handlers count in D1 |

Zone controls (WAF, rate limit, HSTS, API Shield) apply only to hostnames in the
zone, and workers.dev is outside it. The Worker therefore has no workers.dev
production alias (`workers_dev: false` in [`wrangler.jsonc`](../wrangler.jsonc)),
and its preview URLs sit behind Access.

## Preview access

Every uploaded version and every pull request's alias gets a preview URL of
the form `<version or alias>-jseverino.severino.workers.dev`
(`PREVIEW_HOST_SUFFIX` in
[`src/lib/site-config.ts`](../src/lib/site-config.ts)). One self-hosted Access
application on `*-jseverino.severino.workers.dev` covers them all, and they are
reachable only with a service token. The application holds Service Auth policies alone (decision `non_identity`, include
rules that name service tokens), with two tokens:

- **CI.** The `deploy` workflow's `preview` and `production` jobs send
  `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` to the version they
  verify. [`bin/lib/access.ts`](../bin/lib/access.ts) attaches them only to
  `https` hosts of one label plus `PREVIEW_HOST_SUFFIX`.
- **The tailnet proxy.** A reverse proxy reachable only on the tailnet holds
  the second token and is how a person opens a preview. It lives outside this
  repo.

`zone.json` declares `preview.accessPolicy: "service-auth-only"`. `cloudflare check`
finds the application by that wildcard and reports a missing application, or
any other policy on it (an email, a group, everyone, or no policy), as a manual
item and exits 1. Apply never edits Access: fix it in Zero
Trust → Access → Applications. Create and rotate each token under Zero Trust →
Access → Service credentials. A rotated CI token goes into the repository
secrets, and the proxy's into the proxy's own configuration.

## WAF rules

Rules live in `zone.json`, each with a ref `jseverino-com-<id>`. Apply creates,
updates, or deletes only rules carrying that prefix; a rule added by hand in
the dashboard during an incident is never touched.

| Rule | Blocks |
|---|---|
| `api-request` | anything but `POST` under `/api/`; `/api/contact` without `application/json`; `/api/csp-report` without `application/csp-report`, `application/reports+json`, or `application/json` (a `; charset` suffix is fine) |
| `sitedrift-production` | `/__sitedrift*` on `jseverino.com` and `www.jseverino.com` (the route already 404s there; this stops it at the edge) |

At most five custom rules, dashboard rules included. `cloudflare check` reports the total as `rule budget`.

## Features that stay off

Each of these injects into or rewrites HTML after the build, adding markup the
build-time CSP hashes do not cover:

- **Rocket Loader** rewrites every script tag and loads them through its own
  script.
- **Email Obfuscation** injects a decoder script.
- **Server-Side Excludes** and **Automatic HTTPS Rewrites** rewrite HTML. Every
  URL the site emits is already `https`.
- **Cloudflare Fonts** rewrites font links. The site self-hosts its one font.
- **Zaraz** injects scripts.
- **Hotlink Protection** is redundant with `Cross-Origin-Resource-Policy`.

Speed Brain stays on. It prefetches likely next pages through a
`speculation-rules` response header, which adds no markup.

HTML is cacheable: it is static and the policy is the same on every request.

`browser_cache_ttl` is `0` (respect existing headers). Any other value overrides
shorter origin TTLs, such as the 1 hour `_headers` sets for `/favicon.ico` and
`/assets/icons/*`.

## Bot management

`botManagement` in `zone.json` declares the zone's `bot_management` settings.
`enable_js` is `false`: JavaScript Detections inject an inline script with
per-request values into HTML, and a static hash CSP cannot cover it. Turning Bot
Fight Mode off in the dashboard leaves JavaScript Detections on; only
`enable_js: false` turns them off, so the setting is declared. `fight_mode` is
`false` because Bot Fight Mode challenges datacenter IPs. CI's deploy
verification also targets each version's own preview URL on workers.dev,
outside the zone. Neither setting can skip paths.

`ai_training`, `ai_search`, and `ai_user` are the three AI crawler policies on
the Security → Bots page. The endpoint accepts only a PUT and resets every field
the PUT leaves out. Apply therefore sends the declared fields over the live
values of `ai_bots_protection`, `content_bots_protection`, and
`crawler_protection`, so dashboard changes to those three survive an apply.

## Turnstile

The contact handler ([`src/lib/api/contact.ts`](../src/lib/api/contact.ts))
accepts a token only when siteverify reports `success`, the hostname
`jseverino.com` (`SITE.domain`), and the action `contact` (the contract's
`turnstileAction`, sent by the widget as `data-action`). The widget's allowed
hostnames are `turnstile.domains` in `zone.json`, set by apply, and name the
same host. A token solved anywhere else, a preview deployment included, fails
verification.

## Web Analytics

By default the zone injects the beacon, which the CSP allows by host
(`static.cloudflareinsights.com` in `script-src`, `cloudflareinsights.com` in
`connect-src`). To own the markup instead, set `WEB_ANALYTICS` in
[`src/lib/site-config.ts`](../src/lib/site-config.ts) to
`{ emitBeacon: true, token: '<site token>' }` and, in the same release, switch
the Web Analytics site to **Enable with JS Snippet installation** so the zone
stops injecting. The token is public; it ships in every page either way.

## Running check, plan, and apply

The token comes from `CLOUDFLARE_API_TOKEN` only, and the tool never prints it.
Keep the tokens in 1Password and pass them per command:

```sh
CLOUDFLARE_API_TOKEN="op://<vault>/<read token item>/credential" op run -- mise run cloudflare check
CLOUDFLARE_API_TOKEN="op://<vault>/<read token item>/credential" op run -- mise run cloudflare plan
CLOUDFLARE_API_TOKEN="op://<vault>/<edit token item>/credential" op run -- mise run cloudflare apply --yes
```

`check` prints a table (`--json` for JSON) and exits 1 on drift. `plan`
lists the calls an apply would make. `apply` without `--yes` is the plan; with
it, apply makes the calls, re-checks, and exits 1 if anything is left, which
includes items only a person can fix.

Scope both tokens to the one zone and the one account.

| Resource | Permission | check / plan | apply |
|---|---|---|---|
| Zone | Zone | Read | Read |
| Zone | Zone Settings | Read | Edit |
| Zone | DNS (DNSSEC) | Read | Edit |
| Zone | Zone WAF (custom rules, rate limit) | Read | Edit |
| Zone | API Gateway (schema validation) | Read | Edit |
| Zone | Bot Management | Read | Edit |
| Account | Access: Apps and Policies | Read | Read |
| Account | Turnstile | Read | Edit |

Unit tests drive all three commands against an in-memory API
([`tests/unit/cloudflare.test.ts`](../tests/unit/cloudflare.test.ts)).

## After an apply

```sh
curl -sI https://<alias>-jseverino.severino.workers.dev/   # 302 to the Access login
curl -s -o /dev/null -w '%{http_code}\n' https://jseverino.com/api/contact          # 403 (GET)
curl -s -o /dev/null -w '%{http_code}\n' https://jseverino.com/.env                 # 403
curl -sI https://jseverino.com/assets/icons/favicon.svg | grep -i cache-control      # max-age=3600
mise run deploy:verify
```

Then run `mise run cloudflare check` until it exits 0.

The repository's own settings follow the same check, plan, and apply pattern in
[GitHub Settings](./GitHub-Settings.md).

## Standing up the Worker

CI deploys every version after the first. These steps run once, by hand, for a
new account or a fresh instance of the site.

### The deploy credentials

The `deploy` workflow reads `CLOUDFLARE_API_TOKEN` from the `production`
environment's secrets and `CLOUDFLARE_ACCOUNT_ID` from the repository variables.
Scope the token to this account: Workers Scripts edit, plus D1 read so wrangler
can resolve the database by name. `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` hold the CI service token ([Preview access](#preview-access)).

### The first deploy

`wrangler versions upload` needs a Worker that exists, and wrangler refuses to
create one whose `secrets.required` are unset, while `wrangler secret put`
cannot set a secret on a Worker that does not exist yet. The first deploy
therefore carries the secret itself:

```sh
mise run build
TURNSTILE_SECRET_KEY="op://<vault>/<turnstile item>/credential" op run -- sh -c 'printf "TURNSTILE_SECRET_KEY=%s\n" "$TURNSTILE_SECRET_KEY" | npx wrangler deploy --config dist/server/wrangler.json --secrets-file /dev/stdin'
```

Later versions inherit the secret. Rotate it with
`npx wrangler secret put TURNSTILE_SECRET_KEY --name jseverino`, which deploys a
new version carrying it.

### The preview Access application

Before CI's first preview, add the self-hosted Access application on
`*-jseverino.severino.workers.dev` with a Service Auth policy for each token
([Preview access](#preview-access)), then run `mise run cloudflare check` until
its `preview` row is `ok`.

### Moving the domain from Pages

A Worker custom domain cannot be attached while the hostname has another DNS
record, so the move from a Cloudflare Pages project takes three steps, in order:

1. Delete the `jseverino.com` DNS record that points at the Pages project
   (DNS → Records).
2. Attach `jseverino.com` to the `jseverino` Worker as a custom domain (Workers
   & Pages → `jseverino` → Settings → Domains & Routes → Add → Custom domain).
3. Run `mise run deploy:verify` against production.

Once production verifies on the Worker, delete what Pages left behind: the
Pages project itself, the Access application that guarded its previews, and the
`jseverino_pages_dev` Bulk Redirect list and the rule that used it. `mise run
cloudflare check` passing afterwards confirms nothing it manages depended on
them.

## `wrangler.jsonc`

[`wrangler.jsonc`](../wrangler.jsonc) is the source of truth for the Worker: its
name, compatibility date, bindings, asset handling and observability. Astro's
adapter adds `main` and the assets directory at build time. The D1 binding
names the database (`jseverino-contact`, `SITE.d1`) and carries no
`database_id`: at deploy, wrangler looks the database up by name in the account
and binds it, so the public file holds no account resource ID. `mise run
checks:d1` holds the binding's name to `SITE.d1`. `TURNSTILE_SECRET_KEY` is
listed under `secrets.required`, so `wrangler types` declares it and the local
runtime warns when `.env` lacks it.

`wrangler types` writes [`src/generated/worker-configuration.d.ts`](../src/generated/worker-configuration.d.ts),
the `Env` interface and the Workers runtime types for that compatibility date.
[`tsconfig.worker.json`](../tsconfig.worker.json) compiles the on-demand routes
under them, apart from the Node and DOM program, and `mise run checks:types`
runs `wrangler types --check`, so the file follows every config or `workerd`
change.
