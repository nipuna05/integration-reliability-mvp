import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('dashboard script has no syntax errors (a broken script blanks the whole page)', () => {
  assert.doesNotThrow(() => new vm.Script(script));
});

test('every element the script looks up by id exists in the page', () => {
  const ids = new Set([...script.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});
