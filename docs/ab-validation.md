# A/B-валідація MCP (Task D)

**Промпт (однаковий для A і B, дослівно з `materials/ab-question.md`):**

```text
Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.
```

**Хост / модель:** Claude Code 2.1.233, headless (`claude -p`), модель
`claude-sonnet-5`, Windows 11, Node 22.14.0
**Сервер під тестом:** `mcp-server/` — tools `search_inventory`, `check_stock`,
`low_stock`, `inventory_value`; resource `inventory://catalog`

**Що саме порівнюється.** Змінна рівно одна — **власний сервер `catalog`**.
`filesystem` і `memory` підключені в обох прогонах, вбудовані tools хоста теж
доступні в обох. Тому нижче навмисно написано «`catalog` підключено / не
підключено», а не «з MCP / без MCP»: MCP у прогоні B нікуди не дівся.

**Як забезпечено чистоту прогонів.** Кожен прогін — окремий процес `claude -p`,
тобто гарантовано новий чат без спільної історії. Конфіг MCP передавався явно
через `--strict-mcp-config --mcp-config`, щоб жоден сервер не «просочився» з
глобальних налаштувань: прогін A — `.mcp.json`, прогін B —
[`docs/mcp/mcp-run-b.json`](./mcp/mcp-run-b.json) (та сама копія без блоку
`catalog`, закомічена для відтворюваності). Набір дозволених tools в обох
прогонах однаковий (`Read`, `Glob`, `Grep`, `Bash`, `mcp__filesystem`).

## Ground truth

Порахований локально командою з `materials/ab-question.md`:

```bash
set -euo pipefail
cd app && npm run build
node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
```

```text
SKU, що потребують дозамовлення (9): DK-4001, WC-8002, DS-6002, MS-2001,
                                     MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Загальна вартість запасів: 46152
```

## Прогін A — сервер `catalog` підключено

Конфіг: `.mcp.json` як є (filesystem + memory + catalog). У `system/init`
хост відрапортував `catalog: connected`.

```bash
claude -p 'Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.' \
  --strict-mcp-config --mcp-config .mcp.json \
  --allowedTools "mcp__catalog" "mcp__filesystem" "Read" "Glob" "Grep" "Bash" \
  --output-format stream-json --verbose --model sonnet
```

**Що зробив агент:**

1. `ToolSearch` — підтягнув схеми `mcp__catalog__low_stock` і
   `mcp__catalog__inventory_value` (у цій збірці Claude Code MCP-tools
   вантажаться на вимогу);
2. `mcp__catalog__low_stock {}`;
3. `mcp__catalog__inventory_value {}`.

Файл `catalog.json` він не відкривав жодного разу — ні `Read`, ні `Bash`, ні
filesystem-сервером.

**Відповідь:**

```text
**9 SKUs need reordering:** DK-4001, WC-8002, DS-6002, MS-2001, MN-3002,
HS-5002, SS-1102, KB-1002, CB-7003

**Total inventory value: 46152**
```

**Правильно?** Так — і SKU, і сума збігаються з ground truth. 4 turns, 5.5 с.

## Прогін B — сервер `catalog` не підключено

**Як саме вимикали:** зроблено копію `.mcp.json` без запису `catalog` —
[`docs/mcp/mcp-run-b.json`](./mcp/mcp-run-b.json), закомічену поруч, — і
запущено новий процес:

```bash
claude -p 'Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.' \
  --strict-mcp-config --mcp-config docs/mcp/mcp-run-b.json \
  --allowedTools "mcp__filesystem" "Read" "Glob" "Grep" "Bash" \
  --output-format stream-json --verbose --model sonnet
```

`filesystem` і `memory` лишились підключеними — знімався рівно один сервер.
Оскільки це окремий процес, а не
перепідключення в живій сесії, старих tools у контексті бути не могло: у
`system/init` видно лише `filesystem` і `memory`. Прогін B зроблено **двічі**,
щоб побачити, наскільки поведінка стабільна.

**Що зробив агент (B1):** пішов роздивлятися репо — `cat AGENTS.md`, `glob`
по `mcp-server/`, `cat .mcp.json`, `ls mcp-server/dist src`, потім
`cat app/data/catalog.json` і порахував **у голові**, без жодного обчислення в
коді. 7 turns, 22.3 с.

