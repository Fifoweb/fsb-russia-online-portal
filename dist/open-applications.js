import * as api from './auth-client.js?v=open-forms-1';
import { transferRules } from './data/transfer-rules.js';
import { seniorRanks } from './data/senior-report-rules.js';
import { internalDepartments } from './data/internal-departments.js';

const types = [
  {id:'restoration',route:'reinstatement',title:'Восстановление во фракцию',description:'Обстоятельства увольнения и ссылки на подтверждения прежнего звания.'},
  {id:'transfer',route:'transfer',title:'Переводы в ФСБ',description:'Перевод из другой структуры по утверждённой таблице рангов.'},
  {id:'internal_transfer',route:'internal-transfer',title:'Переводы между отделами',description:'Текущий отдел, желаемый отдел и причина перевода.'},
  {id:'senior_report',route:'senior-report',title:'Отчёт старших',description:'Повышение с 1 по 14 ранг. Адресат и доказательства проделанной работы.'},
];
const drafts = new Map();
const histories = new Map();
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const owner = state => state.profile?.user_id || null;
const key = (kind,state) => `portal-open:${kind}:${owner(state)||'guest'}`;
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
function draftFor(kind,state) {
  const id=key(kind,state);
  if(!drafts.has(id)) {
    let saved={};try{saved=JSON.parse(sessionStorage.getItem(id)||'{}')||{};}catch{}
    drafts.set(id,{values:{},guestToken:token(),...saved,busy:false,error:'',checking:false,checked:null});
  }
  return drafts.get(id);
}
function save(kind,state,draft){try{sessionStorage.setItem(key(kind,state),JSON.stringify({values:draft.values,guestToken:draft.guestToken,pending:draft.pending,success:draft.success,lastRequest:draft.lastRequest}));}catch{/* The active view still retains its receipt. */}}
const head = title => `<div class="container page-heading portal-heading"><nav class="breadcrumb" aria-label="Навигационная цепочка"><a href="#/">Главная</a><span>/</span><a href="#/applications">Заявки</a></nav><h1 class="page-title">${esc(title)}</h1><p class="page-description">Заполните и отправьте форму без регистрации. Используйте только игровые данные.</p></div>`;
export function renderAccountBenefits() {
  return `<aside class="open-benefits"><div><span class="portal-label">ПО ЖЕЛАНИЮ</span><h2>Меньше полей в каждой заявке</h2><p>Аккаунт сохраняет игровой ник и Static ID: они подставятся во все формы. В кабинете останется история заявок, отправленных после входа.</p><p>Добровольная привязка Discord добавит автозаполнение Discord ID и ника, а также подтверждённое упоминание автора в уведомлении.</p></div><div class="portal-actions"><a class="button secondary" href="#/account?tab=register">Создать аккаунт</a><a class="text-link" href="#/account?tab=login">Уже есть аккаунт? Войти ↗</a></div><p class="portal-field-hint">Ник и статик сохраняет регистрация. Привязка Discord для этого не требуется.</p></aside>`;
}
export function renderOpenServices() {
  return types.map(type=>`<a class="portal-service" href="#/applications/${type.route}"><div class="portal-service-copy"><div><h2>${type.title}</h2><p>${type.description}</p></div></div><span class="portal-service-action">Заполнить ↗</span></a>`).join('');
}
export function renderOpenApplicationsPage() {
  const state=api.getAccountState();
  return head('Ваши обращения')+`<section class="container portal-page" data-open-index><div class="open-access-note"><span class="portal-label">ОТКРЫТО ДЛЯ ВСЕХ</span><p>Все четыре формы доступны без аккаунта и без привязки Discord.</p></div>${renderOpenServices()}${owner(state)?'<p class="portal-field-hint">Вы вошли в аккаунт. Данные профиля будут подставлены автоматически. <a href="#/account">Личный кабинет ↗</a></p>':renderAccountBenefits()}</section>`;
}
function input(d,name,label,{type='text',required=true,max=100,pattern='',readonly=false,value,hint='',min='',step=''}={}) {
  return `<label class="portal-field" for="open-${name}">${label}<input class="portal-input" id="open-${name}" name="${name}" type="${type}" value="${esc(value??d.values[name]??'')}" ${required?'required':''} maxlength="${max}" ${pattern?`pattern="${pattern}"`:''} ${readonly?'readonly':''} ${min?`min="${min}"`:''} ${step?`step="${step}"`:''} ${['staticId','discordId'].includes(name)?'inputmode="numeric"':''} autocomplete="off" ${hint?`aria-describedby="open-hint-${name}"`:''}>${hint?`<span class="portal-field-hint" id="open-hint-${name}">${hint}</span>`:''}</label>`;
}
function select(d,name,label,options) {
  return `<label class="portal-field" for="open-${name}">${label}<select class="portal-input" id="open-${name}" name="${name}" required><option value="">Выберите…</option>${options.map(o=>`<option value="${esc(o.id)}" ${d.values[name]===String(o.id)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`;
}
const departments=internalDepartments.map(d=>({id:d.id,label:d.label}));
function text(d,name,label,hint='',max=1000) {
  return `<label class="portal-field" for="open-${name}">${label}<textarea class="portal-input" id="open-${name}" name="${name}" rows="4" maxlength="${max}" required ${hint?`aria-describedby="open-hint-${name}"`:''}>${esc(d.values[name]||'')}</textarea>${hint?`<span class="portal-field-hint" id="open-hint-${name}">${hint}</span>`:''}</label>`;
}
function specificFields(kind,d) {
  if(kind==='restoration') {
    const banned=d.values.dismissalType==='ban_warn';
    return `<h2>Обстоятельства увольнения</h2><div class="portal-short-fields">${select(d,'dismissalType','Тип увольнения',[{id:'regular',label:'Обычное увольнение'},{id:'ban_warn',label:'После бана или варна'}])}${input(d,'previousRank','Звание до увольнения',{type:'number',min:'1',step:'1',max:4})}</div>${text(d,'reason','Причина восстановления')}${input(d,'rankUrl','Подтверждение прежнего звания',{type:'url',max:300,hint:'Полная HTTPS-ссылка на скриншот или альбом.'})}${banned?input(d,'approvalUrl','Одобренный запрос после бана или варна',{type:'url',max:500}):input(d,'tabletUrl','Планшет с причиной увольнения',{type:'url',max:300})}`;
  }
  if(kind==='transfer') {
    const structure=transferRules.structures.find(s=>s.id===d.values.sourceStructure);
    const rule=structure?.ranks.find(r=>String(r.rank)===d.values.sourceRank);
    return `<h2>Перевод в ФСБ</h2><div class="portal-short-fields">${select(d,'sourceStructure','Из какой структуры',transferRules.structures.map(s=>({id:s.id,label:s.label})))}${select(d,'sourceRank','Текущий ранг',(structure?.ranks||[]).map(r=>({id:String(r.rank),label:`${r.rank} — ${r.title}`})))}</div><p class="open-rank-result" role="status">${rule?`По таблице переводов: <strong>${rule.targetRank} — ${esc(rule.targetTitle)}</strong>`:'Выберите структуру и текущий ранг — покажем ранг перевода.'}</p>${input(d,'sourcePosition','Текущая должность',{max:120})}${input(d,'passportNumber','Номер игрового паспорта',{pattern:'[0-9]{1,20}',max:20})}${input(d,'passportUrl','Игровой паспорт — ссылка',{type:'url',max:300})}${input(d,'credentialUrl','Игровое удостоверение — ссылка',{type:'url',max:300})}${input(d,'profileUrl','Планшет / профиль — ссылка',{type:'url',max:300})}${input(d,'approvalUrl','Одобрение лидера / заместителя — ссылка',{type:'url',max:500})}${text(d,'reason','Причина перевода')}`;
  }
  if(kind==='internal_transfer') return `<h2>Перевод между отделами</h2><div class="portal-short-fields">${select(d,'sourceDepartment','В каком отделе вы сейчас',departments)}${select(d,'targetDepartment','В какой отдел хотите перевестись',departments.filter(x=>x.id!==d.values.sourceDepartment))}</div>${text(d,'reason','Причина перевода')}<p class="portal-field-hint">Руководство выбранного отдела получит уведомление. Решение о переводе принимает руководство.</p>`;
  const from=seniorRanks.find(r=>r.id===d.values.fromRank);
  const count=Math.max(1,Math.min(5,Number(d.values.peopleCount)||1));
  return `<h2>Отчёт о повышении</h2>${select(d,'recipient','Кого отметить',[{id:'senior',label:'Старший состав'},...departments.map(x=>({id:`department:${x.id}`,label:`Руководство ${x.label}`})),{id:'person',label:'Конкретные люди по Discord-нику'}])}${d.values.recipient==='person'?`<fieldset class="open-people"><legend>Получатели отчёта</legend><p class="portal-field-hint">Точный Discord username или ID участника сервера ФСБ. До пяти человек.</p>${Array.from({length:count},(_,i)=>input(d,`person${i+1}`,`Discord username или ID человека ${i+1}`,{max:80,required:false})).join('')}<div class="portal-actions">${count<5?'<button class="button secondary" type="button" data-open-action="add-person">Добавить человека</button>':''}${count>1?'<button class="text-link" type="button" data-open-action="remove-person">Убрать последнего</button>':''}<button class="button secondary" type="button" data-open-action="check-people" ${d.checking?'disabled':''}>${d.checking?'Проверяем…':'Проверить получателей'}</button></div><p class="portal-field-hint">Пустые строки: будет отмечен старший состав.</p>${d.checked?`<p class="portal-message is-success" role="status">${d.checked.length?`Найдены: ${d.checked.map(m=>esc(m.username)).join(', ')}`:'Будет отмечен старший состав.'}</p>`:''}</fieldset>`:''}<div class="portal-short-fields">${select(d,'fromRank','Текущий ранг',seniorRanks.map(r=>({id:r.id,label:`${r.rank} — ${r.label}`})))}${select(d,'toRank','Ранг повышения',seniorRanks.filter(r=>!from||r.rank>from.rank).map(r=>({id:r.id,label:`${r.rank} — ${r.label}`})))}</div>${from?.rank===14?'<p class="portal-message is-error">14 — Генерал-полковник — максимальный ранг. Повышение выше него недоступно.</p>':''}${text(d,'evidenceUrls','Доказательства проделанной работы','От 1 до 10 полных HTTPS-ссылок. Каждая ссылка с новой строки.',3100)}`;
}
function receipt(app) {
  const status=app.delivery_status;
  const title=status==='sent'?'Отправлено в Discord':status==='unknown'?'Доставка требует проверки':'Заявка сохранена';
  const detail=status==='sent'?'Руководство получило уведомление. Решение по заявке принимает руководство.':status==='unknown'?'Discord мог получить сообщение. Повторная отправка закрыта, чтобы избежать дубликатов. Сообщите номер заявки руководству.':'Доставка ещё не подтверждена. Можно проверить статус и повторить доставку через минуту с тем же номером.';
  return `<div class="portal-gate open-receipt"><span class="portal-label">${esc(title)}</span><h2>${esc(types.find(t=>t.id===app.kind)?.title||'Заявка')}</h2><p>${detail}</p><p class="portal-field-hint">Номер: <code>${esc(app.id)}</code></p>${['pending','retryable','failed'].includes(status)?'<button class="button secondary" type="button" data-open-action="retry">Проверить и повторить доставку</button>':''}</div>`;
}
export function renderOpenFormPage(kind) {
  const state=api.getAccountState(),d=draftFor(kind,state),type=types.find(t=>t.id===kind);
  if(!type)return '';
  if(!d.values.dismissalType)d.values.dismissalType='regular';
  if(!d.values.recipient)d.values.recipient='senior';
  if(kind==='internal_transfer'&&!d.values.sourceDepartment&&state.profile?.department?.id)d.values.sourceDepartment=state.profile.department.id;
  const notice=owner(state)?`<div class="open-access-note"><p>Вы вошли как <strong>${esc(state.profile.game_name)}</strong>. Ник и статик подставлены из профиля. <a href="#/account">Личный кабинет ↗</a></p></div>`:renderAccountBenefits();
  const feedback=`<div class="portal-message is-error" data-open-error role="alert" ${d.error?'':'hidden'}>${esc(d.error)}</div>`;
  let content;
  if(d.success) content=receipt(d.success)+`<div class="portal-actions"><button class="button secondary" type="button" data-open-action="new">Новая заявка</button><a class="text-link" href="#/applications">Все формы ↗</a></div>${feedback}${owner(state)?'':notice}`;
  else if(d.pending) content=`<div class="portal-gate"><h2>Проверим результат отправки</h2><p>Данные этой попытки сохранены в текущей вкладке. Проверим статус или повторим тот же запрос с прежним номером.</p><div class="portal-actions"><button class="button secondary" type="button" data-open-action="status">Проверить статус</button><button class="button primary" type="button" data-open-action="resend">Повторить запрос</button></div>${feedback}</div>`;
  else content=`${owner(state)?notice:''}<form class="portal-restoration open-form" data-open-form="${kind}" aria-busy="${d.busy}"><div class="portal-form-body"><fieldset class="open-identity"><legend>Данные заявителя</legend><div class="portal-short-fields">${input(d,'gameName','Игровой ник',{readonly:!!owner(state),value:state.profile?.game_name??d.values.gameName,max:100,hint:'Имя и фамилия игрового персонажа.'})}${input(d,'staticId','Static ID',{readonly:!!owner(state),value:state.profile?.static_id??d.values.staticId,pattern:'[0-9]{1,20}',max:20})}</div>${state.discord?`<div class="portal-short-fields">${input(d,'discordId','Discord ID',{required:false,readonly:true,value:state.discord.id,pattern:'[0-9]{17,20}',max:20})}${input(d,'discordUsername','Никнейм Discord',{required:false,readonly:true,value:state.discord.username,max:80})}</div><p class="portal-field-hint">Discord подтверждён привязкой. Данные заполнены автоматически.</p>`:`${input(d,'discordId','Discord ID (необязательно)',{required:false,value:d.values.discordId,pattern:'[0-9]{17,20}',max:20})}<p class="portal-field-hint">Для отправки заявки Discord-ник не нужен. При желании укажите Discord ID для связи. После добровольной привязки в личном кабинете ID и ник будут заполняться автоматически.</p>`}</fieldset><div class="open-specific" data-open-specific>${specificFields(kind,d)}</div><div class="open-honeypot" aria-hidden="true"><label>Не заполняйте это поле<input name="website" tabindex="-1" autocomplete="off"></label></div><div class="portal-submit-area"><label class="portal-consent"><input type="checkbox" name="consent" required ${d.values.consent?'checked':''}><span>Подтверждаю игровые данные и согласен на сохранение заявки и отправку её в Discord фракции.</span></label>${feedback}<div class="portal-submit-row"><p>Настоящие документы не отправляйте.</p><button class="button primary" type="submit" ${d.busy?'disabled':''}>${d.busy?'Сохраняем и отправляем…':'Отправить заявку'}</button></div></div></div></form>${owner(state)?'':notice}`;
  return head(type.title)+`<section class="container portal-page portal-form-page" data-open-page="${kind}">${content}</section>`;
}
function payload(kind,d,state) {
  const v=d.values;
  const body={...v,action:'submit',kind,idempotencyKey:crypto.randomUUID(),guestToken:d.guestToken,consent:v.consent===true,discordUsername:state.discord?.username||''};
  if(kind==='restoration')Object.assign(body,{previousRank:Number(v.previousRank),rankProof:{paths:[],urls:[v.rankUrl]},tabletProof:{paths:[],urls:v.dismissalType==='regular'?[v.tabletUrl]:[]},approvalUrl:v.dismissalType==='ban_warn'?v.approvalUrl:null});
  if(kind==='transfer')body.sourceRank=Number(v.sourceRank);
  if(kind==='senior_report')Object.assign(body,{recipientKind:v.recipient?.startsWith('department:')?'department':v.recipient,department:v.recipient?.split(':')[1]||null,recipientUsernames:Array.from({length:5},(_,i)=>v[`person${i+1}`]||''),evidenceUrls:(v.evidenceUrls||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)});
  return body;
}
export function renderOpenHistorySection() {
  const state=api.getAccountState();if(!owner(state))return '';
  return `<section class="container portal-page portal-history" data-open-history><div class="portal-section-head"><div><h2>Новые обращения</h2><p>Заявки, отправленные после входа в аккаунт. Гостевые обращения в кабинет автоматически не переносятся.</p></div><button class="portal-refresh" type="button" data-open-action="refresh-history">Обновить</button></div><div data-open-history-body>${historyMarkup(histories.get(owner(state)))}</div></section>`;
}
function historyMarkup(value) {
  if(!value)return '<p class="portal-field-hint">Загружаем обращения…</p>';
  if(value.error)return `<p class="portal-message is-error" role="alert">${esc(value.error)}</p>`;
  if(!value.length)return '<p class="portal-field-hint">Новых обращений пока нет. Выберите форму в разделе «Заявки».</p>';
  return value.map(app=>`<article class="open-history-item"><h3>${esc(types.find(t=>t.id===app.kind)?.title||'Заявка')}</h3><p>${new Date(app.created_at).toLocaleString('ru-RU')} · ${esc(app.snapshot.game_name)} · Static ID ${esc(app.snapshot.static_id)}</p><p>${esc(app.delivery_status==='sent'?'Доставлено в Discord':app.delivery_status==='unknown'?'Доставка требует проверки':'Доставка пока не подтверждена')}</p><code>${esc(app.id)}</code><details><summary>Данные заявки</summary><p>Discord ID: ${esc(app.snapshot.discord.id||'не указан')} · ${app.snapshot.discord_verified?'подтверждён привязкой':'не подтверждён'}</p>${app.snapshot.reason?`<p>${esc(app.snapshot.reason)}</p>`:''}${app.kind==='internal_transfer'?`<p>${esc(app.snapshot.source_department)} → ${esc(app.snapshot.target_department)}</p>`:''}${app.kind==='senior_report'?`<p>${esc(app.snapshot.from_rank)} → ${esc(app.snapshot.to_rank)}</p>`:''}</details>${['pending','retryable','failed'].includes(app.delivery_status)?`<button class="button secondary" type="button" data-open-action="retry-history" data-open-id="${esc(app.id)}">Проверить и повторить доставку</button>`:''}</article>`).join('');
}
export function mountOpenApplications({onStateChange=()=>{}}={}) {
  let state=api.getAccountState(),signature=JSON.stringify(state),alive=true;
  const page=document.querySelector('[data-open-page]'),kind=page?.dataset.openPage;
  const d=kind?draftFor(kind,state):null,expectedOwner=owner(state);
  const rerender=()=>{if(alive){const y=window.scrollY;onStateChange();window.scrollTo({top:y,behavior:'instant'});}};
  const request=body=>api.openApplicationRequest(body,expectedOwner);
  async function loadHistory(){if(!expectedOwner)return;try{const r=await request({action:'list'});histories.set(expectedOwner,r.applications);}catch(e){histories.set(expectedOwner,{error:e.message});}if(alive){const node=document.querySelector('[data-open-history-body]');if(node)node.innerHTML=historyMarkup(histories.get(expectedOwner));}}
  function values(form){for(const [name,value] of new FormData(form))if(name!=='website')d.values[name]=value;d.values.consent=form.elements.consent.checked;}
  function update(event){if(!d||!event.target.name)return;const name=event.target.name;d.values[name]=event.target.type==='checkbox'?event.target.checked:event.target.value;d.error='';d.checked=null;
    if(name==='sourceStructure')d.values.sourceRank='';
    if(name==='sourceDepartment'&&d.values.targetDepartment===d.values.sourceDepartment)d.values.targetDepartment='';
    if(name==='fromRank'&&seniorRanks.findIndex(r=>r.id===d.values.toRank)<=seniorRanks.findIndex(r=>r.id===d.values.fromRank))d.values.toRank='';
    save(kind,state,d);
    if(['dismissalType','sourceStructure','sourceRank','sourceDepartment','recipient','fromRank'].includes(name)){const fields=page?.querySelector('[data-open-specific]');if(fields)fields.innerHTML=specificFields(kind,d);}
  }
  async function send(){if(!d?.pending||d.busy)return;d.busy=true;d.error='';page?.querySelectorAll('button').forEach(b=>b.disabled=true);try{const r=await request(d.pending);d.lastRequest=d.pending;d.success=r.application;d.pending=null;histories.delete(expectedOwner);if(kind==='internal_transfer'&&expectedOwner)await api.refreshProfileDepartment({fresh:true}).catch(()=>{});}catch(e){d.error=e.message;if(e.status>=400&&e.status<500&&e.code!=='idempotency_conflict')d.pending=null;}finally{d.busy=false;save(kind,state,d);if(owner(api.getAccountState())===expectedOwner&&location.hash.split('?')[0]===`#/applications/${types.find(t=>t.id===kind).route}`)onStateChange();}}
  async function submit(event){if(!event.target.matches('[data-open-form]'))return;event.preventDefault();if(d.busy)return;values(event.target);if(event.target.elements.website.value)return;d.pending=payload(kind,d,state);save(kind,state,d);await send();}
  async function click(event){const button=event.target.closest('[data-open-action]');if(!button||button.disabled)return;const action=button.dataset.openAction;
    if(action==='refresh-history')return loadHistory();
    if(action==='retry-history'){
      const apps=histories.get(expectedOwner);const app=Array.isArray(apps)?apps.find(a=>a.id===button.dataset.openId):null;
      if(!app)return;button.disabled=true;
      try{await request({action:'retry',kind:app.kind,idempotencyKey:app.idempotencyKey});await loadHistory();}
      catch(e){if(alive){const node=document.querySelector('[data-open-history-body]');if(node){const error=document.createElement('p');error.className='portal-message is-error';error.setAttribute('role','alert');error.textContent=e.message;node.prepend(error);}}}
      finally{if(button.isConnected)button.disabled=false;}return;
    }
    if(!d||d.busy)return;
    if(action==='new'){drafts.delete(key(kind,state));try{sessionStorage.removeItem(key(kind,state));}catch{}return rerender();}
    if(action==='add-person'||action==='remove-person'){const count=Math.max(1,Math.min(5,(Number(d.values.peopleCount)||1)+(action==='add-person'?1:-1)));if(action==='remove-person')d.values[`person${count+1}`]='';d.values.peopleCount=String(count);save(kind,state,d);return rerender();}
    if(action==='resend')return send();
    d.error='';
    try{
      if(action==='check-people'){d.checking=true;button.disabled=true;button.textContent='Проверяем…';const r=await request({action:'check-people',guestToken:d.guestToken,recipientUsernames:Array.from({length:5},(_,i)=>d.values[`person${i+1}`]||'')});d.checked=r.members;}
      if(action==='status'){const r=await request({...d.pending,action:'status'});if(r.application){d.lastRequest=d.pending;d.success=r.application;d.pending=null;}else d.error='Запись пока не найдена. Повторите запрос с сохранёнными данными.';}
      if(action==='retry'){const id=d.success.id;const savedBody=d.lastRequest;if(savedBody){const r=await request({...savedBody,action:'retry'});d.success=r.application;}else d.error=`Сообщите номер заявки руководству: ${id}`;}
    }catch(e){d.error=e.message;}finally{d.checking=false;save(kind,state,d);rerender();}
  }
  function inputEvent(event){if(d&&event.target.name&&event.target.tagName!=='SELECT'){d.values[event.target.name]=event.target.type==='checkbox'?event.target.checked:event.target.value;save(kind,state,d);}}
  const main=document.querySelector('#main');
  main?.addEventListener('submit',submit);main?.addEventListener('change',update);main?.addEventListener('input',inputEvent);main?.addEventListener('click',click);
  const unsubscribe=api.subscribeAccount(next=>{if(JSON.stringify(next)!==signature){signature=JSON.stringify(next);state=next;rerender();}});
  if(expectedOwner&&document.querySelector('[data-open-history]'))void loadHistory();
  return ()=>{alive=false;unsubscribe();main?.removeEventListener('submit',submit);main?.removeEventListener('change',update);main?.removeEventListener('input',inputEvent);main?.removeEventListener('click',click);};
}
