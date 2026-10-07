# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | Yes                |
| 1.x     | No                 |
| < 1.0   | No                |

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/ykstorm/quickdraw/security/advisories/new)
(Security tab → "Report a vulnerability"). This keeps the report and discussion
private until a fix ships.

Include as much detail as possible:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

We aim to acknowledge within 48 hours and provide a timeline for a fix. We follow a coordinated disclosure process and will credit researchers in the release notes (unless you prefer anonymity).

## What to report

- API key exposure via logs or error messages
- Cost ceiling bypass
- Injection via prompt parameters
- Any behavior that reads or exfiltrates credentials

## What NOT to report

- Feature requests (use GitHub Issues for these)
- Questions about usage (use Discussions)
- Performance regressions (open an issue with benchmarks)