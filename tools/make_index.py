import re, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s=open(os.path.join(ROOT, 'tools', 'page.html'),encoding='utf-8').read()
head,body=s.split('<!--/HEAD-->',1)
body=re.sub(r'<!--MAP-->.*?<!--/MAP-->','<iframe src="https://yandex.ru/map-widget/v1/org/myaso_kubani_i_steyki/72276710971/?theme=dark&z=16" title="Карта: Мясо Кубани и стейки" loading="lazy" allowfullscreen></iframe>',body,flags=re.S)
doc=f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#141010">
<meta property="og:title" content="Мясо Кубани и стейки">
<meta property="og:description" content="Мраморная говядина, вагю и костромские сыры. Доставка по Москве.">
<meta property="og:image" content="img/ribeye-steaks.jpg">
{head.strip()}
</head>
<body>
{body.strip()}
</body>
</html>
'''
open(os.path.join(ROOT, 'site', 'index.html'),'w',encoding='utf-8').write(doc)
print('ok',len(doc))

import subprocess, sys
if subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'check_js.py')]).returncode:
    sys.exit('site/index.html собран, но в скриптах ошибка — не публикуйте')
