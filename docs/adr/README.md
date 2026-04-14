# Architecture Decision Records

Durable records of decisions that are hard to reverse, affect architecture, or that future-you will want a real answer for. Format is MADR-minimal — see `_template.md`.

## Filename convention

`NNNN-slug.md`, zero-padded four-digit sequence. Never renumber; if an ADR is superseded, write a new one and update the old one's `Status`.

## Reserved slots

- `0001-macos-arm64-only.md` — retrospective, captures the scope decision from `CLAUDE.md`. To be written.
- `0002-manual-install-only.md` — retrospective, captures the distribution decision. To be written.
- `0003-pty-backend.md` — **reserved** for the Phase 2 decision. Do not write until the PTY backend is locked.

See `../DOCUMENTATION_STANDARDS.md` § ADRs for the rules on when to write one.
