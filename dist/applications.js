import { renderInternalTransferService } from './internal-transfers.js?v=internal-transfer-1';
import { renderTransferService } from './transfers.js?v=internal-transfer-1';
import * as accountApi from './auth-client.js?v=internal-transfer-1';

const MAX_FILE = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const drafts = new Map();
const draftViews = new WeakMap();
const applicationCache = new Map();
const actionState = { busy: false, action: '', confirmUnlink: false, unlinkUserId: null, message: '', error: false };
const arrow = '<span aria-hidden="true">↗</span>';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeState = () => {
  try { return accountApi.getAccountState(); }
  catch { return { status: 'error', profile: null, discord: null, error: 'Не удалось загрузить аккаунт. Обновите страницу.', configured: false }; }
};
const isMember = state => Boolean(state.profile && ['registered', 'linked'].includes(state.status));
const isLinked = state => state.status === 'linked' && state.profile && state.discord?.id;
const accountKey = state => String(state.profile?.user_id || 'anonymous');
const stateSignature = state => JSON.stringify([state.status, state.profile?.user_id, state.profile?.game_name, state.profile?.static_id, state.discord?.id, state.discord?.username, state.discord?.display_name, state.error, state.configured]);

function heading(kicker, title, description, child = false) {
  return `<div class="container page-heading portal-heading ${child ? 'portal-heading-child' : ''}"><nav class="breadcrumb" aria-label="Навигационная цепочка"><a href="#/">Главная</a><span>/</span>${child ? '<a href="#/applications">Заявки</a><span>/</span>' : ''}<span>${esc(kicker)}</span></nav><h1 class="page-title">${esc(title)}</h1><p class="page-description">${esc(description)}</p></div>`;
}

function draftFor(state) {
  const key = accountKey(state);
  if (!drafts.has(key)) {
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(`portal-restoration:${key}`) || '{}') || {}; } catch { /* A draft is optional. */ }
    const checkpoint = validCheckpoint(stored.checkpoint) ? stored.checkpoint : null;
    drafts.set(key, {
      dismissalType: stored.dismissalType === 'ban_warn' ? 'ban_warn' : 'regular',
      reason: typeof stored.reason === 'string' ? stored.reason.slice(0, 1000) : '',
      previousRank: typeof stored.previousRank === 'string' ? stored.previousRank : '',
      approvalUrl: typeof stored.approvalUrl === 'string' ? stored.approvalUrl : '',
      rankUrl: typeof stored.rankUrl === 'string' ? stored.rankUrl : '',
      tabletUrl: typeof stored.tabletUrl === 'string' ? stored.tabletUrl : '',
      rankFiles: [], tabletFiles: [], errors: {}, success: null, checkpoint,
      idempotencyKey: checkpoint?.idempotencyKey || null, historyChecked: !checkpoint, busy: false, attempted: false
    });
  }
  return drafts.get(key);
}

function saveDraft(state, draft) {
  const { dismissalType, reason, previousRank, approvalUrl, rankUrl, tabletUrl, checkpoint } = draft;
  try { sessionStorage.setItem(`portal-restoration:${accountKey(state)}`, JSON.stringify({ dismissalType, reason, previousRank, approvalUrl, rankUrl, tabletUrl, checkpoint })); return true; } catch { return false; }
}

function validCheckpoint(value) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.idempotencyKey || '')
    && /^[0-9a-f]{64}$/.test(value.fingerprint || '') && value.fields && ['regular', 'ban_warn'].includes(value.fields.dismissalType)
    && ['reason', 'previousRank', 'approvalUrl', 'rankUrl', 'tabletUrl'].every(key => typeof value.fields[key] === 'string')
    && Array.isArray(value.files) && value.files.length <= 3
    && value.files.every(file => file && ['rank', 'tablet'].includes(file.category) && /^[0-9a-f]{64}$/.test(file.hash || '') && ALLOWED_TYPES.has(file.type) && Number.isInteger(file.size) && file.size > 0 && file.size <= MAX_FILE && typeof file.name === 'string');
}

const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(n => n.toString(16).padStart(2, '0')).join('');

async function prepareSubmission(draft) {
  const banned = draft.dismissalType === 'ban_warn';
  const fields = { dismissalType: draft.dismissalType, reason: draft.reason.trim(), previousRank: String(Number(draft.previousRank)),
    approvalUrl: banned ? new URL(draft.approvalUrl.trim()).href : '',
    rankUrl: new URL(draft.rankUrl.trim()).href,
    tabletUrl: !banned ? new URL(draft.tabletUrl.trim()).href : '' };
  const files = [];
  const fingerprint = await sha256(new TextEncoder().encode(JSON.stringify({ fields, files })));
  return { fingerprint, fields, files, input: { dismissalType: fields.dismissalType, reason: fields.reason, previousRank: Number(fields.previousRank), approvalUrl: fields.approvalUrl || null,
    rankProof: { urls: [fields.rankUrl] }, tabletProof: { urls: fields.tabletUrl ? [fields.tabletUrl] : [] } } };
}

function checkpointMarkup(draft, gate = false) {
  const checkpoint = draft.checkpoint;
  if (!checkpoint) return '';
  const legacy = checkpoint.files.length > 0;
  return `<div class="portal-gate portal-recovery"><h2>${legacy ? 'Проверим прежнюю заявку' : gate ? 'Проверим результат отправки' : 'Отправка ещё не подтверждена'}</h2><p>${legacy ? 'В прежней попытке были изображения. Теперь доказательства принимаются только по ссылкам. Сначала проверьте, сохранилась ли та заявка, чтобы не отправить её повторно.' : 'Сначала проверим историю. Если записи пока нет, повторная отправка с теми же данными сохранит прежний номер и не создаст дубликат.'}</p><div class="portal-actions"><button class="button secondary" type="button" data-portal-action="reconcile-attempt">Проверить результат</button>${gate || legacy ? '' : '<button class="text-link portal-plain-button" type="button" data-portal-action="restore-attempt">Вернуть прежние поля</button>'}<a class="text-link" href="#/account">Мои заявки</a></div>${legacy && draft.historyChecked ? '<p class="portal-field-hint">Если заявка не найдена, проверьте историю немного позже или обратитесь к руководству. Новая отправка пока закрыта.</p>' : ''}${messageMarkup(draft.recoveryError || '', true)}</div>`;
}

function messageMarkup(message = '', error = false) {
  return `<div class="portal-message ${error ? 'is-error' : 'is-success'}" data-portal-feedback role="${error ? 'alert' : 'status'}" ${message ? '' : 'hidden'}>${esc(message)}</div>`;
}