**Відповідь (B1):** усі 9 правильних SKU з назвами й парами `stock/reorderLevel`,
`Total inventory value: 46152`. Перед відповіддю додав ремарку: «the custom
catalog MCP server isn't currently loaded in this session, I computed directly
from `app/data/catalog.json` (stock < reorderLevel …)».

**Що зробив агент (B2):** `ls` по репо, `Read` цілого `catalog.json`, потім
`node -e "const c = require('./app/data/catalog.json'); const reorder =
c.filter(p => p.stock < p.reorderLevel) …"` — тобто **сам переписав доменне
правило** у виразі bash-виклику. 5 turns, 13.8 с.

**Відповідь (B2):** ті самі 9 SKU, `46152`. Заголовок відповіді — «Needs
reordering (**stock < reorderLevel**)».

**Правильно?** Формально так — обидва рази. Але правило, за яким рахував агент,
**не те, що в домені**: `app/src/catalog.ts` визначає `lowStock` як
`stock <= reorderLevel`, а агент в обох прогонах B узяв строгий `<`. Різниці не
видно лише тому, що в засіяних даних немає жодного товару, у якого
`stock === reorderLevel` (перевірено: `<` дає 9, `<=` дає ті самі 9). Тобто
прогін B видав правильну відповідь із **неправильною бізнес-логікою** — і
жоден із двох прогонів не мав як про це дізнатися.

## Таблиця відмінностей

| Аспект | A (`catalog` підключено) | B (`catalog` не підключено) |
|---|---|---|
| Викликав tool власного сервера | так — `low_stock`, `inventory_value` | ні (їх не було); замість них `Bash cat` / `Read` + `node -e` |
| Список SKU повний | так (9/9) | так (9/9, обидва прогони) |
| Загальна сума точна | так (46152) | так (46152, обидва прогони) |
| Скільки кроків знадобилось | 4 turns / 5.5 с | 7 turns / 22.3 с (B1), 5 turns / 13.8 с (B2) |
| Звідки взялася бізнес-логіка | з тестованого `app/src/catalog.ts` | агент переписав її сам — і взяв `<` замість `<=` |
| Що потрапило в контекст | два короткі текстові результати | увесь `catalog.json` (24 товари) плюс блукання по репо |
| Впевненість відповіді vs її правильність | збігаються — число прийшло з коду | збігаються **випадково**: у даних немає граничного випадку, який викрив би `<` vs `<=` |
| Відтворюваність між прогонами | детермінована (та сама функція) | різна щоразу: B1 рахував подумки, B2 — через `node -e` |

## Висновок

Чесний результат близький до нульового за **правильністю**: без сервера
`catalog` агент двічі з двох прочитав `catalog.json` і видав ті самі 9 SKU й ті
самі 46152. Якщо міряти лише «правильна відповідь / ні», мій MCP-сервер не
змінив нічого — і вигадувати різницю тут не варто. Варто одразу зауважити, що
прогін B — це не «агент без інструментів»: у нього лишалися і `filesystem`, і
вбудований `Bash`, тобто доступ до даних нікуди не зникав. Знімалася рівно одна
річ — доменні tools.

Різниця в іншому і вона видима в логах. По-перше, ціна: 4 кроки й 5.5 с проти
5–7 кроків, 14–22 с і цілого JSON у контексті. По-друге і головне — **джерело
бізнес-правила**. У прогоні A «потребує дозамовлення» означає рівно те, що
написано в `lowStock()` і покрито тестами. У прогоні B агент щоразу
реконструював правило заново і обидва рази взяв `stock < reorderLevel` замість
`<=`; на цих даних це непомітно, бо жоден товар не стоїть рівно на межі. Тобто
без сервера я отримав правильне число і неправильне правило — найгірший вид
успіху, бо він не сигналізує про себе.

Звідси й практичний критерій, коли власний MCP-сервер вартий своєї ціни: не
тоді, коли модель «не дістане дані» (Bash дістане майже завжди), а тоді, коли
відповідь має відповідати **одному конкретному визначенню**, яке живе в коді й
має право змінюватися. Для «покажи мені файл» сервер зайвий. Для «що вважається
дефіцитом», «як рахується вартість запасів», «яка знижка застосовна» — сервер
перетворює домовленість команди на єдине джерело правди, замість того щоб
щоразу покладатися на реконструкцію правила з даних.
