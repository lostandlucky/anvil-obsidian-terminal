# Architecture Decision Records

Durable records of decisions that are hard to reverse, affect architecture, or that future-you will want a real answer for. Format is MADR-minimal — see `_template.md`.

## Filename convention

`NNNN-slug.md`, zero-padded four-digit sequence. Never renumber; if an ADR is superseded, write a new one and update the old one's `Status`.

See `../DOCUMENTATION_STANDARDS.md` § ADRs for the rules on when to write one. The authoritative index is the filesystem — `ls docs/adr/*.md`.
