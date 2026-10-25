#!/usr/bin/env python3
"""Builds the product catalog JSON for the site from own photos and supplier manifests."""
import json, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
SRC = os.path.join(ROOT, 'tools', 'src')   # распакованные фото поставщиков (в репозиторий не входят)
OUT = SITE + '/img/p'
os.makedirs(OUT, exist_ok=True)

items, covers = [], {}
SUBN = {
 'beef':'Говядина','lamb':'Баранина и ягнятина','veal':'Телятина','bird':'Птица',
 'wagyu':'Вагю','premium':'Премиальные','alt':'Альтернативные',
 'bogovarovo':'Боговарово','gorka':'Горка',
 'milk':'Молоко и кефир','cream':'Сметана и сливки','butter':'Масло','tvorog':'Творог и десерты',
 'it':'Итальянские','mold':'С белой плесенью',
 'kolbasa':'Колбасы','deli':'Деликатесы',
 'black':'Чёрная икра','red':'Красная икра','cans':'Консервы',
 'grill':'Для гриля','farsh':'Фарш и котлеты','sausages':'Колбаски','bbq':'Для гриля',
}
seen_names = set()

def slug(s):
    t = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'}
    s = ''.join(t.get(c, c) for c in s.lower())
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:40]

def img_out(path, name, keep_alpha=False, maxw=900):
    if not path or not os.path.exists(path):
        return ''
    im = Image.open(path)
    alpha = keep_alpha or (im.mode in ('RGBA', 'LA') or 'transparency' in im.info)
    im.thumbnail((maxw, maxw))
    if alpha:
        fn = name + '.webp'; im.convert('RGBA').save(f'{OUT}/{fn}', quality=84, method=5)
    else:
        fn = name + '.jpg'; im.convert('RGB').save(f'{OUT}/{fn}', quality=82, optimize=True, progressive=True)
    return 'img/p/' + fn

def add(cat, sub, name, price, unit='kg', img='', fit='contain', note='', src='', tag='', w=None, pp=None, step=None, mn=None, iid=None):
    key = (cat, re.sub(r'\s+', ' ', name.lower()).strip())
    if key in seen_names:
        return
    seen_names.add(key)
    it = dict(id=iid or slug(cat + '-' + name), cat=cat, sub=sub, subName=SUBN.get(sub, ''), name=name.strip(), price=price, unit=unit, img=img, fit=fit)
    for k, v in (('note', note), ('src', src), ('tag', tag), ('w', w), ('pp', pp), ('step', step), ('min', mn)):
        if v not in (None, ''):
            it[k] = v
    items.append(it)

# ---------- own photos ----------
add('steaks','wagyu','Вагю A5, рибай',28000,'kg','img/wagyu-a5.jpg','cover','Высшая категория японской оценки, BMS 10–12. Режем от 200 г.','Япония','BMS 10–12',step=.1,mn=.2,iid='a5')
add('steaks','wagyu','Стриплойн вагю',8500,'kg','img/striploin-wagyu.jpg','cover','Толстый край с жировой корочкой, BMS 7–8.','','BMS 7–8',iid='striploin')
add('steaks','wagyu','Филе-миньон вагю',12000,'pc','img/tenderloin-medallions.jpg','cover','Медальоны из вырезки по 180–200 г.','','BMS 6–7',w=.19,iid='medallions')
add('steaks','premium','Рибай-стейк',4500,'pc','img/ribeye-steaks.jpg','cover','Зерновой откорм 200+ дней, толщина 3–4 см.','','BMS 5–6',w=.45,iid='ribeye-steaks')
add('steaks','premium','Рибай в вакууме',3200,'pc','img/ribeye-vacuum.jpg','cover','Готов к гриллю, хранится 14 дней.','','BMS 2–3',w=.35,iid='ribeye-vac')
add('meat','beef','Рибай вагю, кусок',9900,'kg','img/ribeye-wagyu.jpg','cover','Целым куском для запекания или стейками на заказ.','','BMS 8–9',iid='ribeye-wagyu')
add('meat','beef','Чак-ролл мраморный',1600,'kg','img/chuck-roll.jpg','cover','Шейная часть зернового откорма: томление, бургеры, Денвер.','',mn=1,iid='chuck')
add('meat','beef','Мозговые кости',350,'kg','img/marrow-bones.jpg','cover','Распил 5–7 см, для запекания и бульона.','',mn=1,iid='bones')
for n,f,age,fat,pr in [('Пармезан','parmesan','12 мес','40%',2900),('Годуновъ','godunov','6 мес','40%',2300),('Бофор','beaufort','4 мес','50%',2400),('Старая Кострома','staraya-kostroma','4 мес','50%',1900),('Раклет','raclette','3 мес','50%',2200),('Трюфель','truffle','2 мес','50%',2600)]:
    add('cheese','bogovarovo',n,pr,'kg',f'img/cheese-{f}.webp','contain',f'Выдержка {age} · жирность {fat}','Боговарово',step=.25,mn=.25)
