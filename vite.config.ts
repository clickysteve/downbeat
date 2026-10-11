import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths: the build works at the domain root and under /<repo>/.
  base: './',
  server: { port: 5207 },
  test: { include: ['tests/unit/**/*.test.ts'] },
} as never);
