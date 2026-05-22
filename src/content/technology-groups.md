# Technology Groups

Single source of truth for technology tag slugs and their human-readable labels.

The `Featured` column controls the **home page technology cloud**: only rows
marked `yes` (and referenced by at least one published writeup) appear there.
Every slug still shows on its individual writeup pages and `/tag/<slug>/` pages
regardless of the flag — the flag only curates the home page.

Group taxonomy and ordering match the legacy WordPress site
(`static.jseverino.com`). Tags within a group are sorted alphabetically by label
at render time, so the order here is informational.

If a writeup's `technologies:` frontmatter references a slug that is missing
from this file, a warning is printed at dev/build time so it can be added.

This file syncs to `src/content/technology-groups.md` in the site repo via
`bin/sync-content.mjs`. Edit here, not in the site repo.

## Concepts & Frameworks

| Slug | Label | Featured |
| --- | --- | --- |
| browser-local-storage | Browser Local Storage |  |
| csp | Content Security Policy |  |
| diamond-model | Diamond Model | yes |
| file-integrity-monitoring | File Integrity Monitoring | yes |
| local-first-architecture | Local-First Architecture |  |
| mitre-attack | MITRE ATT&CK | yes |
| nist | NIST |  |
| private-root-ca | Private Root CA | yes |
| security-event-monitoring | Security Event Monitoring |  |
| vulnerability-detection | Vulnerability Detection |  |
| webauthn | WebAuthn | yes |
| zero-trust | Zero Trust | yes |

## Dev Tools

| Slug | Label | Featured |
| --- | --- | --- |
| git | Git |  |
| github | GitHub |  |
| phpmyadmin | phpMyAdmin |  |
| portainer | Portainer |  |
| uptime-kuma | Uptime Kuma |  |

## Languages

| Slug | Label | Featured |
| --- | --- | --- |
| css | CSS |  |
| html | HTML |  |
| javascript | JavaScript |  |
| json | JSON |  |
| php | PHP |  |
| python | Python | yes |
| zsh | zsh |  |

## Networking

| Slug | Label | Featured |
| --- | --- | --- |
| caddy | Caddy | yes |
| cisco-packet-tracer | Cisco Packet Tracer | yes |
| dns-over-https | DNS over HTTPS | yes |
| mininet | Mininet | yes |
| nftables | nftables | yes |
| nginx-proxy-manager | Nginx Proxy Manager | yes |
| rdp | RDP |  |
| smtp | SMTP |  |
| ssh | SSH |  |
| subnet-routing | Subnet Routing |  |
| tailscale | Tailscale | yes |
| wireguard | WireGuard | yes |

## Platforms & OS

| Slug | Label | Featured |
| --- | --- | --- |
| cloudflare | Cloudflare | yes |
| debian | Debian |  |
| digitalocean | DigitalOcean |  |
| docker | Docker | yes |
| docker-engine | Docker Engine |  |
| hyper-v | Hyper-V |  |
| ubuntu-server | Ubuntu Server |  |
| utm | UTM |  |
| windows | Windows |  |
| windows-11-pro | Windows 11 Pro |  |
| wordpress | WordPress |  |

## Security Tools

| Slug | Label | Featured |
| --- | --- | --- |
| adguard-home | AdGuard Home | yes |
| kali-linux | Kali Linux | yes |
| lets-encrypt | Let’s Encrypt |  |
| metasploit-framework | Metasploit Framework | yes |
| nmap | Nmap | yes |
| openssl | OpenSSL |  |
| wazuh | Wazuh | yes |
| wireshark | Wireshark | yes |