add('dairy','butter','Масло сливочное Премиум 82,5%',2290,'pc','img/cheese-butter-premium.webp','contain','170 г, для базилирования стейка','Боговарово',w=.17,iid='butter')

# ---------- Labinsk Beef ----------
def manifest(name):
    p = f'{SRC}/{name}'
    if not os.path.exists(p):
        return []
    return [l.rstrip('\n').split('\t') for l in open(p, encoding='utf-8') if l.strip()]

PIECE = {'ribeye':.5,'cowboy':.7,'striploin':.7,'t-bone':1.0,'club':.7,'fillet mignon':.4,'chateaubriand':.8,'сhateaubriand':.8}
for row in manifest('labinsk-manifest.txt'):
    f, name = row[0], row[1]
    price = int(re.sub(r'\D', '', row[2].split('₽')[0])) if len(row) > 2 and re.search(r'\d', row[2]) else None
    n = name.replace('Cтейк', 'Стейк')
    low = n.lower()
    img = img_out(f'{SRC}/{f}', 'lb-' + slug(n))
    if 'барбекю' in low:
        add('ready','bbq',n,price or 1300,'kg',img,'cover','Нарезано для шашлыка и гриля','Labinsk Beef'); continue
    if low.startswith('стейк') or 'flank' in low or 'denver' in low:
        key = next((k for k in PIECE if k in low), None)
        alt = any(k in low for k in ['chuck','пиканья','flank','denver','tri-tip','минутка','osso'])
        if key and not alt:
            add('steaks','premium',n,price or 4000,'pc',img,'cover','Кубанская мраморная говядина','Labinsk Beef',w=PIECE[key])
        else:
            add('steaks','alt',n,price or 1800,'kg',img,'cover','Альтернативный стейк','Labinsk Beef',mn=.5)
        continue
    ribs = 'рёбр' in low or 'ребр' in low
    add('meat','beef',n,price or (1100 if ribs else 1400),'kg',img,'cover','Кубанская мраморная говядина','Labinsk Beef',mn=1)

# ---------- Gurmanin ----------
for row in manifest('gurmanin-manifest.txt'):
    f, name = row[0], row[1].strip()
    price = int(re.sub(r'\D', '', row[2])) if len(row) > 2 and re.search(r'\d', row[2]) else None
    if not price or price < 100:
        continue
    k = f.split('-')[1]
    low = name.lower()
    img = img_out(f'{SRC}/{f}', 'gm-' + slug(name))
    S = 'Гурманин'
    stem = f.rsplit('.',1)[0]
    CONTAIN = {'g-bird-01','g-bird-02','g-bird-03','g-ikra-03','g-ikra-04','g-steaks-11','g-steaks-15'} | {f'g-deli-{i:02d}' for i in range(3,19)}
    FIT = 'contain' if stem in CONTAIN else 'cover'
    if stem == 'g-deli-02':
        add('meat','beef',name,price,'kg',img,'cover','Для томления, тают после 3 часов',S,mn=1); continue
    if stem == 'g-deli-17':
        add('ready','farsh',name,price,'pc',img,'contain','Говядина в слоёном тесте, запечь 40 минут',S,pp=price); continue
    if k == 'ikra':
        add('fish','red' if 'кет' in low or 'горбуш' in low or 'красн' in low else 'black',name,price,'pc',img,FIT,'',S,pp=price)
    elif k == 'deli':
        if 'консерв' in low:
            add('fish','cans',name,price,'pc',img,FIT,'',S,pp=price)
        elif 'для жарки' in low:
            add('ready','sausages',name,price,'pc',img,FIT,'Замороженные, упаковка',S,pp=price)
        elif 'колбас' in low or 'салями' in low:
            add('sausage','kolbasa',name,price,'pc',img,FIT,'',S,pp=price)
        else:
            add('sausage','deli',name,price,'pc',img,FIT,'',S,pp=price)
    elif k in ('lamb','yagn'):
        add('meat','lamb',name,price,'kg',img,FIT,'',S,mn=1)
    elif k == 'veal':
        add('meat','veal',name,price,'kg',img,FIT,'',S,mn=1)
    elif k == 'bird':
        if 'корнишон' in low:
            add('meat','bird',name,price,'pc',img,FIT,'',S,pp=price)
        else:
            add('meat','bird',name,price,'kg',img,FIT,'',S,mn=.5)
    elif k == 'farsh':
        if 'котлеты' in low:
            add('ready','farsh',name,price,'pc',img,FIT,'Упаковка',S,pp=price)
        else:
            add('ready','farsh',name,price,'kg',img,FIT,'',S,mn=.5)
    elif k == 'steaks':
        if 'сухого' in low:
            continue
        sub = 'wagyu' if 'вагю' in low else ('premium' if any(x in low for x in ['prime','choice','томагавк','клаб','филе']) else 'alt')
        add('steaks',sub,name,price,'pc',img,FIT,'',S,pp=price)

