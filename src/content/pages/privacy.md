---
title: Privacy
description: What this site collects, where it goes, and how to ask for it to be deleted.
path: /privacy/
published: true
---

This site doesn't track you. It uses no cookies for analytics or
advertising, sets no cross-site identifiers, and runs no third-party
trackers. There is no consent banner because there is nothing that
would require one.

## What is collected

**Web Analytics.** Cloudflare Web Analytics is auto-injected by the
Cloudflare edge and records sampled pageview data (URL, referrer,
browser, country) via a cookieless beacon. No personal identifier is
set or read on your device.

**The contact form.** If you send a message via
[the contact form](/contact/), the following is stored in a private
database I review:

- Your name, email, and message (you provide these directly).
- Your IP address, user-agent, and parsed browser and device (request
  context, used for abuse review and rate limiting).
- Cloudflare two-letter country code (request context).
- The page you submitted the form from.

**Cookies.** None set by this site. Cloudflare may set strictly
necessary infrastructure cookies (`__cf_bm` for bot management,
Turnstile challenge tokens). These are required for the site to
function and are not used for tracking.

**Browser security diagnostics.** Browsers may send a short automated
note to the site when a page hits a security-policy mismatch. No extra
data is collected beyond what a normal page load already includes.

## Why

So I can read and reply to your message, and filter abusive
submissions if any arrive. The GDPR term for that is *legitimate
interest*.

## How long

Contact-form records are kept indefinitely until I remove them — there
is no automated retention policy. You can request deletion at any
time (see below).

## Your rights

Want a copy of your submission, or want it deleted? Send a follow-up
through the contact form and start with **"Data request"** — I'll see
it and handle it.

## For developers and security researchers

The engineering-side view — schema, rate-limiting, the Content
Security Policy, the build pipeline — lives in the repository's
[SECURITY.md](https://github.com/joeseverino/jseverino.com/blob/main/SECURITY.md).
That doc also has the responsible-disclosure path if you've found
a security issue.
