/* ---------- API (real server or in-browser demo) ---------- */
const API=(window.SHOP_API||'').replace(/\/$/,'');
const LEVELS=[{name:'Choice',from:0,rate:.03},{name:'Prime',from:20000,rate:.05},{name:'Вагю A5',from:60000,rate:.07}];
const escA=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(path,body){
  if(!API)return demoApi(path,body);
  let tok='';try{tok=localStorage.getItem('mk-token')||''}catch(e){}
  const h=body?{'content-type':'application/json'}:{};if(tok)h.authorization='Bearer '+tok;
  const r=await fetch(API+path,{method:body?'POST':'GET',credentials:'include',headers:h,body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));
  try{if(j.token)localStorage.setItem('mk-token',j.token);else if(r.status===401||path==='/api/auth/logout')localStorage.removeItem('mk-token')}catch(e){}
  if(!r.ok){const e=new Error(j.error||'Сервер недоступен, попробуйте позже');e.status=r.status;throw e}
  return j;
}
/* demo backend: same answers as the real server, state kept in this browser */
let DS;try{DS=JSON.parse(localStorage.getItem('mk-demo')||'null')}catch(e){}
DS=DS||{users:{},sid:null,orders:{},seq:1100,pending:null};
const dsSave=()=>{try{localStorage.setItem('mk-demo',JSON.stringify(DS))}catch(e){}};
const normPhone=p=>{let d=String(p||'').replace(/\D/g,'');if(d.length===11&&(d[0]==='8'||d[0]==='7'))d='7'+d.slice(1);else if(d.length===10)d='7'+d;return /^7\d{10}$/.test(d)?'+'+d:null};
const lvlOf=sp=>{let L=LEVELS[0];LEVELS.forEach(l=>{if(sp>=l.from)L=l});const n=LEVELS[LEVELS.indexOf(L)+1];return {name:L.name,rate:L.rate,next:n?{name:n.name,rate:n.rate,need:n.from-sp}:null}};
function dsBonus(u,d,reason,no){if(!d)return;u.bonus=Math.max(0,u.bonus+d);u.ledger.unshift({at:new Date().toISOString(),delta:d,reason,order:no||null})}
const PUB={new:'Ждёт оплаты',claimed:'Проверяем оплату',paid:'Оплачен',work:'В работе',packed:'Собран',road:'Передан в доставку',done:'Выполнен',cancel:'Отменён'};
function demoErr(m,s){const e=new Error(m);e.status=s||400;throw e}
async function demoApi(path,b){
  await new Promise(r=>setTimeout(r,250));
  const u=DS.sid&&DS.users[DS.sid];
  if(path==='/api/auth/start'){const ph=normPhone(b.phone);if(!ph)demoErr('Введите номер телефона в формате +7 900 000-00-00');DS.pending=ph;dsSave();
    return {nonce:'demo',method:'telegram_code',demo:true,hint:'Демо-режим: введите код 123456. На рабочем сайте код придёт в Telegram от бота лавки.'}}
  if(path==='/api/auth/verify'){if(String(b.code).replace(/\D/g,'')!=='123456')demoErr('Неверный код. В демо-режиме код 123456.');
    const ph=DS.pending;if(!DS.users[ph]){DS.users[ph]={phone:ph,name:'',birthday:'',note:'',addresses:[],bonus:0,spent:0,ledger:[],created:new Date().toISOString()};dsBonus(DS.users[ph],300,'Приветственные бонусы')}
    DS.sid=ph;DS.pending=null;dsSave();return {ok:true}}
  if(path==='/api/auth/logout'){DS.sid=null;dsSave();return {ok:true}}
  if(path==='/api/me'){if(!u)demoErr('Войдите в личный кабинет',401);
    if(b){if(b.name!=null)u.name=String(b.name).slice(0,60);if(b.note!=null)u.note=String(b.note).slice(0,300);
      if(b.birthday&&!u.birthday){if(!/^(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])$/.test(b.birthday))demoErr('Дата рождения в формате ДД.ММ');u.birthday=b.birthday}
      if(Array.isArray(b.addresses))u.addresses=b.addresses.slice(0,5);dsSave()}
    const orders=Object.values(DS.orders).filter(o=>o.user===u.phone).sort((a,b)=>b.at.localeCompare(a.at));
    return {phone:u.phone,name:u.name,birthday:u.birthday,note:u.note,addresses:u.addresses,telegram:true,bonus:u.bonus,spent:u.spent,level:lvlOf(u.spent),levels:LEVELS,maxBonusShare:.3,
      ledger:u.ledger.slice(0,30),orders:orders.map(o=>({...o,statusText:PUB[o.status]})),sessions:[{id:'demo',current:true,created:u.created,seen:new Date().toISOString(),ua:navigator.userAgent}]}}
  if(path==='/api/orders'){
    const items=b.items.map(({id,q})=>{const p=ALL[id];return {id,name:p.name,qty:qLabel(p,q),q,sum:Math.round(lineSum(p,q))}});
    const goods=items.reduce((s,i)=>s+i.sum,0),delivery=b.pickup||goods>=5000?0:500;
    let used=0;if(u&&b.useBonus>0)used=Math.min(Math.floor(b.useBonus),u.bonus,Math.floor(goods*.3));
    const no=String(++DS.seq);
    DS.orders[no]={no,at:new Date().toISOString(),status:'new',user:u?u.phone:null,items,goods,delivery,bonusUsed:used,total:goods+delivery-used,cashback:0,pickup:!!b.pickup,addr:b.addr||''};
    if(used)dsBonus(u,-used,'Оплата бонусами',no);
    if(u&&!b.pickup&&b.addr&&!u.addresses.includes(b.addr))u.addresses=[b.addr,...u.addresses].slice(0,5);
    if(u&&!u.name)u.name=b.name;
    dsSave();const o=DS.orders[no];
    return {no,token:'demo',status:'new',total:o.total,goods,delivery,bonusUsed:used,payQr:null,botLink:null,telegramLinked:!!u,payNote:''}}
  const m=path.match(/^\/api\/orders\/(\d+)\/paid$/);
  if(m){const o=DS.orders[m[1]];if(o&&o.status==='new'){o.status='claimed';dsSave()}return {ok:true}}
  demoErr('not found',404);
}
/* called by the staff-bot demo so the demo account sees status changes and bonuses */
function demoAdvance(no,status,fact){
  if(API)return;const o=DS.orders[no];if(!o)return;
  const map={wait:'claimed'};o.status=map[status]||status;
  if(fact!=null)o.fact=fact;
  const u=o.user&&DS.users[o.user];
  if(u&&o.status==='cancel'&&o.bonusUsed&&!o.refunded){o.refunded=true;dsBonus(u,o.bonusUsed,'Возврат бонусов за отменённый заказ',no)}
  if(u&&o.status==='done'&&!o.cashback){const paid=Math.max(0,(o.fact!=null?o.fact:o.goods)-o.bonusUsed),L=lvlOf(u.spent);o.cashback=Math.floor(paid*L.rate);u.spent+=paid;dsBonus(u,o.cashback,`Кешбэк ${Math.round(L.rate*100)}% за заказ`,no)}
  dsSave();
}

