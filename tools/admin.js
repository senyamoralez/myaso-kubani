/* ---------- live catalog: prices, stock and labels from the admin panel ---------- */
const FULL=DATA.items.slice();
const BASE={};FULL.forEach(p=>BASE[p.id]={price:p.price,pp:p.pp,stock:p.stock,hidden:p.hidden,badge:p.badge,old:p.old});
const BADGES={hit:'Хит',new:'Новинка',sale:'Скидка'};
let OV={};
function applyOv(ov){
  OV=ov||{};
  FULL.forEach(p=>{const b=BASE[p.id];['price','pp','stock','hidden','badge','old'].forEach(k=>{if(b[k]===undefined)delete p[k];else p[k]=b[k]});if(OV[p.id])Object.assign(p,OV[p.id])});
  DATA.items=FULL.filter(p=>!p.hidden);
}
function rerenderView(){
  renderTiles();
  const h=decodeURIComponent(location.hash.slice(1));
  if(CATS[h]){const y=scrollY,sub=curSub;renderCat(h);if(sub!=='all'){const ch=document.querySelector(`.chip[data-sub="${sub}"]`);if(ch)ch.click()}scrollTo(0,y)}
  else if(h.startsWith('search=')){const y=scrollY;renderSearch(h.slice(7));scrollTo(0,y)}
}
if(API)fetch(API+'/api/catalog',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j&&j.ov&&Object.keys(j.ov).length){applyOv(j.ov);rerenderView()}}).catch(()=>{});