# ---------- Postnikovo dairy ----------
for row in manifest('milk-manifest.txt'):
    f, txt = row[0], row[1]
    m = re.match(r'М\.Д\.Ж\.\s*([\d,\-–]+%)\s*(.+?)\s*Фасовка:\s*(.+?)\s*В упаковке:', txt)
    pm = re.search(r'(\d+)\s*₽\s*$', txt.strip())
    if not m or not pm:
        continue
    fat, name, pack, price = m.group(1), m.group(2).strip(), m.group(3).strip(), int(pm.group(1))
    low = name.lower()
    sub = 'butter' if 'масло' in low else 'cream' if ('сметан' in low or 'сливк' in low) else 'tvorog' if ('творож' in low or 'десерт' in low) else 'milk'
    if 'ведро' in pack:
        continue
    img = img_out(f'{SRC}/{f}', 'pk-' + slug(name + '-' + fat))
    nm = name if fat in name else f'{name} {fat}'
    nm = nm.replace(' с массовой долей жира', '')
    if pack.strip() == 'кг':
        add('dairy',sub,nm,price,'kg',img,'cover',f'Жирность {fat} · на развес','Постников',step=.25,mn=.25)
    else:
        add('dairy',sub,nm,price,'pc',img,'cover',f'Жирность {fat} · {pack}','Постников',pp=price)

# ---------- Gorka (PDF images, mapped manually) ----------
for row in manifest('gorka-manifest.txt'):
    f, cat, sub, name, price, note = row[:6]
    img = img_out(f'{SRC}/{f}', 'gk-' + slug(name), maxw=1000)
    add(cat, sub, name, int(price), 'kg', img, row[6] if len(row) > 6 else 'cover', note, 'Горка', step=.2, mn=.2)

# ---------- covers ----------
def first(cat, pred=lambda p: True):
    for p in items:
        if p['cat'] == cat and p['img'] and pred(p):
            return p['img']
    return ''
covers = {
 'meat': first('meat', lambda p: p['src'] == 'Labinsk Beef' if 'src' in p else False) or 'img/ribeye-wagyu.jpg',
 'steaks': 'img/hero-ribeye.jpg',
 'cheese': first('cheese', lambda p: p.get('src') == 'Горка') or 'img/cheese-parmesan.webp',
 'dairy': first('dairy', lambda p: p.get('src') == 'Постников'),
 'italian': first('italian'),
 'sausage': first('sausage'),
 'fish': first('fish'),
 'ready': first('ready'),
}
over = SRC + '/covers.json'
if os.path.exists(over):
    covers.update(json.load(open(over, encoding='utf-8')))

json.dump({'items': items, 'covers': covers}, open(os.path.join(ROOT, 'tools', 'catalog.json'), 'w', encoding='utf-8'), ensure_ascii=False)
from collections import Counter
print(len(items), dict(Counter(p['cat'] for p in items)))
