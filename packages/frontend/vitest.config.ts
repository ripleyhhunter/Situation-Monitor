import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror the SvelteKit aliases from svelte.config.js so pure-logic
    // modules (stores, utils, services) are testable outside the app.
    alias: {
      $components: src('lib/components'),
      $stores: src('lib/stores'),
      $services: src('lib/services'),
      $utils: src('lib/utils'),
      $types: src('lib/types'),
      $lib: src('lib'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
