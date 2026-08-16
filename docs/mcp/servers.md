# MCP-сервери проєкту (Task A)

**Хост(и), у якому налаштовано:** Claude Code 2.1.233 (модель `claude-sonnet-5`),
Windows 11, Node 22.14.0
**Файл конфігурації:** [`.mcp.json`](../../.mcp.json) у корені репо (project-scoped,
закомічений) + [`.claude/settings.json`](../../.claude/settings.json) — permission-правила
поверх нього.

Підключено три сервери: два публічних (**filesystem**, **memory**) і один
власний (**catalog**, Task B). `uv`/Python на машині немає, тому свідомо взято
два npx-сервери, а не `git`/`fetch` — див. «Що НЕ підключали».

---

## Сервер 1 — filesystem (`@modelcontextprotocol/server-filesystem`)

| | |
|---|---|
| **Навіщо** | Дати агенту читати сирі дані каталогу без запуску shell — і, головне, мати чесний baseline для Task D: у прогоні B агент має чимось читати `catalog.json`. |
| **Транспорт** | stdio (хост сам запускає процес) |
| **Як запускається** | `npx -y @modelcontextprotocol/server-filesystem@2026.7.10 ./app/data` |
| **Область доступу (scope)** | **Тільки `./app/data`** — одна тека з одним файлом `catalog.json`. Не домашня тека, не корінь репо: усе, що серверу потрібно, лежить там. Решта репо (`.env`, `node_modules`, `.git`) фізично поза його областю. |
| **Секрети** | Немає — токен не потрібен |
| **Версія** | Зафіксована `@2026.7.10`, не `@latest`: інакше кожен запуск `npx` може підтягнути новий код у мій агент без мого відома |

**Які tools він дав агенту (14, реально з `tools/list`):** `read_file`,
`read_text_file`, `read_media_file`, `read_multiple_files`, `write_file`,
`edit_file`, `create_directory`, `list_directory`,
`list_directory_with_sizes`, `directory_tree`, `move_file`, `search_files`,
`get_file_info`, `list_allowed_directories`.

⚠️ **Чотири з них пишуть** (`write_file`, `edit_file`, `create_directory`,
`move_file`) — і пишуть саме в ту теку, де лежить `catalog.json`, який
редагувати заборонено. Пакет називається «secure filesystem server», але
read-only-режиму в нього немає. Тому вони явно заборонені в
`.claude/settings.json` (`permissions.deny`), а не «ми ж не будемо їх
викликати». Деталі — у [`SECURITY.md`](./SECURITY.md).

**Перевірка, що працює:** `tools/list` + виклик `list_allowed_directories`
напряму по stdio. У stderr сервера видно рядок, заради якого й варто було
дивитися:

```text
Secure MCP Filesystem Server running on stdio
Client does not support MCP Roots, using allowed directories set from server args: [
  'D:\\...\\2026-udc-06-mcp-hw\\app\\data'
]
```

Тобто в моєму випадку scope справді визначає аргумент із конфігу, бо клієнт
(мій тестовий stdio-харнес) не підтримує `roots`. Якби підтримував — область
доступу задавав би **хост**, а мій аргумент став би просто запасним варіантом.
І це в будь-якому разі не механізм безпеки: за специфікацією сервер `SHOULD`
поважати roots, а не `MUST`, і в ревізії `2026-07-28` вони позначені як
deprecated. Справжня межа — права ОС/пісочниця, а не рядок у конфізі.
Відносний шлях `./app/data` сервер коректно розгорнув в абсолютний від cwd
процесу — але саме тому він і працює лише тоді, коли хост стартує з кореня
репо.

---

## Сервер 2 — memory (`@modelcontextprotocol/server-memory`)

