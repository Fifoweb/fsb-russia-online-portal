import { createClient } from './vendor/supabase/supabase.js';
import { appConfig } from './data/app-config.js';
import { createPrivateAuthFetch, createPrivateAuthStorage } from './auth-privacy.js';
import { discordCallbackUrl } from './auth-redirect.js';
import { unlinkDiscordIdentity } from './discord-unlink.js';

const configured = Boolean(appConfig.supabaseUrl && appConfig.publishableKey);
const authStorageKey = configured ? `sb-${new URL(appConfig.supabaseUrl).hostname.split('.')[0]}-auth-token` : null;
const client = configured ? createClient(appConfig.supabaseUrl, appConfig.publishableKey, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
    storageKey: authStorageKey, storage: createPrivateAuthStorage(authStorageKey) },
  global: { fetch: createPrivateAuthFetch(appConfig.supabaseUrl) },
}) : null;
const listeners = new Set();
let state = { status: 'loading', profile: null, discord: null, error: null, configured };
let initialized = false, refreshing = null, lastSignature = '';
let unlinking = null;
const messages = {
  authentication_required: 'Войдите в свой аккаунт.',
  invalid_credentials: 'Неверный Static ID или пароль.',
  registration_unavailable: 'Не удалось зарегистрироваться. Возможно, этот никнейм или Static ID уже занят.',
  invalid_game_name: 'Укажите имя и фамилию персонажа: два слова буквами.',
  invalid_static_id: 'Static ID должен состоять из цифр.',
  invalid_password: 'Пароль должен содержать от 8 до 128 символов.',
  evidence_links_only: 'Доказательства принимаются только по ссылкам.',
  discord_link_required: 'Сначала привяжите Discord к аккаунту.',
  discord_identity_changed: 'Discord аккаунта изменился. Обратитесь к руководству по сохранённой заявке.',
  discord_unlink_unavailable: 'Не удалось безопасно отвязать Discord. Войдите по Static ID и паролю или обратитесь к руководству.',
  discord_unlink_failed: 'Discord пока не отвязан. Повторите попытку немного позже.',
  discord_unlink_unconfirmed: 'Не удалось проверить отвязку Discord. Обновите кабинет и проверьте статус перед повторной попыткой.',
  rate_limited: 'Слишком много попыток. Подождите несколько минут и попробуйте снова.',
  origin_not_allowed: 'Адрес сайта ещё не подключён к сервису заявок.',
  idempotency_conflict: 'Эта заявка уже сохранена с другими данными. Обновите список заявок.',
  service_unavailable: 'Сервис временно недоступен. Попробуйте позднее.',
  application_not_found: 'Заявка не найдена.',
  invalid_transfer_fields: 'Проверьте должность и данные перевода.',
  invalid_transfer_rank: 'Выберите текущий ранг из таблицы переводов.',
  transfer_rank_not_in_table: 'Такого ранга нет в таблице для выбранной структуры.',
  invalid_transfer_structure: 'Выберите структуру, из которой переводитесь.',
  invalid_passport_number: 'Номер игрового паспорта должен состоять из цифр.',
  invalid_internal_departments: 'Выберите текущий и другой желаемый отдел.',
  invalid_transfer_reason: 'Укажите причину перевода, не длиннее 1000 символов.',
  transfer_consent_required: 'Подтвердите отправку игровых данных руководству в Discord.',
};
function fail(code, message) { const error = new Error(message || messages[code] || 'Проверьте поля формы и попробуйте ещё раз.'); error.code = code; return error; }
export function getAccountState() { return state; }
export function subscribeAccount(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function publish(next) {
  state = { ...state, ...next };
  const signature = JSON.stringify(state);
  if (signature === lastSignature) return;
  lastSignature = signature;
  for (const listener of listeners) { try { listener(state); } catch { /* one view must not break the session */ } }
}
async function session() {
  if (!client) throw fail('service_unavailable');
  const { data, error } = await client.auth.getSession();
  if (error) throw fail('authentication_required');
  return data.session;
}
async function endpoint(name, body, signedIn = true) {
  if (!configured) throw fail('service_unavailable');
  const active = signedIn ? await session() : null;
  if (signedIn && !active) throw fail('authentication_required');
  let response;
  try {
    response = await fetch(`${appConfig.functionsBaseUrl}/${name}`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', apikey: appConfig.publishableKey,
        ...(active ? { Authorization: `Bearer ${active.access_token}` } : {}),
      }, body: JSON.stringify(body),
    });
  } catch { throw fail('network_error', 'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.'); }
  let result;
  try { result = await response.json(); } catch { throw fail('service_unavailable'); }
  if (!response.ok || result.error) {
    const error = fail(result.error?.code || 'service_unavailable');
    error.status = response.status;
    throw error;
  }
  return result;
}
async function refreshAccount() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const active = await session();
      if (!active) { publish({ status: 'anonymous', profile: null, discord: null, error: null }); return state; }
      const result = await endpoint('portal-auth', { action: 'me' });
      publish({ status: result.discord ? 'linked' : 'registered', profile: result.profile, discord: result.discord || null, error: null });
    } catch (error) {
      if (error.code === 'authentication_required') publish({ status: 'anonymous', profile: null, discord: null, error: 'Сессия завершена. Войдите ещё раз.' });
      else publish({ status: 'error', profile: null, discord: null, error: error.message });
    }
    return state;
  })();
  try { return await refreshing; } finally { refreshing = null; }
}
export async function initAccount() {
  if (initialized) return refreshAccount();
  initialized = true;
  if (!client) { publish({ status: 'error', error: 'Сервис аккаунтов ещё не настроен.' }); return state; }
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') publish({ status: 'anonymous', profile: null, discord: null, error: null });
    else if (['SIGNED_IN', 'USER_UPDATED', 'TOKEN_REFRESHED'].includes(event)) queueMicrotask(() => { void refreshAccount(); });
  });
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  let callbackError = null;
  if (code || oauthError) {
    let returnPath = '#/account';
    try { const saved = sessionStorage.getItem('portal-discord-return'); if (/^#\/(applications(?:\/(?:reinstatement|transfer|internal-transfer))?|account)(?:\?.*)?$/.test(saved || '')) returnPath = saved; sessionStorage.removeItem('portal-discord-return'); } catch { /* storage may be disabled */ }
    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) callbackError = 'Не удалось завершить вход через Discord. Попробуйте привязать аккаунт ещё раз.';
    } else callbackError = 'Привязка Discord отменена или не завершена.';
    for (const key of ['code', 'error', 'error_code', 'error_description', 'auth_callback']) url.searchParams.delete(key);
    url.hash = returnPath.slice(1);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  await refreshAccount();
  if (callbackError) publish({ error: callbackError });
  return state;
}
async function acceptSession(result) {
  if (!result.session?.access_token || !result.session?.refresh_token) throw fail('service_unavailable');
  const { error } = await client.auth.setSession(result.session);
  if (error) throw fail('authentication_required');
  await refreshAccount();
  if (!state.profile) throw fail('service_unavailable', state.error || undefined);
  return state;
}
export async function registerAccount({ gameName, staticId, password }) {
  return acceptSession(await endpoint('portal-auth', { action: 'register', gameName, staticId, password }, false));
}
export async function loginAccount({ staticId, password }) {
  return acceptSession(await endpoint('portal-auth', { action: 'login', staticId, password }, false));
}
export async function logoutAccount() {
  if (client) { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw fail('service_unavailable'); }
  publish({ status: 'anonymous', profile: null, discord: null, error: null });
}
export function unlinkDiscord() {
  if (unlinking) return unlinking;
  unlinking = (async () => {
    if (!(await session()) || !state.profile) throw fail('authentication_required');
    const userId = state.profile.user_id;
    let failureCode;
    try { await unlinkDiscordIdentity(client.auth, userId); }
    catch (error) { failureCode = error.code || 'discord_unlink_unconfirmed'; }
    // Do not reuse a profile request that began before the identity was removed.
    if (refreshing) await refreshing;
    const updated = await refreshAccount();
    if (updated.profile?.user_id === userId && updated.status === 'registered' && !updated.discord) return updated;
    if (updated.status === 'anonymous' || updated.profile?.user_id && updated.profile.user_id !== userId) throw fail('authentication_required');
    throw fail(failureCode || 'discord_unlink_unconfirmed');
  })().finally(() => { unlinking = null; });
  return unlinking;
}
export async function linkDiscord(returnPath) {
  if (!(await session())) throw fail('authentication_required');
  try { sessionStorage.setItem('portal-discord-return', ['#/applications/transfer','#/applications/internal-transfer'].includes(returnPath) ? returnPath : window.location.hash.startsWith('#/applications') ? window.location.hash : '#/applications/reinstatement'); } catch { /* PKCE SDK will report if storage unavailable */ }
  // PKCE verifier belongs to this origin. Return to the same origin and project
  // path on GitHub Pages; Supabase's exact allowlist validates the destination.
  const { error } = await client.auth.linkIdentity({ provider: 'discord', options: { redirectTo: discordCallbackUrl(window.location.href) } });
  if (error) throw fail('discord_not_configured', 'Не удалось открыть вход через Discord. Попробуйте позднее или сообщите руководству.');
}

