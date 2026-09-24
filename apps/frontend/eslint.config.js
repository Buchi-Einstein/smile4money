import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Custom rule: no-missing-css-imports
//
// Fail CI when a component imports a CSS file that does not exist on disk.
// This replaces the `css: false` suppression that was previously in
// vite.config.ts, which silently swallowed missing-file errors in tests.
//
// Implementation note: ESLint v9 no longer supports --rulesdir, so the rule
// is defined inline here inside the flat-config file.
// ---------------------------------------------------------------------------
const noMissingCssImports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow imports of CSS files that do not exist on disk',
    },
    schema: [],
    messages: {
      missingCss: "CSS file '{{importPath}}' does not exist.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;
        if (typeof importPath !== 'string') return;
        if (!importPath.endsWith('.css')) return;

        // Resolve the import relative to the importing file
        const filePath = context.getFilename?.() ?? context.filename ?? '';
        if (!filePath || filePath === '<input>') return;

        const dir = dirname(fileURLToPath(new URL('file://' + resolve(filePath))));
        const resolvedCss = resolve(dir, importPath);

        if (!existsSync(resolvedCss)) {
          context.report({
            node: node.source,
            messageId: 'missingCss',
            data: { importPath },
          });
        }
      },
    };
  },
};

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // ── Base recommended rules ────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript + React source files ──────────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        // Vitest globals
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      // Inline plugin — no package required
      local: {
        rules: {
          'no-missing-css-imports': noMissingCssImports,
        },
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Guard: fail CI when a component imports a CSS file that doesn't exist.
      // This is the lint-side complement to removing `css: false` from
      // vite.config.ts — together they ensure missing CSS imports are caught
      // both at lint time and at Vitest transform time.
      'local/no-missing-css-imports': 'error',
    },
  },

  // ── Ignore patterns ───────────────────────────────────────────────────────
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
];