function accessGate(state, restoration = false) {
  if (state.status === 'loading') return '<div class="portal-gate portal-loading" role="status"><span class="portal-loader" aria-hidden="true"></span><h2>Загружаем аккаунт</h2><p>Проверяем вход и привязку Discord.</p></div>';
  if (state.status === 'error') return `<div class="portal-gate"><span class="portal-label">АККАУНТ НЕДОСТУПЕН</span><h2>Не удалось проверить вход</h2><p>${state.configured === false ? 'Вход временно недоступен. Информационные разделы портала продолжают работать.' : 'Обновите страницу и попробуйте ещё раз. Информационные разделы портала доступны.'}</p><div class="portal-actions"><button class="button secondary" type="button" data-portal-action="reload">Обновить страницу ${arrow}</button><a class="text-link" href="#/documents">К документам ${arrow}</a></div></div>`;
  if (!isMember(state)) return `<div class="portal-gate"><span class="portal-label">ШАГ 01 · АККАУНТ</span><h2>${restoration ? 'Войдите, чтобы подать заявку' : 'Ваши заявки — в личном аккаунте'}</h2><p>Войдите по Static ID или создайте аккаунт. Затем привяжите Discord — туда придёт уведомление о заявке.</p><div class="portal-actions"><a class="button primary" href="#/account?tab=login">Войти ${arrow}</a><a class="button secondary" href="#/account?tab=register">Регистрация</a></div>${messageMarkup(state.error || "", true)}<p class="portal-gate-note">Справочник и документы доступны без входа.</p></div>`;
  if (!isLinked(state)) return `<div class="portal-gate"><span class="portal-label">ШАГ 02 · DISCORD</span><div class="portal-gate-title"><span class="portal-discord-mark" aria-hidden="true">${discordIcon()}</span><h2>Привяжите Discord</h2></div><p>Аккаунт <strong>${esc(state.profile.game_name)}</strong> создан. Для подачи заявки осталось связать его с вашим Discord.</p><div class="portal-actions"><button class="button primary" type="button" data-portal-action="link-discord" ${actionState.busy ? 'disabled' : ''}>${actionState.busy && actionState.action === 'link-discord' ? 'Открываем Discord…' : `Привязать Discord ${arrow}`}</button><a class="text-link" href="#/account">Мой аккаунт ${arrow}</a></div>${messageMarkup(state.error || actionState.message, Boolean(state.error) || actionState.error)}<p class="portal-gate-note">Откроется Discord для подтверждения. Пароль от Discord на портале не нужен.</p></div>`;
  return '';
}

function discordIcon() {
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.7 5.3a18.3 18.3 0 0 0-4.5-1.4l-.5 1a17 17 0 0 0-5.4 0l-.5-1a18.3 18.3 0 0 0-4.5 1.4C1.5 9.5.8 13.6 1.2 17.7a18.6 18.6 0 0 0 5.5 2.8l1.1-1.8-1.7-.8.4-.3a13.5 13.5 0 0 0 11 0l.4.3-1.7.8 1.1 1.8a18.6 18.6 0 0 0 5.5-2.8c.5-4.8-.8-8.9-3.1-12.4ZM8.5 15.2c-1 0-1.8-1-1.8-2.1s.8-2.1 1.8-2.1 1.8 1 1.8 2.1-.8 2.1-1.8 2.1Zm7 0c-1 0-1.8-1-1.8-2.1s.8-2.1 1.8-2.1 1.8 1 1.8 2.1-.8 2.1-1.8 2.1Z"/></svg>';
}

function accountStrip(state) {
  return `<div class="portal-account-strip"><div><span class="portal-status-dot" aria-hidden="true"></span><strong>${esc(state.profile.game_name)}</strong><span class="portal-muted">StaticID ${esc(state.profile.static_id)}</span></div><div class="portal-strip-discord">${discordIcon()}<span>${esc(state.discord.display_name || state.discord.username || 'Discord привязан')}</span><span class="portal-connected">Привязан</span></div><a class="text-link" href="#/account">Личный кабинет</a></div>${messageMarkup(state.error || '', true)}`;
}

function historySection(state, title = 'Мои заявки') {
  return `<section class="portal-history" aria-labelledby="portal-history-title"><div class="portal-section-head"><div><h2 id="portal-history-title">${esc(title)}</h2><p>Последние 20 заявок и статус их доставки в Discord.</p></div><button class="portal-refresh" type="button" data-portal-action="refresh-applications" aria-label="Обновить список заявок">Обновить</button></div><div data-portal-history aria-live="polite" aria-atomic="false">${historyMarkup(applicationCache.get(accountKey(state)))}</div></section>`;
}

export function renderApplicationsPage() {
  const state = safeState();
  const linked = isLinked(state);
  return heading('Заявки', 'Ваши обращения', 'Подайте заявку на восстановление, перевод в ФСБ или между отделами и проверьте её доставку.') + `<section class="container portal-page" data-portal-page="applications">${linked ? accountStrip(state) : accessGate(state)}<a href="${linked ? '#/applications/reinstatement' : '#/account?tab=login'}" class="portal-service ${linked ? '' : 'is-locked'}" ${linked ? '' : 'data-portal-action="explain-gate"'}><div class="portal-service-copy"><span class="portal-service-icon" aria-hidden="true">${documentIcon()}</span><div><h2>Восстановление во фракцию</h2><p>Обычное увольнение или увольнение после бана либо варна. Доказательства принимаются по ссылкам.</p></div></div><span class="portal-service-action">${linked ? 'Заполнить заявку' : 'Войти в аккаунт'} ${arrow}</span></a>${renderTransferService()}${renderInternalTransferService()}${isMember(state) ? historySection(state) : ''}</section>`;
}

function documentIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></svg>';
}

function fieldError(name, draft) {
  return `<p class="portal-field-error" id="portal-error-${name}" data-error-for="${name}" ${draft.errors[name] ? '' : 'hidden'}>${esc(draft.errors[name])}</p>`;
}

function proofField(category, title, description, draft) {
  const urlKey = category === 'rank' ? 'rankUrl' : 'tabletUrl';
  return `<div class="portal-proof" data-proof="${category}"><label class="portal-field" for="portal-${category}-url">${esc(title)}<input class="portal-input" id="portal-${category}-url" name="${urlKey}" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="300" required placeholder="https://…" value="${esc(draft[urlKey])}" aria-describedby="portal-${category}-hint portal-error-${category}Proof" ${draft.errors[`${category}Proof`] ? 'aria-invalid="true"' : ''}></label><p class="portal-field-hint" id="portal-${category}-hint">${esc(description)}</p>${fieldError(`${category}Proof`, draft)}</div>`;
}

function applicantSummary(state) {
  return `<div class="portal-applicant"><div class="portal-applicant-main"><span class="portal-avatar" aria-hidden="true">${esc(state.profile.game_name.split(/\s+/).map(part => [...part][0]).slice(0, 2).join(''))}</span><div><strong>${esc(state.profile.game_name)}</strong><span>StaticID ${esc(state.profile.static_id)}</span></div></div><div class="portal-applicant-discord">${discordIcon()}<div><strong>${esc(state.discord.username || state.discord.display_name)}</strong><span>Discord ID <span translate="no">${esc(state.discord.id)}</span></span></div><span class="portal-connected">Привязан</span></div></div>`;
}

