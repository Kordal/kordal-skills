# kordal-skills

Claude Code skills for planning and delivering an MVP with agents.

| Skill | Does |
| --- | --- |
| `/kordal-plan` | Scaffolds a new project and plans an MVP through six stages |
| `/kordal-build` | Delivers the planned tasks, hands the owner a test list, ships |

## Install

```bash
git clone git@github.com:Kordal/kordal-skills.git ~/Development/kordal-skills
ln -s ~/Development/kordal-skills/kordal-plan ~/.claude/skills/kordal-plan
ln -s ~/Development/kordal-skills/kordal-build ~/.claude/skills/kordal-build
```

Commit every change to `kordal-plan/scaffold/`: a project records the scaffold commit it was created from, and `/kordal-plan update` diffs against it.
