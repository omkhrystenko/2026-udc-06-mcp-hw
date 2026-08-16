# Task E (bonus) — Шлях 2: дебаг через MCP Inspector

**Що робили:** ганяли власний сервер (`mcp-server/`) Інспектором у CLI-режимі,
без жодного хоста — щоб відділити «сервер зламаний» від «модель не захотіла
викликати tool».

```bash
cd mcp-server
npx -y @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
npx -y @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/list
npx -y @modelcontextprotocol/inspector --cli node ./dist/server.js \
  --method tools/call --tool-name check_stock --tool-arg sku=ZZ-9999
```

## Що побачили

- **4 tools і 1 resource** — рівно те, що зареєстровано: `search_inventory`,
  `check_stock`, `low_stock`, `inventory_value`, і `inventory://catalog`.
- **Згенеровані JSON-схеми** з zod: у `low_stock` та `inventory_value`
  `"properties": {}` без `required` — тобто хост коректно бачить їх як tools
  без аргументів.
- **Анотації дійшли до клієнта:** у кожному tool
  `"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false`.
  Це видно саме в `tools/list` — у чаті цього не побачиш ніяк.
- **Помилки — це теж дані.** Виклик `check_stock` з неіснуючим SKU повертає
  `isError: true` з текстом-підказкою, а не падає:
  `No product with SKU "ZZ-9999". Use search_inventory to find the right one.`
- **Попередження самого Інспектора:** `@modelcontextprotocol/inspector v1 is
  deprecated … v1 receives security fixes only`. Дрібниця, але показова: навіть
  дебаг-інструмент у цій екосистемі рухається швидше за туторіали.

## Що знайшли й полагодили завдяки цьому

**Знайдений баг: `search_inventory` без аргументу падав на валідації.**
Виклик без `query` повертав:

```
Input validation error: Invalid arguments for tool search_inventory:
query: Invalid input: expected string, received undefined
```

Це суперечило домену: `searchProducts(catalog, "")` за контрактом повертає
**весь каталог**, тобто «покажи всі товари» — легітимний сценарій, який схема
просто не пускала. У чаті це виглядало б як «модель чомусь не викликає tool»
або як помилка, яку модель тихо обійде іншим шляхом — і причину шукали б у
промпті, а не в схемі.

Фікс — зробити параметр необов'язковим із дефолтом (`mcp-server/src/server.ts`):

```ts
query: z
  .string()
  .optional()
  .default("")
  .describe(
    "Free-text match on product name, SKU, or category. Omit or pass an empty string for all products.",
  ),
```

Після перезбірки той самий виклик без аргументів повертає всі 24 товари.

**Другий, дрібніший результат:** підтвердили, що `loadCatalog()` не залежить
від cwd. Інспектор запускає сервер як окремий процес — і читання
`app/data/catalog.json` спрацювало, бо шлях у `loader.ts` обчислюється від
`import.meta.url`, а не від робочого каталогу. Це та сама пастка, що й з
`../../app/dist/index.js`: у хості перевірити її важче, бо незрозуміло, з якого
каталогу він стартував.

## Висновок

Інспектор дає те, чого чат не дає в принципі: **сирий бік протоколу**. У чаті
видно тільки «модель викликала / не викликала tool», і будь-яка проблема
виглядає як проблема промпта. В Інспекторі видно згенеровану схему, анотації,
точний текст помилки валідації й відповідь tool до того, як її перепише модель.
Баг зі `search_inventory` — рівно той клас проблем, який без Інспектора шукали б
годину не там: сервер працював, tool був зареєстрований, опис був нормальний, а
не працював контракт схеми.

Практичний висновок для себе: `tools/list` через Інспектор — перший крок після
кожної зміни сервера, ще до перезапуску хоста.
