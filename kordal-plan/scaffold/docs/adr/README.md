# Architecture Decision Records

An Architecture Decision Record (ADR) is a short document capturing one significant architecture decision: its context, the decision itself, and its consequences. ADRs give future contributors — human and AI — the reasoning behind the architecture, not just its current shape.

Any architecture change requires an ADR.

## Naming

Number ADRs sequentially with a zero-padded three-digit prefix and a short kebab-case title:

```
001-title.md
002-title.md
```

Numbers are never reused. To change a decision, write a new ADR that supersedes the old one and mark the old one as superseded.

## Format

```markdown
# ADR-001: Title

- **Status:** Proposed
- **Owning task:** CAP-001

## Context

## Proposed decision

## Alternatives

## Consequences
```

Planning writes an ADR as Proposed, with the choices still open. Its owning task resolves them, records the alternatives and consequences, renames the section to "Decision" and sets the status to Accepted before implementing dependent behaviour. The structure check (`make structure-check`, part of every task gate) requires every ADR of a completed task to be Accepted.
