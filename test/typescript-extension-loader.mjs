import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const sourceExtensions = ['.ts', '.tsx', '.mjs', '.js'];
const platform = process.env.ACTUM_TEST_PLATFORM;

function resolveSourceUrl(baseUrl) {
  const basePath = fileURLToPath(baseUrl);
  const platformSuffixes = platform
    ? sourceExtensions.map((extension) => `.${platform}${extension}`)
    : [];
  const fileCandidates = [
    basePath,
    ...platformSuffixes.map((suffix) => `${basePath}${suffix}`),
    ...sourceExtensions.map((extension) => `${basePath}${extension}`),
    ...platformSuffixes.map((suffix) => `${basePath}/index${suffix}`),
    ...sourceExtensions.map((extension) => `${basePath}/index${extension}`),
  ];

  for (const candidate of fileCandidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return undefined;
}

export async function resolve(specifier, context, nextResolve) {
  let baseUrl;
  if (specifier.startsWith('@/')) {
    baseUrl = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
  } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    baseUrl = new URL(specifier, context.parentURL);
  }

  const sourceUrl = baseUrl ? resolveSourceUrl(baseUrl) : undefined;
  if (sourceUrl) return nextResolve(sourceUrl, context);
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = await readFile(new URL(url), 'utf8');
    const transpiled = ts.transpileModule(source, {
      fileName: url,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    });
    return { format: 'module', shortCircuit: true, source: transpiled.outputText };
  }
  return nextLoad(url, context);
}
