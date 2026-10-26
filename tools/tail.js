/* ---------- home: category tiles ---------- */
const count=c=>DATA.items.filter(p=>p.cat===c).length;
const plural=n=>{const a=n%10,b=n%100;return n+' '+(a===1&&b!==11?'позиция':a>=2&&a<=4&&(b<12||b>14)?'позиции':'позиций')};
$('#tiles').innerHTML=ORDER.map(c=>`<a class="tile t-${c}" href="#${c}">${DATA.covers[c]?`<img src="${DATA.covers[c]}" alt="" loading="lazy">`:''}<span class="tt"><b>${CATS[c].name}</b><span class="mono num">${count(c)?plural(count(c)):'скоро'}</span></span></a>`).join('');

/* ---------- category view ---------- */
const plus='<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0v12M0 6h12" stroke="currentColor" stroke-width="1.4"/></svg>';
let curCat=null,curSub='all';
function card(p){return `<article class="pc" data-sub="${p.sub||''}">
 <div class="pc-ph${p.fit==='cover'?' cover':''}">${p.img?`<img src="${p.img}" alt="${p.name}" loading="lazy">`:''}${p.tag?`<span class="tag">${p.tag}</span>`:''}</div>
 <div class="pc-b">
  <span class="pc-k mono">${[p.subName,p.src].filter(Boolean).join(' · ')}</span>
  <h3>${p.name}</h3>
  ${p.note?`<p class="pc-n">${p.note}</p>`:''}
  <div class="pc-f"><span class="pc-p num">${unitPrice(p)}${subPrice(p)?`<small>${subPrice(p)}</small>`:''}</span><button class="pc-add" data-add="${p.id}">${plus}<span class="lbl">В корзину</span></button></div>
 </div></article>`}
function renderCat(c){
  const m=CATS[c],items=DATA.items.filter(p=>p.cat===c);curCat=c;curSub='all';
  const subs=[];items.forEach(p=>{if(p.sub&&!subs.find(s=>s[0]===p.sub))subs.push([p.sub,p.subName])});
  const i=ORDER.indexOf(c),nx=ORDER[(i+1)%ORDER.length];
  const cover=DATA.covers[c];
  $('#catView').innerHTML=`
  <div class="wrap cv-hero">
    <div class="cv-copy">
      <p class="crumbs mono"><a href="#top">Главная</a><span>/</span><span>Каталог</span><span>/</span><span>${m.name}</span></p>
      <h1>${m.name}<em>${m.em}</em></h1>
      <p class="lead">${m.lead}</p>
      <div class="cv-facts mono num"><span><b>${plural(items.length)}</b></span>${m.facts.map(f=>`<span>${f}</span>`).join('')}</div>
    </div>
    ${cover?`<figure class="cv-cover"><img src="${cover}" alt="" fetchpriority="high"><figcaption class="mono">${m.name}</figcaption></figure>`:''}
  </div>
  <nav class="cv-tabs" aria-label="Разделы каталога"><div class="wrap">${ORDER.map(k=>`<a href="#${k}"${k===c?' aria-current="page"':''}>${CATS[k].name}<sup class="num">${count(k)}</sup></a>`).join('')}</div></nav>
  <div class="wrap cv-body">
    ${subs.length>1?`<div class="chips" role="group" aria-label="Фильтр">${[['all','Все']].concat(subs).map(([k,n])=>`<button class="chip" data-sub="${k}" aria-pressed="${k==='all'}">${n}<sup class="num">${k==='all'?items.length:items.filter(p=>p.sub===k).length}</sup></button>`).join('')}</div>`:''}
    ${items.length?`<div class="pgrid">${items.map(card).join('')}</div>`:`<div class="cv-aside"><div><b>Раздел наполняется</b><p>Фотографии и ассортимент появятся после съёмки в лавке. Наличие на сегодня уточните по телефону.</p></div><a class="btn btn-line" href="tel:+79262443737">+7 926 244-37-37</a></div>`}
    ${c==='steaks'?`<div class="cv-aside"><div><b>Как жарить стейк, чтобы не пересушить</b><p>Инструмент прожарки покажет температуру в центре для каждой степени и подскажет, какую выбрать для вагю.</p></div><a class="btn btn-line" href="#doneness">Открыть прожарку <span class="ar">→</span></a></div>`:''}
    ${['meat','steaks','cheese','dairy'].includes(c)?'':''}
    <p class="demo-note" style="margin-top:20px">Цены демонстрационные, итоговую сумму за весовой товар подтвердим после взвешивания.</p>
    <a class="cv-next" href="#${nx}"><span><span class="mono">Следующий раздел</span><b>${CATS[nx].name}</b></span><span class="ar">→</span></a>
  </div>`;
}
document.addEventListener('click',e=>{
  const ch=e.target.closest('.chip[data-sub]');
  if(ch){curSub=ch.dataset.sub;$$('.chip[data-sub]').forEach(b=>b.setAttribute('aria-pressed',b===ch));$$('#catView .pc').forEach(c=>c.hidden=!(curSub==='all'||c.dataset.sub===curSub));return}
  const t=e.target.closest('[data-add],[data-set]');if(!t||t.closest('#drawer'))return;
  if(t.dataset.set){addToCart(t.dataset.set,1);return}
  addToCart(t.dataset.add);
  if(t.classList.contains('pc-add')){const l=t.querySelector('.lbl');t.classList.add('done');if(l)l.textContent='Добавлено';setTimeout(()=>{t.classList.remove('done');if(l)l.textContent='В корзину'},1300)}
});

