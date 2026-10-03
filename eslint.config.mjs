// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';

/**
 * ESLint decides what the code MEANS. Prettier decides what it LOOKS LIKE.
 *
 * They are kept apart, which is what Prettier itself recommends: running the
 * formatter as an ESLint rule is slower, fills the editor with red squiggles
 * over things that fix themselves on save, and adds a layer that can break.
 * `eslint-config-prettier` only turns OFF the stylistic rules that would argue
 * with the formatter, and it goes last because that is how it works. This repo
 * used to run `plugin:prettier/recommended`; it does not any more, and the
 * scaffold `samble init` writes never did.
 *
 * Flat config, because `.eslintrc` was removed in ESLint 10. This file and the
 * one in the scaffold are deliberately the same shape — a framework whose own
 * tooling disagrees with what it generates teaches the wrong thing twice.
 */
export default defineConfig([
  globalIgnores([
    'dist',
    '.bytecode',
    'types',
    'build',
    'coverage',
    'logs',
    // Projects the CLI scaffolds during the tests: they resolve against their
    // own node_modules and are not ours to lint.
    'test/.generated',
    'test/.generated-dialects',
    // Build helpers in plain JS: not TypeScript, and not what this config is
    // parameterised for.
    'scripts',
  ]),

  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],

    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // The framework hands back whatever an endpoint returned and takes
      // whatever an author logs. `unknown` at those seams would only be cast
      // away, which is the same `any` with more ceremony.
      '@typescript-eslint/no-explicit-any': 'off',

      // Declaration merging is how an application fills in `SambleAuth`, and it
      // only works through a namespace. Ambient declarations stay allowed; a
      // namespace used as a value does not.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],

      // `Function` stays allowed, and only `Function`. A module's entities and
      // migrations ARE classes, and that is how TypeORM types them
      // (`entities: (Function | string | EntitySchema)[]`) — narrowing it here
      // would mean casting at every seam where samble hands a list back.
      // Everything the v8 split kept banning (`{}`, `Object`, `String`) still
      // is, which is where the rules earn their keep.
      '@typescript-eslint/no-unsafe-function-type': 'off',

      // `interface Permissions extends PermissionsOf<typeof mod> {}` is empty
      // BECAUSE the keys come from the `extends`.
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],

      // Types are the return type. Writing them twice is how they drift.
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],

      // The type-aware pair worth what type information costs. A promise nobody
      // awaited is work that silently did not happen — in a framework, in
      // somebody else's request.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  {
    // `require()` is the mechanism here, not a shortcut: these files load the
    // APPLICATION's own files by path at run time — a module's endpoints, its
    // entities, the entry point `samble build` compiles. An `import` is resolved
    // when the program is compiled, which is exactly what none of this can do.
    files: [
      'lib/cli/*.ts',
      'lib/core/pattern-resolver.ts',
      'lib/modules/module-files.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    // The suite asserts on shapes the framework deliberately allows and on
    // files the generators just wrote, so it reaches for `require` and for
    // casts that production code should not.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  prettier,
]);
