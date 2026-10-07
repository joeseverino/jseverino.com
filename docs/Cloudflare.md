# Cloudflare

The site runs on Cloudflare's free plan: Pages for the static build and the
Functions, one D1 database, Turnstile, and the zone in front of it. Everything
that can be code is code. The repo holds the Pages configuration files and a
desired-state file for the zone and account, and
[`bin/cloudflare.ts`](../bin/cloudflare.ts) checks the live state against it
and applies the difference.

## What runs where

| Layer | Lives in | Applied by |
|---|---|---|
| Response headers, cache rules | [`public/_headers`](../public/_headers) | every Pages deploy |
| Redirects | [`public/_redirects`](../public/_redirects) | every Pages deploy |
| Which requests run Functions | [`public/_routes.json`](../public/_routes.json) | every Pages deploy |
| Contact form, CSP reports, preview proxy | [`functions/`](../functions/) | every Pages deploy |
| Zone settings, HSTS, DNSSEC, bot management, WAF custom rules, rate limit | [`cloudflare/zone.json`](../cloudflare/zone.json) | `npm run cloudflare:apply` |
| `jseverino.pages.dev` redirect, Pages compatibility date, API Shield, Turnstile hostnames | [`cloudflare/zone.json`](../cloudflare/zone.json) | `npm run cloudflare:apply` |
| Preview Access application and its Service Auth policies | dashboard (checked by `cloudflare:check`, never applied) | Pages project → Settings → General → Enable access policy, then [Preview access](#preview-access) |
| Web Analytics mode, Pages bindings and secrets, D1 | dashboard | by hand |

[`cloudflare/zone.json`](../cloudflare/zone.json) is validated by
[`cloudflare/zone.schema.json`](../cloudflare/zone.schema.json), whose
descriptions say why each value is what it is. It holds no account or zone ID:
the tool looks both up from the zone name at runtime.

### Functions routing

Every HTML page is a plain static asset, served without invoking a Function.
[`_routes.json`](../public/_routes.json) includes only `/api/*` and
`/__sitedrift/*`, with an empty exclude list. A miss anywhere gets the root
`404.html`, which carries the same policy as every page. The free plan allows
100,000 Function requests a day, and page views no longer count against it: the
quota covers only the contact form, CSP reports, and the preview proxy.

The Content-Security-Policy is built into `dist/_headers` at build time by
[`bin/build-csp.ts`](../bin/build-csp.ts), so it does not depend on a Function
running. Pages applies `_headers` to static assets only, not to Function
responses, which set their own headers.

[`check-routes.ts`](../tests/audits/check-routes.ts) fails the publish gate if a
Function route does not invoke Functions, if a built HTML page does, if an
include rule matches no Function route, or if the built `_headers` has a leftover
placeholder, lists a path twice, lacks a `Content-Security-Policy` on `/*`, or
lacks the detach-plus-set override on `/contact/*`. The edge suite proves the
routing and the headers under `wrangler pages dev`.

## Free-plan limits that shaped this

| Feature | Free limit | Used |
|---|---|---|
| WAF custom rules | 5, no regex | 4; one stays free for an incident |
| Rate-limiting rules | 1; path and verified-bot fields; per IP; 10 s period; 10 s block | 1: `/api/*`, 15 requests per 10 s |
| Bulk Redirects | 15 rules | 1: `jseverino.pages.dev` → `https://jseverino.com` |
| API Shield schema validation | Block is the only action | Block on `POST /api/contact` |
| Workers Rate Limiting binding | not available to Pages Functions | the contact and report handlers count in D1 instead |
| `wrangler.toml` for Pages | compatibility date and flags, D1, vars, per-environment; no rate limiting | not used (below) |
| Early Hints | always on for Pages, but Function-handled HTML gets no `Link` header | nothing to configure |

Zone controls (WAF, rate limit, HSTS, API Shield) apply only to hostnames in
the zone. `*.pages.dev` is outside it, which is why the production alias
`jseverino.pages.dev` is closed with a Bulk Redirect and preview deployments
sit behind Access instead. The redirect matches the bare alias with subpath
matching and does not include subdomains, so `<hash>.jseverino.pages.dev`
previews keep working.

## Preview access

Previews are reachable only with a service token. The preview Access
application holds Service Auth policies alone (decision `non_identity`, include
rules that name service tokens), with two tokens:

- **CI.** The `deploy` workflow's `verify` job sends `CF_ACCESS_CLIENT_ID` and
  `CF_ACCESS_CLIENT_SECRET` (repository secrets) to the deployment it checks.
  [`bin/lib/access.ts`](../bin/lib/access.ts) attaches them only to the Pages
  project's host and its deployment subdomains.
- **The tailnet proxy.** A reverse proxy reachable only on the tailnet holds
  the second token and is how a person opens a preview. It lives outside this
  repo.

`zone.json` declares `pages.previewPolicy: "service-auth-only"`. `cloudflare:check`
reports any other policy on the application (an email, a group, everyone, or
no policy at all) as a manual item and exits 1. Apply never edits Access: the
fix is in Zero Trust → Access → Applications. Each token is created and
rotated under Zero Trust → Access → Service credentials; a rotated CI token goes into
the repository secrets, and the proxy's into the proxy's own configuration.

## WAF rules

Rules live in `zone.json`, each with a ref `jseverino-com-<id>`. Apply creates,
updates, or deletes only rules carrying that prefix; a rule added by hand in
the dashboard during an incident is never touched.

| Rule | Blocks |
|---|---|
| `api-method` | anything but `POST` under `/api/` |
| `api-content-type` | `/api/contact` without `application/json`; `/api/csp-report` without `application/csp-report`, `application/reports+json`, or `application/json` (a `; charset` suffix is fine) |
| `sitedrift-production` | `/__sitedrift*` on `jseverino.com` and `www.jseverino.com` (the Function already 404s there; this stops it at the edge) |
| `scanner-noise` | `*.php`, `/.env*`, `/.git*` |

## Features that stay off

Each of these injects into or rewrites HTML after the build, and so adds markup
the build-time CSP hashes do not cover:

- **Rocket Loader** rewrites every script tag and loads them through its own
  script.
- **Email Obfuscation** injects a decoder script.
- **Server-Side Excludes** and **Automatic HTTPS Rewrites** rewrite HTML. Every
  URL the site emits is already `https`.
- **Cloudflare Fonts** rewrites font links. The site self-hosts its one font.
- **Zaraz** injects scripts.
- **Hotlink Protection** is redundant with `Cross-Origin-Resource-Policy`.

Speed Brain stays on. It prefetches likely next pages through a
`speculation-rules` response header, which adds no markup, so the HTML served is
the HTML built.

No Cache Rule is a problem for CSP reasons: HTML is static and the policy is the
same on every request, so HTML is cacheable.

`browser_cache_ttl` is `0` (respect existing headers). Any other value
overrides shorter origin TTLs, which is how `/favicon.ico` and
`/assets/icons/*` were served with 4 hours instead of `_headers`' 1 hour.

## Bot management

`botManagement` in `zone.json` declares the zone's `bot_management` settings.
`enable_js` is `false`: JavaScript Detections inject an inline script with
per-request values into HTML, and a static hash CSP cannot cover that script.
On the free plan, turning Bot Fight Mode off in the dashboard does not turn
JavaScript Detections off; only `enable_js: false` does, which is why the
setting is declared rather than left to the dashboard. `fight_mode` is `false`
for the same reason, and because Bot Fight Mode challenges datacenter IPs, which
is why CI's deploy verification targets each deployment's own `*.pages.dev` URL,
outside the zone. Neither setting can skip paths on the free plan.

`ai_training`, `ai_search`, and `ai_user` are the three AI crawler policies on
the Security → Bots page. The endpoint accepts only a PUT and resets every field
a PUT leaves out, so apply sends the declared fields over the live values of
`ai_bots_protection`, `content_bots_protection`, and `crawler_protection`, and a
change made in the dashboard to those three survives an apply.

## Turnstile

The contact handler ([`functions/api/contact.ts`](../functions/api/contact.ts))
accepts a token only when siteverify reports `success`, the hostname
`jseverino.com` (`SITE.domain`), and the action `contact` (the contract's
`turnstileAction`, which the widget sends as `data-action`). The widget's
allowed hostnames are `turnstile.domains` in `zone.json`; apply sets them, and
they should name the same host. A token solved anywhere else, a preview
deployment included, fails verification.

## Web Analytics

By default the zone injects the beacon. `static.cloudflareinsights.com` is in
`script-src` and `cloudflareinsights.com` is in `connect-src`, so the beacon is
allowed by host. To own the
markup instead, set `WEB_ANALYTICS` in
[`src/lib/site-config.ts`](../src/lib/site-config.ts) to
`{ emitBeacon: true, token: '<site token>' }` and, in the same release, switch
the Web Analytics site to **Enable with JS Snippet installation** so the zone
stops injecting. The token is public; it ships in every page either way.

## Running check, plan, and apply

The token comes from `CLOUDFLARE_API_TOKEN` and nowhere else, and the tool
never prints it. Keep the tokens in 1Password and pass them per command:

```sh
CLOUDFLARE_API_TOKEN="op://<vault>/<read token item>/credential" op run -- npm run cloudflare:check
CLOUDFLARE_API_TOKEN="op://<vault>/<read token item>/credential" op run -- npm run cloudflare:plan
CLOUDFLARE_API_TOKEN="op://<vault>/<edit token item>/credential" op run -- npm run cloudflare:apply -- --yes
```

`check` prints a table (`-- --json` for JSON) and exits 1 on drift. `plan`
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
| Account | Account Rulesets (Bulk Redirect rule) | Read | Edit |
| Account | Account Filter Lists (Bulk Redirect list) | Read | Edit |
| Account | Cloudflare Pages | Read | Edit |
| Account | Access: Apps and Policies | Read | Read |
| Account | Turnstile | Read | Edit |

Unit tests drive all three commands against an in-memory API
([`tests/unit/cloudflare.test.ts`](../tests/unit/cloudflare.test.ts)); nothing
in the repo calls Cloudflare on its own.

## After an apply

```sh
curl -sI https://jseverino.pages.dev/about/?x=1        # 301, location https://jseverino.com/about/?x=1
curl -sI https://<hash>.jseverino.pages.dev/           # 302 to the Access login
curl -s -o /dev/null -w '%{http_code}\n' https://jseverino.com/api/contact          # 403 (GET)
curl -s -o /dev/null -w '%{http_code}\n' https://jseverino.com/.env                 # 403
curl -sI https://jseverino.com/assets/icons/favicon.svg | grep -i cache-control      # max-age=3600
npm run deploy:verify
```

Then run `npm run cloudflare:check` until it exits 0.

The repository's own settings follow the same check, plan, and apply pattern in
[GitHub Settings](./GitHub-Settings.md).

## No `wrangler.toml`

A Pages `wrangler.toml` would pin the compatibility date in the repo, but it
becomes the source of truth for every binding, so it would also have to carry
the D1 database ID in a public repository. `cloudflare:check` already holds the
project's compatibility date to the one the edge suite runs
([`tests/browser-test-env.ts`](../tests/browser-test-env.ts)), and apply sets
it. That was the only benefit, so the repo stays without one.
