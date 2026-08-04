import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const ignoredDirectories = new Set(['node_modules', '.expo', 'dist', 'ios', 'android']);

function sourceFiles(root) {
  const result = [];
  for (const name of readdirSync(root)) {
    if (ignoredDirectories.has(name)) continue;
    const absolute = join(root, name);
    const stat = statSync(absolute);
    if (stat.isDirectory()) result.push(...sourceFiles(absolute));
    else if (sourceExtensions.has(extname(name)) && !name.endsWith('.d.ts')) result.push(absolute);
  }
  return result;
}

function projectPath(absolute) {
  return relative(projectDirectory, absolute).split(sep).join('/');
}

function moduleEdges(file) {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edges = [];

  function record(node, typeOnly = false) {
    if (node && ts.isStringLiteralLike(node)) {
      edges.push({ specifier: node.text, typeOnly });
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      record(node.moduleSpecifier, Boolean(node.importClause?.isTypeOnly));
    } else if (ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier, Boolean(node.isTypeOnly));
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        record(node.arguments[0]);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        record(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return edges;
}

function normalizeTarget(fromFile, specifier) {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith('.')) return projectPath(resolve(dirname(fromFile), specifier));
  return specifier;
}

function featureName(file) {
  return /^src\/features\/([^/]+)/.exec(file)?.[1];
}

test('source imports respect Actum module boundaries', () => {
  const files = [
    ...sourceFiles(join(projectDirectory, 'src')),
    ...sourceFiles(join(projectDirectory, 'scripts')),
  ];
  const violations = [];
  const capabilityOwners = new Map([
    ['@react-native-async-storage/async-storage', 'src/lib/storage.native.ts'],
    ['expo-notifications', 'src/lib/notifications.native.ts'],
    ['expo-haptics', 'src/lib/haptics.ts'],
    ['expo-device', 'src/lib/haptics.ts'],
  ]);

  for (const absolute of files) {
    const from = projectPath(absolute);
    for (const edge of moduleEdges(absolute)) {
      const target = normalizeTarget(absolute, edge.specifier);
      const detail = `${from} -> ${edge.specifier}`;

      if (from.startsWith('src/domain/') && !target.startsWith('src/domain/')) {
        violations.push(`domain must stay platform-independent: ${detail}`);
      }
      if (
        from.startsWith('src/lib/') &&
        /^src\/(app|components|features|screens|state)\//.test(target)
      ) {
        violations.push(`lib cannot depend on presentation or application state: ${detail}`);
      }
      if (
        from.startsWith('src/shared/') &&
        /^src\/(app|components|features|screens|state|lib)\//.test(target)
      ) {
        violations.push(`shared helpers cannot depend on features, state, or adapters: ${detail}`);
      }
      if (
        from.startsWith('src/state/') &&
        /^src\/(app|components|features|screens)\//.test(target)
      ) {
        violations.push(`state cannot depend on presentation features: ${detail}`);
      }
      if (
        (from.startsWith('src/') && target.startsWith('scripts/')) ||
        (from.startsWith('scripts/') && target.startsWith('src/'))
      ) {
        violations.push(`client and local gateway cannot import each other: ${detail}`);
      }

      const owner = capabilityOwners.get(edge.specifier);
      if (owner && from !== owner) {
        violations.push(`platform capability ${edge.specifier} belongs to ${owner}: ${detail}`);
      }
      if (
        from.startsWith('src/') &&
        (edge.specifier.startsWith('node:') || ['fs', 'path', 'readline'].includes(edge.specifier))
      ) {
        violations.push(`Node built-ins are server-only: ${detail}`);
      }

      const fromFeature = featureName(from);
      const targetFeature = featureName(target);
      if (targetFeature && fromFeature !== targetFeature) {
        if (target !== `src/features/${targetFeature}`) {
          violations.push(`feature consumers must use the public index: ${detail}`);
        }
      }
      if (
        fromFeature &&
        fromFeature === targetFeature &&
        edge.specifier.startsWith('@/features/')
      ) {
        violations.push(`feature internals must use relative imports: ${detail}`);
      }
      if (from.startsWith('src/features/') && target.startsWith('src/app/')) {
        violations.push(`features cannot depend on Router entrypoints: ${detail}`);
      }
      if (!from.startsWith('src/state/') && target.startsWith('src/state/')) {
        violations.push(`state consumers must use the public @/state index: ${detail}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('Expo Router leaf routes remain thin feature entrypoints', () => {
  const appDirectory = join(projectDirectory, 'src', 'app');
  const routeFiles = sourceFiles(appDirectory).filter(
    (file) => !basename(file).startsWith('_layout.'),
  );

  assert.ok(routeFiles.length > 0, 'at least one Expo Router leaf route must exist');
  for (const routeFile of routeFiles) {
    const route = projectPath(routeFile);
    const source = readFileSync(routeFile, 'utf8').trim();
    const match = /^export \{ default \} from '@\/features\/([a-z0-9-]+)';$/u.exec(source);
    assert.ok(match, `${route} must be a single public feature export`);
    const publicIndex = join(projectDirectory, 'src', 'features', match[1], 'index.ts');
    assert.ok(
      existsSync(publicIndex) && statSync(publicIndex).isFile(),
      `${route} must target a feature with a public index.ts`,
    );
  }
});
