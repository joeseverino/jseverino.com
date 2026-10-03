---
title: >-
  From iCloud Passwords to 1Password: Logins, SSH Certificates, and Homelab
  Secrets in One Place
description: >-
  How a free 1Password account replaced iCloud Passwords and became the source
  for my homelab's secrets, SSH certificates signed with Touch ID, and the
  vaults my AI agents are allowed to read.
published: true
published_at: 2026-10-02T00:00:00.000Z
last_reviewed: 2026-10-02T00:00:00.000Z
cover_image: ./images/cover.png
cover_alt: >-
  One 1Password account feeding four things: logins and passkeys on the Mac and
  iPhone, SSH certificates and sudo approved by Touch ID, server secrets
  rendered from templates, and AI agents limited to their own scoped vaults.
technologies:
  - 1password
  - secrets-management
  - systemd
  - ssh
  - webauthn
  - claude-code
  - docker
  - portainer
  - ubuntu-server
featured: true
featured_order: 1
---

# From iCloud Passwords to 1Password: Logins, SSH Certificates, and Homelab Secrets in One Place

![hero](/assets/writeups/from-icloud-passwords-to-1password/images/cover.png)

## Overview

I started using 1Password through work and found out an Enterprise seat comes
with a free personal account. Until then I had no reason to leave iCloud
Passwords: it was native, free, end-to-end encrypted, and on every device I
own.

I switched out of curiosity. A couple of months later it is where my servers
read their secrets from, the certificate authority behind my SSH logins, what
approves `sudo`, and the limit on what my AI agents can reach.

## Leaving iCloud Passwords

iCloud Passwords only holds logins. No API tokens, no SSH keys, no files, and
no command line, so my API keys lived in `.env` files and my SSH keys in
`~/.ssh`.

The migration took a couple of hours. Passwords, passkeys, and one-time code
seeds all came across. I turned off iCloud Passwords autofill the same day so
only one app holds the current value for a login.

## Secret References

What changed things was `op`, the CLI, and its secret references:

```text
op://<vault>/<item>/<field>
```

That string points to a value. It can sit in a config file or a repo,
and it only resolves for an identity granted that vault.

::table
| What I was doing | What replaced it |
| --- | --- |
| API keys in `.env` files on my Mac | `op read` when a tool runs |
| SSH private keys in `~/.ssh` | SSH certificates signed by 1Password |
| Secrets edited over SSH on each host | templates the host renders from a vault |
| Tokens pasted into an AI agent's config | a scoped account per agent |
::

## A Vault Is Defined by Who Reads It

My first vaults were sorted by topic, and one turned into a junk drawer. Now a
vault is defined by who reads it:

::table
| Vault | Read by |
| --- | --- |
| Private | me, and nothing automated |
| SSH | the 1Password SSH agent |
| Infrastructure | tools on my Mac, by reference |
| Recovery | only me, when something is broken |
| One vault per server | that server's renderer |
| Agents | AI agent sessions |
::

1Password forces this anyway: a service account's vault grants cannot be
changed after it is created.

::figure
![The 1Password sidebar listing each vault with a custom icon: Private, Agents, Certificates, Edge, Homelab Apps, HQ Development, Infrastructure, Managed Devices, Recovery, Severino HQ Production, Shared Secrets, and SSH.](/assets/writeups/from-icloud-passwords-to-1password/images/vaults.png)

Each vault gets an icon for what it holds.
::

## SSH: Two Certificate Authorities in 1Password

My servers used to trust my keys forever through `authorized_keys`, and my
`known_hosts` was a list of fingerprints I never checked. Both are certificate
authorities now, and both CA keys live in 1Password.

::figure
![The Mac asks 1Password for a 12-hour certificate with Touch ID, then exchanges a user certificate and a host certificate with every server in the Servers group: homelab-server and the cloud VPS.](/assets/writeups/from-icloud-passwords-to-1password/images/ssh-certificates.png)

1Password holds both CAs. The Mac gets a user certificate, and each server
proves itself with a host certificate.
::

The user CA's key was generated inside 1Password and signs through its SSH
agent, so each certificate is a Touch ID and the key has never been a file. The
servers no longer read `authorized_keys` for my account.

::terminal
$ ssh-keygen -L -f ~/.ssh/homelab-server-cert.pub
Valid: from 2026-09-29T13:19:37 to 2026-09-30T01:24:37
Principals:
  joe
Critical Options:
  source-address <my tailnet addresses>
