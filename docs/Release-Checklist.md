# Release Checklist

This checklist is the human release gate for `jseverino.com`. It complements
[`npm run publish:check`](../bin/publish-check.mjs), which performs the local
automated checks.

Use it for production pushes, signed releases, and any change that affects
content sync, generated assets, Cloudflare headers, CSP, SEO metadata, or the
contact form.

## 1. Preflight

Confirm the branch is clean and current:

```sh
git status -sb
git log -1 --oneline
```

The expected status before release work is:

```text
## main...origin/main
```

If local commits exist, push them before starting deploy validation. If remote
commits exist, pull or rebase first.

## 2. iCloud Conflict Copies

The repo currently lives in an iCloud-synced path. iCloud can create numbered
conflict-copy files or directories such as `home 2.md` or `building-a-homelab 2`.
Those are local filesystem artifacts, not source files.

Check for conflict copies before the release gate:

```sh
find src/content public/assets -name '* [0-9]' -o -name '* [0-9].*'
```

`publish:check` runs [`bin/clean-generated.mjs`](../bin/clean-generated.mjs),
which resolves numbered copies in generated content and asset roots. If conflict
copies are reported, treat them as release noise that must be resolved before the
final status check. Do not commit numbered copies.

## 3. Local Release Gate

Run the canonical repo-local gate:

```sh
npm run publish:check
```

A clean release should report:

```text
sync       content snapshot updated
check      0 errors, 0 warnings
build      <n> pages built
csp        <n> inline-script hash(es) verified against public/_headers
assets     Images: <n>; Total image weight: <n>; No images over 1.5 MB.
```

Then confirm the worktree is still intentional:

```sh
git status -sb
```

Content changes from the private vault are expected only when the release is
intended to publish those changes.

## 4. Commit And Push

Commit source, content snapshot, generated manifest, docs, and public assets
that are part of the release:

```sh
git add <changed-files>
git commit -m "<release commit message>"
git push origin main
```

Do not commit local caches, build output, `.env*`, `.dev.vars*`, editor folders,
or numbered iCloud conflict copies.

## 5. Signed Version Tag

For a versioned release, move the signed tag only after the final release commit
is on `main`.

```sh
git tag -s -f v2.0.0 -m "v2.0.0 - Content architecture refactor"
git tag -v v2.0.0
git push --force origin v2.0.0
git ls-remote origin refs/tags/v2.0.0 refs/tags/v2.0.0^{}
```

The local verification must show a good signature. The peeled remote tag
(`refs/tags/v2.0.0^{}`) must point to the intended release commit.

## 6. Cloudflare Deploy Verification

After Cloudflare Pages deploys `main`, verify the live site from a clean browser
profile or with extensions disabled:

```sh
curl -I https://jseverino.com/
curl -I https://jseverino.com/portfolio/zero-trust-private-infrastructure/
```

Confirm:

- `content-security-policy` is present on HTML responses.
- The HTML CSP does not include `script-src 'unsafe-inline'`.
- `strict-transport-security` includes `includeSubDomains`.
- `x-content-type-options: nosniff` is present.
- `referrer-policy: strict-origin-when-cross-origin` is present.
- Cloudflare Web Analytics or challenge scripts do not create first-party site
  errors in a clean browser profile.

Browser-extension errors, including AdGuard content script messages, are not site
release failures unless they reproduce with extensions disabled.

## 7. SEO And Accessibility Spot Checks

After deployment, validate the high-value URLs:

- Homepage.
- Portfolio index.
- Top flagship writeup.
- Contact page.

Check:

- Google Search Console URL inspection uses the intended canonical URL.
- Rich Results Test detects Article or WebSite structured data where expected.
- The page title, meta description, canonical URL, and Open Graph image are correct.
- `site seo <url|path|slug>` renders the expected Google-style title, URL,
  description, and metadata checks from built HTML.
- Keyboard navigation reaches header links, mobile menu controls, project cards,
  footer social links, and the contact form.
- VoiceOver rotor headings show one page `h1`, then article or section headings
  in a coherent order.

## 8. Scorecard Update

Update the vault scorecard in `00 Reporting` only for work that was actually
completed and verified. Do not raise the score for planned items.

Recommended evidence to record:

- final commit SHA;
- `publish:check` output summary;
- signed tag verification result;
- Cloudflare deploy URL or timestamp;
- live header check summary;
- Search Console and Rich Results outcomes;
- manual keyboard and VoiceOver notes.