/* ---------- router ---------- */
const home=$('#home'),catView=$('#catView'),staffView=$('#staffView'),accView=$('#accView'),legalView=$('#legalView');
let lastView='home';
function route(){
  const h=decodeURIComponent(location.hash.slice(1));
  accView.hidden=h!=='account';legalView.hidden=!(h==='privacy'||h==='consent');
  if(h==='privacy'||h==='consent'){home.hidden=true;catView.hidden=true;staffView.hidden=true;renderLegal(h);scrollTo(0,0);lastView='legal';document.title=(h==='privacy'?'Политика конфиденциальности':'Согласие на обработку персональных данных')+' — Мясо Кубани и стейки'}
  else if(h==='account'){home.hidden=true;catView.hidden=true;staffView.hidden=true;renderAccount();if(meLoaded)loadMe().then(()=>{if(location.hash==='#account')renderAccount()});scrollTo(0,0);lastView='acc';document.title='Личный кабинет — Мясо Кубани и стейки'}
  else if(CATS[h]){home.hidden=true;staffView.hidden=true;catView.hidden=false;renderCat(h);scrollTo(0,0);lastView='cat';document.title=CATS[h].name+' — Мясо Кубани и стейки'}
  else if(h==='staff'){home.hidden=true;catView.hidden=true;staffView.hidden=false;renderStaff();scrollTo(0,0);lastView='staff';document.title='Бот для сотрудников — Мясо Кубани и стейки'}
  else{const was=lastView;home.hidden=false;catView.hidden=true;staffView.hidden=true;lastView='home';document.title='Мясо Кубани и стейки';
    const el=h&&h!=='top'?document.getElementById(h):null;if(el)requestAnimationFrame(()=>el.scrollIntoView());else if(was!=='home'||h==='top')scrollTo(0,0)}
  $$('.nav a').forEach(a=>a.setAttribute('aria-current',a.getAttribute('href')==='#'+h?'page':'false'));
}
addEventListener('hashchange',route);

