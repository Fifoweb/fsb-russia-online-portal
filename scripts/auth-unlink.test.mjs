import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '../dist/vendor/supabase/supabase.js';
import { unlinkDiscordIdentity } from '../dist/discord-unlink.js';
import { createPrivateAuthFetch } from '../dist/auth-privacy.js';

const owner = '10000000-0000-4000-8000-000000000001';
const emailId = '20000000-0000-4000-8000-000000000002';
const discordId = '30000000-0000-4000-8000-000000000003';
const email = { identity_id: emailId, user_id: owner, provider: 'email', identity_data: { sub: owner } };
const discord = { identity_id: discordId, user_id: owner, provider: 'discord', identity_data: { sub: '123456789012345678', user_name: 'fixture.discord' } };
const user = identities => ({ id: owner, aud: 'authenticated', role: 'authenticated', app_metadata: { portal_registered: true, static_id: '000123', game_name: 'Иван Петров' }, identities: structuredClone(identities) });
const rejectCode = code => error => error.code === code && !/private|secret|database/i.test(error.message);

function fixture({ identities = [email, discord], deletion = 'ok', readFailureAfterDelete = false, switchOwner = false } = {}) {
  let record = user(identities), refreshed = 0;
  const removed = [], calls = [];
  const auth = {
    getUser: async () => {
      if (readFailureAfterDelete && calls.length) return { data: { user: null }, error: { status: 503 } };
      const result = structuredClone(record);
      if (switchOwner && calls.length) result.id = '90000000-0000-4000-8000-000000000009';
      return { data: { user: result }, error: null };
    },
    unlinkIdentity: async identity => {
      calls.push(identity.identity_id);
      if (deletion !== 'denied') {
        record.identities = record.identities.filter(item => item.identity_id !== identity.identity_id);
        removed.push(identity.identity_id);
      }
      return { error: deletion === 'ok' ? null : { status: deletion === 'denied' ? 403 : 503, message: 'private server detail' } };
    },
    refreshSession: async () => { refreshed++; return { data: {}, error: null }; },
  };
  return { auth, removed, calls, record: () => record, refreshed: () => refreshed };
}

test('removes Discord only, retains password identity and immutable portal data', async () => {
  const f = fixture();
  assert.deepEqual(await unlinkDiscordIdentity(f.auth, owner), { unlinked: true });
  assert.deepEqual(f.removed, [discordId]);
  assert.deepEqual(f.record().identities, [email]);
  assert.equal(f.record().app_metadata.static_id, '000123');
  assert.equal(f.refreshed(), 1);
});
test('already unlinked is an idempotent no-op', async () => {
  const f = fixture({ identities: [email] });
  assert.deepEqual(await unlinkDiscordIdentity(f.auth, owner), { unlinked: false });
  assert.deepEqual(f.calls, []);
  assert.equal(f.refreshed(), 0);
});
test('refuses to remove the last login identity or proceed without a password identity', async () => {
  for (const identities of [[discord], [discord, { ...email, provider: 'google' }]]) {
    const f = fixture({ identities });
    await assert.rejects(unlinkDiscordIdentity(f.auth, owner), rejectCode('discord_unlink_unavailable'));
    assert.deepEqual(f.calls, []);
  }
});
test('cannot act for another account or delete malformed identity identifiers', async () => {
  const f = fixture();
  await assert.rejects(unlinkDiscordIdentity(f.auth, 'another-user'), rejectCode('authentication_required'));
  assert.deepEqual(f.calls, []);
  for (const value of [undefined, '', '../email']) {
    const malformed = fixture({ identities: [email, { ...discord, identity_id: value }] });
    await assert.rejects(unlinkDiscordIdentity(malformed.auth, owner), rejectCode('discord_unlink_unavailable'));
    assert.deepEqual(malformed.calls, []);
  }
});
test('server denial keeps the binding and returns a safe error', async () => {
  const f = fixture({ deletion: 'denied' });
  await assert.rejects(unlinkDiscordIdentity(f.auth, owner), rejectCode('discord_unlink_failed'));
  assert.equal(f.record().identities.length, 2);
});
test('lost delete response is reconciled with fresh Auth state', async () => {
  const f = fixture({ deletion: 'lost' });
  assert.deepEqual(await unlinkDiscordIdentity(f.auth, owner), { unlinked: true });
  assert.deepEqual(f.removed, [discordId]);
});
test('does not claim success if the final user check fails or the account changes', async () => {
  for (const [options, code] of [[{ readFailureAfterDelete: true }, 'discord_unlink_unconfirmed'], [{ switchOwner: true }, 'authentication_required']]) {
    const f = fixture(options);
    await assert.rejects(unlinkDiscordIdentity(f.auth, owner), rejectCode(code));
  }
});
test('all Discord identities can be removed while email remains intact', async () => {
  const second = { ...discord, identity_id: '40000000-0000-4000-8000-000000000004' };
  const f = fixture({ identities: [email, discord, second] });
  assert.deepEqual(await unlinkDiscordIdentity(f.auth, owner), { unlinked: true });
  assert.deepEqual(f.calls, [discordId, second.identity_id]);
  assert.deepEqual(f.record().identities, [email]);
});

test('bundled Supabase SDK uses authenticated DELETE and refreshes its cached identity list', async () => {
  const project = 'https://unlink-fixture.supabase.co';
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })}.${Buffer.from('fixture-signature').toString('base64url')}`;
  let record = user([email, discord]);
  const deletions = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), method = init.method || 'GET';
    const headers = new Headers(init.headers);
    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      assert.equal(headers.get('Authorization'), `Bearer ${token}`);
      return Response.json(record);
    }
    if (url.pathname.startsWith('/auth/v1/user/identities/') && method === 'DELETE') {
      assert.equal(headers.get('Authorization'), `Bearer ${token}`);
      assert.equal(url.pathname, `/auth/v1/user/identities/${discordId}`);
      deletions.push(url.pathname);
      record = user([email]);
      return Response.json({});
    }
    assert.equal(url.pathname, '/auth/v1/token');
    assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
    return Response.json({ access_token: token, refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'bearer', provider_token: 'fixture-provider-token', user: record });
  };
  const client = createClient(project, 'fixture-publishable-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: createPrivateAuthFetch(project, fetcher) } });
  assert.equal((await client.auth.setSession({ access_token: token, refresh_token: 'fixture-refresh' })).error, null);
  assert.deepEqual(await unlinkDiscordIdentity(client.auth, owner), { unlinked: true });
  const { data } = await client.auth.getSession();
  assert.deepEqual(data.session.user.identities, [email]);
  assert.equal(Object.hasOwn(data.session, 'provider_token'), false);
  assert.equal(data.session.user.app_metadata.static_id, '000123');
  assert.equal(deletions.length, 1);
  await client.auth.stopAutoRefresh();
});