/* ---------- session state ---------- */
let ME=null,meLoaded=false;
// Шкала статуса заказа в кабинете: оплачен → в работе → в доставке → доставлен (самовывоз: собран → выдан).
function oTrack(o){
  if(o.status==='cancel')return '';
  const steps=o.pickup?['Оплачен','В работе','Собран, ждёт вас','Выдан']:['Оплачен','В работе','Передан в доставку','Доставлен'];
  const at=(o.pickup?{paid:0,work:1,packed:2,done:3}:{paid:0,work:1,packed:1,road:2,done:3})[o.status];
  const cur=at==null?-1:at;
  return `<ol class="o-track${cur<0?' wait':''}">${steps.map((t,i)=>`<li class="${i<cur?'ok':i===cur?(o.status==='done'?'ok':'now'):''}"><i></i><span>${t}</span></li>`).join('')}</ol>`;
}
async function loadMe(){try{ME=await api('/api/me')}catch(e){ME=null}meLoaded=true;renderAccBtn();return ME}
function renderAccBtn(){const b=$('#accBtn');if(!b)return;b.querySelector('.lbl').textContent=ME?(ME.name||'Кабинет'):'Войти';b.classList.toggle('in',!!ME);
  const bb=b.querySelector('.bb');if(bb){bb.textContent=ME?ME.bonus:'';bb.hidden=!ME}}

/* ---------- account view ---------- */
let accTab='orders',login={step:'phone'},pollT=null;
// статусы заказов обновляются сами, пока открыт кабинет на вкладке «Заказы»
setInterval(async()=>{if(!API||location.hash!=='#account'||accTab!=='orders'||!ME||document.hidden)return;
  const was=JSON.stringify(ME.orders.map(o=>o.status));await loadMe();if(ME&&location.hash==='#account'&&accTab==='orders'&&JSON.stringify(ME.orders.map(o=>o.status))!==was)renderAccount()},30000);