function proofLinks(proof) {
  if ((proof?.files?.length || 0) || (proof?.paths?.length || 0)) throw fail('evidence_links_only');
  const urls = [...(proof?.urls || [])].filter(Boolean).map(value => {
    try { const url = new URL(value); if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.href.length > 300) throw Error(); return url.href; }
    catch { throw fail('invalid_url', 'Укажите полную HTTPS ссылку без логина и пароля, не длиннее 300 символов.'); }
  });
  return { paths: [], urls };
}
export async function submitRestoration(input) {
  let payload;
  try {
    // Reject legacy file payloads before any auth or submission request.
    const rankProof = proofLinks(input.rankProof);
    const suppliedTablet = proofLinks(input.tabletProof);
    const tabletProof = input.dismissalType === 'regular' ? suppliedTablet : { paths: [], urls: [] };
    if (rankProof.urls.length + tabletProof.urls.length > appConfig.maxFiles) throw fail('evidence_count', 'Можно добавить не более трёх ссылок.');
    await refreshAccount();
    if (!state.profile) throw fail('authentication_required');
    if (!state.discord) throw fail('discord_link_required');
    const requestId = input.idempotencyKey;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) throw fail('invalid_request');
    payload = { action: 'submit', idempotencyKey: requestId, dismissalType: input.dismissalType,
      approvalUrl: input.dismissalType === 'ban_warn' ? input.approvalUrl : null,
      reason: input.reason, previousRank: input.previousRank, rankProof, tabletProof };
  } catch (error) {
    error.submissionMayExist = false; // No submit request has started in this attempt.
    throw error;
  }
  try { return await endpoint('portal-submit', payload); }
  catch (error) {
    // Definitive validation/auth/rate errors happen before the new application is saved.
    // A transport/5xx/conflicting-key error remains ambiguous and must keep its checkpoint.
    if (error.status >= 400 && error.status < 500 && error.code !== 'idempotency_conflict') error.submissionMayExist = false;
    throw error;
  }
}
export async function retryApplication(applicationId) { return endpoint('portal-submit', { action: 'retry', applicationId }); }
export async function listMyApplications() {
  if (!(await session())) return [];
  const { data, error } = await client.from('portal_applications').select('id,created_at,delivery_status,delivery_error_code,snapshot').order('created_at', { ascending: false }).limit(20);
  if (error) throw fail('service_unavailable');
  return data || [];
}
export async function findMyApplicationByKey(idempotencyKey) {
  if (!(await session())) throw fail('authentication_required');
  const { data, error } = await client.from('portal_applications')
    .select('id,created_at,delivery_status,delivery_error_code,snapshot')
    .eq('idempotency_key', idempotencyKey).maybeSingle();
  if (error) throw fail('service_unavailable');
  return data || null;
}

