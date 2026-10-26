import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '../dist/vendor/supabase/supabase.js';
import { createPrivateAuthFetch, createPrivateAuthStorage } from '../dist/auth-privacy.js';

const project = 'https://privacy-test.supabase.co';
const key = 'sb-privacy-test-auth-token';
const fixture = () => ({
  access_token: 'portal-access', refresh_token: 'portal-refresh', expires_in: 3600,
  provider_token: 'fake-discord-access', provider_refresh_token: 'fake-discord-refresh',
  user: { id: '10000000-0000-4000-8000-000000000001', identities: [{ provider: 'discord', identity_data: { sub: '123456789012345678', name: 'Игрок' } }] },
});
function backing(initial = []) {
  const values = new Map(initial), writes = [];
  return { values, writes,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes.push({ key, value }); values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
}
function assertPrivate(value) {
  assert.equal(Object.hasOwn(value, 'provider_token'), false);
  assert.equal(Object.hasOwn(value, 'provider_refresh_token'), false);
  assert.equal(value.access_token, 'portal-access');
  assert.equal(value.refresh_token, 'portal-refresh');
  assert.equal(value.user.identities[0].identity_data.sub, '123456789012345678');
}

test('provider tokens never reach persistent storage; portal session and identity survive', () => {
  const disk = backing();
  const storage = createPrivateAuthStorage(key, () => disk);
  storage.setItem(key, JSON.stringify(fixture()));
  for (const write of disk.writes.filter(write => write.key === key)) assertPrivate(JSON.parse(write.value));
  assertPrivate(JSON.parse(storage.getItem(key)));
  assert.equal(fixture().provider_token, 'fake-discord-access');
});

test('existing sessions are cleaned on read before the SDK receives them', () => {
  const disk = backing([[key, JSON.stringify(fixture())]]);
  const storage = createPrivateAuthStorage(key, () => disk);
  assertPrivate(JSON.parse(storage.getItem(key)));
  assertPrivate(JSON.parse(disk.values.get(key)));
  assert.equal(disk.writes.filter(write => write.key === key).length, 1);
  storage.getItem(key);
  assert.equal(disk.writes.filter(write => write.key === key).length, 1, 'already-clean sessions must not trigger storage events');
});

test('PKCE verifier remains available for redirect completion; sign-out removes the session', () => {
  const disk = backing();
  const storage = createPrivateAuthStorage(key, () => disk);
  storage.setItem(`${key}-code-verifier`, JSON.stringify('pkce-verifier-value'));
  storage.setItem(key, JSON.stringify(fixture()));
  assert.equal(storage.getItem(`${key}-code-verifier`), JSON.stringify('pkce-verifier-value'));
  storage.removeItem(key);
  assert.equal(storage.getItem(key), null);
  assert.equal(disk.values.has(`${key}-code-verifier`), true);
});

test('invalid persisted sessions are discarded; a failed rewrite removes the old session', () => {
  const disk = backing([[key, '{invalid-json']]);
  const storage = createPrivateAuthStorage(key, () => disk);
  assert.equal(storage.getItem(key), null);
  assert.equal(disk.values.has(key), false);
  disk.values.set(key, JSON.stringify(fixture()));
  disk.setItem = () => { throw new Error('quota'); };
  assert.equal(storage.getItem(key), null);
  assert.equal(disk.values.has(key), false);
});

test('disabled browser storage uses an ephemeral sanitized session', () => {
  const storage = createPrivateAuthStorage(key, () => { throw new Error('storage disabled'); });
  storage.setItem(key, JSON.stringify(fixture()));
  assertPrivate(JSON.parse(storage.getItem(key)));
  storage.removeItem(key);
  assert.equal(storage.getItem(key), null);
});

test('a present but unwritable browser storage also falls back to memory', () => {
  const denied = {
    getItem() { throw new Error('storage operation denied'); },
    setItem() { throw new Error('storage operation denied'); },
    removeItem() { throw new Error('storage operation denied'); },
  };
  const storage = createPrivateAuthStorage(key, () => denied);
  storage.setItem(key, JSON.stringify(fixture()));
  assertPrivate(JSON.parse(storage.getItem(key)));
  storage.removeItem(key);
  assert.equal(storage.getItem(key), null);
});

test('Auth token response is stripped before SDK events, with no caching or stale body headers', async () => {
  let observed;
  const request = new Request(`${project}/auth/v1/token?grant_type=pkce`, { method: 'POST', body: 'request' });
  const privateFetch = createPrivateAuthFetch(project, async (input, init) => {
    observed = { input, init };
    return new Response(JSON.stringify(fixture()), { headers: { 'Content-Length': '999', 'Content-Encoding': 'gzip', 'X-Test': 'kept' } });
  });
  const response = await privateFetch(request);
  assert.equal(observed.input, request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.has('Content-Length'), false);
  assert.equal(response.headers.has('Content-Encoding'), false);
  assert.equal(response.headers.get('X-Test'), 'kept');
  assertPrivate(await response.json());
});

test('other endpoints and Auth errors pass through; malformed token success fails closed', async () => {
  for (const url of [`${project}/rest/v1/portal_applications`, 'https://other.supabase.co/auth/v1/token']) {
    const original = new Response('unchanged');
    const privateFetch = createPrivateAuthFetch(project, async () => original);
    assert.equal(await privateFetch(url, { method: 'POST' }), original);
  }
  const denied = new Response('{"error":"invalid_grant"}', { status: 400 });
  assert.equal(await createPrivateAuthFetch(project, async () => denied)(`${project}/auth/v1/token`, { method: 'POST' }), denied);
  const invalid = await createPrivateAuthFetch(project, async () => new Response('invalid secret response'))(`${project}/auth/v1/token`, { method: 'POST' });
  assert.equal(invalid.status, 502);
  assert.equal((await invalid.text()).includes('invalid secret response'), false);
});

test('bundled SDK completes PKCE without provider tokens in returned session, storage or auth events', async () => {
  const disk = backing([[`${key}-code-verifier`, JSON.stringify('fixture-verifier/signin')]]);
  const storage = createPrivateAuthStorage(key, () => disk);
  const events = [];
  let requests = 0;
  const privateFetch = createPrivateAuthFetch(project, async (input, init) => {
    assert.equal(new URL(input).pathname, '/auth/v1/token');
    assert.equal(new URL(input).searchParams.get('grant_type'), 'pkce');
    const payload = JSON.parse(init.body);
    assert.equal(payload.auth_code, 'fixture-authorization-code');
    assert.equal(payload.code_verifier, 'fixture-verifier');
    requests++;
    return new Response(JSON.stringify(fixture()), { headers: { 'Content-Type': 'application/json' } });
  });
  const client = createClient(project, 'fixture-publishable-key', {
    auth: { flowType: 'pkce', storageKey: key, storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: privateFetch },
  });
  const { data: listener } = client.auth.onAuthStateChange((event, session) => { if (session) events.push({ event, session }); });
  const { data, error } = await client.auth.exchangeCodeForSession('fixture-authorization-code');
  assert.equal(error, null);
  assertPrivate(data.session);
  assertPrivate(JSON.parse(disk.values.get(key)));
  assert.equal(disk.values.has(`${key}-code-verifier`), false);
  assert.equal(requests, 1);
  assert.equal(events.some(event => event.event === 'SIGNED_IN'), true);
  for (const event of events) assertPrivate(event.session);
  for (const write of disk.writes.filter(write => write.key === key)) assertPrivate(JSON.parse(write.value));
  listener.subscription.unsubscribe();
  await client.auth.stopAutoRefresh();
});
