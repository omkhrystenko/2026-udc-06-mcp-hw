# AGENTS.md — catalog app

Guidance for an Agentic IDE working inside `app/`.

## Stack

- TypeScript (ES2022, NodeNext modules), Node 22+
- vitest for tests, colocated as `*.test.ts`
- No framework, no runtime dependencies — this is a plain domain library

## Commands

```bash
npm install
npm test          # vitest run
npm run typecheck # tsc, no emit
npm run build     # tsc -> dist/  (needed before mcp-server/ can import it)
```

## Architecture

- `data/catalog.json` — the seeded product data (synthetic, 24 items).
- `src/catalog.ts` — **pure** functions over a `Product[]` passed in. No I/O.
- `src/loader.ts` — the only file that touches the filesystem (`loadCatalog`).
- `src/index.ts` — public surface; everything external imports from here.

The split is deliberate: pure logic stays trivially testable, and the MCP
server in `mcp-server/` imports the same functions rather than reimplementing
them.

## Conventions

- Named exports only, no default exports.
- No `any`. Prefer `unknown` plus narrowing if a type is genuinely open.
- Keep `src/catalog.ts` free of imports from `node:*` — it must stay pure.
- Every exported function gets a colocated test case in `src/catalog.test.ts`.
- Import paths carry the `.js` extension (NodeNext), even from `.ts` sources.

## Guardrails

- **Do not change the signatures** of the exported catalog functions —
  `mcp-server/` depends on them, and so does the graded homework.
- **Do not edit `data/catalog.json`.** The A/B exercise in Task D compares
  against the seeded numbers; changing the data invalidates it.
- Never add real business data, PII, or secrets here. Everything is synthetic
  on purpose.

## MCPs

Servers this project expects to have connected. Config lives in `.mcp.json` at
the repo root (project-scoped, committed); permission rules in
`.claude/settings.json`. Full write-up: `docs/mcp/servers.md`; threat model:
`docs/mcp/SECURITY.md`.

| Server | What it is for here | Scope | Notes |
|---|---|---|---|
| `catalog` (`mcp-server/`, own) | Answer catalog questions through the tested domain functions instead of re-deriving them from raw JSON | imports `app/dist/index.js`, which reads `app/data/catalog.json` only | read-only; tools `search_inventory`, `check_stock`, `low_stock`, `inventory_value`; resource `inventory://catalog` |
| `filesystem` `@2026.7.10` | Read the raw seed data without shelling out | `./app/data` only — not the repo root, not `$HOME` | ships 4 write tools; they are denied in `.claude/settings.json` — **never edit `data/catalog.json`** |
| `memory` `@2026.7.4` | Keep notes across sessions | one graph file, `.mcp-memory/ws06-graph.json` (gitignored) | the only server here that writes by design |

Working rules for an agent in `app/`:

- Prefer the `catalog` tools over reading `data/catalog.json` and doing the
  arithmetic yourself — `lowStock` is `stock <= reorderLevel`, and re-deriving
  that rule from the data is exactly how it drifts to `<`.
- After changing anything in `src/`, run `npm run build`: the MCP server imports
  `dist/`, so a stale build means the server answers with old logic.
- Server versions in `.mcp.json` are pinned on purpose. Do not switch them to
  `@latest`.
- **Secrets: `${ENV_VAR}` only.** None of the three servers above needs a token,
  and that is deliberate. If a future server does, reference it in `.mcp.json`
  as `${SOME_TOKEN}`, put the value in `.env` (gitignored), and add the name to
  `.env.example`. A literal key must never appear in `.mcp.json`, in
  `.claude/settings.json`, or in any doc under `docs/` — including as an
  "example".
