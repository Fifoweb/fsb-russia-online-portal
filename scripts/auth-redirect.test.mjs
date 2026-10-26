import test from 'node:test';
import assert from 'node:assert/strict';
import {discordCallbackUrl} from '../dist/auth-redirect.js';
test('GitHub Pages callback retains both origin and project path',()=>{
  assert.equal(discordCallbackUrl('https://example.github.io/fsb-russia-online/#/applications/transfer'),'https://example.github.io/fsb-russia-online/?auth_callback=discord');
  assert.equal(discordCallbackUrl('https://example.github.io/fsb-russia-online/index.html#/account'),'https://example.github.io/fsb-russia-online/?auth_callback=discord');
});
test('old host and local preview keep PKCE on their own origin',()=>{
  assert.equal(discordCallbackUrl('https://fsb-russia-online.pages.dev/#/account'),'https://fsb-russia-online.pages.dev/?auth_callback=discord');
  assert.equal(discordCallbackUrl('http://127.0.0.1:4193/#/account'),'http://127.0.0.1:4193/?auth_callback=discord');
});
test('prior OAuth codes, errors and fragment do not leak into another callback',()=>{
  assert.equal(discordCallbackUrl('https://example.github.io/portal/?code=old&error=test#/account'),'https://example.github.io/portal/?auth_callback=discord');
  assert.throws(()=>discordCallbackUrl('file:///tmp/index.html'));
});