::

A `Match exec` line in `~/.ssh/config` mints a new certificate when the old one
expires, which works out to one Touch ID per server per day.

::figure
![Running ssh homelab-server prints that a 12-hour certificate is being minted, and 1Password asks to allow iTerm2 to use the SSH CA - User key with Touch ID.](/assets/writeups/from-icloud-passwords-to-1password/images/ssh-ca-touch-id.png)

The first connection of the day. 1Password signs the certificate with the user
CA after Touch ID.
::

The host CA signs each server's host key, so `known_hosts` trusts all of them
with one `@cert-authority` line, and a rebuilt server gets signed instead of
throwing a "host key changed" warning.

## Touch ID for sudo

`pam_ssh_agent_auth` lets `sudo` authenticate by asking an SSH agent to sign a
challenge. My 1Password agent is forwarded from the Mac, so `sudo` on either
server raises a prompt on my laptop. My account has no `NOPASSWD` rule and is
not in the `docker` group, and the list of keys allowed to approve `sudo` is
owned by root.

## Editing Secrets on My Mac

Changing a secret used to mean SSHing into the right server, editing a `.env`
with `sudo`, and restarting the container. So I never rotated anything.

Now every secret file under `/opt/apps` has a `.tpl` sibling with references
where the values go:

```text
APP_URL=https://sso.jseverino.com
ENCRYPTION_KEY=op://<vault>/<item>/<field>
```

A systemd timer runs `op inject` on every template hourly, writes the result
`0400 root`, and restarts only the services whose files changed:

::terminal
$ sudo journalctl -u homelab-secrets.service --no-pager
render-homelab-secrets.sh[67086]: Rendered and restarted: npm portainer
render-homelab-secrets.sh[67446]: Secrets are current.
::

If a reference fails or a value comes back empty, it leaves the old file alone.
To test it I deleted every rendered secret on the homelab server and ran the
unit. All of them came back, including Portainer's database key byte for byte.

The renderer still needs its own credential to start. On the homelab server it
reads from 1Password Connect on loopback, with a read-only token encrypted by
`systemd-creds` and sealed to the VM's virtual TPM, so a copied disk carries no
usable key. The cloud VPS uses a service account so it does not depend on a
server in my house.

::figure
![The Developer page of the 1Password web console showing one Connect server, homelab-connect, with two active tokens, its last sync time, and the four vaults it can read.](/assets/writeups/from-icloud-passwords-to-1password/images/connect-server.png)

The Connect server on the homelab: two read-only tokens, one per renderer, and
only the vaults those renderers need.
::

::figure
![1Password sending read-only tokens to homelab-server, which renders secrets into its containers with op inject, and one vault to the cloud VPS through a service account, while the Mac reaches the SSH and Infrastructure vaults by Touch ID.](/assets/writeups/from-icloud-passwords-to-1password/images/renderer-topology.png)

Servers read their own vaults. The SSH and Infrastructure vaults open only on
my Mac.
::

## AI Agents

The Touch ID prompt is not a good gate for an agent. One approval gives the
terminal full access to the account, every vault included, and it never says
which item or vault the call wants.

So each agent gets its own service account instead. It can read a development
vault and read and write an Agents vault, and the grant lives on 1Password's
side, so nothing on my Mac can widen it. Every other vault is invisible to it. If I want
an agent to use something from Private, I copy it into Agents.

Each agent's token comes from its own 1Password Environment, which shows up as
a named pipe the desktop app answers. The same Environment holds the agent's
identity for [HQ](https://github.com/joeseverino/severino-hq) and
[ntfy](https://github.com/binwiederhier/ntfy).

::figure
![The Claude Code Mac Environment in 1Password, holding a service account token, an HQ client ID and secret, and the token URL, with the secret values masked.](/assets/writeups/from-icloud-passwords-to-1password/images/agent-environment.png)

One agent's Environment: its 1Password service account and its HQ identity.
::

## The Work Laptop

My main account does not sign in on a work laptop I don't control. The laptop
gets a secondary account with access to one shared vault that my main account
owns. Logins I need on both machines, like GitHub, live in that vault once
instead of being copied.

## Conclusion

1Password started as a free license and a password import. Now every secret my
servers run on is rendered from it, every SSH login and `sudo` is a Touch ID on
my Mac, and my agents only see the vaults I gave them. For autofill on an
iPhone, iCloud Passwords was just as good. I stayed for the rest of it.
