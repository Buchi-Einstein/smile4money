/**
 * Minimal ambient declarations for the two Node built-ins used by the test
 * suite (`node:fs`, `node:path`).
 *
 * `@types/node` is deliberately **not** a dependency of this package — the
 * production source is browser-only and does not need it. Only
 * `tests/mobile-responsive.test.tsx` reads files from disk, and adding a
 * full type package for two one-line calls would be a poor trade. These
 * declarations cover exactly what that file uses.
 *
 * If `@types/node` is ever added, delete this file — it would then conflict
 * with the real declarations.
 */

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:path' {
  export function resolve(...pathSegments: string[]): string;
}

/** Present in CommonJS/ESM-transpiled Node contexts; used for test file paths. */
declare const __dirname: string;
