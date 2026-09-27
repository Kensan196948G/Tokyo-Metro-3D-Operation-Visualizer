import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateIdentifiers, validateRuntime, verifyGate, validateArchive, serviceDropin, verifyServiceDropin, RUNTIME_CHECK } from './deploy-release.mjs';

const sha = 'a'.repeat(40);
const successful = { path: '.github/workflows/ci.yml', head_sha: sha, status: 'completed',
  conclusion: 'success', event: 'push', head_branch: 'main' };

function analyzeDropin(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro3d-unit-test-'));
  try {
    const unit = path.join(dir, 'metro3d-preflight.service');
    fs.writeFileSync(unit, `[Unit]\nDefaultDependencies=no\n[Service]\nType=simple\n${contents}`);
    return spawnSync('systemd-analyze', ['--generators=no', '--man=no', 'verify', unit], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, LC_ALL: 'C', SYSTEMD_LOG_LEVEL: 'warning', SYSTEMD_LOG_TARGET: 'console', SYSTEMD_COLORS: '0',
        SYSTEMD_UNIT_PATH: dir },
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('systemd parser accepts generated WorkingDirectory and EnvironmentFile directives', () => {
  for (const release of ['/tmp/metro3d-release', '/tmp/metro3d space %/release']) {
    const contents = serviceDropin(release, '/tmp/metro3d root %');
    const result = analyzeDropin(contents);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.trim(), '');
    assert.doesNotThrow(() => verifyServiceDropin(contents));
  }
});

test('preflight rejects the production incident quoted-path regression', () => {
  const corrected = serviceDropin('/tmp/metro3d-release', '/tmp/metro3d-root');
  for (const directive of ['WorkingDirectory', 'EnvironmentFile']) {
    const broken = corrected.replace(new RegExp(`^${directive}=(/.+)$`, 'm'), `${directive}="$1"`);
    const result = analyzeDropin(broken);
    assert.match(result.stderr, /not absolute|Invalid argument|bad unit file/i);
    assert.throws(() => verifyServiceDropin(broken), /preflight failed/);
  }
});

test('preflight rejects ignored directives even when systemd verify exits zero', () => {
  const broken = `${serviceDropin('/tmp/metro3d-release', '/tmp/metro3d-root')}UnknownMetroDirective=true\n`;
  const result = analyzeDropin(broken);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Unknown key/);
  assert.throws(() => verifyServiceDropin(broken), /preflight failed/);
});

test('runtime gate accepts supported patches and rejects older or unsupported runtimes', () => {
  for (const version of ['v20.19.0', 'v20.20.2', 'v20.21.0', 'v22.12.0', 'v22.22.3', 'v24.0.0', 'v25.0.0']) {
    assert.doesNotThrow(() => validateRuntime(version));
  }
  for (const version of ['v18.20.8', 'v20.18.3', 'v21.7.3', 'v22.11.0', 'v23.0.0', 'v24.0.0-rc.1', '20.20.2', 'invalid']) {
    assert.throws(() => validateRuntime(version));
  }
});

test('isolated runtime verification compiles and checks referenced assets', async () => {
  const paths = [];
  const script = new Script(RUNTIME_CHECK);
  await script.runInNewContext({
    require: () => ({ buildApp: async () => ({
      inject: async url => {
        paths.push(url);
        return { statusCode: 200, json: () => ({ data: { status: 'healthy' } }),
          body: '<script src="/assets/app.js"></script><link href="/assets/style.css">' };
      },
      close: async () => {},
    }) }),
    process: { exit: () => { throw new Error('Runtime verification failed'); } },
  });
  assert.deepEqual(paths, ['/api/health', '/', '/assets/app.js', '/assets/style.css']);
});

test('only the successful current main push workflow passes the release gate', () => {
  assert.doesNotThrow(() => verifyGate(successful, sha, sha));
  for (const change of [
    { path: '.github/workflows/other.yml' }, { head_sha: 'b'.repeat(40) },
    { status: 'in_progress' }, { conclusion: 'failure' }, { event: 'pull_request' },
    { head_branch: 'feature/debug' },
  ]) assert.throws(() => verifyGate({ ...successful, ...change }, sha, sha));
  assert.throws(() => verifyGate(successful, sha, 'b'.repeat(40)));
});

test('release identifiers cannot become paths or CLI options', () => {
  assert.doesNotThrow(() => validateIdentifiers(sha, '123'));
  for (const invalid of ['../release', '--help', 'abc', 'A'.repeat(40)]) {
    assert.throws(() => validateIdentifiers(invalid, '123'));
  }
  for (const invalid of ['--repo', '0', '../123', '12 3']) {
    assert.throws(() => validateIdentifiers(sha, invalid));
  }
});

const entries = ['RELEASE_SHA', 'backend/package.json', 'backend/package-lock.json',
  'backend/dist/server.js', 'frontend/dist/index.html', 'frontend/dist/assets/app.js'];
const types = entries.map(() => '-');

test('archive permits release files and rejects traversal, links, secrets and unrelated files', () => {
  assert.doesNotThrow(() => validateArchive(entries, types));
  assert.doesNotThrow(() => validateArchive(['./', ...entries], ['d', ...types]));
  for (const unsafe of ['../.env', '/etc/passwd', 'backend/dist/../../.env',
    'backend/dist/.env', 'README.md', 'backend/node_modules/index.js']) {
    assert.throws(() => validateArchive([...entries, unsafe], [...types, '-']));
  }
  for (const type of ['l', 'h', 'b']) {
    assert.throws(() => validateArchive([...entries, 'backend/dist/link'], [...types, type]));
  }
  assert.throws(() => validateArchive([...entries, entries[0]], [...types, '-']));
  assert.throws(() => validateArchive(entries.slice(1), types.slice(1)));
});

test('drop-in resets obsolete executable and environment file while retaining production secrets in place', () => {
  const unit = serviceDropin(`/home/test/releases/${sha}`, '/home/test/current');
  assert.match(unit, /WorkingDirectory=\/home\/test\/releases\/a{40}\/backend\n/);
  assert.match(unit, /EnvironmentFile=\nEnvironmentFile=\/home\/test\/current\/\.env\n/);
  assert.match(unit, /ExecStart=\nExecStart=\/usr\/bin\/env/);
  assert.match(unit, /"SERVE_STATIC_DIR=\/home\/test\/releases\/a{40}\/frontend\/dist"/);
  assert.match(unit, /"CACHE_DIR=\/home\/test\/current\/backend\/data\/cache"/);
  assert.match(unit, /\/usr\/bin\/node dist\/server\.js\n$/);
  assert.doesNotMatch(unit, /ODPT_API_TOKEN|Mirai-DX-Project/);
  assert.match(serviceDropin('/home/test/space %/release'), /space %%/);
  assert.throws(() => serviceDropin('/home/test/\nrelease'));
  assert.throws(() => serviceDropin('relative'));
  for (const unsafe of ['quote"', 'back\\slash', '$variable', '*glob', '[glob]']) {
    assert.throws(() => serviceDropin(`/tmp/${unsafe}`));
  }
});
