# Security policy

## Reporting a vulnerability

Report security issues in this site privately, not in a public issue. That
covers the build output, the contact and CSP-report functions, the response
headers, and anything else in this repository.

- Use the contact form at <https://jseverino.com/contact/> and start the message
  with **Security:**.
- Include what reproduces it: the URL or endpoint, the request, and the observed
  versus expected behavior.
- For sensitive exploit detail, encrypt to the OpenPGP key for
  `security@jseverino.com` (published by
  [Web Key Directory](https://jseverino.com/.well-known/openpgpkey/hu/t5s8ztdbon8yzntexy6oz5y48etqsnbb))
  and paste the armored message into the form.

The same path is published per [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)
at [`/.well-known/security.txt`](https://jseverino.com/.well-known/security.txt),
clear-signed by that key.

This is a personal site with no bug bounty. Reports are read and real issues are
fixed promptly; please allow a reasonable window before public disclosure.

## Supported versions

Only the deployed site and the `main` branch are supported.

## Security architecture

[`docs/Security.md`](./docs/Security.md) covers the design: the static origin,
the contact form, the response headers and hash-based CSP, the Cloudflare edge
posture, and the supply chain.
