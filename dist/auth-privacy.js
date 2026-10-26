const providerTokenKeys = ['provider_token', 'provider_refresh_token'];

function withoutProviderTokens(value) {
  const clean = { ...value };
  for (const key of providerTokenKeys) delete clean[key];
  return clean;
}

// Retain the portal's own session and PKCE verifier, never Discord OAuth tokens.
export function createPrivateAuthStorage(sessionKey, resolveStorage = () => window.localStorage) {
  const memory = new Map();
  let backing;
  try {
    const candidate = resolveStorage();
    if (candidate) {
      const probe = `${sessionKey}-storage-probe-${globalThis.crypto.randomUUID()}`;
      candidate.setItem(probe, '1');
      candidate.removeItem(probe);
      backing = candidate;
    }
  } catch { /* Match the SDK's memory fallback when browser storage is unusable. */ }
  const read = key => backing ? backing.getItem(key) : memory.get(key) ?? null;
  const write = (key, value) => backing ? backing.setItem(key, value) : memory.set(key, value);
  const remove = key => backing ? backing.removeItem(key) : memory.delete(key);
  function cleanSession(value) {
    if (value == null) return null;
    let data;
    try { data = JSON.parse(value); } catch { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return providerTokenKeys.some(key => Object.hasOwn(data, key))
      ? JSON.stringify(withoutProviderTokens(data)) : value;
  }
  return {
    getItem(key) {
      const original = read(key);
      if (key !== sessionKey) return original;
      const clean = cleanSession(original);
      // Migrate sessions left by an older release before the SDK can load them.
      if (clean !== original) {
        try { clean == null ? remove(key) : write(key, clean); }
        catch {
          // If rewriting is impossible, discard the old session rather than reuse its tokens.
          remove(key);
          return null;
        }
      }
      return clean;
    },
    setItem(key, value) {
      const clean = key === sessionKey ? cleanSession(value) : value;
      clean == null ? remove(key) : write(key, clean);
    },
    removeItem: remove,
  };
}

// Filter at the Auth boundary as well: SDK events and cross-tab broadcasts must
// receive only the portal session, not the provider's access/refresh tokens.
export function createPrivateAuthFetch(supabaseUrl, fetcher = (input, init) => globalThis.fetch(input, init)) {
  const tokenUrl = new URL('/auth/v1/token', supabaseUrl);
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const response = await fetcher(input, init);
    if (url.origin !== tokenUrl.origin || url.pathname !== tokenUrl.pathname || method !== 'POST' || !response.ok) return response;
    let data;
    try { data = await response.json(); } catch { /* Fail closed without exposing the response body. */ }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return new Response(JSON.stringify({ error: 'invalid_token_response', error_description: 'Invalid authentication response.' }), {
        status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(withoutProviderTokens(data)), {
      status: response.status, statusText: response.statusText, headers,
    });
  };
}
