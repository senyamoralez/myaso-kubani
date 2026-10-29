(function(){
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- catalog ---------- */
const DATA=/*CATALOG*/{"items":[],"covers":{}}/*END*/;
const CATS={
 meat:{name:'Мясо',em:'с Кубани и не только',lead:'Говядина Labinsk Beef из Краснодарского края, баранина, ягнятина, молочная телятина и птица. Отруба целиком и порционно, режем при вас.',facts:['Режем при вас','Охлаждённое']},
 steaks:{name:'Стейки',em:'от рибая до вагю A5',lead:'Премиальные и альтернативные стейки. Нарежем нужную толщину и подскажем прожарку для каждого отруба.',facts:['Толщина на выбор','Шкала BMS']},
 cheese:{name:'Сыры',em:'выдержанные, от головы',lead:'Костромские сыроварни «Боговарово»: выдержанные премиум-сыры, мини-головки и традиционные российские сорта. И сыроварня «Горка». Режем по весу, перед покупкой можно попробовать.',facts:['Дегустация в лавке','От 250 г']},
 dairy:{name:'Молочка',em:'фермерская',lead:'Молоко, кефир, сметана, сливки, масло и творожные десерты КФХ Постникова и итальянской фермы Fattoria Marian: козье молоко, ряженка, творог, масло с трюфелем и гхи.',facts:['Короткий срок хранения','Без восстановленного молока']},
 italian:{name:'Итальянские сыры',em:'от буррат до монтазио',lead:'Буррата, страчателла, моцарелла, качотта, монтазио, таледжо и горгонзола итальянской фермы Fattoria Marian, а ещё сыры сыроварни «Горка». Для пасты, пиццы, гриля и сырной тарелки.',facts:['Молодые сыры','Храним при +2…+6 °C']},
 sausage:{name:'Колбаса',em:'и мясные деликатесы',lead:'Ветчины, варёные, полукопчёные и сырокопчёные колбасы, копчёности, сосиски, сардельки и сало мясокомбинатов «Ломоносовский» и «Бердянский». А ещё деликатесы: салями, рийет и фуа-гра.',facts:['Нарезка по запросу','Деликатесы к вину']},
 fish:{name:'Рыба и икра',em:'осётр, лосось, икра',lead:'Копчёная и слабосолёная рыба: осётр, кижуч, лосось, арктический голец. Чёрная икра осетра и белуги, красная икра кеты и консервы из осетра.',facts:['Храним при −2…+2 °C','Подарочная упаковка']},
 ready:{name:'Полуфабрикаты',em:'ужин за 20 минут',lead:'Фарш из мраморной говядины, котлеты, пельмени, манты, вареники, блинчики и сырники, хинкали, чебуреки, колбаски для жарки и мясо для барбекю.',facts:['Из нашего мяса','Можно заморозить']}
};
const ORDER=['meat','steaks','cheese','dairy','italian','sausage','fish','ready'];
const SETS=[
 {id:'set-two',name:'Вечер на двоих',for:'2 персоны',img:'img/ribeye-steaks.jpg',price:4900,was:5164,hero:0,items:[['Рибай-стейк','2 шт · ≈ 900 г'],['Масло Премиум 82,5%','170 г'],['Пармезан, 12 мес','250 г']]},
 {id:'set-wagyu',name:'Вагю-дегустация',for:'2–4 персоны · хит',img:'img/wagyu-a5.jpg',price:13900,was:15060,hero:1,items:[['Вагю A5, рибай','200 г'],['Стриплойн вагю','500 г'],['Филе-миньон вагю','2 шт'],['Сыр с трюфелем','250 г']]},
 {id:'set-grill',name:'Гриль на компанию',for:'6–8 персон',img:'img/chuck-roll.jpg',price:9900,was:11150,hero:0,items:[['Рибай-стейк','4 шт · ≈ 1,8 кг'],['Чак-ролл для бургеров','1 кг'],['Мозговые кости','1 кг'],['Раклет для плавления','500 г']]}
];
const ALL={};DATA.items.forEach(p=>ALL[p.id]=p);SETS.forEach(s=>ALL[s.id]={id:s.id,name:'Набор «'+s.name+'»',img:s.img,unit:'pc',pp:s.price,fit:'cover'});

const rub=n=>Math.round(n).toLocaleString('ru-RU')+' ₽';
const kgf=n=>(Math.round(n*100)/100).toLocaleString('ru-RU')+' кг';
const minQ=p=>p.unit==='kg'?(p.min||.5):1, stepQ=p=>p.unit==='kg'?(p.step||.5):1;
const qLabel=(p,q)=>p.unit==='kg'?kgf(q):q+' шт';
const piece=p=>p.pp!=null?p.pp:p.price*(p.w||1);
const lineSum=(p,q)=>p.unit==='kg'?p.price*q:piece(p)*q;
const unitPrice=p=>p.unit==='kg'?rub(p.price)+' / кг':rub(piece(p))+' / шт';
const subPrice=p=>p.unit==='pc'&&p.w&&p.pp==null?'≈ '+Math.round(p.w*1000)+' г · '+rub(p.price)+'/кг':(p.unit==='kg'?'от '+kgf(minQ(p)):'');

/* ---------- cart state ---------- */
let cart={};try{cart=JSON.parse(localStorage.getItem('mk3-cart')||'{}')||{}}catch(e){cart={}}
const save=()=>{try{localStorage.setItem('mk3-cart',JSON.stringify(cart))}catch(e){}};
function addToCart(id,q){const p=ALL[id];if(!p||(p.price==null&&p.pp==null)||p.stock==='out'||p.hidden)return;cart[id]=Math.round(((cart[id]||0)+(q||minQ(p)))*100)/100;save();renderCount(true);toast(p.name+' — в корзине')}
function renderCount(pop){const c=$('#cartCount');c.textContent=Object.keys(cart).filter(k=>ALL[k]).length;if(pop){c.classList.add('pop');setTimeout(()=>c.classList.remove('pop'),350)}}
