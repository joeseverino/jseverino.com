---
title: Building a Custom MCP Layer for My Technical Vault and Workflow
description: >-
  A local MCP server that lets any AI assistant on my Mac search my Obsidian
  vault for runbooks and infrastructure notes, with a sensitivity gate that
  keeps restricted docs from leaving the machine without an explicit unlock.
published: true
published_at: 2026-05-29T00:00:00.000Z
last_reviewed: 2026-05-30T00:00:00.000Z
cover_image: ./images/mcp-call.png
technologies:
  - claude-code
  - django
  - docker
  - lm-studio
  - mcp
  - obsidian
  - python
  - tailscale
  - yaml
featured: true
featured_order: 1
---

# Building a Custom MCP Layer for My Technical Vault and Workflow

![hero](/assets/writeups/building-a-custom-mcp-layer/images/mcp-call.png)

## Overview

I keep a personal Obsidian vault that documents my homelab, VPS, and the tools I've built around them. About eighty markdown files live in there now, covering runbooks, infrastructure notes, project indexes, and reference material. Every doc has a small metadata block at the top that tags it with an ID, a type, and a sensitivity label. That structure is what makes the vault legible to everything else in my workflow.

[severino-vault-mcp](https://github.com/joeseverino/severino-vault-mcp) is a small Python server I built so any AI assistant on my Mac can use that documentation directly. It runs locally, lets the assistant search and read the vault, and refuses to release anything tagged restricted unless I explicitly unlock it. Two other pieces sit alongside it: Severino HQ, a private Django app that turns the same vault metadata into a portfolio and operations dashboard, and a small CLI toolchain that wraps the repeatable commands the runbooks describe.

This writeup walks through the documentation conventions, the MCP itself, how the sensitivity gate works, and how the pieces fit together.

## The System At A Glance

```text
Obsidian Vault
  ├─ 01 Projects/
  ├─ 02 Infrastructure/
  ├─ 03 Runbooks/
  └─ 04 Reference/
        │
        ├── MCP Server → AI assistants / local models
        │       └── sensitivity gate before model context
        │
        ├── Severino HQ → project/content/asset dashboard
        │
        └── CLI Tools → repeatable local operations
```

One vault. Three consumers. Each one reads the same frontmatter for a different purpose.

## Why MCP

Model Context Protocol is Anthropic's open standard for letting an AI host talk to a local tool over stdio. The host (Claude Code, Codex, Cline, a local model client) spawns the MCP server as a child process and shuts it down when the session ends. Since the server is spawned locally over stdio, there is no network listener or remote authentication surface to manage.

That fit what I wanted. The vault sits on my laptop. The assistant should read it when I'm talking to it and stop reading it the moment I'm not.

## The Vault Comes First

The MCP only works because the vault is structured. Every doc under `01 Projects/`, `02 Infrastructure/`, and `03 Runbooks/` has a YAML frontmatter block with a stable `doc_id`, a `doc_type`, a `system`, an `environment`, a `status`, a `sensitivity`, and a `last_reviewed` date. Obsidian reads it, Severino HQ reads it, and the MCP reads it. One source, three consumers.

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/infrastructure.png)

An infrastructure note for Caddy. The properties at the top are the schema the rest of the system hangs off of. If a doc doesn't have frontmatter, it doesn't exist as far as the MCP or HQ are concerned.
::

New docs always start from a template so the block never gets skipped:

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/template.png)

The runbook template in `00 Templates/`. Pre-filled frontmatter, goal, prerequisites, steps, expected results, verify, rollback, common mistakes.
::

`00 Inbox/` is the loose end of the vault. Ideas land there fast, without frontmatter, and graduate into projects or runbooks later:

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/inbox.png)

A captured note about adding a phptest cross-language pre-deploy gate. Frontmatter gets added when it becomes a real runbook.
::

`01 Projects/` holds one folder per active project with an `index.md` linked back to the GitHub repo it represents:

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/projects.png)

The project index for the Severino Labs Security Layer plugin. The `project_path` field points at the real repo on disk.
::

`03 Runbooks/` is the operational layer. Short, command-first docs that the MCP surfaces first when I ask "how do I":

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/runbook.png)

The Manage Homelab VM runbook. When the assistant calls `find_runbook("restart homelab VM")`, this is what comes back.
::

`04 Reference/` is for primers and meta material. Lighter frontmatter, still discoverable through `search_body`:

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/reference.png)

A GitHub Actions primer in `04 Reference/`.
::

## The MCP

The MCP is a small Python package. It's installed with `uv tool install` and registered with each AI host that needs it. When the host launches, it spawns a `severino-vault-mcp` subprocess and talks to it over stdio.

