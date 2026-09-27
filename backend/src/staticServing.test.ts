import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('single-service deployment', () => {
  it('fails startup when a moved frontend path no longer exists', async () => {
    vi.stubEnv('SERVE_STATIC_DIR', '/nonexistent/metro3d-moved-frontend');
    vi.resetModules();
    const { buildApp } = await import('./app.js');
    await expect(buildApp({ logger: false })).rejects.toThrow('refusing incomplete deployment');
  });

  it('serves the page and assets alongside health from the configured root', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro3d-static-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>metro3d fixture</html>');
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("fixture");');
    vi.stubEnv('SERVE_STATIC_DIR', dir);
    vi.resetModules();
    const { buildApp } = await import('./app.js');
    const app = await buildApp({ logger: false });
    try {
      expect((await app.inject('/')).body).toContain('metro3d fixture');
      expect((await app.inject('/app.js')).statusCode).toBe(200);
      expect((await app.inject('/api/health')).json().data.status).toBe('healthy');
      expect((await app.inject('/%2e%2e/package.json')).statusCode).toBe(404);
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