export function renderReinstatementPage() {
  const state = safeState();
  const intro = heading('Восстановление', 'Заявка на восстановление', 'Укажите обстоятельства увольнения и добавьте ссылки на доказательства.', true);
  if (!isLinked(state)) return intro + `<section class="container portal-page portal-form-page" data-portal-page="reinstatement">${accessGate(state, true)}</section>`;
  const draft = draftFor(state);
  if (draft.checkpoint && (!draft.historyChecked || draft.checkpoint.files.length) && !draft.success) return intro + `<section class="container portal-page portal-form-page" data-portal-page="reinstatement">${checkpointMarkup(draft, true)}</section>`;
  if (draft.success) return intro + `<section class="container portal-page portal-form-page" data-portal-page="reinstatement">${successMarkup(draft.success)}<div class="portal-actions"><a class="button primary" href="#/account">В личный кабинет</a><button class="button secondary" type="button" data-portal-action="new-restoration">Новая заявка</button></div></section>`;
  const banned = draft.dismissalType === 'ban_warn';
  return intro + `<section class="container portal-page portal-form-page" data-portal-page="reinstatement">${checkpointMarkup(draft)}<form class="portal-restoration" data-portal-form="restoration" novalidate aria-busy="${draft.busy}">${applicantSummary(state)}<div class="portal-form-body"><div class="portal-form-title"><h2>Обстоятельства увольнения</h2><span>Все поля обязательны</span></div><div class="portal-short-fields"><label class="portal-field" for="portal-dismissal-type">Тип увольнения<select class="portal-input" id="portal-dismissal-type" name="dismissalType" autocomplete="off"><option value="regular" ${!banned ? 'selected' : ''}>Обычное увольнение</option><option value="ban_warn" ${banned ? 'selected' : ''}>После бана или варна</option></select></label><div><label class="portal-field" for="portal-previous-rank">Звание до увольнения<input class="portal-input" id="portal-previous-rank" name="previousRank" type="number" inputmode="numeric" autocomplete="off" min="1" max="1000" step="1" required placeholder="Номер звания…" value="${esc(draft.previousRank)}" aria-describedby="portal-error-previousRank" ${draft.errors.previousRank ? 'aria-invalid="true"' : ''}></label>${fieldError('previousRank', draft)}</div></div><label class="portal-field portal-reason" for="portal-reason">Причина восстановления<textarea class="portal-input" id="portal-reason" name="reason" rows="3" maxlength="1000" autocomplete="off" required placeholder="Почему вы были уволены и хотите восстановиться…" aria-describedby="portal-reason-count portal-error-reason" ${draft.errors.reason ? 'aria-invalid="true"' : ''}>${esc(draft.reason)}</textarea><span class="portal-counter" id="portal-reason-count" data-reason-count>${draft.reason.length} / 1000</span></label>${fieldError('reason', draft)}<div class="portal-proof-head"><h2>Ссылки на доказательства</h2><details class="portal-help"><summary>Как подготовить ссылки</summary><p>Разместите скриншоты в доступном альбоме или сообщении. Откройте ссылки в другом браузере и убедитесь, что руководство сможет увидеть изображения. Принимаются полные ссылки, начинающиеся с https://.</p></details></div>${proofField('rank', 'Подтверждение прежнего звания', 'Ссылка на скриншот или альбом, где видно ваше звание.', draft)}<div data-tablet-row ${!banned ? '' : 'hidden'}>${proofField('tablet', 'Планшет с причиной увольнения', 'Ссылка на скриншот планшета с указанной причиной увольнения.', draft)}</div><div data-approval-row ${banned ? '' : 'hidden'}><label class="portal-field" for="portal-approval-url">Одобренный запрос после бана или варна<input class="portal-input" id="portal-approval-url" name="approvalUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="500" placeholder="https://…" value="${esc(draft.approvalUrl)}" aria-describedby="portal-approval-hint portal-error-approvalUrl" ${banned ? 'required' : 'disabled'} ${draft.errors.approvalUrl ? 'aria-invalid="true"' : ''}></label><p class="portal-field-hint" id="portal-approval-hint">Ссылка на одобренный запрос госфракций. Руководство проверит одобрение.</p>${fieldError('approvalUrl', draft)}</div>${fieldError('evidence', draft)}<div class="portal-submit-area"><label class="portal-consent"><input type="checkbox" name="consent" required aria-describedby="portal-error-consent"><span>Подтверждаю данные и согласен на сохранение заявки и отправку её в Discord фракции.</span></label>${fieldError('consent', draft)}<div class="portal-message is-error" data-submit-error role="alert" ${draft.errors.submit ? '' : 'hidden'}>${esc(draft.errors.submit)}</div><div class="portal-submit-row"><p>Уведомление получат ответственные роли и заявитель. Решение о восстановлении принимает руководство.</p><button class="button primary portal-submit" type="submit" ${draft.busy ? 'disabled' : ''}>${draft.busy ? 'Сохраняем и отправляем…' : 'Отправить заявку'}</button></div></div></div></form><p class="portal-form-footer">Данные заявителя берутся из аккаунта. <a href="#/account">Вернуться в личный кабинет</a></p></section>`;
}

function discordUnlinkControls() {
  if (!actionState.confirmUnlink) return `<button class="portal-unlink-button" type="button" data-portal-action="unlink-discord" ${actionState.busy ? 'disabled' : ''}>Отвязать Discord</button>`;
  const pending = actionState.busy && actionState.action === 'unlink-discord';
  return `<div class="portal-unlink-confirm" role="group" aria-labelledby="portal-unlink-title" aria-busy="${pending}"><p id="portal-unlink-title">Отвязать Discord от аккаунта?</p><p>Вход по Static ID с прежним паролем и история заявок сохранятся. Для новых заявок потребуется снова привязать Discord.</p><div class="portal-unlink-actions"><button class="button secondary" type="button" data-portal-action="cancel-unlink-discord" ${actionState.busy ? 'disabled' : ''}>Отмена</button><button class="button primary" type="button" data-portal-action="confirm-unlink-discord" ${actionState.busy ? 'disabled' : ''}>${pending ? 'Отвязываем…' : 'Да, отвязать'}</button></div></div>`;
}