/* ---------- cart drawer & payment ---------- */
const drawer=$('#drawer'),scrim=$('#scrim');let lastF=null,stage='cart',order=null,useBonus=false;
const total=()=>Object.entries(cart).reduce((s,[id,q])=>ALL[id]?s+lineSum(ALL[id],q):s,0);
function dates(){const o=[],d=new Date(),wd=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],mo=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];for(let i=0;o.length<6&&i<10;i++){const x=new Date(d);x.setDate(d.getDate()+i);if(x.getDay()===1)continue;o.push((i===0?'Сегодня, ':i===1?'Завтра, ':wd[x.getDay()]+', ')+x.getDate()+' '+mo[x.getMonth()])}return o}
const bar=n=>`<div class="steps-bar" aria-hidden="true">${[1,2,3].map(i=>`<i class="${i<=n?'on':''}"></i>`).join('')}</div>`;
function renderDrawer(){
  const b=$('#drBody');
  if(stage==='pay'&&order){
    $('#drTitle').textContent='Оплата';
    b.innerHTML=bar(2)+`<div class="pay">
      <div class="pay-num"><b class="num">№ ${order.no}</b><span class="num">${rub(order.total)}</span></div>
      <div class="qr-box"><div class="qr" id="qr"></div><div><b>Оплата по QR-коду СБП</b><p>Откройте камеру или приложение банка, отсканируйте код и подтвердите перевод. Номер заказа уже указан в назначении платежа.</p></div></div>
      <ol class="pay-list">
        <li>Оплатите ${rub(order.total)} по QR-коду.</li>
        <li>Нажмите «Я оплатил», заказ уйдёт мяснику.</li>
        <li>Мясник взвесит товар. Если вес меньше, разницу вернём, если больше, согласуем доплату по телефону.</li>
      </ol>
      <div class="copyline"><span class="mono" style="color:var(--tallow-3)">Назначение</span><code id="purp">Заказ № ${order.no}</code><button class="copy" id="copyPurp">Копировать</button></div>
      <button class="btn btn-fill" id="paid" style="justify-content:center">Я оплатил <span class="ar">→</span></button>
      ${order.botLink?`<a class="btn btn-line" href="${order.botLink}" target="_blank" rel="noopener" style="justify-content:center">Получать статус в Telegram</a>`:''}
      ${API?'':'<button class="btn btn-line" id="backCart" style="justify-content:center">Изменить заказ</button>'}
      <p class="note">${API?esc(order.payNote||''):'Демо-версия: QR-код содержит только номер заказа, реальные реквизиты магазин подставит при запуске.'}</p>
    </div>`;
    drawQR();return}
  if(stage==='sent'&&order){
    $('#drTitle').textContent='Заказ передан';
    b.innerHTML=bar(3)+(API?`<div class="ok-box"><span class="mono" style="color:var(--brass)">Заказ № ${order.no}</span><b>Передали сотрудникам</b><p>Проверим поступление оплаты, и мясник возьмёт заказ в работу. ${order.telegramLinked?'Статус придёт в Telegram от бота лавки.':order.botLink?'Статус будет приходить в Telegram.':'Если появятся вопросы, позвоним на '+esc(order.tel)+'.'}${ME?' Заказ виден в личном кабинете.':''}</p>${order.botLink?`<a class="btn btn-fill" href="${order.botLink}" target="_blank" rel="noopener">Открыть заказ в Telegram <span class="ar">→</span></a>`:''}<button class="btn btn-line" data-close>Вернуться на сайт</button></div>`
  :`<div class="ok-box"><span class="mono" style="color:var(--brass)">Заказ № ${order.no}</span><b>Передали сотрудникам</b><p>Как только поступит оплата, мясник возьмёт заказ в работу. Статус придёт в Telegram.${ME?' Заказ уже виден в личном кабинете, а бонусы начислятся после выполнения.':''}</p><a class="btn btn-fill" href="#staff" data-close>Как заказ видят сотрудники <span class="ar">→</span></a><button class="btn btn-line" data-close>Вернуться на сайт</button><p class="note">Демо: откройте страницу бота, чтобы увидеть этот заказ глазами сотрудника.</p></div>`);return}
  $('#drTitle').textContent='Ваш заказ';
  const ids=Object.keys(cart).filter(id=>ALL[id]);
  if(!ids.length){b.innerHTML=`<div class="empty"><b>Корзина пока пуста</b><span>Загляните в разделы каталога: стейки, мясо, сыры и деликатесы.</span><a class="btn btn-fill" href="#steaks" data-close>К стейкам <span class="ar">→</span></a></div>`;return}
  const rows=ids.map(id=>{const p=ALL[id],q=cart[id];return `<div class="ci"><img src="${p.img||''}" alt="" class="${p.fit==='cover'?'':'cz'}"><div><b>${p.name}</b><small class="num">${p.unit==='kg'?rub(p.price)+'/кг':(p.w&&p.pp==null?'≈ '+kgf(p.w*q)+' · '+rub(p.price)+'/кг':rub(piece(p))+'/шт')}</small></div><div class="r"><span class="num">${rub(lineSum(p,q))}</span><div class="stepper"><button data-cdec="${id}" aria-label="Меньше">−</button><output class="num">${qLabel(p,q)}</output><button data-cinc="${id}" aria-label="Больше">+</button></div></div></div>`}).join('');
  const t=total(),free=t>=5000;
  const maxB=ME?Math.min(ME.bonus,Math.floor(t*ME.maxBonusShare)):0;if(!maxB)useBonus=false;
  const sum=(free?t:t+500)-(useBonus?maxB:0);
  const accHtml=ME?(maxB?`<label class="bonus-tg"><input type="checkbox" id="useB" ${useBonus?'checked':''}><span>Списать ${maxB} бонусов<small>На счёте ${ME.bonus}. Бонусами можно оплатить до ${Math.round(ME.maxBonusShare*100)}% заказа.</small></span></label>`:`<div class="acc-strip"><span>За этот заказ начислим ≈ ${Math.floor(t*ME.level.rate)} бонусов</span></div>`)
    :`<div class="acc-strip"><span>Войдите, чтобы получить 300 бонусов и кешбэк до 7%</span><a href="#account" data-close>Войти</a></div>`;
  b.innerHTML=bar(1)+rows+`<div class="sum"><div><span>Товары</span><span class="num">${rub(t)}</span></div><div><span>Доставка</span><span class="num">${free?'Бесплатно':'500 ₽'}</span></div>${useBonus?`<div><span>Бонусы</span><span class="num">−${rub(maxB)}</span></div>`:''}<div class="tot"><span>К оплате</span><span class="num">${rub(sum)}</span></div><p class="note">Оплата полная, при оформлении. Весовой товар взвесим после нарезки: если вес меньше, разницу вернём.${free?'':' До бесплатной доставки: '+rub(5000-t)+'.'}</p></div>
  ${accHtml}
  <form class="order" id="order" novalidate>
   <div class="seg" role="radiogroup" aria-label="Способ получения"><input type="radio" name="how" id="how-d" value="d" checked><label for="how-d">Доставка</label><input type="radio" name="how" id="how-p" value="p"><label for="how-p">Самовывоз</label></div>
   <div class="row2"><div class="fld"><label for="f-name">Имя</label><input id="f-name" autocomplete="given-name" placeholder="Анна" value="${ME?escA(ME.name):''}"></div><div class="fld"><label for="f-tel">Телефон</label><input id="f-tel" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00" value="${ME?escA(ME.phone):''}"></div></div>
   <div class="fld" id="addrFld"><label for="f-addr">Адрес</label><input id="f-addr" autocomplete="street-address" placeholder="Улица, дом, квартира" list="addrList" value="${ME&&ME.addresses[0]?escA(ME.addresses[0]):''}">${ME?`<datalist id="addrList">${ME.addresses.map(a=>`<option value="${escA(a)}">`).join('')}</datalist>`:''}</div>
   <div class="row2"><div class="fld"><label for="f-date">День</label><select id="f-date">${dates().map(d=>`<option>${d}</option>`).join('')}</select></div><div class="fld"><label for="f-time">Время</label><select id="f-time"><option>10:00–12:00</option><option>12:00–14:00</option><option>14:00–16:00</option><option>16:00–18:00</option><option>18:00–20:00</option></select></div></div>
   <div class="fld"><label for="f-note">Пожелания мяснику</label><textarea id="f-note" placeholder="Например: рибай толщиной 3 см, кости распилить">${ME?escA(ME.note):''}</textarea></div>
   ${AGREE('f-agree')}
   <p class="err" id="formErr" hidden></p>
   <button class="btn btn-fill" type="submit" style="justify-content:center">Перейти к оплате · ${rub(sum)} <span class="ar">→</span></button>
  </form>`;
}
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function drawQR(){const el=$('#qr');if(!el)return;if(order.qr){el.innerHTML=`<img src="${order.qr}" alt="QR-код для оплаты заказа № ${order.no}">`;return}
  if(API){el.innerHTML='<span class="mono" style="color:#6C5B51;text-align:center;font-size:11px;line-height:1.4">QR-код<br>уточните<br>по телефону<br>+7 926 244-37-37</span>';return}const txt='ДЕМО · Мясо Кубани и стейки · Заказ № '+order.no+' · '+Math.round(order.total)+' руб.';
  if(window.QRCode){try{new QRCode(el,{text:txt,width:132,height:132,colorDark:'#1C1412',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});return}catch(e){}}
  el.innerHTML='<span class="mono" style="color:#6C5B51;text-align:center">QR-код<br>СБП</span>'}
