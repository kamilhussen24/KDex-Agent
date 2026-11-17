# Security Policy

## Reporting a vulnerability
Please report security problems privately. Do not open a public issue.

Use GitHub's private reporting: **Security > Report a vulnerability** in the
[repository](https://github.com/kamilhussen24/KDex-Agent/security/advisories/new).
Include what you found, the steps to reproduce it and the app version
(Settings > About). You will get a reply as soon as the maintainer can.

## What counts
- Anything that exposes API keys, Git tokens or `.env` values, to the model, the chat or the network.
- Ways around the approval step, the secret-file protection or the folder limit.
- Ways for a repository, file or AI reply to run something without approval.

## Supported versions
Only the latest release receives fixes. Update from Settings > About.

## Privacy by design
No server, no accounts, no analytics. API keys and tokens are stored with the
Android Keystore. See [PRIVACY.md](PRIVACY.md).
