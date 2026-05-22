# Technology Groups

Single source of truth for technology tag slugs and their human-readable labels.
Each group below is rendered on the homepage technology cloud (only slugs
referenced by at least one published writeup are shown).

Group taxonomy and ordering match the legacy WordPress site
(`static.jseverino.com`). Tags within a group are sorted alphabetically by label
at render time, so the order here is informational.

If a writeup's `technologies:` frontmatter references a slug that is missing
from this file, a warning is printed at dev/build time so it can be added.

This file syncs to `src/content/technology-groups.md` in the site repo via
`bin/sync-content.mjs`. Edit here, not in the site repo.

## Concepts & Frameworks

| Slug | Label |
| --- | --- |
| browser-local-storage | Browser Local Storage |
| csp | Content Security Policy |
| diamond-model | Diamond Model |
| file-integrity-monitoring | File Integrity Monitoring |
| local-first-architecture | Local-First Architecture |
| mitre-attack | MITRE ATT&CK |
| nist | NIST |
| private-root-ca | Private Root CA |
| security-event-monitoring | Security Event Monitoring |
| vulnerability-detection | Vulnerability Detection |
| webauthn | WebAuthn |
| zero-trust | Zero Trust |

## Dev Tools

| Slug | Label |
| --- | --- |
| git | Git |
| github | GitHub |
| phpmyadmin | phpMyAdmin |
| portainer | Portainer |
| uptime-kuma | Uptime Kuma |

## Languages

| Slug | Label |
| --- | --- |
| css | CSS |
| html | HTML |
| javascript | JavaScript |
| json | JSON |
| php | PHP |
| python | Python |
| zsh | zsh |

## Networking

| Slug | Label |
| --- | --- |
| caddy | Caddy |
| cisco-packet-tracer | Cisco Packet Tracer |
| dns-over-https | DNS over HTTPS |
| mininet | Mininet |
| nftables | nftables |
| nginx-proxy-manager | Nginx Proxy Manager |
| rdp | RDP |
| smtp | SMTP |
| ssh | SSH |
| subnet-routing | Subnet Routing |
| tailscale | Tailscale |
| wireguard | WireGuard |

## Platforms & OS

| Slug | Label |
| --- | --- |
| cloudflare | Cloudflare |
| debian | Debian |
| digitalocean | DigitalOcean |
| docker | Docker |
| docker-engine | Docker Engine |
| hyper-v | Hyper-V |
| ubuntu-server | Ubuntu Server |
| utm | UTM |
| windows | Windows |
| windows-11-pro | Windows 11 Pro |
| wordpress | WordPress |

## Security Tools

| Slug | Label |
| --- | --- |
| adguard-home | AdGuard Home |
| kali-linux | Kali Linux |
| lets-encrypt | Let’s Encrypt |
| metasploit-framework | Metasploit Framework |
| nmap | Nmap |
| openssl | OpenSSL |
| wazuh | Wazuh |
| wireshark | Wireshark |