export function renderAccountPage(params = new URLSearchParams()) {
  const state = safeState();
  if (actionState.confirmUnlink && !actionState.busy && (!isLinked(state) || actionState.unlinkUserId !== state.profile?.user_id)) { actionState.confirmUnlink = false; actionState.unlinkUserId = null; }
  if (state.status === 'loading' || state.status === 'error') return heading('Аккаунт', 'Личный аккаунт.', 'Профиль для подачи заявок во фракцию.') + `<section class="container portal-page" data-portal-page="account">${accessGate(state)}</section>`;

  if (isMember(state)) {
    const linked = isLinked(state);
    const initials = state.profile.game_name.split(/\s+/).map(part => [...part][0]).slice(0, 2).join('');
    return heading('Личный кабинет', 'Личный кабинет', 'Ваш профиль, привязка Discord и история обращений.') + `<section class="container portal-page portal-cabinet" data-portal-page="account"><div class="portal-cabinet-banner"><div><span class="portal-readiness ${linked ? 'is-ready' : ''}"><span aria-hidden="true"></span>${linked ? 'Можно подать заявку' : 'Требуется привязка Discord'}</span><p>${linked ? 'Профиль заполнен и Discord привязан. Данные заявителя подставятся автоматически.' : 'Игровой профиль сохранён. Привяжите Discord, чтобы отправлять заявки.'}</p></div>${linked ? '<a class="button primary" href="#/applications/reinstatement">Подать заявку</a>' : `<button class="button primary" type="button" data-portal-action="link-discord" ${actionState.busy ? 'disabled' : ''}>${actionState.busy && actionState.action === 'link-discord' ? 'Открываем Discord…' : 'Привязать Discord'}</button>`}</div><div class="portal-cabinet-grid"><aside class="portal-profile-panel" aria-labelledby="portal-profile-title"><div class="portal-profile-identity"><span class="portal-avatar portal-avatar-large" aria-hidden="true">${esc(initials)}</span><div><h2 id="portal-profile-title">${esc(state.profile.game_name)}</h2><p>Игровой профиль</p></div></div><dl class="portal-profile-data"><div><dt>StaticID</dt><dd translate="no">${esc(state.profile.static_id)}</dd></div><div><dt>Игровой ник</dt><dd>${esc(state.profile.game_name)}</dd></div></dl><div class="portal-discord-panel"><div class="portal-discord-heading">${discordIcon()}<h3>Discord</h3><span class="portal-connected ${linked ? '' : 'is-unlinked'}">${linked ? 'Привязан' : 'Не привязан'}</span></div>${linked ? `<p class="portal-discord-name">${esc(state.discord.display_name || state.discord.username)}</p><p class="portal-discord-handle" translate="no">${esc(state.discord.username || '')}</p><dl class="portal-profile-data"><div><dt>Discord ID</dt><dd translate="no">${esc(state.discord.id)}</dd></div></dl><p class="portal-profile-note">В заявках будет указан этот аккаунт Discord.</p><div data-portal-unlink-controls>${discordUnlinkControls()}</div>` : '<p class="portal-profile-note">После привязки здесь появятся ваш ник и Discord ID. Пароль Discord вводится только на сайте Discord.</p>'}</div>${messageMarkup(state.error || actionState.message, Boolean(state.error) || actionState.error)}<div class="portal-profile-bottom"><p>Игровой ник и StaticID сохранены при регистрации.</p><button class="portal-logout" type="button" data-portal-action="logout" ${actionState.busy ? 'disabled' : ''}>Выйти из аккаунта</button></div></aside><div class="portal-cabinet-history">${historySection(state)}</div></div><p class="portal-cabinet-note">Статус в кабинете показывает доставку уведомления. Ответ по восстановлению даёт руководство в Discord.</p></section>`;
  }
  const register = params?.get?.('tab') === 'register';
  return heading('Аккаунт', register ? 'Создайте аккаунт.' : 'С возвращением.', register ? 'Создайте игровой профиль. Для входа используется Static ID.' : 'Вход по Static ID. Электронная почта не нужна.') + `<section class="container portal-page portal-auth-layout" data-portal-page="account"><div class="portal-auth-card"><nav class="portal-auth-tabs" aria-label="Действия с аккаунтом"><a href="#/account?tab=login" class="${register ? '' : 'active'}" ${register ? '' : 'aria-current="page"'}>Вход</a><a href="#/account?tab=register" class="${register ? 'active' : ''}" ${register ? 'aria-current="page"' : ''}>Регистрация</a></nav><form data-portal-form="${register ? 'register' : 'login'}" class="portal-auth-form" novalidate>${register ? '<label class="portal-field" for="portal-game-name">Игровой ник<input class="portal-input" id="portal-game-name" name="gameName" type="text" autocomplete="off" maxlength="100" required placeholder="Имя Фамилия" aria-describedby="portal-name-hint portal-error-gameName"><span class="portal-field-hint" id="portal-name-hint">Имя и фамилия персонажа для профиля и заявок. Кириллица и латиница.</span></label><p class="portal-field-error" id="portal-error-gameName" data-error-for="gameName" hidden></p>' : ''}<label class="portal-field" for="portal-static-id">Static ID<input class="portal-input" id="portal-static-id" name="staticId" type="text" inputmode="numeric" pattern="[0-9]+" autocomplete="username" maxlength="20" required placeholder="Например, 12345" aria-describedby="portal-static-hint portal-error-staticId"><span class="portal-field-hint" id="portal-static-hint">${register ? 'Числовой ID персонажа. Используйте его для входа в аккаунт.' : 'Static ID, указанный при регистрации. Игровой ник для входа не нужен.'}</span></label><p class="portal-field-error" id="portal-error-staticId" data-error-for="staticId" hidden></p><label class="portal-field" for="portal-password">Пароль<span class="portal-password-wrap"><input class="portal-input" id="portal-password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" ${register ? 'minlength="8"' : ''} maxlength="128" required aria-describedby="portal-password-hint portal-error-password"><button type="button" data-portal-action="toggle-password" data-target="portal-password" aria-label="Показать пароль" aria-pressed="false">Показать</button></span><span class="portal-field-hint" id="portal-password-hint">${register ? 'Не менее 8 символов. Используйте отдельный пароль для портала.' : 'Пароль вашего аккаунта на портале.'}</span></label><p class="portal-field-error" id="portal-error-password" data-error-for="password" hidden></p>${register ? '<label class="portal-field" for="portal-password-confirm">Повторите пароль<span class="portal-password-wrap"><input class="portal-input" id="portal-password-confirm" name="passwordConfirm" type="password" autocomplete="new-password" maxlength="128" required aria-describedby="portal-error-passwordConfirm"><button type="button" data-portal-action="toggle-password" data-target="portal-password-confirm" aria-label="Показать повтор пароля" aria-pressed="false">Показать</button></span></label><p class="portal-field-error" id="portal-error-passwordConfirm" data-error-for="passwordConfirm" hidden></p>' : ''}<div class="portal-message is-error" data-submit-error role="alert" hidden></div><button class="button primary portal-auth-submit" type="submit">${register ? 'Создать аккаунт' : 'Войти'} ${arrow}</button></form></div><aside class="portal-auth-aside"><span class="portal-label">ДОСТУП К ЗАЯВКАМ</span><h2>Один профиль.<br>Все ваши обращения.</h2><p>Для входа нужны Static ID и пароль. Игровой ник сохраняется в профиле, Discord привязывается в личном кабинете.</p><div class="portal-auth-route"><span>Аккаунт</span><span aria-hidden="true">→</span><span>Discord</span><span aria-hidden="true">→</span><span>Заявка</span></div><p class="portal-auth-footnote">Регистрация не ограничивает доступ к справочнику, документам и другим материалам портала.</p></aside></section>`;
}