function openCart(){lastF=document.activeElement;if(stage==='sent')stage='cart';renderDrawer();drawer.hidden=false;scrim.hidden=false;document.documentElement.style.overflow='hidden';$('#cartClose').focus()}
function closeCart(){drawer.hidden=true;scrim.hidden=true;document.documentElement.style.overflow='';if(stage==='sent')stage='cart';if(lastF&&lastF.focus)lastF.focus()}
$('#cartOpen').onclick=openCart;$('#mnCart').onclick=()=>{menu(false);openCart()};$('#ctaCart').onclick=openCart;$('#cartClose').onclick=closeCart;scrim.onclick=closeCart;
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!drawer.hidden)closeCart()});
drawer.addEventListener('click',e=>{
  const t=e.target.closest('button,a');if(!t)return;
  if(t.dataset.close!==undefined){closeCart();return}
  if(t.id==='backCart'){stage='cart';renderDrawer();return}
  if(t.id==='copyPurp'){const v=$('#purp').textContent;const ok=()=>{t.textContent='Скопировано'};if(navigator.clipboard)navigator.clipboard.writeText(v).then(ok).catch(()=>{});return}
  if(t.id==='paid'){
    const fin=()=>{order.status='wait';saveOrder();cart={};save();renderCount();stage='sent';renderDrawer()};
    t.disabled=true;api('/api/orders/'+order.no+'/paid',{token:order.token}).catch(()=>null).then(()=>{fin();if(ME)loadMe()});return}
  const id=t.dataset.cdec||t.dataset.cinc;if(!id)return;const p=ALL[id];
  const q=Math.round((cart[id]+(t.dataset.cinc?stepQ(p):-stepQ(p)))*100)/100;
  if(q<minQ(p))delete cart[id];else cart[id]=q;save();renderCount();renderDrawer();
});
drawer.addEventListener('change',e=>{if(e.target.name==='how')$('#addrFld').hidden=e.target.value==='p';
  if(e.target.id==='useB'){const keep={n:$('#f-name').value,t:$('#f-tel').value,a:$('#f-addr').value,no:$('#f-note').value,p:$('#how-p').checked,g:$('#f-agree').checked};useBonus=e.target.checked;renderDrawer();$('#f-name').value=keep.n;$('#f-tel').value=keep.t;$('#f-addr').value=keep.a;$('#f-note').value=keep.no;$('#f-agree').checked=keep.g;if(keep.p){$('#how-p').checked=true;$('#addrFld').hidden=true}}});
