# Сервер лавки на Cloudflare Workers

Бесплатно, работает круглосуточно, HTTPS сразу. Логика та же, что в `bot/` (`bot/core.js`): заказы, личный кабинет, бонусы, Telegram-бот для сотрудников.
Если Cloudflare станет неудобен (закон о хранении данных в РФ, замедление в России), тот же код запускается на любом VPS: см. `bot/README.md`.

## Как устроено

- `src/index.js` принимает запросы сайта и вебхук Telegram. Всё обрабатывает один Durable Object `Shop`, он же хранит базу.
- Вебхук Telegram подключается сам при первом обращении к серверу.
- Раз в 5 минут срабатывает расписание: итоги дня в 21:00, бонусы на день рождения, уборка старых сессий.
- Настройки (адрес сайта, доставка, бонусы) — в `wrangler.toml`. Секрет `BOT_TOKEN` хранится только в Cloudflare.

## Запуск (один раз)

1. **Бот.** В Telegram откройте @BotFather → `/newbot` → придумайте имя и адрес (должен заканчиваться на `bot`). Скопируйте токен.
2. **Cloudflare.** Workers & Pages → Create → Import a repository → `senyamoralez/myaso-kubani`.
   - Project name: `myaso-kubani`
   - Root directory (Advanced): `worker`
   - Deploy command: `npx wrangler deploy`
3. После первого деплоя: Settings → Variables and Secrets → Add → тип **Secret**, имя `BOT_TOKEN`, значение — токен из BotFather → Deploy.
4. Откройте `https://myaso-kubani.<ваш-поддомен>.workers.dev/health`. Должно быть `"bot": "имя_бота"`.
5. **Рабочий чат.** Создайте группу в Telegram, добавьте бота и сотрудников, напишите в группе `/staff`.
6. **QR для оплаты.** Отправьте в эту группу картинку QR-кода СБП с подписью `/qr`.
7. **Сайт.** В `tools/assemble.py` впишите адрес воркера в `window.SHOP_API`, пересоберите и запушьте.

Дальше каждый push в `main` обновляет и сайт (GitHub Pages), и сервер (Cloudflare).

## Проверка

```bash
cd worker && npm install && npm test   # проверки воркера + все сценарии bot/test в среде Cloudflare
```
