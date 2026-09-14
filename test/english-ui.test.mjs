import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function screensIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? screensIn(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

test('screen copy, accessibility text, and placeholders remain English', () => {
  const violations = [];
  const literalKinds = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.JsxText,
  ]);
  for (const path of screensIn(join(root, 'src'))) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (literalKinds.has(node.kind) && /[А-Яа-яЁё]/u.test(node.text)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${relative(root, path)}:${line + 1}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(violations, [], 'Translate built-in UI text; legacy input matching belongs outside screens.');
});