drawer.addEventListener('submit',async e=>{e.preventDefault();
  const name=$('#f-name').value.trim(),tel=$('#f-tel').value.trim(),pickup=$('#how-p').checked,addr=$('#f-addr').value.trim();
  const err=[];if(!name)err.push('имя');if(tel.replace(/\D/g,'').length<10)err.push('телефон из 10–11 цифр');if(!pickup&&!addr)err.push('адрес доставки');
  const box=$('#formErr');if(err.length){box.textContent='Заполните: '+err.join(', ')+'.';box.hidden=false;return}
  if(!$('#f-agree').checked){box.textContent='Отметьте согласие на обработку персональных данных.';box.hidden=false;return}
  const t=total(),free=t>=5000;
  order={no:1100+Math.floor(Math.random()*800),name,tel,pickup,addr:pickup?'Самовывоз · Таллинская, 7':addr,date:$('#f-date').value,time:$('#f-time').value,note:$('#f-note').value.trim(),
    items:Object.entries(cart).filter(([id])=>ALL[id]).map(([id,q])=>{const p=ALL[id];return {name:p.name,qty:qLabel(p,q),sum:lineSum(p,q)}}),delivery:free||pickup?0:500};
  order.total=order.items.reduce((s,i)=>s+i.sum,0)+order.delivery;
  const btn=e.target.querySelector('[type=submit]');btn.disabled=true;
  try{
    const maxB=ME?Math.min(ME.bonus,Math.floor(total()*ME.maxBonusShare)):0;
    const j=await api('/api/orders',{consent:true,name,tel,pickup,addr,date:order.date,time:order.time,note:order.note,useBonus:useBonus?maxB:0,items:Object.entries(cart).filter(([id])=>ALL[id]).map(([id,q])=>({id,q}))});
    Object.assign(order,{no:j.no,token:j.token,total:j.total,delivery:j.delivery,bonusUsed:j.bonusUsed,qr:j.payQr?API+j.payQr:null,botLink:j.botLink,payNote:j.payNote,telegramLinked:j.telegramLinked});
    useBonus=false;if(ME)loadMe();
  }catch(err){box.textContent='Не удалось отправить заказ: '+err.message+'. Позвоните нам: +7 926 244-37-37.';box.hidden=false;btn.disabled=false;return}
  stage='pay';renderDrawer();
});
function saveOrder(){try{localStorage.setItem('mk3-order',JSON.stringify(order))}catch(e){}}