/* ---------- admin panel (#admin) ---------- */
const AD={tok:'',me:null,users:null,log:[],tab:'items',cat:'all',q:'',f:'all',draft:{},sel:new Set(),busy:false,err:'',msg:''};
try{AD.tok=localStorage.getItem('mk-admin')||''}catch(e){}
async function adApi(path,body){
  const h={};if(body)h['content-type']='application/json';if(AD.tok)h.authorization='Admin '+AD.tok;
  const r=await fetch(API+path,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const j=await r.json().catch(()=>({}));
  if(r.status===401&&path!=='/api/admin/login'){AD.tok='';AD.me=null;try{localStorage.removeItem('mk-admin')}catch(e){}}
  if(!r.ok){const e=new Error(j.error||'Сервер недоступен, попробуйте позже');e.status=r.status;throw e}
  return j;
}
const adPrice=p=>p.unit==='pc'&&BASE[p.id].pp!=null?p.pp:p.price;
const adUnit=p=>p.unit==='kg'||(p.unit==='pc'&&BASE[p.id].pp==null)?'₽/кг':'₽/шт';
const adVal=(p,k)=>{const d=AD.draft[p.id];if(d&&k in d)return d[k];return k==='price'?adPrice(p):k==='stock'?(p.stock||'in'):k==='hidden'?!!p.hidden:k==='badge'?(p.badge||''):k==='old'?(p.old||null):null};
function adSet(id,k,v){
  const p=FULL.find(x=>x.id===id);if(!p)return;
  const cur=k==='price'?adPrice(p):k==='stock'?(p.stock||'in'):k==='hidden'?!!p.hidden:k==='badge'?(p.badge||''):(p.old||null);
  const d=AD.draft[id]||(AD.draft[id]={});
  if(v===cur||(v==null&&cur==null))delete d[k];else d[k]=v;
  if(!Object.keys(d).length)delete AD.draft[id];
}
const adCount=()=>Object.keys(AD.draft).length;
function adFiltered(){
  const q=AD.q.trim().toLowerCase();
  return FULL.filter(p=>{
    if(AD.cat!=='all'&&p.cat!==AD.cat)return false;
    if(q&&!(p.name+' '+(p.subName||'')+' '+(p.src||'')).toLowerCase().includes(q))return false;
    const f=AD.f;
    if(f==='noprice')return adVal(p,'price')==null;
    if(f==='out')return adVal(p,'stock')==='out';
    if(f==='hidden')return adVal(p,'hidden');
    if(f==='badge')return !!adVal(p,'badge');
    if(f==='changed')return !!OV[p.id]||!!AD.draft[p.id];
    return true});
}
function adStats(){
  const c={all:FULL.length,noprice:0,out:0,hidden:0,badge:0,changed:0};
  FULL.forEach(p=>{if(adVal(p,'price')==null)c.noprice++;if(adVal(p,'stock')==='out')c.out++;if(adVal(p,'hidden'))c.hidden++;if(adVal(p,'badge'))c.badge++;if(OV[p.id]||AD.draft[p.id])c.changed++});
  return c;
}
function adRow(p){
  const pr=adVal(p,'price'),st=adVal(p,'stock'),hd=adVal(p,'hidden'),bd=adVal(p,'badge'),old=adVal(p,'old'),ch=!!AD.draft[p.id];
  return `<div class="ad-row${ch?' ch':''}${hd?' hd':''}" data-id="${escA(p.id)}">
   <label class="ad-ck"><input type="checkbox" data-ad="sel"${AD.sel.has(p.id)?' checked':''} aria-label="Выбрать"></label>
   <span class="ad-ph">${p.img?`<img src="${escA(p.img)}" alt="" loading="lazy">`:''}</span>
   <span class="ad-nm"><b>${escA(p.name)}</b><small class="mono">${escA([CATS[p.cat]?.name,p.subName,p.src].filter(Boolean).join(' · '))}</small></span>
   <label class="ad-pr"><input type="number" inputmode="numeric" min="1" step="1" data-ad="price" value="${pr==null?'':pr}" placeholder="по запросу" aria-label="Цена"><span>${adUnit(p)}</span></label>
   <button type="button" class="ad-st ${st==='out'?'off':'on'}" data-ad="stock">${st==='out'?'Нет в наличии':'В наличии'}</button>
   <select data-ad="badge" aria-label="Метка"><option value="">Без метки</option>${Object.entries(BADGES).map(([k,n])=>`<option value="${k}"${bd===k?' selected':''}>${n}</option>`).join('')}</select>
   ${bd==='sale'?`<label class="ad-pr ad-old"><input type="number" inputmode="numeric" min="1" step="1" data-ad="old" value="${old||''}" placeholder="была" aria-label="Старая цена"><span>было</span></label>`:'<span class="ad-old"></span>'}
   <button type="button" class="ad-eye" data-ad="hidden" title="${hd?'Показать на сайте':'Скрыть с сайта'}" aria-pressed="${hd}">${hd?'Скрыт':'На сайте'}</button>
  </div>`;
}
function adList(){
  const L=adFiltered(),box=$('#adList');if(!box)return;
  box.innerHTML=L.length?L.map(adRow).join(''):'<p class="ad-empty">Ничего не найдено</p>';
  $('#adShown').textContent=L.length;adBars();
}
function adBars(){
  const n=adCount(),bar=$('#adSave');if(bar){bar.hidden=!n;$('#adN').textContent=n}
  const s=adStats();$$('.ad-f').forEach(b=>{const k=b.dataset.f;b.querySelector('sup').textContent=s[k];b.setAttribute('aria-pressed',AD.f===k)});
  const bk=$('#adBulk');if(bk){bk.hidden=!AD.sel.size;$('#adSelN').textContent=AD.sel.size}
}
function renderAdmin(){
  const v=$('#adminView');
  if(!API){v.innerHTML=`<div class="wrap ad"><h1>Управление</h1><p class="ad-note">Панель работает только с подключённым сервером.</p></div>`;return}
  if(!AD.tok){v.innerHTML=`<div class="wrap ad ad-login"><form class="login-card" id="adLogin">
    <p class="mono">Для сотрудников</p><h1>Вход в&nbsp;управление</h1>
    <label class="fld"><span>Логин или телефон</span><input name="login" autocomplete="username" autocapitalize="none" required></label>
    <label class="fld"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" required></label>
    ${AD.err?`<p class="err">${escA(AD.err)}</p>`:''}
    <button class="btn btn-fill" type="submit"${AD.busy?' disabled':''}>${AD.busy?'Входим…':'Войти'} <span class="ar">→</span></button>
    <a class="ad-back" href="#top">← На сайт</a></form></div>`;return}
  if(!AD.me){v.innerHTML='<div class="wrap ad"><p class="ad-note">Загружаем…</p></div>';adLoad();return}
  const tabs=[['items','Товары'],['log','История'],['access','Доступ']];
  let body='';
  if(AD.tab==='items'){
    const F=[['all','Все'],['noprice','Без цены'],['out','Нет в наличии'],['hidden','Скрытые'],['badge','С меткой'],['changed','Изменённые']];
    body=`<div class="ad-tools">
      <input type="search" id="adQ" placeholder="Поиск по названию" value="${escA(AD.q)}" aria-label="Поиск">
      <select id="adCat" aria-label="Раздел"><option value="all">Все разделы</option>${ORDER.map(c=>`<option value="${c}"${AD.cat===c?' selected':''}>${CATS[c].name}</option>`).join('')}</select>
    </div>
    <div class="chips ad-fs">${F.map(([k,n])=>`<button type="button" class="chip ad-f" data-f="${k}" aria-pressed="${AD.f===k}">${n}<sup class="num">0</sup></button>`).join('')}</div>
    <div class="ad-bulk" id="adBulk" hidden><b>Выбрано: <span id="adSelN">0</span></b>
      <button type="button" data-bulk="in">В наличии</button><button type="button" data-bulk="out">Нет в наличии</button>
      <button type="button" data-bulk="hide">Скрыть</button><button type="button" data-bulk="show">Показать</button>
      <span class="ad-pct"><input type="number" id="adPct" placeholder="%" aria-label="Процент" step="1"><button type="button" data-bulk="pct">Цена ±%</button></span>
      <button type="button" data-bulk="none" class="ad-x">Снять выбор</button></div>
    <div class="ad-head mono"><label class="ad-ck"><input type="checkbox" id="adAll" aria-label="Выбрать все"></label><span>Показано: <b id="adShown">0</b></span></div>
    <div class="ad-list" id="adList"></div>`;
  }else if(AD.tab==='log'){
    body=AD.log.length?`<ol class="ad-log">${AD.log.map(l=>`<li><time class="mono">${new Date(l.at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><b>${escA(l.name)}</b><span>${escA(l.text)}</span><small>${escA(l.by)}</small></li>`).join('')}</ol>`:'<p class="ad-note">Изменений пока не было.</p>';
  }else{
    body=`<div class="ad-acc"><form class="ad-card" id="adPw"><h3>Сменить мой пароль</h3>
      <label class="fld"><span>Старый пароль</span><input name="old" type="password" autocomplete="current-password" required></label>
      <label class="fld"><span>Новый пароль, от 8 символов</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <button class="btn btn-ink" type="submit">Сохранить пароль</button></form>
      ${AD.users?`<div class="ad-card"><h3>Кто имеет доступ</h3><ul class="ad-users">${AD.users.map(u=>`<li><span><b>${escA(u.name)}</b><small class="mono">${escA(u.login)} · ${escA(u.roleName)}</small></span>${u.login===AD.me.login?'<small>это вы</small>':`<button type="button" data-deluser="${escA(u.login)}">Удалить</button>`}</li>`).join('')}</ul>
      <form id="adAdd" class="ad-add"><h3>Добавить сотрудника</h3>
       <label class="fld"><span>Имя</span><input name="name" placeholder="Например, Иван (продавец)" required></label>
       <label class="fld"><span>Логин</span><input name="login" autocapitalize="none" placeholder="ivan или 8-901-123-45-67" pattern="[a-zA-Z0-9._()+ \-]{3,40}" required></label>
       <label class="fld"><span>Пароль, от 8 символов</span><input name="password" minlength="8" required></label>
       <label class="fld"><span>Права</span><select name="role"><option value="staff">Сотрудник: цены и наличие</option><option value="owner">Владелец: ещё и доступы</option></select></label>
       <button class="btn btn-ink" type="submit">Добавить</button></form></div>`:''}
    </div>`;
  }
  v.innerHTML=`<div class="wrap ad">
    <div class="ad-top"><div><p class="mono">Управление магазином</p><h1>${escA(AD.me.name||AD.me.login)}</h1></div>
      <div class="ad-top-r"><a class="btn btn-line" href="#top">На сайт</a><button type="button" class="btn btn-line" id="adOut">Выйти</button></div></div>
    <nav class="ad-tabs">${tabs.map(([k,n])=>`<button type="button" data-tab="${k}" aria-pressed="${AD.tab===k}">${n}</button>`).join('')}</nav>
    ${AD.msg?`<p class="ad-msg">${escA(AD.msg)}</p>`:''}${AD.err?`<p class="err">${escA(AD.err)}</p>`:''}
    ${body}
    <div class="ad-save" id="adSave" hidden><span>Изменено товаров: <b id="adN">0</b></span><button type="button" class="btn btn-line" id="adUndo">Отменить</button><button type="button" class="btn btn-fill" id="adGo">Сохранить</button></div>
  </div>`;
  if(AD.tab==='items')adList();else adBars();
}
async function adLoad(){
  try{const j=await adApi('/api/admin/state');AD.me=j.me;AD.users=j.users;AD.log=j.log||[];applyOv(j.ov);AD.err=''}
  catch(e){AD.err=e.message}
  if(location.hash==='#admin')renderAdmin();
}
const adFlash=m=>{AD.msg=m;AD.err='';setTimeout(()=>{if(AD.msg===m){AD.msg='';const x=$('.ad-msg');if(x)x.remove()}},3500)};
document.addEventListener('submit',async e=>{
  const f=e.target;if(!f.closest||!f.closest('#adminView'))return;e.preventDefault();
  const d=Object.fromEntries(new FormData(f));
  try{
    if(f.id==='adLogin'){AD.busy=true;AD.err='';renderAdmin();const j=await adApi('/api/admin/login',d);AD.tok=j.token;try{localStorage.setItem('mk-admin',j.token)}catch(x){}AD.me=null;AD.busy=false}
    else if(f.id==='adPw'){await adApi('/api/admin/password',d);adFlash('Пароль изменён')}
    else if(f.id==='adAdd'){const j=await adApi('/api/admin/users',{action:'add',...d});AD.users=j.users;adFlash('Сотрудник добавлен: '+d.login)}
  }catch(x){AD.busy=false;AD.err=x.message}
  renderAdmin();
});
document.addEventListener('input',e=>{
  const t=e.target;if(!t.closest||!t.closest('#adminView'))return;
  if(t.id==='adQ'){AD.q=t.value;adList();return}
  const row=t.closest('.ad-row');if(!row)return;
  if(t.dataset.ad==='price'||t.dataset.ad==='old'){const v=t.value.trim()===''?null:Math.round(+t.value);if(v!==null&&!(v>0))return;adSet(row.dataset.id,t.dataset.ad,v);row.classList.toggle('ch',!!AD.draft[row.dataset.id]);adBars()}
});
document.addEventListener('change',e=>{
  const t=e.target;if(!t.closest||!t.closest('#adminView'))return;
  if(t.id==='adCat'){AD.cat=t.value;adList();return}
  if(t.id==='adAll'){adFiltered().forEach(p=>t.checked?AD.sel.add(p.id):AD.sel.delete(p.id));adList();return}
  const row=t.closest('.ad-row');if(!row)return;const id=row.dataset.id;
  if(t.dataset.ad==='sel'){t.checked?AD.sel.add(id):AD.sel.delete(id);adBars();return}
  if(t.dataset.ad==='badge'){adSet(id,'badge',t.value);row.outerHTML=adRow(FULL.find(p=>p.id===id));adBars()}
});
document.addEventListener('click',async e=>{
  const t=e.target.closest('#adminView button');if(!t)return;
  if(t.dataset.tab){AD.tab=t.dataset.tab;AD.err='';if(t.dataset.tab!=='items')adLoad();renderAdmin();return}
  if(t.dataset.f){AD.f=t.dataset.f;adList();return}
  const row=t.closest('.ad-row');
  if(row&&t.dataset.ad){const id=row.dataset.id,p=FULL.find(x=>x.id===id);
    if(t.dataset.ad==='stock')adSet(id,'stock',adVal(p,'stock')==='out'?'in':'out');
    if(t.dataset.ad==='hidden')adSet(id,'hidden',!adVal(p,'hidden'));
    row.outerHTML=adRow(p);adBars();return}
  if(t.dataset.bulk){
    const ids=[...AD.sel];
    if(t.dataset.bulk==='none'){AD.sel.clear();adList();return}
    if(t.dataset.bulk==='pct'){const k=+$('#adPct').value;if(!k||k<-90||k>500){AD.err='Укажите процент, например 10 или -5';renderAdmin();return}
      let skip=0;ids.forEach(id=>{const p=FULL.find(x=>x.id===id),cur=adVal(p,'price');if(cur==null){skip++;return}adSet(id,'price',Math.max(1,Math.round(cur*(1+k/100))))});
      if(skip)adFlash(`Пропущено без цены: ${skip}`)}
    else ids.forEach(id=>{const b=t.dataset.bulk;if(b==='in'||b==='out')adSet(id,'stock',b);else adSet(id,'hidden',b==='hide')});
    adList();return}
  if(t.id==='adUndo'){AD.draft={};adList();return}
  if(t.id==='adGo'){
    t.disabled=true;t.textContent='Сохраняем…';
    try{const j=await adApi('/api/admin/save',{changes:AD.draft});AD.draft={};applyOv(j.ov);renderTiles();adFlash(j.changed?`Сохранено: ${j.changed}. Покупатели уже видят новые цены.`:'Сохранено')}
    catch(x){AD.err=x.message}
    renderAdmin();return}
  if(t.dataset.deluser){if(!confirm('Удалить доступ «'+t.dataset.deluser+'»?'))return;
    try{const j=await adApi('/api/admin/users',{action:'del',login:t.dataset.deluser});AD.users=j.users;adFlash('Доступ удалён')}catch(x){AD.err=x.message}renderAdmin();return}
  if(t.id==='adOut'){try{await adApi('/api/admin/logout',{})}catch(x){}AD.tok='';AD.me=null;AD.draft={};try{localStorage.removeItem('mk-admin')}catch(x){}renderAdmin()}
});
addEventListener('beforeunload',e=>{if(adCount()&&location.hash==='#admin'){e.preventDefault();e.returnValue=''}});