function deliveryInfo(application) {
  const status = application?.delivery_status || application?.deliveryStatus || 'pending';
  if (status === 'sent' || status === 'delivered') return { label: 'Доставлена в Discord', kind: 'sent', detail: 'Уведомление доставлено. Решение о восстановлении принимает руководство.', retry: false };
  if (application?.delivery_error_code === 'delivery_outcome_unknown') return { label: 'Доставка проверяется', kind: 'saved', detail: 'Заявка сохранена. Discord мог получить сообщение, поэтому повторная отправка закрыта до проверки канала руководством.', retry: false };
  if (['failed', 'error'].includes(status)) return { label: 'Ошибка доставки', kind: 'error', detail: 'Заявка сохранена, но уведомление не доставлено. Можно повторить отправку.', retry: true };
  return { label: 'Ожидает доставки', kind: 'saved', detail: 'Заявка сохранена. Доставка уведомления в Discord пока не подтверждена.', retry: true };
}

function dateText(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function safeEvidenceLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

function historyEvidence(snapshot) {
  const links = [];
  for (const [key, label] of [['rank_proof', 'Подтверждение звания'], ['tablet_proof', 'Планшет с причиной увольнения']]) {
    for (const value of (Array.isArray(snapshot[key]?.urls) ? snapshot[key].urls : [])) {
      const href = safeEvidenceLink(value);
      if (href) links.push(`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ${arrow}</a>`);
    }
  }
  const approval = safeEvidenceLink(snapshot.approval_url);
  if (approval) links.push(`<a href="${esc(approval)}" target="_blank" rel="noopener noreferrer">Одобренный запрос ${arrow}</a>`);
  const oldFiles = ['rank_proof', 'tablet_proof'].reduce((sum, key) => sum + (Array.isArray(snapshot[key]?.paths) ? snapshot[key].paths.length : 0), 0);
  return `${links.length ? `<div class="portal-history-links">${links.join('')}</div>` : ''}${oldFiles ? `<p class="portal-field-hint">В этой заявке сохранены изображения: ${oldFiles}.</p>` : ''}`;
}

function historyMarkup(cache) {
  if (!cache) return '<div class="portal-history-loading" role="status" aria-label="Загружаем заявки…"><span></span><span></span><span></span><p>Загружаем заявки…</p></div>';
  if (cache.error) return `<div class="portal-empty"><h3>История временно недоступна</h3><p>${esc(cache.error)}</p><button class="button secondary" type="button" data-portal-action="refresh-applications">Загрузить снова</button></div>`;
  if (!cache.items.length) return '<div class="portal-empty"><span class="portal-empty-icon" aria-hidden="true">' + documentIcon() + '</span><h3>Заявок пока нет</h3><p>После отправки здесь появятся номер заявки, ваши данные и статус доставки в Discord.</p></div>';
  const sent = cache.items.filter(app => ['sent', 'delivered'].includes(app.delivery_status)).length;
  const waiting = cache.items.length - sent;
  return `<div class="portal-history-overview"><span>Показано <strong>${cache.items.length}</strong></span><span>Доставлено <strong>${sent}</strong></span>${waiting ? `<span>Требуют внимания <strong>${waiting}</strong></span>` : ''}</div><ul class="portal-application-list">${cache.items.map(app => {
    const delivery = deliveryInfo(app);
    const id = String(app.id || '');
    const snapshot = app.snapshot || {};
    return `<li class="portal-application"><div class="portal-application-top"><div><span class="portal-application-id">№ ${esc(id.slice(0, 8))}</span><h3>${snapshot.dismissal_type === 'ban_warn' ? 'После бана или варна' : 'Восстановление во фракцию'}</h3></div><span class="portal-delivery is-${delivery.kind}"><span aria-hidden="true"></span>${delivery.label}</span></div><p>${delivery.detail}</p><div class="portal-application-bottom"><time datetime="${esc(app.created_at || '')}">${esc(dateText(app.created_at))}</time>${delivery.retry && id ? `<button class="button secondary small" type="button" data-portal-action="retry-application" data-application-id="${esc(id)}">Повторить отправку</button>` : ''}</div><details class="portal-application-details"><summary>Детали заявки</summary><dl><div><dt>Звание до увольнения</dt><dd>${esc(snapshot.previous_rank ?? 'Не указано')}</dd></div><div><dt>Причина восстановления</dt><dd class="portal-history-reason">${esc(snapshot.reason || 'Не указана')}</dd></div></dl>${historyEvidence(snapshot)}</details><div class="portal-message" data-retry-feedback="${esc(id)}" role="status" hidden></div></li>`;
  }).join('')}</ul>`;
}

function successMarkup(result) {
  const application = result.application || result;
  const delivery = deliveryInfo({ ...application, delivery_status: result.deliveryStatus || result.delivery_status || application.delivery_status });
  return `<div class="portal-result"><span class="portal-result-mark" aria-hidden="true">${delivery.kind === 'sent' ? '✓' : '↗'}</span><span class="portal-label">ЗАЯВКА № ${esc(String(application.id || '').slice(0, 8))}</span><h2>${delivery.kind === 'sent' ? 'Заявка отправлена.' : 'Заявка сохранена.'}</h2><p>${delivery.detail}</p><span class="portal-delivery is-${delivery.kind}"><span aria-hidden="true"></span>${delivery.label}</span>${delivery.retry && application.id ? `<button class="button secondary" type="button" data-portal-action="retry-application" data-application-id="${esc(application.id)}">Повторить отправку ${arrow}</button><div class="portal-message" data-retry-feedback="${esc(application.id)}" role="status" hidden></div>` : ''}<p class="portal-result-note">Восстановление требует решения руководства. Статус выше показывает доставку уведомления.</p></div>`;
}

function errorText(error, fallback = 'Не удалось выполнить действие. Попробуйте ещё раз.') {
  const code = String(error?.code || '').toLowerCase();
  if (/invalid_credentials|invalid_login/.test(code)) return 'Неверный Static ID или пароль.';
  if (code === 'evidence_links_only') return 'Доказательства принимаются только по ссылкам. Уберите файлы и добавьте HTTPS ссылки.';
  if (/already|duplicate|exists|23505/.test(code)) return 'Этот игровой ник или StaticID уже зарегистрирован. Проверьте данные или войдите в свой аккаунт.';
  if (/rate|too_many/.test(code)) return 'Слишком много попыток. Подождите немного и попробуйте снова.';
  if (/discord.*required|discord.*unlinked|discord_not_linked/.test(code)) return 'Для отправки заявки нужно привязать Discord в аккаунте.';
  if (/not_configured|configuration|unconfigured/.test(code)) return 'Действие временно недоступно. Попробуйте позже.';
  if (/session|unauthorized|not_authenticated|auth_required/.test(code)) return 'Сеанс завершён. Войдите в аккаунт ещё раз.';
  if (/network|fetch|timeout/.test(code) || error instanceof TypeError) return 'Нет связи с сервером. Проверьте подключение и повторите попытку.';
  // The account client supplies safe, localized validation errors; never expose raw service diagnostics.
  const message = String(error?.message || '');
  return /[А-Яа-яЁё]/.test(message) && !/supabase|postgres|sql|stack|token|secret|apikey/i.test(message) ? message.slice(0, 300) : fallback;
}

function isHttps(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}

function validateDraft(draft, consent) {
  const errors = {};
  if (!draft.reason.trim()) errors.reason = 'Укажите причину увольнения и восстановления.';
  else if (draft.reason.length > 1000) errors.reason = 'Сократите причину до 1000 символов.';
  if (!/^\d+$/.test(draft.previousRank.trim()) || Number(draft.previousRank) < 1 || Number(draft.previousRank) > 1000) errors.previousRank = 'Укажите целое число от 1 до 1000.';
  if (draft.dismissalType === 'ban_warn' && !isHttps(draft.approvalUrl.trim())) errors.approvalUrl = 'Добавьте полную ссылку https:// на одобренный запрос.';
  else if (draft.dismissalType === 'ban_warn' && draft.approvalUrl.trim().length > 500) errors.approvalUrl = 'Ссылка должна быть не длиннее 500 символов.';
  for (const category of draft.dismissalType === 'regular' ? ['rank', 'tablet'] : ['rank']) {
    const value = draft[`${category}Url`].trim();
    if (!value) errors[`${category}Proof`] = 'Добавьте ссылку на доказательство.';
    else if (!isHttps(value)) errors[`${category}Proof`] = 'Укажите полную ссылку https:// без логина и пароля.';
    else if (value.length > 300) errors[`${category}Proof`] = 'Ссылка должна быть не длиннее 300 символов.';
  }
  if (draft.rankFiles.length || draft.tabletFiles.length) errors.evidence = 'Доказательства принимаются только по ссылкам.';
  if (!consent) errors.consent = 'Подтвердите данные и отправку заявки в Discord.';
  return errors;
}

function showErrors(form, errors) {
  form.querySelectorAll('[data-error-for]').forEach(node => {
    const message = errors[node.dataset.errorFor];
    node.textContent = message || '';
    node.hidden = !message;
  });
  form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
  const fieldNames = { rankProof: 'rankUrl', tabletProof: 'tabletUrl' };
  Object.keys(errors).forEach(key => {
    const field = form.elements.namedItem(fieldNames[key] || key);
    field?.setAttribute?.('aria-invalid', 'true');
  });
}

function setFeedback(scope, message, error = false) {
  const node = scope.querySelector('[data-submit-error], [data-portal-feedback]');
  if (!node) return;
  node.textContent = message;
  node.className = `portal-message ${error ? 'is-error' : 'is-success'}`;
  node.setAttribute('role', error ? 'alert' : 'status');
  node.hidden = !message;
}

function newKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return [...bytes].map((byte, i) => `${[4, 6, 8, 10].includes(i) ? '-' : ''}${byte.toString(16).padStart(2, '0')}`).join('');
}