/* ---------- staff bot demo ---------- */
const SAMPLE={no:1124,name:'Анна',tel:'+7 916 555-12-40',pickup:false,addr:'ул. Таллинская, 20, кв. 48',date:'Сегодня',time:'14:00–16:00',note:'Рибай толщиной 3 см',items:[{name:'Рибай-стейк',qty:'2 шт',sum:4050},{name:'Масло Премиум',qty:'1 шт',sum:389},{name:'Пармезан',qty:'0,25 кг',sum:725}],delivery:0,total:5164,sample:true};
const FLOW=[['wait','Оплата','Бот присылает заказ и ждёт, пока сотрудник проверит поступление денег.'],['paid','Оплачен','Заказ уходит мяснику, покупатель получает подтверждение.'],['work','В работе','Мясник режет, взвешивает и вводит фактическую сумму.'],['packed','Собран','Заказ упакован в вакуум и термосумку.'],['road','У курьера','Курьер забирает заказ, покупатель получает уведомление.'],['done','Доставлен','Заказ закрыт, итоги дня уходят владельцу.']];
let st=null,feed=[],clock=null;
function hhmm(){clock=clock?new Date(clock.getTime()+ (3+Math.floor(Math.random()*9))*60000):new Date();return clock.toTimeString().slice(0,5)}
function orderText(o){return `Клиент: ${o.name}, ${o.tel}
${o.pickup?'Самовывоз':'Доставка: '+o.addr}
Когда: ${o.date}, ${o.time}

${o.items.map(i=>`• ${i.name} × ${i.qty} — ${rub(i.sum)}`).join('\n')}${o.delivery?`\n• Доставка — ${rub(o.delivery)}`:''}

Итого оплачено: ${rub(o.total)}${o.note?`\nКомментарий: ${o.note}`:''}`}
const STL={wait:['Ждёт проверки оплаты','st-wait'],paid:['Оплачен','st-ok'],work:['В работе','st-work'],packed:['Собран','st-work'],road:['У курьера','st-work'],done:['Доставлен','st-done'],cancel:['Отменён','st-done']};
function kb(o){switch(o.status){
  case 'wait':return `<div class="tg-kb"><button data-bot="paid">Оплата получена</button><button data-bot="cancel">Оплаты нет</button></div>`;
  case 'paid':return `<div class="tg-kb"><button class="wide" data-bot="work">Взять в работу</button></div>`;
  case 'work':return `<div class="tg-weigh"><input id="fact" inputmode="numeric" aria-label="Фактическая сумма после взвешивания" value="${Math.round(o.total-(o.delivery||0)-Math.round(Math.random()*120))}"><button data-bot="weigh">Взвесил</button></div>`;
  case 'packed':return `<div class="tg-kb"><button class="wide" data-bot="road">${o.pickup?'Выдан покупателю':'Передан курьеру'}</button></div>`;
  case 'road':return `<div class="tg-kb"><button class="wide" data-bot="done">Доставлен</button></div>`;
  default:return ''}}