| | |
|---|---|
| **Навіщо** | Knowledge graph між сесіями: зафіксувати висновки по домашці (які SKU в дефіциті, які рішення щодо scope) так, щоб вони пережили новий чат. Це єдиний сервер тут, який щось запам'ятовує. |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-memory@2026.7.4` |
| **Область доступу (scope)** | Один файл графа — `MEMORY_FILE_PATH=./.mcp-memory/ws06-graph.json`. За замовчуванням сервер пише граф поруч зі своїм пакетом у `node_modules`, тобто **глобально для всіх проєктів**; явний шлях робить пам'ять локальною для цього репо. Тека в `.gitignore`. |
| **Секрети** | Немає |
| **Версія** | Зафіксована `@2026.7.4` |

**Які tools він дав агенту (9):** `create_entities`, `create_relations`,
`add_observations`, `delete_entities`, `delete_observations`,
`delete_relations`, `read_graph`, `search_nodes`, `open_nodes`.

⚠️ Шість із дев'яти — **із побічним ефектом** (створення/видалення вузлів
графа). Це прийнято свідомо: сервер без запису безглуздий, а писати він може
рівно в один гітігнорений файл.

**Перевірка, що працює:** `initialize` + `tools/list` по stdio → у stderr
`Knowledge Graph MCP Server running on stdio`, у відповіді — усі 9 tools.

---

## Сервер 3 — catalog (власний, Task B)

| | |
|---|---|
| **Навіщо** | Виставити доменні функції каталогу як tools, щоб відповіді рахувалися тестованим кодом, а не арифметикою моделі |
| **Транспорт** | stdio |
| **Як запускається** | `node ./mcp-server/dist/server.js` |
| **Область доступу (scope)** | Жодного доступу до ФС із самого сервера: він імпортує `app/dist/index.js`, а той читає рівно один файл `app/data/catalog.json` (шлях обчислено від файлу модуля, не від cwd). Мережі немає, запису немає. |
| **Секрети** | Немає |
| **Версія** | Локальний код у цьому ж репо; SDK `@modelcontextprotocol/server@^2.0.0` (v2), `zod@^4.2.0` |

**Tools:** `search_inventory`, `check_stock`, `low_stock`, `inventory_value` —
усі з `annotations.readOnlyHint: true`.
**Resource:** `inventory://catalog` — JSON-зведення (кількість товарів,
категорії, загальна вартість, список SKU на дозамовлення).

**Перевірка, що працює:** з кореня репо — `npx -y
@modelcontextprotocol/inspector --cli node ./mcp-server/dist/server.js --method
tools/list` (див. [`task-e-bonus.md`](../task-e-bonus.md))
і реальний прогін у Claude Code — агент викликав `mcp__catalog__low_stock` та
`mcp__catalog__inventory_value` (див. [`ab-validation.md`](../ab-validation.md)).

---

## Що НЕ підключали і чому

- **`git` і `fetch`** (`uvx`) — потребують Python + `uv`, яких на машині немає.
  Ставити рантайм заради двох tools — гірший обмін, ніж узяти два npx-сервери.
  Окремо про `fetch`: він тягне **довільний контент з інтернету** просто в
  контекст агента. Це найпряміший канал prompt injection у всьому списку, і в
  репо, де агент має право писати файли, я його свідомо не вмикаю.
- **GitHub MCP** — потрібен токен. Для цієї домашки він не закриває жодної
  задачі, а додає в гру секрет із правами на мої репозиторії. Класичний випадок,
  коли «підключити про всяк випадок» коштує дорожче за користь.
- **Будь-який сервер із `@latest`** — не через сервер, а через тег: незакріплена
  версія означає, що код у моєму агенті може змінитися між двома запусками.

## Область доступу — головне

Найважливіший рядок усього конфіга — `"./app/data"` в аргументах filesystem.
Він же й найкрихкіший: це **аргумент**, а не гарантія. Якщо хост підтримує
`roots`, він перевизначить область; якщо процес запустять з іншого cwd —
відносний шлях розгорнеться в інше місце. Тому scope тут тримається на трьох
речах одночасно: вузький аргумент, `deny` на write-tools у
`.claude/settings.json` і те, що дані все одно синтетичні й лежать під git.
