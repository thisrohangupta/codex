# Security Policy

- Report vulnerabilities privately to the maintainers. Preferred: GitHub Security Advisory ("Report a vulnerability" in the repo Security tab) or email: security@your-domain.example.
- Please include a minimal reproduction, affected versions/commits, impact, and any suggested mitigations.
- Do not open public issues for unpatched vulnerabilities.
- We aim to acknowledge reports within 2 business days and provide a triage decision within 7 days.
- For secrets exposure: rotate credentials immediately and include evidence/logs as appropriate.

## Supported Versions
- `main` branch and the latest tagged release.

## Scope
- App code under `apps/` and deployment config in `ops/`.
- CI workflows under `.github/workflows/`.

## Out of Scope
- Third-party dependencies (report upstream when appropriate).
- Misconfigurations in your own cloud accounts (outside of repo-provided IaC).