function renderStaff(){
  let o=null;try{o=JSON.parse(localStorage.getItem('mk3-order')||'null')}catch(e){}
  if(!st||(o&&st.no!==o.no)){st=JSON.parse(JSON.stringify(o||SAMPLE));st.status='wait';clock=null;feed=[{sys:'Новый заказ с сайта',before:true,t:hhmm()}]}
  const s=STL[st.status]||STL.wait;
  $('#staffView').innerHTML=`<div class="staff"><div class="wrap">
   <div class="staff-tx">
     <p class="crumbs mono"><a href="#top">Главная</a><span>/</span><span>Для сотрудников</span></p>
     <h1>Заказы приходят <em>в Telegram</em></h1>
     <p class="lead">Бот работает как приложение для сотрудников. Каждый оплаченный заказ с сайта приходит в рабочий чат, а кнопки под сообщением ведут его от проверки оплаты до доставки. Покупатель получает уведомление на каждом шаге.</p>
     <ol class="flow">${FLOW.map(f=>`<li class="${f[0]===st.status?'on':''}"><b>${f[1]}</b><span>${f[2]}</span></li>`).join('')}</ol>
     <p class="demo-note">${st.sample?'Это пример заказа. Оформите заказ на сайте, и здесь появится он.':'Здесь ваш заказ № '+st.no+' с сайта.'} Нажимайте кнопки в чате, чтобы пройти весь путь.</p>
     <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-line" id="botReset">Начать сначала</button><a class="btn btn-line" href="#steaks">К каталогу</a></div>
   </div>
   <div class="phone-mock"><div class="tg">
     <div class="tg-top"><span class="tg-ava">МК</span><span><b>Лавка · Заказы</b><small>бот · 4 сотрудника</small></span></div>
     <div class="tg-feed" id="tgFeed">
       ${feed.filter(f=>f.sys&&f.before).map(f=>`<span class="tg-sys">${f.sys}</span>`).join('')}
       <div class="tg-msg"><span class="h">Заказ № ${st.no}</span><br><span class="st ${s[1]}">${s[0]}</span><div class="ln">${orderText(st)}</div>${st.fact?`<div class="ln" style="margin-top:6px">После взвешивания: ${rub(st.fact)} · ${st.total-(st.delivery||0)-st.fact>=0?'к возврату '+rub(st.total-(st.delivery||0)-st.fact):'к доплате '+rub(st.fact-(st.total-(st.delivery||0)))}</div>`:''}<time>${feed[0].t||''}</time>${kb(st)}</div>
       ${feed.slice(1).map(f=>f.sys?`<span class="tg-sys">${f.sys}</span>`:'').join('')}
     </div>
   </div></div>
  </div></div>`;
  const fd=$('#tgFeed');if(fd)fd.scrollTop=fd.scrollHeight;
}
document.addEventListener('click',e=>{
  if(e.target.closest('#botReset')){st=null;renderStaff();return}
  const b=e.target.closest('[data-bot]');if(!b||!st)return;
  const a=b.dataset.bot,t=hhmm();
  if(a==='paid'){st.status='paid';feed.push({sys:`Ирина: оплата ${rub(st.total)} получена · ${t}`},{sys:'Покупателю: «Оплата получена, заказ передан мяснику»'})}
  if(a==='cancel'){st.status='cancel';feed.push({sys:`Ирина: оплата не поступила, заказ отменён · ${t}`},{sys:'Покупателю: «Оплата не найдена, позвоните нам»'})}
  if(a==='work'){st.status='work';feed.push({sys:`Мясник Сергей взял заказ · ${t}`})}
  if(a==='weigh'){const v=parseInt(($('#fact')||{}).value,10);if(!v)return;st.fact=v;st.status='packed';const d=st.total-(st.delivery||0)-v;feed.push({sys:`Сергей: взвешено ${rub(v)} · ${t}`},{sys:d>=0?`Покупателю: «Заказ собран, вернём ${rub(d)}»`:`Покупателю: «Заказ собран, доплата ${rub(-d)}»`})}
  if(a==='road'){st.status=st.pickup?'done':'road';feed.push({sys:st.pickup?`Выдан покупателю · ${t}`:`Курьер Дмитрий забрал заказ · ${t}`},{sys:st.pickup?'Покупателю: «Спасибо за покупку!»':'Покупателю: «Курьер в пути»'})}
  if(a==='done'){st.status='done';feed.push({sys:`Доставлено · ${t}`},{sys:'Владельцу: заказ закрыт, выручка дня обновлена'})}
  demoAdvance(String(st.no),st.status,st.fact);
  renderStaff();
});

let tt;function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,1800)}
renderCount();route();if(location.hash!=='#account')loadMe();
})();
