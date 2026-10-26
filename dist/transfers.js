import * as api from './auth-client.js?v=internal-transfer-1';
import { transferRules, lookupTransferRule } from './data/transfer-rules.js?v=internal-transfer-1';

const drafts = new Map();
const histories = new Map();
const views = new Set();
const fieldNames = ['sourceStructure','sourceRank','sourcePosition','passportNumber','passportUrl','credentialUrl','profileUrl','approvalUrl','reason'];
const labels = { sourceStructure:'Структура', sourceRank:'Текущий ранг', sourcePosition:'Должность', passportNumber:'Номер игрового паспорта', passportUrl:'Паспорт', credentialUrl:'Удостоверение', profileUrl:'Планшет / профиль', approvalUrl:'Одобрение руководителя', reason:'Причина перевода', consent:'Подтверждение отправки' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const member = state => Boolean(state.profile && ['linked','registered'].includes(state.status));
const linked = state => member(state) && state.status === 'linked' && state.discord?.id;
const key = state => String(state.profile?.user_id || 'anonymous');
const notify = () => [...views].forEach(view => view());
const transferIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></svg>';
const stateNow = () => api.getAccountState();
const selectedRule = draft => lookupTransferRule(draft.sourceStructure, Number(draft.sourceRank));

function draftFor(state) {
  const owner = key(state);
  if (!drafts.has(owner)) {
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(`portal-transfer:${owner}`) || '{}') || {}; } catch { /* Draft storage is optional. */ }
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
  try { sessionStorage.setItem(`portal-transfer:${key(state)}`, JSON.stringify(stored)); return true; } catch { return false; }
}
function safeMessage(error) {
  const text = String(error?.message || '');
  return /[А-Яа-яЁё]/.test(text) && !/token|secret|supabase|sql|apikey/i.test(text) ? text.slice(0,300) : 'Не удалось связаться с сервисом. Проверьте соединение и попробуйте снова.';
}
function validUrl(value, max) {
  if (!value || value.length > max || /[\s<>`\\]/u.test(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password && (!url.port || url.port === '443') && url.href.length <= max; } catch { return false; }
}
export function validateTransferDraft(draft, consent = draft.consent) {
  const errors = {};
  if (!transferRules.structures.some(item => item.id === draft.sourceStructure)) errors.sourceStructure = 'Выберите структуру, из которой переводитесь.';
  if (!selectedRule(draft)) errors.sourceRank = 'Выберите текущий ранг из таблицы выбранной структуры.';
  if (!draft.sourcePosition.trim() || [...draft.sourcePosition.trim()].length > 120 || /[\x00-\x1f\x7f]/u.test(draft.sourcePosition)) errors.sourcePosition = 'Укажите текущую должность, до 120 символов.';
  if (!/^[0-9]{1,20}$/.test(draft.passportNumber.trim())) errors.passportNumber = 'Укажите номер игрового паспорта цифрами.';
  for (const name of ['passportUrl','credentialUrl','profileUrl','approvalUrl']) {
    const max = name === 'approvalUrl' ? 500 : 300;
    if (!validUrl(draft[name].trim(), max)) errors[name] = `Добавьте полную HTTPS ссылку без логина и пароля, до ${max} символов.`;
  }
  if (!draft.reason.trim() || [...draft.reason.trim()].length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(draft.reason)) errors.reason = 'Укажите причину перевода, до 1000 символов.';
  if (!consent) errors.consent = 'Подтвердите отправку игровых данных руководству.';
  return errors;
}
function errorMarkup(name, draft) {
  return `<p class="portal-field-error" id="transfer-error-${name}" data-transfer-error="${name}" ${draft.errors[name] ? '' : 'hidden'}>${esc(draft.errors[name])}</p>`;
}
function field(name, draft, { type='text', hint='', max=120, title=labels[name] } = {}) {
  return `<div><label class="portal-field" for="transfer-${name}">${esc(title)}<input class="portal-input" id="transfer-${name}" name="${name}" type="${type}" maxlength="${max}" ${name === 'passportNumber' ? 'inputmode="numeric" pattern="[0-9]+"' : type === 'url' ? 'inputmode="url" spellcheck="false"' : ''} autocomplete="off" required value="${esc(draft[name])}" aria-describedby="transfer-hint-${name} transfer-error-${name}" ${draft.errors[name] ? 'aria-invalid="true"' : ''}></label><p class="portal-field-hint" id="transfer-hint-${name}">${esc(hint)}</p>${errorMarkup(name,draft)}</div>`;
}
function rankOptions(draft) {
  const structure = transferRules.structures.find(item => item.id === draft.sourceStructure);
  return '<option value="">Выберите текущий ранг</option>' + (structure?.ranks || []).map(row => `<option value="${row.rank}" ${String(row.rank) === draft.sourceRank ? 'selected' : ''}>${row.rank} — ${esc(row.title)}</option>`).join('');
}
function targetMarkup(draft) {
  const rule = selectedRule(draft);
  return rule ? `<span class="transfer-target-rank">${rule.targetRank} ранг</span><strong>${esc(rule.targetTitle)}</strong><span>${esc(rule.title)} → ${esc(rule.targetTitle)} ФСБ</span>` : '<strong>Выберите структуру и ранг</strong><span>Звание ФСБ появится по таблице переводов.</span>';
}
function gate(state) {
  if (state.status === 'loading') return '<div class="portal-gate portal-history-loading" role="status"><h2>Проверяем аккаунт</h2><span></span><p>Загружаем профиль и привязку Discord.</p></div>';
  if (state.status === 'error') return '<div class="portal-gate"><h2>Не удалось проверить аккаунт</h2><p>Обновите страницу, чтобы повторить проверку входа.</p><button class="button secondary" type="button" data-transfer-action="reload">Обновить страницу</button></div>';
  if (!member(state)) return '<div class="portal-gate"><h2>Войдите, чтобы подать заявку</h2><p>Используйте аккаунт портала и привяжите Discord. Игровой ник и Discord для связи заполнятся из профиля.</p><div class="portal-actions"><a class="button primary" href="#/account?tab=login">Войти</a><a class="button secondary" href="#/account?tab=register">Создать аккаунт</a></div></div>';
  if (!linked(state)) return '<div class="portal-gate"><h2>Привяжите Discord</h2><p>Для отправки заявки нужен подтверждённый Discord. Руководство сможет связаться с вами по привязанному аккаунту.</p><div class="portal-actions"><button class="button primary" type="button" data-transfer-action="link-discord">Привязать Discord</button><a class="text-link" href="#/account">Личный кабинет</a></div><p class="portal-message is-error" data-transfer-gate-error role="alert" hidden></p></div>';
  return '';
}
export function renderTransferPage() {
  const state = stateNow();
  const intro = `<div class="container page-heading portal-heading portal-heading-child"><nav class="breadcrumb" aria-label="Навигационная цепочка"><a href="#/">Главная</a><span>/</span><a href="#/applications">Заявки</a><span>/</span><span>Переводы</span></nav><h1 class="page-title">Переводы в ФСБ</h1><p class="page-description">Переход из другой государственной структуры. Звание ФСБ определяется по таблице переводов.</p></div>`;
  if (!linked(state)) return intro + `<section class="container portal-page portal-form-page" data-transfer-page>${gate(state)}<div class="transfer-requirements"><h2>Подготовьте игровые документы</h2><p>Нужны ссылки на паспорт, удостоверение, планшет или профиль и одобрение лидера либо его заместителя.</p><a class="text-link" href="${transferRules.sourceUrl}" target="_blank" rel="noopener noreferrer">Открыть таблицу переводов ↗</a></div></section>`;
  const draft = draftFor(state);
  const content = draft.success ? resultMarkup(draft.success) : draft.checkpoint ? recoveryMarkup(draft) : formMarkup(state,draft);
  return intro + `<section class="container portal-page portal-form-page" data-transfer-page>${content}${renderTransferHistorySection(state)}</section>`;
}
function formMarkup(state,draft) {
  return `<form class="portal-restoration transfer-form" data-transfer-form novalidate aria-busy="${draft.busy}"><div class="portal-applicant"><div class="portal-applicant-main"><div><strong>${esc(state.profile.game_name)}</strong><span>Static ID ${esc(state.profile.static_id)}</span></div></div><div class="portal-applicant-discord"><div><strong>${esc(state.discord.username)}</strong><span>Discord привязан</span></div></div></div><div class="portal-form-body"><div class="portal-form-title"><h2>Заявка на перевод</h2><span>Все поля обязательны</span></div><div class="portal-message is-error transfer-error-summary" data-transfer-summary tabindex="-1" role="alert" hidden></div>
    <fieldset class="transfer-fieldset"><legend>Текущая служба</legend><div class="portal-short-fields"><div><label class="portal-field" for="transfer-sourceStructure">Из структуры<select class="portal-input" id="transfer-sourceStructure" name="sourceStructure" required aria-describedby="transfer-error-sourceStructure"><option value="">Выберите структуру</option>${transferRules.structures.map(item=>`<option value="${item.id}" ${draft.sourceStructure===item.id?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label>${errorMarkup('sourceStructure',draft)}</div><div><label class="portal-field" for="transfer-sourceRank">Порядковый ранг<select class="portal-input" id="transfer-sourceRank" name="sourceRank" required ${draft.sourceStructure?'':'disabled'} aria-describedby="transfer-error-sourceRank">${rankOptions(draft)}</select></label>${errorMarkup('sourceRank',draft)}</div></div>${field('sourcePosition',draft,{hint:'Должность в вашей текущей структуре.'})}<div class="transfer-target" role="status" aria-live="polite" aria-label="Звание ФСБ по таблице"><span class="transfer-target-label">Перевести в ФСБ</span><div data-transfer-target>${targetMarkup(draft)}</div><a href="${transferRules.sourceUrl}" target="_blank" rel="noopener noreferrer">По таблице переводов ↗</a></div></fieldset>
    <fieldset class="transfer-fieldset"><legend>Подтверждающие материалы</legend><p class="portal-field-hint">Укажите данные игрового персонажа и доступные руководству ссылки на скриншоты. Реальные документы не нужны.</p>${field('passportNumber',draft,{max:20,hint:'Номер паспорта персонажа в игре. Это отдельное поле от Static ID.'})}<div class="portal-short-fields">${field('passportUrl',draft,{type:'url',max:300,hint:'Скриншот игрового паспорта.',title:'Ссылка на паспорт'})}${field('credentialUrl',draft,{type:'url',max:300,hint:'Скриншот служебного удостоверения.',title:'Ссылка на удостоверение'})}</div>${field('profileUrl',draft,{type:'url',max:300,hint:'Ссылка на планшет или профиль персонажа.',title:'Ссылка на планшет / профиль'})}${field('approvalUrl',draft,{type:'url',max:500,hint:'Ссылка на одобрение лидера или заместителя лидера вашей структуры.',title:'Одобрение лидера / заместителя'})}</fieldset>
    <fieldset class="transfer-fieldset"><legend>Причина перевода</legend><label class="portal-field" for="transfer-reason">Почему хотите перевестись в ФСБ<textarea class="portal-input" id="transfer-reason" name="reason" rows="4" maxlength="1000" required aria-describedby="transfer-reason-count transfer-error-reason">${esc(draft.reason)}</textarea></label><p class="portal-field-hint transfer-counter" id="transfer-reason-count"><span data-transfer-count>${[...draft.reason].length}</span> / 1000</p>${errorMarkup('reason',draft)}</fieldset>
    <div class="portal-submit-area"><label class="portal-consent" for="transfer-consent"><input id="transfer-consent" name="consent" type="checkbox" ${draft.consent?'checked':''} aria-describedby="transfer-error-consent"><span>Подтверждаю игровые данные и отправляю их руководству ФСБ в Discord.</span></label>${errorMarkup('consent',draft)}<div class="portal-submit-row"><p>Директор и заместитель получат уведомление. Решение о переводе принимает руководство.</p><button class="button primary portal-submit" type="submit" ${draft.busy?'disabled':''}>${draft.busy?'Отправляем заявку…':'Отправить заявку на перевод'}</button></div><p class="portal-message is-error" data-transfer-feedback role="alert" ${draft.message?'':'hidden'}>${esc(draft.message)}</p></div></div></form>`;
}
function delivery(application) {
  if (application.delivery_status === 'sent') return {label:'Доставлена в Discord',kind:'sent',text:'Уведомление доставлено. Решение о переводе принимает руководство.',retry:false};
  if (application.delivery_error_code === 'delivery_outcome_unknown') return {label:'Доставка проверяется',kind:'saved',text:'Заявка сохранена. Руководство проверит канал Discord, прежде чем повторять отправку.',retry:false};
  if (application.delivery_status === 'failed') return {label:'Ошибка доставки',kind:'error',text:'Заявка сохранена. Обратитесь к руководству для проверки доставки.',retry:false};
  return {label:'Ожидает доставки',kind:'saved',text:'Заявка сохранена. Доставка в Discord пока не подтверждена.',retry:true};
}
function reference(application) { const date=new Date(application.created_at); const day=Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(date).replaceAll('-','');return `TR-${day}-${String(application.id || '').replaceAll('-','').toUpperCase()}`; }
function resultMarkup(result) {
  const application = result.application || result;
  const info = delivery(application);
  return `<div class="portal-result" data-transfer-result><span class="portal-result-mark" aria-hidden="true">${info.kind==='sent'?'✓':'↗'}</span><h2>${info.kind==='sent'?'Заявка отправлена':'Заявка сохранена'}</h2><p class="transfer-reference">${esc(reference(application))}</p><p>${esc(info.text)}</p><span class="portal-delivery is-${info.kind}">${info.label}</span><div class="portal-actions"><a class="button secondary" href="#/account">Личный кабинет</a><button class="text-link portal-plain-button" data-transfer-action="new" type="button">Заполнить новую заявку</button></div></div>`;
}
function recoveryMarkup(draft) {
  const fields = draft.checkpoint.fields;
  const rule = selectedRule(fields);
  return `<div class="portal-gate"><h2>Проверим результат отправки</h2><p>Соединение могло прерваться после сохранения заявки. Проверьте результат перед повторной отправкой.</p><dl class="transfer-pending"><div><dt>Перевод</dt><dd>${esc(rule ? `${rule.structure}, ${rule.title} → ${rule.targetTitle} ФСБ` : 'По сохранённым данным')}</dd></div><div><dt>Причина</dt><dd>${esc(fields.reason)}</dd></div></dl><div class="portal-actions"><button class="button primary" data-transfer-action="reconcile" type="button" ${draft.busy?'disabled':''}>${draft.busy?'Проверяем…':'Проверить результат'}</button>${draft.checked?'<button class="button secondary" data-transfer-action="resend" type="button">Повторить эту заявку</button>':''}</div><p class="portal-message is-error" role="alert" ${draft.message?'':'hidden'}>${esc(draft.message)}</p><p class="portal-field-hint">При повторе сохранятся прежние данные и номер запроса.</p></div>`;
}
export function renderTransferHistorySection(state=stateNow()) {
  if (!member(state)) return '';
  return `<section class="portal-history transfer-history" data-transfer-history-section><div class="portal-section-head"><div><h2>Мои переводы в ФСБ</h2><p>Последние 20 заявок на перевод и доставка уведомлений.</p></div><button class="portal-refresh" data-transfer-action="refresh" type="button">Обновить</button></div><div data-transfer-history aria-live="polite">${historyMarkup(histories.get(key(state)))}</div></section>`;
}
function historyMarkup(cache) {
  if (!cache) return '<div class="portal-history-loading" role="status"><span></span><span></span><p>Загружаем заявки на перевод…</p></div>';
  if (cache.error) return `<div class="portal-empty"><h3>Не удалось загрузить переводы</h3><p>${esc(cache.error)}</p><button class="button secondary" data-transfer-action="refresh" type="button">Попробовать снова</button></div>`;
  if (!cache.items.length) return '<div class="portal-empty"><h3>Заявок на перевод пока нет</h3><p>После отправки здесь появятся её номер, данные и статус доставки.</p><a class="text-link" href="#/applications/transfer">Подать заявку на перевод ↗</a></div>';
  return `<ul class="portal-application-list">${cache.items.map(app=>{
    const info=delivery(app), snapshot=app.snapshot || {};
    const date = new Date(app.created_at);
    const dateText = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(date);
    return `<li class="portal-application"><div class="portal-application-top"><div><span class="portal-application-id transfer-reference">${esc(reference(app))}</span><h3>${esc(snapshot.source_structure)} → ФСБ</h3></div><span class="portal-delivery is-${info.kind}">${info.label}</span></div><p>${esc(info.text)}</p><p>${esc(snapshot.source_rank_title)} → ${esc(snapshot.target_rank_title)}, ${esc(snapshot.target_rank)} ранг</p><details class="portal-application-details"><summary>Детали заявки</summary><dl><div><dt>Должность</dt><dd>${esc(snapshot.source_position)}</dd></div><div><dt>Игровой паспорт</dt><dd>${esc(snapshot.passport_number)}</dd></div><div><dt>Причина перевода</dt><dd class="portal-history-reason">${esc(snapshot.reason)}</dd></div></dl><div class="portal-history-links">${[['passport_url','Паспорт'],['credential_url','Удостоверение'],['profile_url','Планшет / профиль'],['approval_url','Одобрение руководителя']].filter(([name])=>validUrl(String(snapshot[name]||''),500)).map(([name,label])=>`<a href="${esc(snapshot[name])}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`).join('')}</div></details><div class="portal-application-bottom"><time datetime="${esc(app.created_at)}">${esc(dateText)}</time>${info.retry?`<button class="button secondary small" type="button" data-transfer-action="retry" data-transfer-id="${esc(app.id)}">Повторить доставку</button>`:''}</div></li>`;
  }).join('')}</ul>`;
}
export function renderTransferService() {
  return `<a class="portal-service transfer-service" href="#/applications/transfer"><div class="portal-service-copy"><span class="portal-service-icon" aria-hidden="true">${transferIcon}</span><div><h2>Переводы в ФСБ</h2><p>Из ГИБДД, МВД, Армии и ФСО. Звание определяется по таблице переводов.</p></div></div><span class="portal-service-action">Подать заявку ↗</span></a>`;
}
export function mountTransfers({onStateChange=()=>{}}={}) {
  const page = document.querySelector('[data-transfer-page]');
  const scopes = [...document.querySelectorAll('[data-transfer-page], [data-transfer-account]')];
  if (!scopes.length) return ()=>{};
  let alive=true, state=stateNow(), signature=JSON.stringify(state);
  const ownerState=state;
  const draft=member(state)?draftFor(state):null;
  const rerender=()=>{if(alive)onStateChange();};
  views.add(rerender);
  const renderHistory=()=>{if(alive)document.querySelectorAll('[data-transfer-history]').forEach(node=>{node.innerHTML=historyMarkup(histories.get(key(state)));});};
  async function loadHistory() {
    if (!member(state)) return;
    const owner=key(state);
    try { histories.set(owner,{items:await api.listMyTransfers()}); } catch(error) { histories.set(owner,{items:[],error:safeMessage(error)}); }
    renderHistory();
  }
  function applyErrors(form, errors, summary=false) {
    for (const name of [...fieldNames,'consent']) {
      const error=form.querySelector(`[data-transfer-error="${name}"]`), input=form.elements.namedItem(name);
      if(error){error.textContent=errors[name]||'';error.hidden=!errors[name];}
      if(input) input.setAttribute('aria-invalid',String(Boolean(errors[name])));
    }
    const node=form.querySelector('[data-transfer-summary]');
    if(node && (summary || !node.hidden)){node.innerHTML='<strong>Проверьте поля заявки</strong><ul>'+Object.keys(errors).map(name=>`<li><a href="#transfer-${name}" data-transfer-focus="${name}">${esc(labels[name])}: ${esc(errors[name])}</a></li>`).join('')+'</ul>';node.hidden=!Object.keys(errors).length;if(summary&&!node.hidden)node.focus();}
  }
  async function sendPending() {
    if(!draft?.checkpoint || draft.busy)return;
    draft.busy=true;draft.message='';notify();
    const original=draft.checkpoint;
    try {
      const result=await api.submitTransfer({...original.fields,sourceRank:Number(original.fields.sourceRank),passportNumber:original.fields.passportNumber.trim(),idempotencyKey:original.idempotencyKey,consent:true});
      draft.success=result;draft.checkpoint=null;draft.checked=false;histories.delete(key(ownerState));save(ownerState,draft);
    } catch(error) {
      if(error.submissionMayExist===false){draft.checkpoint=null;draft.checked=false;}
      draft.message=safeMessage(error);save(ownerState,draft);
    } finally { draft.busy=false;notify(); }
  }
  async function submit(event) {
    if(!event.target.matches('[data-transfer-form]'))return;
    event.preventDefault();if(!draft||draft.busy)return;
    draft.consent=Boolean(event.target.elements.namedItem('consent')?.checked);
    draft.errors=validateTransferDraft(draft);draft.attempted=true;
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
    if(!input.closest('[data-transfer-form]')||!draft||draft.busy)return;
    if(input.name==='consent')draft.consent=input.checked;
    else if(fieldNames.includes(input.name))draft[input.name]=input.value;
    else return;
    if(input.name==='sourceStructure'){
      draft.sourceRank='';const select=page.querySelector('[name="sourceRank"]');select.innerHTML=rankOptions(draft);select.disabled=!draft.sourceStructure;
    }
    if(['sourceStructure','sourceRank'].includes(input.name))page.querySelector('[data-transfer-target]').innerHTML=targetMarkup(draft);
    const count=page.querySelector('[data-transfer-count]');if(count)count.textContent=[...draft.reason].length;
    save(ownerState,draft);
    if(draft.attempted){draft.errors=validateTransferDraft(draft);applyErrors(input.form,draft.errors);}
  }
  function blur(event){
    if(!draft || !fieldNames.includes(event.target.name))return;
    const name=event.target.name, error=validateTransferDraft(draft)[name];
    if(error)draft.errors[name]=error;else delete draft.errors[name];
    const node=event.target.form?.querySelector(`[data-transfer-error="${name}"]`);
    if(node){node.textContent=error||'';node.hidden=!error;}
    event.target.setAttribute('aria-invalid',String(Boolean(error)));
  }
  async function click(event) {
    const focus=event.target.closest('[data-transfer-focus]');if(focus){event.preventDefault();page?.querySelector(`[name="${focus.dataset.transferFocus}"]`)?.focus();return;}
    const button=event.target.closest('[data-transfer-action]');if(!button)return;
    const action=button.dataset.transferAction;
    if(action==='reload')return location.reload();
    if(button.disabled)return;
    if(action==='new'&&draft){drafts.delete(key(state));try{sessionStorage.removeItem(`portal-transfer:${key(state)}`);}catch{}return rerender();}
    if(action==='resend')return await sendPending();
    button.disabled=true;
    try {
      if(action==='link-discord')await api.linkDiscord('#/applications/transfer');
      if(action==='refresh')await loadHistory();
      if(action==='retry'){await api.retryTransfer(button.dataset.transferId);await loadHistory();}
      if(action==='reconcile'&&draft?.checkpoint){const app=await api.findMyTransferByKey(draft.checkpoint.idempotencyKey);if(app){draft.success={application:app};draft.checkpoint=null;histories.delete(key(state));}else{draft.checked=true;draft.message='Заявка пока не найдена. Можно повторить отправку с прежними данными.';}save(ownerState,draft);rerender();}
    }catch(error){
      if(draft){draft.message=safeMessage(error);rerender();}
      else {const feedback=page?.querySelector('[data-transfer-gate-error]');if(feedback){feedback.textContent=safeMessage(error);feedback.hidden=false;}}
    }finally{if(alive&&button.isConnected)button.disabled=false;}
  }
  for(const scope of scopes){scope.addEventListener('click',click);scope.addEventListener('submit',submit);scope.addEventListener('input',update);scope.addEventListener('change',update);scope.addEventListener('focusout',blur);}
  const unsubscribe=api.subscribeAccount(next=>{const current=JSON.stringify(next);if(current!==signature){signature=current;state=next;rerender();}});
  if(member(state))void loadHistory();
  return()=>{alive=false;views.delete(rerender);unsubscribe();for(const scope of scopes){scope.removeEventListener('click',click);scope.removeEventListener('submit',submit);scope.removeEventListener('input',update);scope.removeEventListener('change',update);scope.removeEventListener('focusout',blur);}};
}
