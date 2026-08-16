# catalog-server — власний MCP-сервер (Task B)

Read-only MCP-сервер над засіяним каталогом товарів. Уся доменна логіка
**імпортована** з `app/dist/index.js` — у цьому пакеті немає жодного правила
каталогу, лише адаптер протоколу.

## Запуск

```bash
cd app && npm install && npm run build && cd ..   # спершу зібрати домен
cd mcp-server && npm install && npm run build
node ./dist/server.js                             # висить і чекає JSON-RPC у stdin — це норма
```

У конфізі хоста (`.mcp.json` у корені репо):

```json
"catalog": { "command": "node", "args": ["./mcp-server/dist/server.js"] }
```

## Що виставляє

| Тип | Ім'я | Що робить |
|---|---|---|
| tool | `search_inventory(query?)` | `searchProducts` — пошук за назвою, SKU або категорією; без аргументу повертає весь каталог |
| tool | `check_stock(sku)` | `findBySku` + порівняння `stock` із `reorderLevel`; на невідомий SKU повертає `isError` з підказкою |
| tool | `low_stock()` | `lowStock` — усе, що на межі дозамовлення або нижче (`stock <= reorderLevel`) |
| tool | `inventory_value()` | `inventoryValue` — `sum(price × stock)`, округлено до копійок |
| resource | `inventory://catalog` | JSON-зведення: кількість товарів, категорії, загальна вартість, SKU на дозамовлення |

Усі tools мають `annotations.readOnlyHint: true`, `destructiveHint: false`,
`openWorldHint: false`. Запису, видалення й мережевих викликів немає взагалі —
ні `fs.write*`, ні `fetch`, ні `child_process`.

## Версія SDK

**v2** — `@modelcontextprotocol/server@2.0.0` (+ `zod@4`). Сигнатури
`registerTool` / `registerResource` звірені з `.d.mts` встановленого пакета, не
зі статті. Якщо збиратимете під v1 (`@modelcontextprotocol/sdk`) — імпорти й
сигнатури інші.

## Розкладка

`src/` і `dist/` навмисно на однаковій глибині: TypeScript не переписує
відносні імпорти, тож `../../app/dist/index.js` коректний і в джерелі, і в
збірці. Шлях до `catalog.json` рахується в `app/src/loader.ts` від
`import.meta.url`, тому сервер не залежить від того, з якого cwd його запустив
хост.

## Перевірка

```bash
npx -y @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
npx -y @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/list
npx -y @modelcontextprotocol/inspector --cli node ./dist/server.js \
  --method tools/call --tool-name check_stock --tool-arg sku=KB-1002
```

Або напряму по stdio, без Inspector:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node ./dist/server.js
```

Що знайшов Inspector і що це полагодило — у `docs/task-e-bonus.md`.
