# Future Ideas Backlog

Ideas that came up during planning or execution but were deliberately deferred. Not a TODO list — more of a "we saw it, made a call, and moved on" record. Revisit when a phase is looking for small wins, or when one of these blocks something real.

Rules:
- Each entry has a stable ID so conversations can reference it (`FI-###`).
- Each entry records *what*, *why deferred*, and *when to reconsider*. Not a spec.
- If an item is picked up, move it to the relevant phase spec and strike it here (keep the row for history).
- Append only; don't renumber.

---

## FI-001: Configurable tmux session naming
**What:** When launching a fresh tmux session via the profile picker, let users configure the session name format instead of relying on tmux's auto-assigned integer names. Candidates: fixed prefix (`obsidian-1`, `obsidian-2`), timestamp (`obsidian-2026-04-14-17-32`), user-prompted, template string with placeholders.

**Why deferred:** Phase 3 ships with tmux auto-assigned names because it's zero code and "just works" for the first-use case. Naming is a polish item that matters more once users have many sessions and want to find them later.

**When to reconsider:** When Steve (or a user) complains about tmux session names being unhelpful, or when tmux session management grows a "rename" or "list with metadata" feature. Likely Phase 4 settings work or later.

**Origin:** Phase 3 planning session, 2026-04-14.
