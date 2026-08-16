/**
 * catalog-server — read-only MCP server over the seeded product catalog.
 *
 * Built against SDK **v2** (`@modelcontextprotocol/server` 2.0.0): signatures
 * checked against the installed `dist/*.d.mts`, not against a blog post.
 *
 * Design rule: this file contains NO catalog logic. Every answer comes from
 * `app/dist/index.js` — the server is a protocol adapter, nothing more.
 * Read-only by construction: no writes, no deletes, no network, no exec.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

// `src/` and `dist/` sit at the same depth on purpose — tsc does not rewrite
// relative imports, so this specifier is valid in both source and build.
import {
  loadCatalog,
  searchProducts,
  findBySku,
  lowStock,
  inventoryValue,
  categories,
  type Product,
} from "../../app/dist/index.js";

const server = new McpServer({
  name: "catalog-server",
  version: "1.0.0",
});

/** One-line rendering used by every tool, so output stays consistent. */
const line = (p: Product) =>
  `${p.sku} — ${p.name} (${p.category}) · price ${p.price} · stock ${p.stock} · reorder at ${p.reorderLevel}`;

/** Everything here reads; nothing mutates. Advertised to the host as such. */
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

// ── Tool 1 — search ───────────────────────────────────────────────────────
server.registerTool(
  "search_inventory",
  {
    title: "Search inventory",
    description:
      "Search the product catalog by name, SKU, or category (case-insensitive " +
      "substring match). Use when the user asks which products exist, asks " +
      "about a category such as 'audio' or 'cables', or names a product " +
      "without knowing its SKU. An empty query returns the whole catalog.",
    inputSchema: z.object({
      // Optional on purpose: the domain treats an empty query as "everything",
      // and Inspector showed the required form made "list all products" fail
      // schema validation instead of returning the catalog.
      query: z
        .string()
        .optional()
        .default("")
        .describe(
          "Free-text match on product name, SKU, or category. Omit or pass an empty string for all products.",
        ),
    }),
    annotations: readOnly,
  },
  async ({ query }) => {
    const results = searchProducts(loadCatalog(), query);
    return {
      content: [
        {
          type: "text",
          text:
            results.length === 0
              ? `No products matched "${query}".`
              : `${results.length} product(s) matched "${query}":\n` +
                results.map(line).join("\n"),
        },
      ],
    };
  },
);

// ── Tool 2 — stock for one SKU ────────────────────────────────────────────
server.registerTool(
  "check_stock",
  {
    title: "Check stock for a SKU",
    description:
      "Report current stock for one exact SKU (format XX-9999, e.g. KB-1001) " +
      "and whether it is at or below its reorder level. Use when the user " +
      "names a specific SKU and asks how many are on hand or whether it needs " +
      "restocking. If the SKU is unknown, use search_inventory first.",
    inputSchema: z.object({
      sku: z
        .string()
        .describe("Exact product SKU, e.g. 'KB-1001'. Case-insensitive."),
    }),
    annotations: readOnly,
  },
  async ({ sku }) => {
    const catalog = loadCatalog();
    const product = findBySku(catalog, sku);
    if (!product) {
      return {
        content: [
          {
            type: "text",
            text: `No product with SKU "${sku}". Use search_inventory to find the right one.`,
          },
        ],
        isError: true,
      };
    }
    // Ask the domain, don't restate the rule: `lowStock` owns the definition
    // of "needs reordering" (and its boundary is `<=`, not `<`). Re-deriving
    // it here is exactly the drift this server exists to prevent.
    const needsReorder = lowStock(catalog).some((p) => p.sku === product.sku);
    return {
      content: [
        {
          type: "text",
          text:
            `${line(product)}\n` +
            (needsReorder
              ? `NEEDS REORDERING — stock ${product.stock} is at or below reorder level ${product.reorderLevel}.`
              : `Stock is healthy — ${product.stock - product.reorderLevel} unit(s) above the reorder level.`),
        },
      ],
    };
  },
);

// ── Tool 3 — the reorder list ─────────────────────────────────────────────
server.registerTool(
  "low_stock",
  {
    title: "Items needing reorder",
    description:
      "List every product whose stock is at or below its reorder level, " +
      "lowest stock first. Use when the user asks what needs reordering, " +
      "what is running out, or what to restock. Takes no arguments and " +
      "always reflects the current catalog.",
    inputSchema: z.object({}),
    annotations: readOnly,
  },
  async () => {
    const items = lowStock(loadCatalog());
    return {
      content: [
        {
          type: "text",
          text:
            items.length === 0
              ? "Nothing needs reordering — every product is above its reorder level."
              : `${items.length} product(s) need reordering:\n` +
                items.map(line).join("\n") +
                `\nSKUs: ${items.map((p) => p.sku).join(", ")}`,
        },
      ],
    };
  },
);

// ── Tool 4 — the aggregate the model cannot guess ─────────────────────────
server.registerTool(
  "inventory_value",
  {
    title: "Total inventory value",
    description:
      "Compute the total value of stock on hand as sum(price × stock) across " +
      "the whole catalog, rounded to cents. Use when the user asks for total " +
      "inventory value, tied-up capital, or the worth of current stock. " +
      "Prefer this over adding the numbers up yourself — the arithmetic is " +
      "done in tested domain code.",
    inputSchema: z.object({}),
    annotations: readOnly,
  },
  async () => {
    const catalog = loadCatalog();
    return {
      content: [
        {
          type: "text",
          text: `Total inventory value across ${catalog.length} products: ${inventoryValue(catalog)}`,
        },
      ],
    };
  },
);

// ── Resource — application-read context, not model-invoked ────────────────
server.registerResource(
  "catalog-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Current state of the catalog: product count, categories, total " +
      "inventory value and how many items need reordering.",
    mimeType: "application/json",
  },
  async (uri) => {
    const catalog = loadCatalog();
    const summary = {
      productCount: catalog.length,
      categories: categories(catalog),
      totalInventoryValue: inventoryValue(catalog),
      needsReorder: lowStock(catalog).map((p) => p.sku),
    };
    return {
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(summary, null, 2) },
      ],
    };
  },
);

// ── Connect ───────────────────────────────────────────────────────────────
// stdio: the host launches this process. stdout carries protocol messages
// only — all diagnostics go to stderr.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("catalog-server ready (read-only, stdio)");
