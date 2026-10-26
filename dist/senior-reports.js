import * as api from './auth-client.js?v=guild-recipients-1';
import { seniorRanks } from './data/senior-report-rules.js?v=guild-recipients-1';
import { internalDepartments } from './data/internal-departments.js?v=guild-recipients-1';

const drafts = new Map();
const histories = new Map();
const views = new Set();
const personFields=['recipientUsername','recipientUsername2','recipientUsername3','recipientUsername4','recipientUsername5'];
const fieldNames=['recipient',...personFields,'peopleCount','fromRank','toRank','evidence'];
const labels={peopleCount:'Получатели',...Object.fromEntries(personFields.map((name,i)=>[name,'Discord username человека '+(i+1)])),recipient:'Кого уведомить',recipientUsername:'Discord-никнейм адресата',fromRank:'Текущий ранг',toRank:'Ранг повышения',evidence:'Доказательства работы',consent:'Подтверждение отправки'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const member = state => Boolean(state.profile && ['linked','registered'].includes(state.status));
const linked = state => member(state) && state.status === 'linked' && state.discord?.id;
const key = state => String(state.profile?.user_id || 'anonymous');
const notify = () => [...views].forEach(view => view());
const transferIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></svg>';
const stateNow = () => api.getAccountState();
const recipients=[...internalDepartments.map(d=>({id:'department:'+d.id,label:'Руководство '+d.label})),{id:'senior',label:'Старший состав'},{id:'person',label:'Конкретные люди по Discord-нику'}];
const recipient = id => recipients.find(item=>item.id===id);
const rankOptions = (value,from='') => '<option value="">Выберите звание</option>'+seniorRanks.map((r,i)=>`<option value="${r.id}" ${value===r.id?'selected':''} ${from&&i<=seniorRanks.findIndex(x=>x.id===from)?'disabled':''}>${r.label}</option>`).join('');
const evidenceUrls = value => value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
function validUrl(value) { try { const url=new URL(value);return value.length<=300&&url.href.length<=300&&url.protocol==='https:'&&url.hostname.includes('.')&&!url.username&&!url.password&&(!url.port||url.port==='443')&&!/[\s<>`\\]/u.test(value); } catch { return false; } }
function validUsername(value) { const name=value.trim().replace(/^@/,'');return [...name].length>=2&&name.length<=80&&!/[\x00-\x1f\x7f<>@\\/]/u.test(name)&&!['everyone','here'].includes(name.toLowerCase()); }
const peopleCount=draft=>Math.min(5,Math.max(1,Number(draft.peopleCount)||1));
const peopleValues=draft=>personFields.slice(0,peopleCount(draft)).map(name=>draft[name]||'');
function personMarkup(draft){return `<div data-senior-person ${draft.recipient==='person'?'':'hidden'}>${personFields.slice(0,peopleCount(draft)).map((name,i)=>`<div class="senior-person-row"><div><label class="portal-field" for="senior-${name}">Discord username человека ${i+1}<input class="portal-input" id="senior-${name}" name="${name}" maxlength="80" autocomplete="off" spellcheck="false" ${draft.recipient==='person'?'':'disabled'} value="${esc(draft[name])}" aria-describedby="senior-username-hint senior-error-${name}"></label>${errorMarkup(name,draft)}</div>${peopleCount(draft)>1?`<button class="portal-refresh" data-senior-action="remove-person" data-person-index="${i}" type="button" aria-label="Удалить человека ${i+1}">Удалить</button>`:''}</div>`).join('')}<p class="portal-field-hint" id="senior-username-hint">Укажите точное имя пользователя Discord или Discord ID. Отображаемые имена не подходят. Адресату не нужен аккаунт на сайте. Если все строки пустые, отметим старший состав.</p><div class="portal-actions">${peopleCount(draft)<5?'<button class="button secondary small" type="button" data-senior-action="add-person">Добавить человека</button>':''}<button class="button secondary small" type="button" data-senior-action="check-people" ${draft.checkingPeople?'disabled':''}>${draft.checkingPeople?'Проверяем…':'Проверить получателей'}</button></div><p class="portal-message is-error" data-senior-people-error role="alert" ${draft.peopleError?'':'hidden'}>${esc(draft.peopleError)}</p><p class="portal-field-hint">Проверка получателей не отправляет отчёт.</p><p class="portal-field-hint" data-senior-checked>${draft.checkedPeople?esc(draft.checkedPeople.length?'Найдены на сервере ФСБ: '+draft.checkedPeople.map(person=>'@'+person.username).join(', '):'Будет отмечен старший состав.'):''}</p></div>`;}

function draftFor(state) {
  const owner = key(state);
  if (!drafts.has(owner)) {
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(`portal-senior-report:${owner}`) || '{}') || {}; } catch { /* Draft storage is optional. */ }
    const fields = Object.fromEntries(fieldNames.map(name => [name, typeof stored[name] === 'string' ? stored[name].slice(0,name==='evidence'?4000:100) : '']));
    fields.peopleCount=String(Math.min(5,Math.max(1,Number(stored.peopleCount)||1)));
    const checkpoint = validCheckpoint(stored.checkpoint) ? stored.checkpoint : null;
    drafts.set(owner, { ...fields, checkpoint, errors:{}, busy:false, attempted:false, success:null, message:'', checked:false, consent:false, checkingPeople:false, checkedPeople:null, peopleError:'' });
  }
  return drafts.get(owner);
}
function validCheckpoint(value) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.idempotencyKey || '') && value.fields && ['recipient','recipientUsername','fromRank','toRank','evidence'].every(name => typeof value.fields[name] === 'string' && value.fields[name].length <= (name==='evidence'?4000:100)) && fieldNames.every(name=>value.fields[name]===undefined||typeof value.fields[name]==='string'&&value.fields[name].length<=(name==='evidence'?4000:100));
}
function save(state, draft) {
  const stored = Object.fromEntries(fieldNames.map(name => [name, draft[name]]));
  stored.checkpoint = draft.checkpoint;
  try { sessionStorage.setItem(`portal-senior-report:${key(state)}`, JSON.stringify(stored)); return true; } catch { return false; }
}
function safeMessage(error) {
  const text = String(error?.message || '');
  return /[А-Яа-яЁё]/.test(text) && !/token|secret|supabase|sql|apikey/i.test(text) ? text.slice(0,300) : 'Не удалось связаться с сервисом. Проверьте соединение и попробуйте снова.';
}
export function validateSeniorReportDraft(draft,consent=draft.consent) {
 const errors={};
 if(!recipient(draft.recipient))errors.recipient='Выберите руководство отдела, старший состав или человека.';
 if(draft.recipient==='person')for(const name of personFields.slice(0,peopleCount(draft))){if(draft[name]?.trim()&&!validUsername(draft[name]))errors[name]='Введите Discord username полностью или Discord ID.';}
 const from=seniorRanks.findIndex(r=>r.id===draft.fromRank),to=seniorRanks.findIndex(r=>r.id===draft.toRank);
 if(from<0)errors.fromRank='Выберите текущее звание старшего состава.';
 if(to<0||to<=from)errors.toRank='Выберите звание выше текущего, до генерал-полковника.';
 const urls=evidenceUrls(draft.evidence);if(!urls.length||urls.length>10||urls.some(url=>!validUrl(url)))errors.evidence='Добавьте от 1 до 10 полных HTTPS-ссылок, по одной на строку, до 300 символов каждая.';
 if(!consent)errors.consent='Подтвердите отправку отчёта в Discord.';
 return errors;
}
function errorMarkup(name,draft){return `<p class="portal-field-error" id="senior-error-${name}" data-senior-error="${name}" ${draft.errors[name]?'':'hidden'}>${esc(draft.errors[name])}</p>`;}
function targetMarkup(draft){
 if(draft.recipient!=='person')return `<strong>${esc(recipient(draft.recipient)?.label||'Выберите адресата')}</strong><span>Уведомление получит выбранная роль.</span>`;
 const names=peopleValues(draft).filter(name=>name.trim());return names.length?`<strong>Получателей: ${names.length}</strong><span>При отправке найдём точные username на сервере ФСБ и поставим настоящие теги. Если хотя бы один человек не найден, отчёт отправлен не будет.</span>`:'<strong>Старший состав</strong><span>Пустые строки: при отправке будет отмечена роль старшего состава.</span>';
}

function gate(state) {
  if (state.status === 'loading') return '<div class="portal-gate portal-history-loading" role="status"><h2>Проверяем аккаунт</h2><span></span><p>Загружаем профиль и привязку Discord.</p></div>';
  if (state.status === 'error') return '<div class="portal-gate"><h2>Не удалось проверить аккаунт</h2><p>Обновите страницу, чтобы повторить проверку входа.</p><button class="button secondary" type="button" data-senior-action="reload">Обновить страницу</button></div>';
  if (!member(state)) return '<div class="portal-gate"><h2>Войдите, чтобы подать заявку</h2><p>Используйте аккаунт портала и привяжите Discord. Игровой ник, Static ID и Discord автора отчёта заполнятся из профиля.</p><div class="portal-actions"><a class="button primary" href="#/account?tab=login">Войти</a><a class="button secondary" href="#/account?tab=register">Создать аккаунт</a></div></div>';
  if (!linked(state)) return '<div class="portal-gate"><h2>Привяжите Discord</h2><p>Для отправки отчёта нужен подтверждённый Discord. Руководство сможет связаться с вами по привязанному аккаунту.</p><div class="portal-actions"><button class="button primary" type="button" data-senior-action="link-discord">Привязать Discord</button><a class="text-link" href="#/account">Личный кабинет</a></div><p class="portal-message is-error" data-senior-gate-error role="alert" hidden></p></div>';
  return '';
}
export function renderSeniorReportPage() {
 const state=stateNow();
 const intro=`<div class="container page-heading portal-heading portal-heading-child"><nav class="breadcrumb" aria-label="Навигационная цепочка"><a href="#/">Главная</a><span>/</span><a href="#/applications">Заявки</a><span>/</span><span>Отчёт старших</span></nav><h1 class="page-title">Отчёт старших</h1><p class="page-description">Отчёт о проделанной работе для повышения старшего состава: от подполковника до генерал-полковника.</p></div>`;
 if(!linked(state))return intro+`<section class="container portal-page portal-form-page" data-senior-page>${gate(state)}</section>`;
 const draft=draftFor(state),content=draft.success?resultMarkup(draft.success):draft.checkpoint?recoveryMarkup(draft):formMarkup(state,draft);
 return intro+`<section class="container portal-page portal-form-page" data-senior-page>${content}${renderSeniorReportHistorySection(state)}</section>`;
}
function formMarkup(state,draft){
 return `<form class="portal-restoration transfer-form" data-senior-form novalidate aria-busy="${draft.busy}"><div class="portal-applicant"><div class="portal-applicant-main"><div><strong>${esc(state.profile.game_name)}</strong><span>Static ID ${esc(state.profile.static_id)}</span></div></div><div class="portal-applicant-discord"><span class="portal-connected">Discord привязан</span></div></div><div class="portal-form-body"><div class="portal-form-title"><h2>Отчёт на повышение</h2><span>Все поля обязательны</span></div><p class="portal-field-hint">Игровой ник и Static ID автоматически заполнены из вашего профиля.</p><div class="portal-message is-error transfer-error-summary" data-senior-summary tabindex="-1" role="alert" hidden></div>
 <fieldset class="transfer-fieldset"><legend>Данные автора отчёта</legend><div class="portal-short-fields"><label class="portal-field" for="senior-author-discord-id">Discord ID<input class="portal-input" id="senior-author-discord-id" type="text" value="${esc(state.discord.id)}" readonly translate="no" autocomplete="off" spellcheck="false" aria-describedby="senior-author-hint"></label><label class="portal-field" for="senior-author-discord-name">Никнейм Discord<input class="portal-input" id="senior-author-discord-name" type="text" value="${esc(state.discord.username)}" readonly translate="no" autocomplete="off" spellcheck="false" aria-describedby="senior-author-hint"></label></div><p class="portal-field-hint" id="senior-author-hint">Из привязанного аккаунта Discord. Эти данные будут указаны в отчёте.</p></fieldset>
 <fieldset class="transfer-fieldset"><legend>Кого уведомить</legend><label class="portal-field" for="senior-recipient">Адресат уведомления<select class="portal-input" id="senior-recipient" name="recipient" required aria-describedby="senior-error-recipient"><option value="">Выберите адресата</option>${recipients.map(r=>`<option value="${r.id}" ${draft.recipient===r.id?'selected':''}>${r.label}</option>`).join('')}</select></label>${errorMarkup('recipient',draft)}${personMarkup(draft)}<div class="transfer-target" role="status" aria-live="polite" aria-label="Адресат отчёта"><span class="transfer-target-label">Кому придёт отчёт</span><div data-senior-target>${targetMarkup(draft)}</div></div></fieldset>
 <fieldset class="transfer-fieldset"><legend>Повышение</legend><div class="portal-short-fields">${['fromRank','toRank'].map(name=>`<div><label class="portal-field" for="senior-${name}">${labels[name]}<select class="portal-input" id="senior-${name}" name="${name}" required aria-describedby="senior-error-${name}">${rankOptions(draft[name],name==='toRank'?draft.fromRank:'')}</select></label>${errorMarkup(name,draft)}</div>`).join('')}</div><p class="portal-field-hint">Желаемый ранг должен быть выше текущего. Решение о повышении принимает руководство.</p></fieldset>
 <fieldset class="transfer-fieldset"><legend>Доказательства проделанной работы</legend><label class="portal-field" for="senior-evidence">Ссылки на доказательства<textarea class="portal-input" id="senior-evidence" name="evidence" rows="5" maxlength="4000" required aria-describedby="senior-evidence-hint senior-error-evidence">${esc(draft.evidence)}</textarea></label><p class="portal-field-hint" id="senior-evidence-hint">От 1 до 10 HTTPS-ссылок на скриншоты, видео или отчёты. По одной ссылке на строку, до 300 символов каждая. Используйте только игровые материалы.</p>${errorMarkup('evidence',draft)}</fieldset>
 <div class="portal-submit-area"><label class="portal-consent" for="senior-consent"><input id="senior-consent" name="consent" type="checkbox" ${draft.consent?'checked':''} aria-describedby="senior-error-consent"><span>Подтверждаю игровые данные и отправляю отчёт выбранному адресату в Discord.</span></label>${errorMarkup('consent',draft)}<div class="portal-submit-row"><p>Доставка отчёта не означает одобрение повышения.</p><button class="button primary portal-submit" type="submit" ${draft.busy?'disabled':''}>${draft.busy?'Отправляем отчёт…':'Отправить отчёт'}</button></div><p class="portal-message is-error" data-senior-feedback role="alert" ${draft.message?'':'hidden'}>${esc(draft.message)}</p></div></div></form>`;
}

function delivery(application) {
  if (application.delivery_status === 'sent') return {label:'Доставлен в Discord',kind:'sent',text:'Уведомление доставлено. Решение о повышении принимает руководство.',retry:false};
  if (application.delivery_error_code === 'delivery_outcome_unknown') return {label:'Доставка проверяется',kind:'saved',text:'Отчёт сохранён. Руководство проверит канал Discord, прежде чем повторять отправку.',retry:false};
  if (application.delivery_status === 'failed') return {label:'Ошибка доставки',kind:'error',text:'Отчёт сохранён. Обратитесь к руководству для проверки доставки.',retry:false};
  return {label:'Ожидает доставки',kind:'saved',text:'Отчёт сохранён. Доставка в Discord пока не подтверждена.',retry:true};
}
function reference(application) { const date=new Date(application.created_at); const day=Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(date).replaceAll('-','');return `SR-${day}-${String(application.id || '').replaceAll('-','').toUpperCase()}`; }
function resultMarkup(result) {
  const application = result.application || result;
  const info = delivery(application);
  return `<div class="portal-result" data-senior-result><span class="portal-result-mark" aria-hidden="true">${info.kind==='sent'?'✓':'↗'}</span><h2>${info.kind==='sent'?'Отчёт отправлен':'Отчёт сохранён'}</h2><p class="transfer-reference">${esc(reference(application))}</p><p>${esc(info.text)}</p><span class="portal-delivery is-${info.kind}">${info.label}</span>${recipientNote(application)}<div class="portal-actions"><a class="button secondary" href="#/account">Личный кабинет</a><button class="text-link portal-plain-button" data-senior-action="new" type="button">Заполнить новый отчёт</button></div></div>`;
}
function recipientNote(app){return app.snapshot?.recipient?.mention_mode==='text'?`<p class="portal-field-hint">${esc(app.snapshot.recipient.label)} указан текстом: адресат не найден среди привязанных Discord-аккаунтов, уведомление этому человеку не отправлялось.</p>`:'';}
function recoveryMarkup(draft){return `<div class="portal-gate"><h2>Проверим результат отправки</h2><p>Ответ сервера мог потеряться после сохранения отчёта. Сначала проверьте результат, чтобы не создать дубликат.</p><div class="portal-actions"><button class="button primary" data-senior-action="reconcile" type="button" ${draft.busy?'disabled':''}>Проверить результат</button>${draft.checked?'<button class="button secondary" data-senior-action="resend" type="button">Повторить этот отчёт</button>':''}</div><p class="portal-message is-error" role="alert" ${draft.message?'':'hidden'}>${esc(draft.message)}</p></div>`;}
export function renderSeniorReportHistorySection(state=stateNow()){
 if(!member(state))return '';
 return `<section class="portal-history transfer-history" data-senior-history-section><div class="portal-section-head"><div><h2>Мои отчёты старших</h2><p>Последние 20 отчётов и статус доставки в Discord.</p></div><button class="portal-refresh" data-senior-action="refresh" type="button">Обновить</button></div><p class="portal-message is-error" data-senior-history-error role="alert" hidden></p><div data-senior-history aria-live="polite">${historyMarkup(histories.get(key(state)))}</div></section>`;
}
function historyMarkup(history){
 if(!history)return '<p class="portal-history-loading" role="status">Загружаем отчёты…</p>';
 if(history.error)return `<p class="portal-message is-error" role="alert">${esc(history.error)}</p>`;
 if(!history.items.length)return '<div class="portal-empty"><p>Отчётов старших пока нет.</p></div>';
 return `<ul class="portal-application-list">${history.items.map(app=>{const info=delivery(app),snapshot=app.snapshot||{},date=new Date(app.created_at),dateText=Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(date);return `<li class="portal-application"><div class="portal-application-top"><div><span class="portal-application-id transfer-reference">${esc(reference(app))}</span><h3>${esc(snapshot.from_rank)} → ${esc(snapshot.to_rank)}</h3></div><span class="portal-delivery is-${info.kind}">${info.label}</span></div><p>${esc(info.text)}</p><p>Адресат: ${esc(snapshot.recipient?.label)}</p>${recipientNote(app)}<details class="portal-application-details"><summary>Доказательства работы</summary><div class="portal-history-links">${(snapshot.evidence_urls||[]).filter(validUrl).map((url,i)=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Доказательство ${i+1} ↗</a>`).join('')}</div></details><div class="portal-application-bottom"><time datetime="${esc(app.created_at)}">${esc(dateText)}</time>${info.retry?`<button class="button secondary small" type="button" data-senior-action="retry" data-senior-id="${esc(app.id)}">Повторить доставку</button>`:''}</div></li>`;}).join('')}</ul>`;
}

export function renderSeniorReportService(){return `<a class="portal-service transfer-service" href="#/applications/senior-report"><div class="portal-service-copy"><span class="portal-service-icon" aria-hidden="true">${transferIcon}</span><div><h2>Отчёт старших</h2><p>Повышение от подполковника до генерал-полковника. Выберите адресата и приложите доказательства работы.</p></div></div><span class="portal-service-action">Подать отчёт ↗</span></a>`;}

export function mountSeniorReports({onStateChange=()=>{}}={}) {
  const page = document.querySelector('[data-senior-page]');
  const scopes = [...document.querySelectorAll('[data-senior-page], [data-senior-account]')];
  if (!scopes.length) return ()=>{};
  let alive=true, state=stateNow(), signature=JSON.stringify(state);
  const ownerState=state;
  const draft=member(state)?draftFor(state):null;
  const rerender=()=>{if(alive)onStateChange();};
  views.add(rerender);
  const renderHistory=()=>{if(alive)document.querySelectorAll('[data-senior-history]').forEach(node=>{node.innerHTML=historyMarkup(histories.get(key(state)));});};
  async function loadHistory() {
    if (!member(state)) return;
    const owner=key(state);
    try { histories.set(owner,{items:await api.listMySeniorReports()}); } catch(error) { histories.set(owner,{items:[],error:safeMessage(error)}); }
    renderHistory();
  }
  function applyErrors(form, errors, summary=false) {
    for (const name of [...fieldNames,'consent']) {
      const error=form.querySelector(`[data-senior-error="${name}"]`), input=form.elements.namedItem(name);
      if(error){error.textContent=errors[name]||'';error.hidden=!errors[name];}
      if(input) input.setAttribute('aria-invalid',String(Boolean(errors[name])));
    }
    const node=form.querySelector('[data-senior-summary]');
    if(node && (summary || !node.hidden)){node.innerHTML='<strong>Проверьте поля отчёта</strong><ul>'+Object.keys(errors).map(name=>`<li><a href="#senior-${name}" data-senior-focus="${name}">${esc(labels[name])}: ${esc(errors[name])}</a></li>`).join('')+'</ul>';node.hidden=!Object.keys(errors).length;if(summary&&!node.hidden)node.focus();}
  }
  async function sendPending() {
    if(!draft?.checkpoint || draft.busy)return;
    draft.busy=true;draft.message='';notify();
    const original=draft.checkpoint;
    try {
      const result=await api.submitSeniorReport({recipientKind:original.fields.recipient.startsWith('department:')?'department':original.fields.recipient,department:original.fields.recipient.split(':')[1]||null,...(Object.hasOwn(original.fields,'peopleCount')?{recipientUsernames:peopleValues(original.fields)}:{recipientUsername:original.fields.recipientUsername}),fromRank:original.fields.fromRank,toRank:original.fields.toRank,evidenceUrls:evidenceUrls(original.fields.evidence),idempotencyKey:original.idempotencyKey,consent:true});
      draft.success=result;draft.checkpoint=null;draft.checked=false;histories.delete(key(ownerState));save(ownerState,draft);
    } catch(error) {
      if(error.submissionMayExist===false){draft.checkpoint=null;draft.checked=false;}
      draft.message=safeMessage(error);save(ownerState,draft);
    } finally { draft.busy=false;notify(); }
  }
  async function submit(event) {
    if(!event.target.matches('[data-senior-form]'))return;
    event.preventDefault();if(!draft||draft.busy)return;
    draft.consent=Boolean(event.target.elements.namedItem('consent')?.checked);
    draft.errors=validateSeniorReportDraft(draft);draft.attempted=true;
    applyErrors(event.target,draft.errors,true);
    if(Object.keys(draft.errors).length)return;
    const fields=Object.fromEntries(fieldNames.map(name=>[name,draft[name].trim()]));
    draft.checkpoint={idempotencyKey:crypto.randomUUID(),fields};
    // Keep the original UUID and immutable payload through timeouts and page reloads.
    if(!save(ownerState,draft)){draft.checkpoint=null;draft.message='Разрешите хранилище вкладки для безопасной отправки и повторите попытку.';rerender();return;}
    await sendPending();
  }
  function update(event) {
    const input=event.target;
    if(!input.closest('[data-senior-form]')||!draft||draft.busy)return;
    if(input.name==='consent')draft.consent=input.checked;
    else if(fieldNames.includes(input.name))draft[input.name]=input.value;
    else return;
    if(input.name==='recipient'){
      const person=page.querySelector('[data-senior-person]');person.hidden=draft.recipient!=='person';person.querySelectorAll('input').forEach(field=>{field.disabled=draft.recipient!=='person';});
    }
    if(input.name==='recipient'||personFields.includes(input.name)){draft.checkedPeople=null;draft.peopleError='';const peopleError=page.querySelector('[data-senior-people-error]');if(peopleError)peopleError.hidden=true;const checked=page.querySelector('[data-senior-checked]');if(checked)checked.textContent='';page.querySelector('[data-senior-target]').innerHTML=targetMarkup(draft);}
    if(input.name==='fromRank'){
      if(seniorRanks.findIndex(r=>r.id===draft.toRank)<=seniorRanks.findIndex(r=>r.id===draft.fromRank))draft.toRank='';
      page.querySelector('[name="toRank"]').innerHTML=rankOptions(draft.toRank,draft.fromRank);
    }

    save(ownerState,draft);
    if(draft.attempted){draft.errors=validateSeniorReportDraft(draft);applyErrors(input.form,draft.errors);}
  }
  function blur(event){
    if(!draft || !fieldNames.includes(event.target.name))return;
    const name=event.target.name, error=validateSeniorReportDraft(draft)[name];
    if(error)draft.errors[name]=error;else delete draft.errors[name];
    const node=event.target.form?.querySelector(`[data-senior-error="${name}"]`);
    if(node){node.textContent=error||'';node.hidden=!error;}
    event.target.setAttribute('aria-invalid',String(Boolean(error)));
  }
  async function click(event) {
    const focus=event.target.closest('[data-senior-focus]');if(focus){event.preventDefault();page?.querySelector(`[name="${focus.dataset.seniorFocus}"]`)?.focus();return;}
    const button=event.target.closest('[data-senior-action]');if(!button)return;
    const action=button.dataset.seniorAction;
    if(action==='reload')return location.reload();
    if(button.disabled)return;
    if(action==='new'&&draft){drafts.delete(key(state));try{sessionStorage.removeItem(`portal-senior-report:${key(state)}`);}catch{}return rerender();}
    if(action==='resend')return await sendPending();
    if(action==='add-person'&&draft){draft.peopleCount=String(Math.min(5,peopleCount(draft)+1));draft.checkedPeople=null;save(ownerState,draft);notify();return;}
    if(action==='remove-person'&&draft){const index=Number(button.dataset.personIndex),values=peopleValues(draft);if(!Number.isInteger(index)||index<0||index>=values.length)return;values.splice(index,1);personFields.forEach((name,i)=>draft[name]=values[i]||'');draft.peopleCount=String(Math.max(1,values.length));draft.checkedPeople=null;save(ownerState,draft);notify();return;}
    if(action==='check-people'&&draft){
      const names=peopleValues(draft),signature=JSON.stringify(names);if(draft.checkingPeople)return;
      draft.checkingPeople=true;draft.message='';draft.peopleError='';notify();
      try{const result=await api.checkSeniorReportPeople(names);if(JSON.stringify(peopleValues(draft))===signature)draft.checkedPeople=result.members;}
      catch(error){if(JSON.stringify(peopleValues(draft))===signature)draft.peopleError=safeMessage(error);}
      finally{draft.checkingPeople=false;notify();}return;
    }
    button.disabled=true;
    try {
      if(action==='link-discord')await api.linkDiscord('#/applications/senior-report');
      if(action==='refresh')await loadHistory();
      if(action==='retry'){await api.retrySeniorReport(button.dataset.seniorId);await loadHistory();}
      if(action==='reconcile'&&draft?.checkpoint){const app=await api.findMySeniorReportByKey(draft.checkpoint.idempotencyKey);if(app){draft.success={application:app};draft.checkpoint=null;histories.delete(key(state));}else{draft.checked=true;draft.message='Отчёт пока не найден. Можно повторить отправку с прежними данными.';}save(ownerState,draft);rerender();}
    }catch(error){
      if(!page || !draft){const feedback=document.querySelector('[data-senior-history-error]');if(feedback){feedback.textContent=safeMessage(error);feedback.hidden=false;}}
      if(draft && page){draft.message=safeMessage(error);rerender();}
      else {const feedback=page?.querySelector('[data-senior-gate-error]');if(feedback){feedback.textContent=safeMessage(error);feedback.hidden=false;}}
    }finally{if(alive&&button.isConnected)button.disabled=false;}
  }
  for(const scope of scopes){scope.addEventListener('click',click);scope.addEventListener('submit',submit);scope.addEventListener('input',update);scope.addEventListener('change',update);scope.addEventListener('focusout',blur);}
  const unsubscribe=api.subscribeAccount(next=>{const current=JSON.stringify(next);if(current!==signature){signature=current;state=next;rerender();}});
  if(member(state))void loadHistory();
  return()=>{alive=false;views.delete(rerender);unsubscribe();for(const scope of scopes){scope.removeEventListener('click',click);scope.removeEventListener('submit',submit);scope.removeEventListener('input',update);scope.removeEventListener('change',update);scope.removeEventListener('focusout',blur);}};
}