const fmtD=d=>new Date(d).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
const fmtDT=d=>new Date(d).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const ua=s=>/iPhone|iPad/.test(s)?'iPhone / iPad':/Android/.test(s)?'Android':/Mac OS/.test(s)?'Mac':/Windows/.test(s)?'Windows':'Браузер';
async function renderAccount(){
  const v=$('#accView');
  if(!meLoaded)await loadMe();
  if(!ME){v.innerHTML=loginView();bindLogin();return}
  const L=ME.level,pct=L.next?Math.min(100,Math.round(ME.spent/(ME.spent+L.next.need)*100)):100;
  const tabs=[['orders','Заказы',ME.orders.length],['bonus','Бонусы',ME.bonus],['addr','Адреса',ME.addresses.length],['profile','Профиль'],['security','Безопасность']];
  v.innerHTML=`<div class="acc wrap">
   <div class="acc-head">
     <div class="acc-hi">
       <p class="crumbs mono"><a href="#top">Главная</a><span>/</span><span>Личный кабинет</span></p>
       <h1>${ME.name?`Здравствуйте, <em>${escA(ME.name)}</em>`:'Личный <em>кабинет</em>'}</h1>
       <p class="lead">Бонусы копятся с каждого заказа и списываются до ${Math.round(ME.maxBonusShare*100)}% суммы. Статусы заказов приходят в Telegram.</p>
     </div>
     <div class="mcard" aria-label="Карта покупателя">
       <div class="mc-top"><span class="mono">Карта гурмана</span><span class="mono num">${escA(ME.phone.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/,'+7 $1 ··· $3 $4'))}</span></div>
       <div class="mc-lvl"><span class="mono">Уровень</span><b>${escA(L.name)}</b><span class="mono">кешбэк ${Math.round(L.rate*100)}%</span></div>
       <div class="mc-bal"><b class="num">${ME.bonus.toLocaleString('ru-RU')}</b><span>бонусов<br>1 бонус = 1 ₽</span></div>
       <div class="mc-prog"><i style="width:${pct}%"></i></div>
       <p class="mc-next">${L.next?`До уровня ${escA(L.next.name)} (${Math.round(L.next.rate*100)}%) — покупки на ${rub(L.next.need)}`:'Максимальный уровень. Спасибо, что вы с нами!'}</p>
     </div>
   </div>
   <nav class="acc-tabs" role="tablist">${tabs.map(t=>`<button role="tab" aria-selected="${t[0]===accTab}" data-acctab="${t[0]}">${t[1]}${t[2]!=null?`<sup class="num">${t[2]}</sup>`:''}</button>`).join('')}</nav>
   <div class="acc-body">${accBody()}</div>
  </div>`;
}
function accBody(){
  if(accTab==='orders'){
    if(!ME.orders.length)return `<div class="acc-empty"><b>Заказов пока нет</b><p>Первый заказ принесёт кешбэк ${Math.round(ME.level.rate*100)}% бонусами.</p><a class="btn btn-fill" href="#steaks">К стейкам <span class="ar">→</span></a></div>`;
    return `<div class="olist">${ME.orders.map(o=>`<article class="orow">
      <div class="o-k"><b class="num">№ ${o.no}</b><span class="mono">${fmtDT(o.at)}</span></div>
      <span class="o-st st-${o.status}">${escA(o.statusText)}</span>
      ${oTrack(o)}
      <p class="o-items">${o.items.map(i=>escA(i.name)+' × '+escA(i.qty)).join(', ')}</p>
      <div class="o-sum"><b class="num">${rub(o.total)}</b>${o.bonusUsed?`<span class="mono">−${o.bonusUsed} бонусов</span>`:''}${o.cashback?`<span class="mono plus">+${o.cashback} бонусов</span>`:''}</div>
      <button class="btn btn-line o-rep" data-repeat="${o.no}">Повторить</button>
    </article>`).join('')}</div>`}
  if(accTab==='bonus'){
    return `<div class="acc-2"><div><h3 class="acc-h">История бонусов</h3>${ME.ledger.length?`<ul class="ledger">${ME.ledger.map(l=>`<li><span class="mono">${fmtD(l.at)}</span><span>${escA(l.reason)}${l.order?` · № ${l.order}`:''}</span><b class="num ${l.delta>0?'plus':''}">${l.delta>0?'+':''}${l.delta}</b></li>`).join('')}</ul>`:'<p class="muted">Пока пусто.</p>'}</div>
     <div><h3 class="acc-h">Уровни</h3><ul class="levels">${ME.levels.map(l=>`<li class="${l.name===ME.level.name?'on':''}"><b>${escA(l.name)}</b><span class="num">${l.from?'от '+rub(l.from):'с первого заказа'}</span><span class="num">${Math.round(l.rate*100)}%</span></li>`).join('')}</ul>
     <ul class="perks"><li>300 бонусов за регистрацию</li><li>1 000 бонусов в день рождения, укажите дату в профиле</li><li>Бонусами можно оплатить до ${Math.round(ME.maxBonusShare*100)}% заказа</li><li>Кешбэк начисляется после выполнения заказа</li></ul></div></div>`}
  if(accTab==='addr'){
    return `<div class="acc-narrow"><h3 class="acc-h">Адреса доставки</h3><p class="muted">Подставляются при оформлении заказа. До 5 адресов.</p>
     <ul class="addr-list">${ME.addresses.map((a,i)=>`<li><span>${escA(a)}</span><button class="copy" data-deladdr="${i}">Удалить</button></li>`).join('')||'<li class="muted">Адресов пока нет</li>'}</ul>
     <form class="inline-form" id="addrForm"><div class="fld"><label for="newAddr">Новый адрес</label><input id="newAddr" placeholder="Улица, дом, квартира, подъезд" maxlength="200"></div><button class="btn btn-line" type="submit">Добавить</button></form></div>`}
  if(accTab==='profile'){
    return `<form class="acc-narrow pform" id="profForm">
      <div class="fld"><label for="p-name">Имя</label><input id="p-name" value="${escA(ME.name)}" maxlength="60" autocomplete="given-name"></div>
      <div class="fld"><label>Телефон</label><input value="${escA(ME.phone)}" disabled><span class="hint">Телефон подтверждён через Telegram. Сменить его можно только через лавку.</span></div>
      <div class="fld"><label for="p-bd">День рождения</label>${ME.birthday?`<input value="${escA(ME.birthday)}" disabled><span class="hint">Дату можно указать один раз.</span>`:`<input id="p-bd" placeholder="ДД.ММ, например 15.03" inputmode="numeric" maxlength="5"><span class="hint">В день рождения подарим 1 000 бонусов. Указать дату можно один раз.</span>`}</div>
      <div class="fld"><label for="p-note">Пожелания мяснику по умолчанию</label><textarea id="p-note" maxlength="300" placeholder="Например: стейки толщиной 3 см, жир не срезать">${escA(ME.note)}</textarea></div>
      <p class="err" id="profErr" hidden></p>
      <button class="btn btn-fill" type="submit">Сохранить</button>
    </form>`}
  return `<div class="acc-narrow"><h3 class="acc-h">Где выполнен вход</h3>
    <ul class="sess">${ME.sessions.map(s=>`<li><b>${ua(s.ua)}${s.current?' · это устройство':''}</b><span class="mono">вход ${fmtDT(s.created)} · активность ${fmtDT(s.seen)}</span></li>`).join('')}</ul>
    <p class="muted">Вход возможен только по коду, который приходит в ваш Telegram. Пароль не нужен, поэтому украсть его нельзя. Сотрудники лавки никогда не спрашивают код.</p>
    <div class="btns-row"><button class="btn btn-line" data-logout="one">Выйти</button><button class="btn btn-line" data-logout="all">Выйти на всех устройствах</button></div></div>`;
}
function loginView(){
  const s=login;
  const perks=`<ul class="perks big"><li><b>300 бонусов</b> сразу после регистрации</li><li><b>Кешбэк 3–7%</b> с каждого заказа бонусами</li><li><b>1 000 бонусов</b> в день рождения</li><li><b>История заказов</b> и повтор в один клик</li></ul>`;
  let form;
  if(s.step==='phone')form=`<form class="lform" id="lPhone"><div class="fld"><label for="l-phone">Номер телефона</label><input id="l-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00" value="${escA(s.phone||'')}"></div>${AGREE('l-agree')}<p class="err" id="lErr" hidden></p><button class="btn btn-fill" type="submit">Получить код <span class="ar">→</span></button><p class="hint">Код придёт в Telegram от бота лавки. Пароль не нужен.</p></form>`;
  else if(s.step==='code')form=`<form class="lform" id="lCode"><p class="lstep">${escA(s.hint)}</p><div class="fld"><label for="l-code">Код из 6 цифр</label><input id="l-code" class="code-in num" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></div><p class="err" id="lErr" hidden></p><button class="btn btn-fill" type="submit">Войти</button><button class="btn btn-line" type="button" id="lBack">Изменить номер</button></form>`;
  else form=`<div class="lform"><p class="lstep">${escA(s.hint)}</p><a class="btn btn-fill" href="${escA(s.link)}" target="_blank" rel="noopener">Открыть Telegram <span class="ar">→</span></a><p class="wait"><i></i>Ждём подтверждения номера в Telegram…</p><p class="err" id="lErr" hidden></p><button class="btn btn-line" type="button" id="lBack">Изменить номер</button></div>`;
  return `<div class="acc wrap"><div class="login">
    <div class="login-tx"><p class="crumbs mono"><a href="#top">Главная</a><span>/</span><span>Вход</span></p><h1>Личный <em>кабинет</em></h1><p class="lead">Копите бонусы, повторяйте любимые заказы и следите за статусом доставки.</p>${perks}</div>
    <div class="login-card">${form}${!API?'<p class="demo-note">Демо-версия: код для входа 123456, бонусы сохраняются в этом браузере.</p>':''}</div>
  </div></div>`;
}
function bindLogin(){
  const err=m=>{const e=$('#lErr');if(e){e.textContent=m;e.hidden=false}};
  const f1=$('#lPhone');if(f1){$('#l-phone').focus();f1.onsubmit=async e=>{e.preventDefault();if(!$('#l-agree').checked){err('Отметьте согласие на обработку персональных данных.');return}const btn=f1.querySelector('[type=submit]');btn.disabled=true;
    try{const r=await api('/api/auth/start',{consent:true,phone:$('#l-phone').value});login={step:r.method==='telegram_link'?'link':'code',nonce:r.nonce,hint:r.hint,link:r.link,phone:$('#l-phone').value};renderAccount();if(login.step==='link')startPoll()}
    catch(x){err(x.message);btn.disabled=false}}}
  const f2=$('#lCode');if(f2){$('#l-code').focus();f2.onsubmit=async e=>{e.preventDefault();const btn=f2.querySelector('[type=submit]');btn.disabled=true;
    try{await api('/api/auth/verify',{nonce:login.nonce,code:$('#l-code').value});await afterLogin()}catch(x){err(x.message);btn.disabled=false}}}
  const bk=$('#lBack');if(bk)bk.onclick=()=>{clearInterval(pollT);login={step:'phone',phone:login.phone};renderAccount()};
}
function startPoll(){clearInterval(pollT);const t0=Date.now();pollT=setInterval(async()=>{
  if(location.hash!=='#account'||Date.now()-t0>10*60e3){clearInterval(pollT);return}
  try{const r=await api('/api/auth/poll',{nonce:login.nonce});if(r.ok){clearInterval(pollT);await afterLogin()}}catch(x){clearInterval(pollT);const e=$('#lErr');if(e){e.textContent=x.message;e.hidden=false}}},2000)}
