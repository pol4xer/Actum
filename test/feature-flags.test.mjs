import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./typescript-extension-loader.mjs', import.meta.url));

const { resolveActumMode } = await import('@/config/feature-flags');

test('Actum mode is fail-closed for missing and unknown values', () => {
  assert.equal(resolveActumMode(undefined, true), 'production');
  assert.equal(resolveActumMode('', true), 'production');
  assert.equal(resolveActumMode('dev', true), 'production');
  assert.equal(resolveActumMode('Development', true), 'production');
});

test('production mode never exposes developer controls', () => {
  assert.equal(resolveActumMode('production', true), 'production');
  assert.equal(resolveActumMode('production', false), 'production');
});

test('development requires both the exact value and a development bundle', () => {
  assert.equal(resolveActumMode('development', true), 'development');
  assert.equal(resolveActumMode('development', false), 'production');
});