export function mountApplicationPage({ path, params, onStateChange = () => {} } = {}) {
  const scope = document.querySelector('[data-portal-page]');
  if (!scope) return () => {};
  let alive = true;
  let state = safeState();
  let signature = stateSignature(state);
  const draft = isMember(state) ? draftFor(state) : null;
  const viewRender = () => { if (alive) onStateChange(); };
  if (draft && ['/applications', '/applications/reinstatement', '/account'].includes(path)) {
    if (!draftViews.has(draft)) draftViews.set(draft, new Set());
    draftViews.get(draft).add(viewRender);
  }
  const requestRender = () => {
    if (alive) onStateChange();
    else for (const render of [...(draftViews.get(draft) || [])]) render();
  };
  const rerenderHistory = () => {
    const node = scope.querySelector('[data-portal-history]');
    if (alive && node) node.innerHTML = historyMarkup(applicationCache.get(accountKey(state)));
  };

  async function loadApplications() {
    if (!isMember(state)) return;
    const key = accountKey(state);
    const button = scope.querySelector('[data-portal-action="refresh-applications"]');
    if (button) button.disabled = true;
    try {
      const result = await accountApi.listMyApplications();
      const items = Array.isArray(result) ? result : result?.applications || result?.data || [];
      applicationCache.set(key, { items: Array.isArray(items) ? items : [] });
    } catch (error) { applicationCache.set(key, { items: [], error: errorText(error, 'Не удалось загрузить список. Попробуйте ещё раз.') }); }
    if (alive) { rerenderHistory(); if (button?.isConnected) button.disabled = false; }
  }

  async function retryApplication(button) {
    if (button.disabled) return;
    const id = button.dataset.applicationId;
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = 'Отправляем…';
    const feedback = [...scope.querySelectorAll('[data-retry-feedback]')].find(node => node.dataset.retryFeedback === id);
    if (feedback) feedback.hidden = true;
    try {
      const result = await accountApi.retryApplication(id);
      const application = result?.application || result || {};
      const delivery = deliveryInfo({ ...application, delivery_status: result?.deliveryStatus || result?.delivery_status || application.delivery_status });
      if (draft?.success && String((draft.success.application || draft.success).id) === id) {
        draft.success = result;
        requestRender();
      } else if (alive && scope.querySelector('[data-portal-history]')) await loadApplications();
      if (alive && feedback?.isConnected) {
        feedback.textContent = delivery.detail;
        feedback.className = `portal-message ${delivery.kind === 'sent' ? 'is-success' : 'is-error'}`;
        feedback.hidden = false;
      }
    } catch (error) {
      if (alive && feedback) { feedback.textContent = errorText(error, 'Заявка сохранена, но повторная отправка не удалась. Попробуйте позже.'); feedback.className = 'portal-message is-error'; feedback.hidden = false; }
    } finally {
      if (alive && button.isConnected) { button.disabled = false; button.textContent = previousText; }
    }
  }

  async function click(event) {
    const button = event.target.closest('[data-portal-action]');
    if (!button || !scope.contains(button)) return;
    const action = button.dataset.portalAction;
    if (action === 'toggle-password') {
      const input = scope.querySelector(`#${button.dataset.target}`);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Скрыть' : 'Показать';
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    } else if (action === 'reload') location.reload();
    else if (action === 'explain-gate') {
      event.preventDefault();
      scope.querySelector('.portal-gate')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
      scope.querySelector('.portal-gate .button')?.focus({ preventScroll: true });
    } else if (action === 'unlink-discord' || action === 'cancel-unlink-discord') {
      if (actionState.busy) return;
      if (action === 'unlink-discord' && !isLinked(safeState())) return;
      actionState.confirmUnlink = action === 'unlink-discord';
      actionState.unlinkUserId = actionState.confirmUnlink ? safeState().profile.user_id : null;
      actionState.message = ''; actionState.error = false;
      const controls = scope.querySelector('[data-portal-unlink-controls]');
      if (controls) controls.innerHTML = discordUnlinkControls();
      queueMicrotask(() => scope.querySelector(`[data-portal-action="${action === 'unlink-discord' ? 'cancel-unlink-discord' : 'unlink-discord'}"]`)?.focus());
    } else if (action === 'confirm-unlink-discord') {
      if (actionState.busy || !actionState.confirmUnlink || !isLinked(safeState()) || actionState.unlinkUserId !== safeState().profile.user_id) return;
      actionState.busy = true; actionState.action = 'unlink-discord';
      actionState.message = ''; actionState.error = false;
      const controls = scope.querySelector('[data-portal-unlink-controls]');
      if (controls) controls.innerHTML = discordUnlinkControls();
      scope.querySelectorAll('[data-portal-action="logout"], [data-portal-action="link-discord"]').forEach(node => { node.disabled = true; });
      try {
        await accountApi.unlinkDiscord();
        actionState.confirmUnlink = false;
        actionState.message = 'Discord отвязан. Для отправки новых заявок привяжите Discord снова.';
      } catch (error) { actionState.message = errorText(error); actionState.error = true; }
      finally { actionState.busy = false; actionState.action = ''; requestRender(); }
    } else if (action === 'link-discord' || action === 'logout') {
      if (actionState.busy) return;
      actionState.busy = true; actionState.action = action; actionState.confirmUnlink = false;
      actionState.message = ''; actionState.error = false;
      button.disabled = true;
      button.textContent = action === 'link-discord' ? 'Открываем Discord…' : 'Выходим…';
      try {
        if (action === 'link-discord') await accountApi.linkDiscord();
        else { await accountApi.logoutAccount(); actionState.message = ''; }
      } catch (error) { actionState.message = errorText(error); actionState.error = true; }
      finally { actionState.busy = false; actionState.action = ''; requestRender(); }
    } else if (action === 'refresh-applications') await loadApplications();
    else if (action === 'retry-application') await retryApplication(button);
    else if (action === 'reconcile-attempt' && draft?.checkpoint) {
      if (button.disabled || draft.busy) return;
      button.disabled = true;
      button.textContent = 'Проверяем…';
      draft.recoveryError = '';
      try {
        const saved = await accountApi.findMyApplicationByKey(draft.checkpoint.idempotencyKey);
        if (saved) {
          draft.success = { application: saved, deliveryStatus: saved.delivery_status };
          draft.checkpoint = null;
          draft.rankFiles = []; draft.tabletFiles = [];
          applicationCache.delete(accountKey(state));
          try { sessionStorage.removeItem(`portal-restoration:${accountKey(state)}`); } catch { /* Optional storage. */ }
        } else {
          draft.historyChecked = true;
          // Preserve the original UUID even if the first request is still finishing.
          Object.assign(draft, draft.checkpoint.fields);
          saveDraft(state, draft);
        }
      } catch (error) { draft.recoveryError = errorText(error, 'Не удалось проверить сохранение. Повторите проверку перед отправкой.'); }
      requestRender();
    } else if (action === 'restore-attempt' && draft?.checkpoint) {
      Object.assign(draft, draft.checkpoint.fields);
      draft.errors = {};
      saveDraft(state, draft);
      requestRender();
    }
    else if (action === 'new-restoration' && draft) {
      drafts.delete(accountKey(state));
      try { sessionStorage.removeItem(`portal-restoration:${accountKey(state)}`); } catch { /* Optional storage. */ }
      requestRender();
    }
  }

  function validateLive() {
    const form = scope.querySelector('[data-portal-form="restoration"]');
    if (!form || !draft) return;
    draft.errors = validateDraft(draft, form.elements.consent.checked);
    showErrors(form, draft.errors);
  }

  function input(event) {
    const form = event.target.closest('[data-portal-form]');
    if (!form) return;
    if (form.dataset.portalForm === 'restoration' && draft && event.target.name && Object.hasOwn(draft, event.target.name)) {
      draft[event.target.name] = event.target.value;
      if (!draft.checkpoint) draft.idempotencyKey = null;
      if (event.target.name === 'reason') scope.querySelector('[data-reason-count]').textContent = `${draft.reason.length} / 1000`;
      saveDraft(state, draft);
      if (draft.attempted) {
        const errorKey = { rankUrl: 'rankProof', tabletUrl: 'tabletProof' }[event.target.name] || event.target.name;
        delete draft.errors[errorKey];
        const error = form.querySelector(`[data-error-for="${errorKey}"]`);
        if (error) error.hidden = true;
        event.target.removeAttribute('aria-invalid');
      }
    } else if (form.dataset.portalForm !== 'restoration') {
      const error = form.querySelector(`[data-error-for="${event.target.name}"]`);
      if (error) error.hidden = true;
      event.target.removeAttribute('aria-invalid');
      if (event.target.name === 'passwordConfirm') {
        const mismatch = event.target.value && event.target.value !== form.elements.password.value;
        event.target.setCustomValidity(mismatch ? 'Пароли не совпадают.' : '');
      }
    }
  }

  function focusout(event) {
    const form = event.target.closest('[data-portal-form="restoration"]');
    if (form && draft?.attempted && event.target.name) validateLive();
  }

  function change(event) {
    if (!draft) return;
    if (event.target.name === 'dismissalType') {
      draft.dismissalType = event.target.value === 'ban_warn' ? 'ban_warn' : 'regular';
      if (!draft.checkpoint) draft.idempotencyKey = null;
      const banned = draft.dismissalType === 'ban_warn';
      scope.querySelector('[data-approval-row]').hidden = !banned;
      const approval = scope.querySelector('[name="approvalUrl"]');
      approval.disabled = !banned;
      approval.required = banned;
      const tablet = scope.querySelector('[data-tablet-row]');
      tablet.hidden = banned;
      tablet.querySelectorAll('input').forEach(node => { node.disabled = banned; });
      saveDraft(state, draft);
      if (draft.attempted) validateLive();
    } else if (event.target.name === 'consent' && draft.attempted) validateLive();
  }

  async function submit(event) {
    const form = event.target.closest('[data-portal-form]');
    if (!form || !scope.contains(form)) return;
    event.preventDefault();
    if (form.getAttribute('aria-busy') === 'true') return;
    const type = form.dataset.portalForm;
    if (type === 'restoration' && draft) {
      draft.attempted = true;
      draft.errors = validateDraft(draft, form.elements.consent.checked);
      showErrors(form, draft.errors);
      if (Object.keys(draft.errors).length) {
        const invalid = form.querySelector('[aria-invalid="true"]') || form.querySelector('[data-error-for]:not([hidden])');
        invalid?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); invalid?.focus?.(); return;
      }
      if (!isLinked(safeState())) { setFeedback(form, 'Для отправки заявки войдите в аккаунт и привяжите Discord.', true); return; }
      draft.busy = true;
      form.setAttribute('aria-busy', 'true');
      const submitButton = form.querySelector('[type="submit"]');
      const fields = [...form.querySelectorAll('input,textarea,select,button')];
      const disabledBefore = new Set(fields.filter(node => node.disabled));
      fields.forEach(node => { node.disabled = true; });
      submitButton.textContent = 'Сохраняем и отправляем…';
      setFeedback(form, '');
      const previousCheckpoint = draft.checkpoint;
      try {
        const prepared = await prepareSubmission(draft);
        if (previousCheckpoint && previousCheckpoint.fingerprint !== prepared.fingerprint) {
          throw new Error('Предыдущая отправка ещё не подтверждена. Проверьте сохранённую заявку или верните прежние поля и ссылки.');
        }
        draft.idempotencyKey = previousCheckpoint?.idempotencyKey || newKey();
        draft.checkpoint = previousCheckpoint || { idempotencyKey: draft.idempotencyKey, fingerprint: prepared.fingerprint, fields: prepared.fields, files: prepared.files };
        draft.historyChecked = true;
        if (!saveDraft(state, draft)) {
          if (!previousCheckpoint) { draft.checkpoint = null; draft.idempotencyKey = null; }
          throw new Error('Браузер не позволяет сохранить состояние отправки. Разрешите хранение данных сайта, чтобы безопасно отправить заявку.');
        }
        const result = await accountApi.submitRestoration({ ...prepared.input, idempotencyKey: draft.idempotencyKey });
        if (!result?.application?.id && !result?.id) throw new Error('Не удалось подтвердить сохранение заявки. Повторите отправку.');
        draft.success = result;
        draft.checkpoint = null;
        draft.rankFiles = []; draft.tabletFiles = [];
        applicationCache.delete(accountKey(state));
        try { sessionStorage.removeItem(`portal-restoration:${accountKey(state)}`); } catch { /* Optional storage. */ }
      } catch (error) {
        if (!previousCheckpoint && error.submissionMayExist === false) {
          draft.checkpoint = null; draft.idempotencyKey = null;
          saveDraft(state, draft);
        }
        const message = errorText(error, 'Не удалось подтвердить сохранение заявки. Повторите отправку: повторная попытка не создаст дубликат.');
        draft.errors.submit = message;
        if (alive) setFeedback(form, message, true);
      } finally {
        draft.busy = false;
        if (alive && form.isConnected) {
          form.setAttribute('aria-busy', 'false');
          fields.forEach(node => { node.disabled = disabledBefore.has(node); });
          submitButton.innerHTML = `Отправить заявку ${arrow}`;
        }
        requestRender();
      }
      return;
    }
    if (!['register', 'login'].includes(type)) return;
    const gameName = type === 'register' ? form.elements.gameName.value.trim() : '';
    const staticId = form.elements.staticId.value.trim();
    const password = form.elements.password.value;
    const errors = {};
    if (type === 'register' && !/^[\p{Script=Latin}\p{Script=Cyrillic}]+[ _]+[\p{Script=Latin}\p{Script=Cyrillic}]+$/u.test(gameName)) errors.gameName = 'Введите RP-ник из имени и фамилии: Имя Фамилия или Имя_Фамилия, кириллицей или латиницей.';
    if (!/^[0-9]{1,20}$/.test(staticId)) errors.staticId = 'Введите Static ID цифрами, до 20 символов.';
    if (!password) errors.password = 'Введите пароль.';
    if (type === 'register') {
      if (password.length < 8) errors.password = 'Пароль должен содержать не менее 8 символов.';
      if (form.elements.passwordConfirm.value !== password) errors.passwordConfirm = 'Пароли не совпадают.';
    }
    showErrors(form, errors);
    if (Object.keys(errors).length) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
    const submitButton = form.querySelector('[type="submit"]');
    form.setAttribute('aria-busy', 'true'); submitButton.disabled = true;
    submitButton.textContent = type === 'register' ? 'Создаём аккаунт…' : 'Входим…';
    setFeedback(form, '');
    try {
      if (type === 'register') await accountApi.registerAccount({ gameName, staticId, password });
      else await accountApi.loginAccount({ staticId, password });
      form.querySelectorAll('input[type="password"], [name="password"], [name="passwordConfirm"]').forEach(node => { node.value = ''; });
      actionState.message = ''; actionState.error = false;
      requestRender();
    } catch (error) {
      if (alive) setFeedback(form, errorText(error, type === 'register' ? 'Не удалось создать аккаунт. Проверьте данные и повторите попытку.' : 'Не удалось войти. Проверьте Static ID и пароль.'), true);
    } finally {
      if (alive && form.isConnected) { form.setAttribute('aria-busy', 'false'); submitButton.disabled = false; submitButton.innerHTML = `${type === 'register' ? 'Создать аккаунт' : 'Войти'} ${arrow}`; }
    }
  }

  scope.addEventListener('click', click);
  scope.addEventListener('input', input);
  scope.addEventListener('focusout', focusout);
  scope.addEventListener('change', change);
  scope.addEventListener('submit', submit);
  let unsubscribe = () => {};
  try {
    unsubscribe = accountApi.subscribeAccount(next => {
      if (!alive) return;
      const updated = next?.status ? next : safeState();
      const nextSignature = stateSignature(updated);
      if (nextSignature === signature) return;
      signature = nextSignature;
      state = updated;
      requestRender();
    }) || (() => {});
  } catch { /* The existing page still exposes the friendly failure state. */ }
  if (['/applications', '/account'].includes(path) && isMember(state)) loadApplications();
  if (path === '/applications/reinstatement' && draft?.dismissalType === 'ban_warn') scope.querySelector('[data-tablet-row]')?.querySelectorAll('input').forEach(node => { node.disabled = true; });
  if (draft?.busy) scope.querySelector('[data-portal-form="restoration"]')?.querySelectorAll('input,textarea,select,button').forEach(node => { node.disabled = true; });
  return () => {
    alive = false;
    unsubscribe();
    if (draft) draftViews.get(draft)?.delete(viewRender);
    scope.removeEventListener('click', click);
    scope.removeEventListener('input', input);
    scope.removeEventListener('focusout', focusout);
    scope.removeEventListener('change', change);
    scope.removeEventListener('submit', submit);
    // Passwords live only in the active form and are discarded when it unmounts.
    scope.querySelectorAll('[name="password"], [name="passwordConfirm"]').forEach(node => { node.value = ''; });
  };
}
