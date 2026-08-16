#!/usr/bin/env node
/**
 * Launcher for @modelcontextprotocol/server-memory.
 *
 * Why this exists: the memory server resolves a relative MEMORY_FILE_PATH
 * against its own module directory — inside the npx cache — not against cwd,
 * and it never creates the parent directory. So the obvious
 * `"MEMORY_FILE_PATH": "./.mcp-memory/ws06-graph.json"` does not put the graph
 * in this repo; it fails with:
 *
 *   ENOENT: no such file or directory, open
 *   'C:\Users\...\npm-cache\_npx\<hash>\node_modules\@modelcontextprotocol\
 *    server-memory\dist\.mcp-memory\ws06-graph.json'
 *
 * This wrapper computes the path from its OWN location (repo root), creates the
 * directory, and passes an absolute MEMORY_FILE_PATH down. That keeps the graph
 * repo-local and cwd-independent, whatever directory the host launches us from.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const memoryFile = resolve(repoRoot, ".mcp-memory", "ws06-graph.json");
mkdirSync(dirname(memoryFile), { recursive: true });

// Pinned on purpose — see docs/mcp/SECURITY.md.
const child = spawn(
  "npx",
  ["-y", "@modelcontextprotocol/server-memory@2026.7.4"],
  {
    stdio: "inherit", // stdio transport: the host talks straight to the child
    env: { ...process.env, MEMORY_FILE_PATH: memoryFile },
    shell: process.platform === "win32", // npx is a .cmd shim on Windows
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
