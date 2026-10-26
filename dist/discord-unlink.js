// Unlink only Discord identities from the current, freshly verified portal user.
// All requests use the user's own Auth session; no administrative key is involved.
const failure = code => Object.assign(new Error(code), { code });
const authFailure = error => error?.status === 401 || ['session_not_found', 'refresh_token_not_found'].includes(error?.code);

export async function unlinkDiscordIdentity(auth, expectedUserId) {
  async function currentUser() {
    let result;
    try { result = await auth.getUser(); }
    catch { throw failure('discord_unlink_unconfirmed'); }
    if (result.error) throw failure(authFailure(result.error) ? 'authentication_required' : 'discord_unlink_unconfirmed');
    const user = result.data?.user;
    if (!expectedUserId || !user || user.id !== expectedUserId || user.is_anonymous || user.app_metadata?.portal_registered !== true) throw failure('authentication_required');
    if (!Array.isArray(user.identities)) throw failure('discord_unlink_unconfirmed');
    return user;
  }
  const user = await currentUser();
  const discord = user.identities.filter(identity => identity.provider === 'discord');
  if (!discord.length) return { unlinked: false };
  // Preserve the existing password identity even if other OAuth providers exist.
  if (!user.identities.some(identity => identity.provider === 'email')) throw failure('discord_unlink_unavailable');
  if (discord.some(identity => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(identity.identity_id || '') || identity.user_id !== expectedUserId)) throw failure('discord_unlink_unavailable');
  let deletionError;
  for (const identity of discord) {
    try {
      const { error } = await auth.unlinkIdentity(identity);
      if (error) { deletionError = error; break; }
    } catch (error) { deletionError = error; break; }
  }
  // Replace the SDK's cached identity list and notify other tabs where possible.
  // The following fresh user request, rather than this refresh result, confirms deletion.
  try { await auth.refreshSession(); } catch { /* A fresh getUser still confirms server state. */ }
  const updated = await currentUser();
  if (updated.identities.some(identity => identity.provider === 'discord')) throw failure(authFailure(deletionError) ? 'authentication_required' : 'discord_unlink_failed');
  if (!updated.identities.some(identity => identity.provider === 'email')) throw failure('discord_unlink_unconfirmed');
  return { unlinked: true };
}
