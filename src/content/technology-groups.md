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
| diamond-model-of-intrusion-analysis | Diamond Model of Intrusion Analysis |
| file-integrity-monitoring | File Integrity Monitoring |
| import-export-workflows | Import/Export Workflows |
| local-first-architecture | Local-First Architecture |
| local-https | Local HTTPS |
| private-root-ca | Private Root CA |
| security-event-monitoring | Security Event Monitoring |
| sha-256 | SHA-256 |
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
| vs-code | VS Code |

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
| dns | DNS |
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
| cloud-vps | Cloud VPS |
| cloudflare | Cloudflare |
| debian | Debian |
| docker | Docker |
| docker-engine | Docker Engine |
| homelab | Homelab |
| hyper-v | Hyper-V |
| ubuntu-linux | Ubuntu Linux |
| ubuntu-server | Ubuntu Server |
| utm | UTM |
| windows-11-pro | Windows 11 Pro |
| windows-endpoint | Windows Endpoint |
| wordpress | WordPress |
| wp-cron | WP-Cron |

## Security Tools

| Slug | Label |
| --- | --- |
| adguard-home | AdGuard Home |
| kali-linux | Kali Linux |
| lets-encrypt | Let’s Encrypt |
| metasploit-framework | Metasploit Framework |
| nmap | Nmap |
| openssl | OpenSSL |
| wazuh-siem | Wazuh SIEM |
| wireshark | Wireshark |