async function afterLogin(){login={step:'phone'};accTab='orders';await loadMe();renderAccount();toast('Вы вошли в личный кабинет')}
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-acctab],[data-repeat],[data-deladdr],[data-logout],#accBtn,#mnAcc');if(!t)return;
  if(t.id==='accBtn'||t.id==='mnAcc'){if(typeof menu==='function')menu(false);location.hash='account';return}
  if(t.dataset.acctab){accTab=t.dataset.acctab;renderAccount();return}
  if(t.dataset.repeat){const o=ME.orders.find(x=>x.no===t.dataset.repeat);let n=0;o.items.forEach(i=>{if(ALL[i.id]){cart[i.id]=Math.round(((cart[i.id]||0)+i.q)*100)/100;n++}});save();renderCount(true);toast(n?'Заказ добавлен в корзину':'Этих товаров сейчас нет');if(n)openCart();return}
  if(t.dataset.deladdr){const a=[...ME.addresses];a.splice(+t.dataset.deladdr,1);ME=await api('/api/me',{addresses:a});renderAccount();return}
  if(t.dataset.logout){await api('/api/auth/logout',{all:t.dataset.logout==='all'}).catch(()=>{});ME=null;renderAccBtn();renderAccount();toast('Вы вышли из кабинета')}
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='addrForm'){e.preventDefault();const v=$('#newAddr').value.trim();if(!v)return;ME=await api('/api/me',{addresses:[v,...ME.addresses].slice(0,5)});renderAccount()}
  if(e.target.id==='profForm'){e.preventDefault();const body={name:$('#p-name').value,note:$('#p-note').value};const bd=$('#p-bd');if(bd&&bd.value.trim())body.birthday=bd.value.trim();
    try{ME=await api('/api/me',body);renderAccBtn();renderAccount();toast('Профиль сохранён')}catch(x){const er=$('#profErr');er.textContent=x.message;er.hidden=false}}
});
