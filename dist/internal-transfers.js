import * as api from './auth-client.js?v=senior-reports-1';
import { internalDepartments } from './data/internal-departments.js?v=senior-reports-1';

const drafts = new Map();
const histories = new Map();
const views = new Set();
const fieldNames = ['sourceDepartment','targetDepartment','reason'];
const labels = {sourceDepartment:'Текущий отдел',targetDepartment:'Желаемый отдел',reason:'Причина перевода',consent:'Подтверждение отправки'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const member = state => Boolean(state.profile && ['linked','registered'].includes(state.status));
const linked = state => member(state) && state.status === 'linked' && state.discord?.id;
const key = state => String(state.profile?.user_id || 'anonymous');
const notify = () => [...views].forEach(view => view());
const transferIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></svg>';
const stateNow = () => api.getAccountState();
const department = id => internalDepartments.find(item => item.id === id);
const options = (value, source = '') => '<option value="">Выберите отдел</option>' + internalDepartments.map(item => `<option value="${item.id}" ${value===item.id?'selected':''} ${source===item.id?'disabled':''}>${item.label}</option>`).join('');

function draftFor(state) {
  const owner = key(state);
  if (!drafts.has(owner)) {
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(`portal-internal-transfer:${owner}`) || '{}') || {}; } catch { /* Draft storage is optional. */ }
    const fields = Object.fromEntries(fieldNames.map(name => [name, typeof stored[name] === 'string' ? stored[name].slice(0, name === 'reason' ? 1000 : 500) : '']));
    const checkpoint = validCheckpoint(stored.checkpoint) ? stored.checkpoint : null;
    drafts.set(owner, { ...fields, checkpoint, errors:{}, busy:false, attempted:false, success:null, message:'', checked:false, consent:false });
  }
  return drafts.get(owner);
}
function validCheckpoint(value) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.idempotencyKey || '') && value.fields && fieldNames.every(name => typeof value.fields[name] === 'string' && value.fields[name].length <= 1000);
}
function save(state, draft) {
  const stored = Object.fromEntries(fieldNames.map(name => [name, draft[name]]));
  stored.checkpoint = draft.checkpoint;
  try { sessionStorage.setItem(`portal-internal-transfer:${key(state)}`, JSON.stringify(stored)); return true; } catch { return false; }
}
function safeMessage(error) {
  const text = String(error?.message || '');
  return /[А-Яа-яЁё]/.test(text) && !/token|secret|supabase|sql|apikey/i.test(text) ? text.slice(0,300) : 'Не удалось связаться с сервисом. Проверьте соединение и попробуйте снова.';
}
export function validateInternalTransferDraft(draft, consent = draft.consent) {
  const errors = {};
  if (!department(draft.sourceDepartment)) errors.sourceDepartment = 'Выберите отдел, в котором служите сейчас.';
  if (!department(draft.targetDepartment) || draft.targetDepartment === draft.sourceDepartment) errors.targetDepartment = 'Выберите другой отдел для перевода.';
  if (!draft.reason.trim() || [...draft.reason.trim()].length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(draft.reason)) errors.reason = 'Укажите причину перевода, до 1000 символов.';
  if (!consent) errors.consent = 'Подтвердите отправку игровых данных руководству.';
  return errors;
}
function errorMarkup(name, draft) {
  return `<p class="portal-field-error" id="internal-error-${name}" data-internal-error="${name}" ${draft.errors[name] ? '' : 'hidden'}>${esc(draft.errors[name])}</p>`;
}
function targetMarkup(draft) {
  const target = department(draft.targetDepartment);
  return target ? `<strong>Руководство ${esc(target.label)}</strong><span>Получит уведомление вместе с вашим тегом Discord.</span>` : '<strong>Выберите желаемый отдел</strong><span>Уведомление получит руководство выбранного отдела.</span>';
}
function gate(state) {
  if (state.status === 'loading') return '<div class="portal-gate portal-history-loading" role="status"><h2>Проверяем аккаунт</h2><span></span><p>Загружаем профиль и привязку Discord.</p></div>';
  if (state.status === 'error') return '<div class="portal-gate"><h2>Не удалось проверить аккаунт</h2><p>Обновите страницу, чтобы повторить проверку входа.</p><button class="button secondary" type="button" data-internal-action="reload">Обновить страницу</button></div>';
  if (!member(state)) return '<div class="portal-gate"><h2>Войдите, чтобы подать заявку</h2><p>Используйте аккаунт портала и привяжите Discord. Игровой ник, Static ID и Discord для связи заполнятся из профиля.</p><div class="portal-actions"><a class="button primary" href="#/account?tab=login">Войти</a><a class="button secondary" href="#/account?tab=register">Создать аккаунт</a></div></div>';
  if (!linked(state)) return '<div class="portal-gate"><h2>Привяжите Discord</h2><p>Для отправки заявки нужен подтверждённый Discord. Руководство сможет связаться с вами по привязанному аккаунту.</p><div class="portal-actions"><button class="button primary" type="button" data-internal-action="link-discord">Привязать Discord</button><a class="text-link" href="#/account">Личный кабинет</a></div><p class="portal-message is-error" data-internal-gate-error role="alert" hidden></p></div>';
  return '';
}
export function renderInternalTransferPage() {
  const state = stateNow();
  const intro = `<div class="container page-heading portal-heading portal-heading-child"><nav class="breadcrumb" aria-label="Навигационная цепочка"><a href="#/">Главная</a><span>/</span><a href="#/applications">Заявки</a><span>/</span><span>Между отделами</span></nav><h1 class="page-title">Переводы между отделами</h1><p class="page-description">Внутренний перевод в ФСБ. Выберите текущий и желаемый отдел — заявку получит руководство принимающего отдела.</p></div>`;
  if (!linked(state)) return intro + `<section class="container portal-page portal-form-page" data-internal-page>${gate(state)}</section>`;
  const draft = draftFor(state);
  const content = draft.success ? resultMarkup(draft.success) : draft.checkpoint ? recoveryMarkup(draft) : formMarkup(state,draft);
  return intro + `<section class="container portal-page portal-form-page" data-internal-page>${content}${renderInternalTransferHistorySection(state)}</section>`;
}
function formMarkup(state,draft) {
  return `<form class="portal-restoration transfer-form" data-internal-form novalidate aria-busy="${draft.busy}"><div class="portal-applicant"><div class="portal-applicant-main"><div><strong>${esc(state.profile.game_name)}</strong><span>Static ID ${esc(state.profile.static_id)}</span></div></div><div class="portal-applicant-discord"><div><strong>${esc(state.discord.username)}</strong><span>Discord привязан · тег добавится автоматически</span></div></div></div><div class="portal-form-body"><div class="portal-form-title"><h2>Заявка на внутренний перевод</h2><span>Все поля обязательны</span></div><p class="portal-field-hint">Ник и Static ID берутся из вашего профиля и не требуют повторного ввода.</p><div class="portal-message is-error transfer-error-summary" data-internal-summary tabindex="-1" role="alert" hidden></div>
    <fieldset class="transfer-fieldset"><legend>Направление перевода</legend><div class="portal-short-fields">${['sourceDepartment','targetDepartment'].map(name => `<div><label class="portal-field" for="internal-${name}">${labels[name]}<select class="portal-input" id="internal-${name}" name="${name}" required aria-describedby="internal-error-${name}">${options(draft[name],name==='targetDepartment'?draft.sourceDepartment:'')}</select></label>${errorMarkup(name,draft)}</div>`).join('')}</div><div class="transfer-target" role="status" aria-live="polite" aria-label="Получатель уведомления"><span class="transfer-target-label">Кому придёт заявка</span><div data-internal-target>${targetMarkup(draft)}</div></div></fieldset>
    <fieldset class="transfer-fieldset"><legend>Причина перевода</legend><label class="portal-field" for="internal-reason">Почему хотите перевестись<textarea class="portal-input" id="internal-reason" name="reason" rows="4" maxlength="1000" required aria-describedby="internal-reason-count internal-error-reason">${esc(draft.reason)}</textarea></label><p class="portal-field-hint transfer-counter" id="internal-reason-count"><span data-internal-count>${[...draft.reason].length}</span> / 1000</p>${errorMarkup('reason',draft)}</fieldset>
    <div class="portal-submit-area"><label class="portal-consent" for="internal-consent"><input id="internal-consent" name="consent" type="checkbox" ${draft.consent?'checked':''} aria-describedby="internal-error-consent"><span>Подтверждаю игровые данные и отправляю заявку руководству выбранного отдела в Discord.</span></label>${errorMarkup('consent',draft)}<div class="portal-submit-row"><p>Решение о переводе принимает руководство. Отправка заявки не меняет ваш отдел автоматически.</p><button class="button primary portal-submit" type="submit" ${draft.busy?'disabled':''}>${draft.busy?'Отправляем заявку…':'Отправить заявку на перевод'}</button></div><p class="portal-message is-error" data-internal-feedback role="alert" ${draft.message?'':'hidden'}>${esc(draft.message)}</p></div></div></form>`;
}
function delivery(application) {
  if (application.delivery_status === 'sent') return {label:'Доставлена в Discord',kind:'sent',text:'Уведомление доставлено. Решение о переводе принимает руководство.',retry:false};
  if (application.delivery_error_code === 'delivery_outcome_unknown') return {label:'Доставка проверяется',kind:'saved',text:'Заявка сохранена. Руководство проверит канал Discord, прежде чем повторять отправку.',retry:false};
  if (application.delivery_status === 'failed') return {label:'Ошибка доставки',kind:'error',text:'Заявка сохранена. Обратитесь к руководству для проверки доставки.',retry:false};
  return {label:'Ожидает доставки',kind:'saved',text:'Заявка сохранена. Доставка в Discord пока не подтверждена.',retry:true};
}
function reference(application) { const date=new Date(application.created_at); const day=Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(date).replaceAll('-','');return `IT-${day}-${String(application.id || '').replaceAll('-','').toUpperCase()}`; }
function resultMarkup(result) {
  const application = result.application || result;
  const info = delivery(application);
  return `<div class="portal-result" data-internal-result><span class="portal-result-mark" aria-hidden="true">${info.kind==='sent'?'✓':'↗'}</span><h2>${info.kind==='sent'?'Заявка отправлена':'Заявка сохранена'}</h2><p class="transfer-reference">${esc(reference(application))}</p><p>${esc(info.text)}</p><span class="portal-delivery is-${info.kind}">${info.label}</span><div class="portal-actions"><a class="button secondary" href="#/account">Личный кабинет</a><button class="text-link portal-plain-button" data-internal-action="new" type="button">Заполнить новую заявку</button></div></div>`;
}
function recoveryMarkup(draft) {
  const fields = draft.checkpoint.fields;
  const source = department(fields.sourceDepartment), target = department(fields.targetDepartment);
  return `<div class="portal-gate"><h2>Проверим результат отправки</h2><p>Соединение могло прерваться после сохранения заявки. Проверьте результат перед повторной отправкой.</p><dl class="transfer-pending"><div><dt>Перевод</dt><dd>${esc(source && target ? `${source.label} → ${target.label}` : 'По сохранённым данным')}</dd></div><div><dt>Причина</dt><dd>${esc(fields.reason)}</dd></div></dl><div class="portal-actions"><button class="button primary" data-internal-action="reconcile" type="button" ${draft.busy?'disabled':''}>${draft.busy?'Проверяем…':'Проверить результат'}</button>${draft.checked?'<button class="button secondary" data-internal-action="resend" type="button">Повторить эту заявку</button>':''}</div><p class="portal-message is-error" role="alert" ${draft.message?'':'hidden'}>${esc(draft.message)}</p><p class="portal-field-hint">При повторе сохранятся прежние данные и номер запроса.</p></div>`;
}
export function renderInternalTransferHistorySection(state=stateNow()) {
  if (!member(state)) return '';
  return `<section class="portal-history transfer-history" data-internal-history-section><div class="portal-section-head"><div><h2>Мои переводы между отделами</h2><p>Последние 20 внутренних заявок и статус доставки в Discord.</p></div><button class="portal-refresh" data-internal-action="refresh" type="button">Обновить</button></div><p class="portal-message is-error" data-internal-history-error role="alert" hidden></p><div data-internal-history aria-live="polite">${historyMarkup(histories.get(key(state)))}</div></section>`;
}
function historyMarkup(history) {
  if (!history) return '<p class="portal-history-loading" role="status">Загружаем заявки…</p>';
  if (history.error) return `<p class="portal-message is-error" role="alert">${esc(history.error)}</p>`;
  if (!history.items.length) return '<div class="portal-empty"><p>Заявок на перевод между отделами пока нет.</p></div>';
  return `<ul class="portal-application-list">${history.items.map(app => {
    const info=delivery(app), snapshot=app.snapshot || {}, date=new Date(app.created_at);
    const dateText=Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(date);
    return `<li class="portal-application"><div class="portal-application-top"><div><span class="portal-application-id transfer-reference">${esc(reference(app))}</span><h3>${esc(snapshot.source_department)} → ${esc(snapshot.target_department)}</h3></div><span class="portal-delivery is-${info.kind}">${info.label}</span></div><p>${esc(info.text)}</p><details class="portal-application-details"><summary>Детали заявки</summary><dl><div><dt>Игровой ник и Static ID</dt><dd>${esc(snapshot.game_name)} · ${esc(snapshot.static_id)}</dd></div><div><dt>Причина перевода</dt><dd class="portal-history-reason">${esc(snapshot.reason)}</dd></div></dl></details><div class="portal-application-bottom"><time datetime="${esc(app.created_at)}">${esc(dateText)}</time>${info.retry?`<button class="button secondary small" type="button" data-internal-action="retry" data-internal-id="${esc(app.id)}">Повторить доставку</button>`:''}</div></li>`;
  }).join('')}</ul>`;
}
export function renderInternalTransferService() {
  return `<a class="portal-service transfer-service" href="#/applications/internal-transfer"><div class="portal-service-copy"><span class="portal-service-icon" aria-hidden="true">${transferIcon}</span><div><h2>Переводы между отделами</h2><p>Изменить направление службы внутри ФСБ: М, КТЦ, УКП, А, В или УОД.</p></div></div><span class="portal-service-action">Подать заявку ↗</span></a>`;
}
export function mountInternalTransfers({onStateChange=()=>{}}={}) {
  const page = document.querySelector('[data-internal-page]');
  const scopes = [...document.querySelectorAll('[data-internal-page], [data-internal-account]')];
  if (!scopes.length) return ()=>{};
  let alive=true, state=stateNow(), signature=JSON.stringify(state);
  const ownerState=state;
  const draft=member(state)?draftFor(state):null;
  const rerender=()=>{if(alive)onStateChange();};
  views.add(rerender);
  const renderHistory=()=>{if(alive)document.querySelectorAll('[data-internal-history]').forEach(node=>{node.innerHTML=historyMarkup(histories.get(key(state)));});};
  async function loadHistory() {
    if (!member(state)) return;
    const owner=key(state);
    try { histories.set(owner,{items:await api.listMyInternalTransfers()}); } catch(error) { histories.set(owner,{items:[],error:safeMessage(error)}); }
    renderHistory();
  }
  function applyErrors(form, errors, summary=false) {
    for (const name of [...fieldNames,'consent']) {
      const error=form.querySelector(`[data-internal-error="${name}"]`), input=form.elements.namedItem(name);
      if(error){error.textContent=errors[name]||'';error.hidden=!errors[name];}
      if(input) input.setAttribute('aria-invalid',String(Boolean(errors[name])));
    }
    const node=form.querySelector('[data-internal-summary]');
    if(node && (summary || !node.hidden)){node.innerHTML='<strong>Проверьте поля заявки</strong><ul>'+Object.keys(errors).map(name=>`<li><a href="#internal-${name}" data-internal-focus="${name}">${esc(labels[name])}: ${esc(errors[name])}</a></li>`).join('')+'</ul>';node.hidden=!Object.keys(errors).length;if(summary&&!node.hidden)node.focus();}
  }
  async function sendPending() {
    if(!draft?.checkpoint || draft.busy)return;
    draft.busy=true;draft.message='';notify();
    const original=draft.checkpoint;
    try {
      const result=await api.submitInternalTransfer({...original.fields,idempotencyKey:original.idempotencyKey,consent:true});
      draft.success=result;draft.checkpoint=null;draft.checked=false;histories.delete(key(ownerState));save(ownerState,draft);
    } catch(error) {
      if(error.submissionMayExist===false){draft.checkpoint=null;draft.checked=false;}
      draft.message=safeMessage(error);save(ownerState,draft);
    } finally { draft.busy=false;notify(); }
  }
  async function submit(event) {
    if(!event.target.matches('[data-internal-form]'))return;
    event.preventDefault();if(!draft||draft.busy)return;
    draft.consent=Boolean(event.target.elements.namedItem('consent')?.checked);
    draft.errors=validateInternalTransferDraft(draft);draft.attempted=true;
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
    if(!input.closest('[data-internal-form]')||!draft||draft.busy)return;
    if(input.name==='consent')draft.consent=input.checked;
    else if(fieldNames.includes(input.name))draft[input.name]=input.value;
    else return;
    if(input.name==='sourceDepartment') {
      if(draft.targetDepartment===draft.sourceDepartment)draft.targetDepartment='';
      page.querySelector('[name="targetDepartment"]').innerHTML=options(draft.targetDepartment,draft.sourceDepartment);
    }
    if(['sourceDepartment','targetDepartment'].includes(input.name))page.querySelector('[data-internal-target]').innerHTML=targetMarkup(draft);
    const count=page.querySelector('[data-internal-count]');if(count)count.textContent=[...draft.reason].length;
    save(ownerState,draft);
    if(draft.attempted){draft.errors=validateInternalTransferDraft(draft);applyErrors(input.form,draft.errors);}
  }
  function blur(event){
    if(!draft || !fieldNames.includes(event.target.name))return;
    const name=event.target.name, error=validateInternalTransferDraft(draft)[name];
    if(error)draft.errors[name]=error;else delete draft.errors[name];
    const node=event.target.form?.querySelector(`[data-internal-error="${name}"]`);
    if(node){node.textContent=error||'';node.hidden=!error;}
    event.target.setAttribute('aria-invalid',String(Boolean(error)));
  }
  async function click(event) {
    const focus=event.target.closest('[data-internal-focus]');if(focus){event.preventDefault();page?.querySelector(`[name="${focus.dataset.internalFocus}"]`)?.focus();return;}
    const button=event.target.closest('[data-internal-action]');if(!button)return;
    const action=button.dataset.internalAction;
    if(action==='reload')return location.reload();
    if(button.disabled)return;
    if(action==='new'&&draft){drafts.delete(key(state));try{sessionStorage.removeItem(`portal-internal-transfer:${key(state)}`);}catch{}return rerender();}
    if(action==='resend')return await sendPending();
    button.disabled=true;
    try {
      if(action==='link-discord')await api.linkDiscord('#/applications/internal-transfer');
      if(action==='refresh')await loadHistory();
      if(action==='retry'){await api.retryInternalTransfer(button.dataset.internalId);await loadHistory();}
      if(action==='reconcile'&&draft?.checkpoint){const app=await api.findMyInternalTransferByKey(draft.checkpoint.idempotencyKey);if(app){draft.success={application:app};draft.checkpoint=null;histories.delete(key(state));}else{draft.checked=true;draft.message='Заявка пока не найдена. Можно повторить отправку с прежними данными.';}save(ownerState,draft);rerender();}
    }catch(error){
      if(!page || !draft){const feedback=document.querySelector('[data-internal-history-error]');if(feedback){feedback.textContent=safeMessage(error);feedback.hidden=false;}}
      if(draft && page){draft.message=safeMessage(error);rerender();}
      else {const feedback=page?.querySelector('[data-internal-gate-error]');if(feedback){feedback.textContent=safeMessage(error);feedback.hidden=false;}}
    }finally{if(alive&&button.isConnected)button.disabled=false;}
  }
  for(const scope of scopes){scope.addEventListener('click',click);scope.addEventListener('submit',submit);scope.addEventListener('input',update);scope.addEventListener('change',update);scope.addEventListener('focusout',blur);}
  const unsubscribe=api.subscribeAccount(next=>{const current=JSON.stringify(next);if(current!==signature){signature=current;state=next;rerender();}});
  if(member(state))void loadHistory();
  return()=>{alive=false;views.delete(rerender);unsubscribe();for(const scope of scopes){scope.removeEventListener('click',click);scope.removeEventListener('submit',submit);scope.removeEventListener('input',update);scope.removeEventListener('change',update);scope.removeEventListener('focusout',blur);}};
}
