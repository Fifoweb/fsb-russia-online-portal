// Keep OAuth/PKCE on the initiating origin, including GitHub Pages project paths.
export function discordCallbackUrl(currentUrl) {
  const base = new URL('./', currentUrl);
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid portal origin');
  base.search = '?auth_callback=discord';
  base.hash = '';
  return base.href;
}