export async function submitTransfer(input) {
  try { return await endpoint('portal-transfer', { action: 'submit', ...input }); }
  catch (error) {
    if (error.status >= 400 && error.status < 500 && error.code !== 'idempotency_conflict') error.submissionMayExist = false;
    throw error;
  }
}
export async function retryTransfer(applicationId) { return endpoint('portal-transfer', { action: 'retry', applicationId }); }
export async function listMyTransfers() {
  if (!(await session())) return [];
  const { data, error } = await client.from('portal_transfer_applications').select('id,created_at,delivery_status,delivery_error_code,snapshot').order('created_at', { ascending: false }).limit(20);
  if (error) throw fail('service_unavailable');
  return data || [];
}
export async function findMyTransferByKey(idempotencyKey) {
  if (!(await session())) throw fail('authentication_required');
  const { data, error } = await client.from('portal_transfer_applications').select('id,created_at,delivery_status,delivery_error_code,snapshot').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (error) throw fail('service_unavailable');
  return data || null;
}

export async function submitInternalTransfer(input) {
  try { return await endpoint('portal-internal-transfer', { action: 'submit', ...input }); }
  catch (error) {
    if (error.status >= 400 && error.status < 500 && error.code !== 'idempotency_conflict') error.submissionMayExist = false;
    throw error;
  }
}
export async function retryInternalTransfer(applicationId) { return endpoint('portal-internal-transfer', { action: 'retry', applicationId }); }
export async function listMyInternalTransfers() {
  if (!(await session())) return [];
  const { data, error } = await client.from('portal_internal_transfers').select('id,created_at,delivery_status,delivery_error_code,snapshot').order('created_at', { ascending: false }).limit(20);
  if (error) throw fail('service_unavailable');
  return data || [];
}
export async function findMyInternalTransferByKey(idempotencyKey) {
  if (!(await session())) throw fail('authentication_required');
  const { data, error } = await client.from('portal_internal_transfers').select('id,created_at,delivery_status,delivery_error_code,snapshot').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (error) throw fail('service_unavailable');
  return data || null;
}
