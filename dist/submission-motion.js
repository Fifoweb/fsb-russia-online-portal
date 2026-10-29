// Presentation only: the caller owns the request, idempotency key and receipt.
let active = null;
const pathDiscord = 'M19.7 5.3a18.3 18.3 0 0 0-4.5-1.4l-.5 1a17 17 0 0 0-5.4 0l-.5-1a18.3 18.3 0 0 0-4.5 1.4C1.5 9.5.8 13.6 1.2 17.7a18.6 18.6 0 0 0 5.5 2.8l1.1-1.8-1.7-.8.4-.3a13.5 13.5 0 0 0 11 0l.4.3-1.7.8 1.1 1.8a18.6 18.6 0 0 0 5.5-2.8c.5-4.8-.8-8.9-3.1-12.4ZM8.5 15.2c-1 0-1.8-1-1.8-2.1s.8-2.1 1.8-2.1 1.8 1 1.8 2.1-.8 2.1-1.8 2.1Zm7 0c-1 0-1.8-1-1.8-2.1s.8-2.1 1.8-2.1 1.8 1 1.8 2.1-.8 2.1-1.8 2.1Z';
const scenes = {
  sent: ['Доставлено в Discord', 'Руководство получило вашу заявку.'],
  pending: ['Заявка сохранена', 'Discord пока не подтвердил доставку. Подробности — в квитанции.'],
  unknown: ['Проверим доставку', 'Discord мог получить сообщение. Подробности — в квитанции.'],
  unconfirmed: ['Проверим результат', 'Ответ сервера пока не получен. Данные этой попытки сохранены.'],
  error: ['Не удалось отправить', 'Проверьте данные и повторите попытку.'],
};
function art() {
  return `<div class="submission-motion-scene" aria-hidden="true"><svg viewBox="0 0 360 180" class="submission-motion-flight"><path class="submission-motion-route" d="M36 126Q180 -8 324 126"/><path class="submission-motion-trace" d="M36 126Q180 -8 324 126"/><g transform="translate(36 126)"><circle r="25" class="submission-motion-node"/><path d="M-8-12H4L10-6V12H-8Z M4-12V-5H10 M-3 1H5 M-3 6H3" class="submission-motion-line"/></g><g transform="translate(324 126)"><circle r="32" class="submission-motion-beacon"/><circle r="25" class="submission-motion-node"/><path transform="translate(-13 -13) scale(1.08)" d="${pathDiscord}" class="submission-motion-discord"/></g><g class="submission-motion-packet"><rect x="-13" y="-16" width="26" height="32" rx="4"/><path d="M-7-7H7 M-7-1H7 M-7 5H2"/></g><text x="36" y="174" text-anchor="middle">Заявка</text><text x="324" y="174" text-anchor="middle">Discord</text></svg><div class="submission-motion-result"><span class="submission-motion-particles">${Array.from({length:8},(_,i)=>`<i style="--particle-angle:${i*45}deg"></i>`).join('')}</span><svg viewBox="0 0 104 104"><circle class="submission-motion-result-circle" cx="52" cy="52" r="42"/><path class="submission-motion-check" d="m31 52 14 14 28-29"/><g class="submission-motion-clock"><circle cx="52" cy="52" r="19"/><path d="M52 40V53L61 59"/></g><path class="submission-motion-cross" d="m40 40 24 24m0-24L40 64"/></svg></div></div>`;
}
export function beginSubmissionMotion({label='Ваша заявка'}={}) {
  active?.destroy();
  const dialog=document.createElement('dialog');
  dialog.className='submission-motion';
  dialog.dataset.state='sending';
  dialog.setAttribute('aria-labelledby','submission-motion-title');
  dialog.setAttribute('aria-describedby','submission-motion-description');
  dialog.innerHTML=`<button type="button" class="submission-motion-close" aria-label="Свернуть уведомление об отправке" autofocus><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><p class="submission-motion-label"></p>${art()}<h2 id="submission-motion-title">Отправляем заявку</h2><p id="submission-motion-description" role="status" aria-live="polite">Передаём данные и ждём подтверждения Discord.</p><p class="submission-motion-note">Отправка продолжится, если свернуть окно.</p>`;
  dialog.querySelector('.submission-motion-label').textContent=label;
  const previousFocus=document.activeElement;
  let disposed=false, timer=null, resolveFinished=null, finishing=null;
  function destroy() {
    if(disposed)return;
    disposed=true;
    clearTimeout(timer);
    if(dialog.open)dialog.close();
    dialog.remove();
    if(active===controller)active=null;
    resolveFinished?.();
    resolveFinished=null;
    if(previousFocus?.isConnected&&!previousFocus.disabled&&!previousFocus.closest('[inert]'))previousFocus.focus?.({preventScroll:true});
  }
  function complete({status='unconfirmed',message=''}={}) {
    if(disposed)return Promise.resolve();
    if(finishing)return finishing;
    const phase=status==='sent'?'sent':status==='unknown'?'unknown':status==='unconfirmed'?'unconfirmed':status==='error'?'error':'pending';
    const [title,description]=scenes[phase];
    dialog.dataset.state=phase;
    dialog.querySelector('h2').textContent=title;
    dialog.querySelector('#submission-motion-description').textContent=phase==='error'&&message?message:description;
    dialog.querySelector('.submission-motion-close').setAttribute('aria-label','Перейти к результату отправки');
    dialog.querySelector('.submission-motion-note').textContent='Открываем результат отправки…';
    finishing=new Promise(resolve=>{resolveFinished=resolve;});
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    timer=setTimeout(destroy,reduced?350:phase==='sent'?1250:1900);
    return finishing;
  }
  const controller={complete,destroy};
  active=controller;
  dialog.querySelector('button').addEventListener('click',destroy);
  dialog.addEventListener('cancel',event=>{event.preventDefault();destroy();});
  document.body.append(dialog);
  try{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}catch{destroy();}
  return controller;
}
