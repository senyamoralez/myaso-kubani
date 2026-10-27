#!/usr/bin/env python3
"""Assembles page.html (v3 with catalog views) from the v2.2 base + parts."""
import re, json
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, 'tools')
base = open(T + '/base.html', encoding='utf-8').read()
s = base
def rep(a, b, n=1):
    global s
    assert s.count(a) == n, (s.count(a), a[:80])
    s = s.replace(a, b)
def cut(a, b, new, include_b=False):
    global s
    i = s.index(a); j = s.index(b, i)
    if include_b: j += len(b)
    s = s[:i] + new + s[j:]

# CSS
rep('/* ============ Compact phone layout ============ */', open(T + '/cat.css', encoding='utf-8').read() + open(T + '/account.css', encoding='utf-8').read() + open(T + '/admin.css', encoding='utf-8').read() + '\n/* ============ Compact phone layout ============ */')

# header nav -> categories
cut('<nav class="nav" aria-label="Разделы">', '</nav>', '<nav class="nav" aria-label="Каталог">\n      <a href="#meat">Мясо</a><a href="#steaks">Стейки</a><a href="#cheese">Сыры</a><a href="#dairy">Молочка</a><a href="#italian">Итальянские сыры</a><a href="#sausage">Колбаса</a><a href="#fish">Рыба и икра</a><a href="#ready">Полуфабрикаты</a>\n    ', include_b=False)
# search button in header (before account button)
rep('<button class="acc-btn" id="accBtn"', '<a class="srch-btn" href="#search" aria-label="Поиск по каталогу"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5.2" stroke="currentColor" stroke-width="1.4"/><path d="M11 11l4 4" stroke="currentColor" stroke-width="1.4"/></svg></a>\n    <button class="acc-btn" id="accBtn"')
# mobile menu
cut('<nav aria-label="Меню">', '</nav>', '''<nav aria-label="Меню">
      <a href="#search">Поиск <span>по каталогу</span></a><a href="#meat">Мясо</a><a href="#steaks">Стейки</a><a href="#cheese">Сыры</a><a href="#dairy">Молочка</a><a href="#italian">Итальянские сыры</a><a href="#sausage">Колбаса</a><a href="#fish">Рыба и икра</a><a href="#ready">Полуфабрикаты</a>
      <a href="#contact">Адреса</a>
    ''')

# home wrapper + category section, drop old cut index & cheese rail
rep('<main id="top">', '<main id="top">\n<div id="home">')
cut('<!-- 3a. CUT INDEX -->', '<!-- 3b. DONENESS -->', '')
cut('<!-- 3c. CHEESE -->', '<!-- 4. PROOF -->', '')
rep('<!-- 2. PROBLEM / SOLUTION -->', '''<!-- CATALOG INDEX -->
<section class="cats" id="catalog" aria-labelledby="catsH">
  <div class="wrap">
    <div class="cats-head"><p class="mono">Каталог · 8 разделов</p><h2 id="catsH">Всё к столу <em>в одной лавке</em></h2></div>
    <form class="srch-f home-srch" id="homeSrch" role="search"><span class="srch-i"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5.2" stroke="currentColor" stroke-width="1.4"/><path d="M11 11l4 4" stroke="currentColor" stroke-width="1.4"/></svg></span><input type="search" enterkeyhint="search" autocomplete="off" placeholder="Найти товар, например «мозговые кости»" aria-label="Поиск по каталогу"><button class="srch-go" type="submit">Найти</button></form>
    <div class="tiles" id="tiles"></div>
  </div>
</section>

<!-- 2. PROBLEM / SOLUTION -->''')
rep('</section>\n</main>', '</section>\n</div>\n<div class="view" id="catView" hidden></div>\n<div class="view" id="staffView" hidden></div>\n<div class="view" id="accView" hidden></div>\n<div class="view" id="legalView" hidden></div>\n<div class="view" id="adminView" hidden></div>\n</main>')
rep('<a class="btn btn-fill" href="#cuts">Выбрать отруб <span class="ar">→</span></a>', '<a class="btn btn-fill" href="#steaks">Выбрать стейк <span class="ar">→</span></a>')
rep('<a class="btn btn-ink" href="#cuts">К отрубам <span class="ar">→</span></a>', '<a class="btn btn-ink" href="#catalog">В каталог <span class="ar">→</span></a>')
rep('<nav aria-label="Ссылки">', '<nav aria-label="Ссылки"><a href="#staff">Бот для сотрудников · демо</a>')
rep('<span>© 2026 · Цены на сайте не являются публичной офертой</span>', '<span>© 2026 · Цены на сайте не являются публичной офертой</span>\n    <nav class="ftr-legal" aria-label="Документы"><a href="#privacy">Политика конфиденциальности</a><a href="#consent">Согласие на обработку персональных данных</a><a href="#admin">Вход для сотрудников</a></nav>')
rep('Оплата картой, по СБП или наличными.', 'Заказ оплачен на сайте, курьеру ничего платить не нужно.') if 'Оплата картой, по СБП или наличными.' in s else None

# script
js_old = s[s.index('<script>\n(function(){'):s.index('</script>', s.index('<script>\n(function(){'))]
def block(a, b):
    i = js_old.index(a); j = js_old.index(b, i); return js_old[i:j]
hero_hdr = block('/* hero specimen parallax */', '/* ---------- 3a. cut index ---------- */')
done = block('/* ---------- 3b. doneness ---------- */', '/* ---------- 3c. cheese rail ---------- */')
proc_offer = block('/* ---------- 5. process ---------- */', '/* ---------- cart drawer ---------- */')
cat = json.load(open(T + '/catalog.json', encoding='utf-8'))
head = open(T + '/head.js', encoding='utf-8').read().replace('/*CATALOG*/{"items":[],"covers":{}}/*END*/', json.dumps(cat, ensure_ascii=False))
tail = open(T + '/legal.js', encoding='utf-8').read() + '\n' + open(T + '/account.js', encoding='utf-8').read() + '\n' + open(T + '/admin.js', encoding='utf-8').read() + '\n' + open(T + '/tail.js', encoding='utf-8').read()
new_js = '<!-- Адрес сервера заказов. Пусто = демо-режим без отправки. Пример: https://api.myaso-kubani.ru -->\n<script>window.SHOP_API="https://myaso-kubani.senyamoralez.workers.dev";</script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>\n<script>\n' + head + '\n' + hero_hdr + '\n' + done + '\n' + proc_offer + '\n' + tail + '\n'
new_js = new_js.replace("$('#menu').innerHTML=", "if($('#menu'))$('#menu').innerHTML=")
s = s.replace(js_old, new_js)
s = s.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>\n<script>\n<script', '<script')
assert 'qrcode.min.js' in s
css = s[s.index('<style>'):s.index('</style>')]
assert css.count('{') == css.count('}'), 'css braces'
open(T + '/page.html', 'w', encoding='utf-8').write(s)
print('ok', len(s))
