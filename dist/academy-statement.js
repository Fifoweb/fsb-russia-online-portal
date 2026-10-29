import { academyStatement } from './academy-statement-template.js?v=statement-credit-1';

export function renderAcademyStatementPreview() {
  return `<aside class="academy-statement-preview" aria-label="Предпросмотр заявления"><details data-statement-details open><summary><span class="academy-statement-heading">Ваше заявление</span><span class="academy-statement-caption">Заполняется вместе с анкетой</span></summary><div class="academy-statement-content"><div class="academy-paper" data-statement-paper></div><p>Этот лист будет прикреплён к заявке в Discord как PNG.</p><button class="button secondary" type="button" data-statement-open>Открыть заявление</button></div></details><dialog class="academy-statement-dialog" data-statement-dialog aria-labelledby="academy-statement-title"><div class="academy-statement-toolbar"><h2 id="academy-statement-title">Заявление в академию</h2><button class="button secondary" type="button" data-statement-close>Закрыть</button></div><div class="academy-statement-full" data-statement-full></div></dialog></aside>`;
}
export function mountAcademyStatement(page, getSnapshot) {
  const preview = page?.querySelector('.academy-statement-preview');
  if (!preview) return {update(){},destroy(){}};
  const dialog = preview.querySelector('[data-statement-dialog]');
  const details = preview.querySelector('[data-statement-details]');
  details.open = matchMedia('(min-width: 1000px)').matches;
  let frame = 0;
  const draw = () => {
    frame = 0;
    const {svg} = academyStatement(getSnapshot());
    preview.querySelector('[data-statement-paper]').innerHTML = svg;
    preview.querySelector('[data-statement-full]').innerHTML = svg;
  };
  const update = () => { if (!frame) frame = requestAnimationFrame(draw); };
  const click = event => {
    if (event.target.closest('[data-statement-open]')) { draw(); dialog.showModal(); }
    if (event.target.closest('[data-statement-close]') || event.target === dialog) dialog.close();
  };
  preview.addEventListener('click', click); draw();
  return {update,destroy(){cancelAnimationFrame(frame);if(dialog.open)dialog.close();preview.removeEventListener('click',click);}};
}