| Property | Value |
|---|---|
| Host | Local Mac only |
| Install path | `~/Documents/Code/Assets/severino-vault-mcp/` |
| Binary | `~/.local/bin/severino-vault-mcp` |
| Transport | stdio |
| Repo | [`joeseverino/severino-vault-mcp`](https://github.com/joeseverino/severino-vault-mcp) (MIT) |
| Stack | Python 3.11+, `mcp>=1.27`, hand-rolled YAML frontmatter parser |

The tool surface is small. Each tool answers a specific shape of question and the assistant chains them when it needs to.

| Tool | Mode | Answers |
|---|---|---|
| `find_runbook(query)` | read | "How do I add an NPM proxy host?" |
| `lookup_system(name)` | read | "Tell me everything about AdGuard Home" |
| `read_doc(doc_id)` | read | Returns the body under the sensitivity gate |
| `search_body(query)` | read | rg-backed full-text search |
| `inventory_for_project(slug)` | read | "What docs are tied to homelab-dns?" |
| `recent_changes(days)` | read | Vault git log within indexed folders |
| `add_frontmatter(...)` | write | Adds validated frontmatter to an untagged doc |
| `update_frontmatter(...)` | write | Mutates fields on a tagged doc (`doc_id` is immutable) |

Two MCP resources sit alongside the tools, `vault://quick-index` for navigation and `vault://doc/{doc_id}` for stable reads, so a host can pin a specific runbook into context without a search round-trip.

## The Sensitivity Gate

Sensitivity is an enum the MCP enforces in code on every read.

| Sensitivity | What the LLM gets |
|---|---|
| `public` | Full body |
| `internal` | Full body. Most operational runbooks. |
| `sensitive` | Full body with an advisory in the response. DNS configs, firewall rules, TLS workflows. |
| `restricted` | Body withheld by default. Caller has to pass `include_restricted=True`, the local config has to enable the unlock flow, a keychain or hash check has to pass, and the attempt is written to an audit log on disk. |

The runbooks I tag `restricted` are the ones that touch real secrets: the offline CA workflow, credential rotation, the age-based encryption setup. Even if an assistant asks for one of those by exact `doc_id`, the body does not leave my machine without an explicit local unlock I configure first.

Prompt-level rules are advisory. The sensitivity gate runs in Python before the body ever reaches the response.

## Recall in Practice

The same MCP works across hosts because MCP is the standard, not a Claude-specific thing. Here's Claude Code in iTerm, answering a homelab cert question through `find_runbook` and `read_doc`:

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/mcp-call.png)

The reply is the five-step procedure from `rb-generate-homelab-cert` verbatim: boot the offline VM, run `cert-gen <service>.homelab`, enter the passphrase, retrieve the files, update the cert inventory in Local PKI.
::

And here's a local Qwen2.5-7B model running in LM Studio, talking to the same MCP, answering how to add a DNS rewrite:

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/dns-rewrite-local-model.png)

The `find_runbook` and `read_doc` calls show up in the tool panel on the right. The steps in the response come from the AdGuard rewrite runbook in my vault. A small local model with no training data about my stack answers correctly because the knowledge lives in the MCP.
::

## Severino HQ: The Browser View

The MCP makes the vault legible to an assistant. [Severino HQ](https://hq.jseverino.com "private: this site only works on my tailnet") is what makes it legible to me at a browser tab. HQ is a private Django app running in Docker on my homelab server, reachable only over Tailscale through Nginx Proxy Manager. It reads the same vault frontmatter and turns it into structured records.

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/hq-dashboard.png)

The HQ dashboard. Active projects, draft content, published content, asset count, and a "docs to review" counter that nags me when a `last_reviewed` date drifts past 180 days.
::

When I publish a writeup, the same `published: true` flag in the writeup's frontmatter is what HQ uses to flip the `ContentItem.status`.

::figure
![](/assets/writeups/building-a-custom-mcp-layer/images/hq-content.png)

The HQ content record for my Zero-Trust Private Infrastructure writeup. Description, tags, related project, published URL, all derived from the writeup frontmatter at sync time.
::

The propagation is one command:

```bash
hq sync
```

`hq sync` walks the vault on the Mac, builds a manifest of every doc with frontmatter, and pipes it into `manage.py import_docs_manifest -` running inside the HQ container over SSH. `doc_id` is the upsert key, so re-running is idempotent.

The split between the MCP and HQ is deliberate. The MCP is for an assistant in a conversation. HQ is for me reviewing the portfolio, tracking expenses, or scanning what's stale. Both read the vault. Neither owns it.

## The Toolchain

The CLI toolchain at `~/Documents/Code/Assets/tools/` is symlinked into `~/.local/bin/`. These are the commands the runbooks tell me to run.

| Tool | Purpose |
|---|---|
| `vault` | Git sync/status around the vault |
| `inbox` | Fast capture into `00 Inbox/` |
| `hq` | Sync, deploy, logs, restart, create records |
| `site` | Sync/build/publish the public Astro site |
| `cert-gen` | Sign a new homelab cert via the offline CA VM |
| `encrypt` / `decrypt` / `open-age` | Age-based file encryption workflows |
| `backup` | Mirror configured files into the backup area |
| `dns-test` | DNS resolver checks |

The rule I follow: if a procedure takes more than one shell command, it should be a tool. The runbook then says "run `cert-gen <host>`" and that's the whole answer, which is exactly what the MCP quotes back.

## What's Next

A few improvements are still on the list:

- More resource templates for hosts that prefer pinning specific docs over searching.
- Streaming responses for long bodies so a 5000-word writeup doesn't eat the assistant's context budget when it only needs a section.
- Wider local-model coverage in the test suite. Right now I run regression tests against Claude and Qwen, and I'd like to add at least two more local model classes, which may require a new Mac since I only have 8GB of RAM.
