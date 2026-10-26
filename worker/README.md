# Сервер лавки на Cloudflare Workers

Бесплатно, работает круглосуточно, HTTPS сразу. Логика та же, что в `bot/` (`bot/core.js`): заказы, личный кабинет, бонусы, Telegram-бот для сотрудников.
Если Cloudflare станет неудобен (закон о хранении данных в РФ, замедление в России), тот же код запускается на любом VPS: см. `bot/README.md`.

## Как устроено

- `src/index.js` принимает запросы сайта и вебхук Telegram. Всё обрабатывает один Durable Object `Shop`, он же хранит базу.
- Вебхук Telegram подключается сам при первом обращении к серверу.
- Раз в 5 минут срабатывает расписание: итоги дня в 21:00, бонусы на день рождения, уборка старых сессий.
- Настройки (адрес сайта, доставка, бонусы) — в `wrangler.toml`. Секрет `BOT_TOKEN` хранится только в Cloudflare.

## Запуск (один раз)

Деплой делает GitHub Actions (`.github/workflows/worker.yml`) при каждом push в `main`: тесты → `wrangler deploy` → токен бота.

1. **Бот.** В Telegram: @BotFather → `/newbot` → имя и адрес на `…bot`. Скопируйте токен.
2. **Токен Cloudflare.** dash.cloudflare.com → My Profile → API Tokens → Create Token → шаблон «Edit Cloudflare Workers» → Continue → Create. Скопируйте токен.
3. **Секреты в GitHub.** Репозиторий → Settings → Secrets and variables → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN` — токен из шага 2;
   - `BOT_TOKEN` — токен из шага 1.
4. Actions → «Сервер на Cloudflare» → Run workflow. В конце шаг «Проверка сервера» покажет `"bot": "имя_бота"`.
5. **Рабочий чат.** Создайте группу в Telegram, добавьте бота и сотрудников, напишите в группе `/staff`.
6. **QR для оплаты.** Отправьте в эту группу картинку QR-кода СБП с подписью `/qr`.
7. **Сайт.** Адрес воркера прописан в `window.SHOP_API` (`tools/assemble.py`). Пустая строка — демо-режим без сервера.

Адрес сервера: `https://myaso-kubani.senyamoralez.workers.dev`.

## Проверка

```bash
cd worker && npm install && npm test   # проверки воркера + все сценарии bot/test в среде Cloudflare
```
