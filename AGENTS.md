# Agent Instructions

Before starting repo work on this machine, read and follow:

`/Users/rico/.agents/AGENTS.md`

That shared file contains the git, worktree, remote-operation, preview-server, and vault workflow preferences for coding agents.

## Store asset maintenance

For store artwork, icons, screenshots, upload mappings or another game’s asset workflow, start with `docs/store-assets/README.md` and `docs/store-assets/WORKFLOW.md`. `catalog.json` selects the sources; `pnpm assets:store` assembles the committed upload snapshot and `pnpm assets:store:check` verifies it. Preserve exploration history, distinguish generated art from gameplay captures, and never infer that a local export is published.
