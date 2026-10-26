import * as api from './auth-client.js?v=profile-department-1';
import { internalDepartments } from './data/internal-departments.js?v=profile-department-1';

const actions=new Map(),views=new Set();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const actionFor=id=>{if(!actions.has(id))actions.set(id,{busy:false,message:'',error:false});return actions.get(id);};
const notify=()=>[...views].forEach(fn=>fn());
export function renderAccountDepartment(state){
 if(!state.profile)return '';
 const department=state.profile.department,known=internalDepartments.find(d=>d.id===department?.id),action=actionFor(state.profile.user_id),automatic=known&&department.source==='transfer';
 return `<section class="portal-discord-panel" data-account-department aria-labelledby="account-department-title"><div class="portal-discord-heading"><h3 id="account-department-title">Отдел</h3></div>${automatic?`<dl class="portal-profile-data"><div><dt>Отдел по последней заявке</dt><dd>${esc(known.label)}</dd></div></dl><p class="portal-profile-note">Обновлён по вашей последней поданной заявке на внутренний перевод. Решение о переводе принимает руководство.</p>`:`<form data-account-department-form novalidate aria-busy="${action.busy}"><label class="portal-field" for="account-department-select">Ваш отдел<select class="portal-input" id="account-department-select" name="departmentId" required aria-describedby="account-department-hint account-department-message" ${action.busy?'disabled':''}><option value="">Не указан</option>${internalDepartments.map(d=>`<option value="${d.id}" ${known?.id===d.id?'selected':''}>${d.label}</option>`).join('')}</select></label><p class="portal-field-hint" id="account-department-hint">Можно выбрать сейчас или заполнить позже. После заявки на внутренний перевод здесь появится выбранный в ней отдел.</p><button class="button secondary small" type="submit" ${action.busy?'disabled':''}>${action.busy?'Сохраняем…':'Сохранить отдел'}</button></form>`}<p class="portal-message ${action.error?'is-error':'is-success'}" id="account-department-message" data-account-department-message role="status" ${action.message?'':'hidden'}>${esc(action.message)}</p></section>`;
}
export function mountAccountDepartment({onStateChange=()=>{}}={}){
 const scope=document.querySelector('[data-account-department]'),state=api.getAccountState();
 if(!scope||!state.profile)return()=>{};
 const owner=state.profile.user_id,action=actionFor(owner);let alive=true;
 const render=()=>{if(alive)onStateChange();};views.add(render);
 function feedback(error){if(!alive)return;const node=scope.querySelector('[data-account-department-message]');if(node){node.textContent=error?.code==='authentication_required'?'Войдите в аккаунт, чтобы сохранить отдел.':'Не удалось обновить отдел. Проверьте соединение и повторите попытку.';node.className='portal-message is-error';node.hidden=false;}}
 async function submit(event){
  if(!event.target.matches('[data-account-department-form]'))return;
  event.preventDefault();if(action.busy)return;
  const select=event.target.elements.namedItem('departmentId'),id=select.value;
  if(!internalDepartments.some(d=>d.id===id)){select.setAttribute('aria-invalid','true');select.focus();const node=scope.querySelector('[data-account-department-message]');node.textContent='Выберите свой отдел из списка.';node.hidden=false;node.className='portal-message is-error';return;}
  action.busy=true;action.message='';action.error=false;notify();
  try{const result=await api.saveProfileDepartment(id);action.message=result.applied?'Отдел сохранён.':'Отдел уже обновлён по последней заявке на перевод.';}
  catch(error){action.message=error?.code==='invalid_profile_department'?'Выберите отдел из списка.':'Не удалось сохранить отдел. Проверьте соединение и повторите попытку.';action.error=true;}
  finally{action.busy=false;notify();}
 }
 scope.addEventListener('submit',submit);
 void api.refreshProfileDepartment().catch(feedback);
 return()=>{alive=false;views.delete(render);scope.removeEventListener('submit',submit);};
}
