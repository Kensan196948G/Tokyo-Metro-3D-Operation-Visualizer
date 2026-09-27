import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = '/home/kensan/Projects/Mirai-Admin-Platform/Tokyo-Metro-3D-Operation-Visualizer';
const STATE = path.join(os.homedir(), '.local/share/metro3d');
const RELEASES = path.join(STATE, 'releases');
const DROPIN = path.join(os.homedir(), '.config/systemd/user/metro3d.service.d/90-metro3d-release.conf');
const NODE = '/usr/bin/node';
const SERVICE = 'metro3d.service';
const MANAGED = '# Managed by metro3d deploy-release.mjs';
const CONTENTS = ['backend/dist', 'backend/package.json', 'backend/package-lock.json', 'frontend/dist'];

export function validateIdentifiers(sha, runId) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('A full lowercase commit SHA is required');
  if (!/^[1-9][0-9]*$/.test(runId ?? '')) throw new Error('A numeric GitHub Actions run ID is required');
}

export function validateRuntime(version) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error('Invalid production Node version');
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24)) {
    throw new Error('Production Node requires 20.19+, 22.12+, or 24+');
  }
}

export function verifyGate(run, sha, mainSha) {
  if (run.path !== '.github/workflows/ci.yml' || run.head_sha !== sha ||
      run.status !== 'completed' || run.conclusion !== 'success' ||
      run.event !== 'push' || run.head_branch !== 'main' || mainSha !== sha) {
    throw new Error('Release must be the current main commit with a successful push CI run');
  }
}

export function validateArchive(entries, types) {
  if (entries.length === 0 || entries.length !== types.length) throw new Error('Invalid release archive');
  const names = new Set();
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i].replace(/^\.\//, '').replace(/\/$/, '');
    if ((name === '.' || name === '') && types[i] === 'd') continue;
    if (!['-', 'd'].includes(types[i]) || !/^[A-Za-z0-9_./@+-]+$/.test(name) ||
        name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.env') || names.has(name)) {
      throw new Error('Release archive contains unsafe paths or links');
    }
    if (!/^(RELEASE_SHA|backend|frontend|backend\/package(?:-lock)?\.json|backend\/dist(?:\/.*)?|frontend\/dist(?:\/.*)?)$/.test(name)) {
      throw new Error('Release archive contains unexpected files');
    }
    names.add(name);
  }
  for (const required of ['RELEASE_SHA', 'backend/package.json', 'backend/package-lock.json',
    'backend/dist/server.js', 'frontend/dist/index.html']) {
    if (!names.has(required)) throw new Error(`Release artifact missing ${required}`);
  }
}

function quoteUnit(value) {
  if (!path.isAbsolute(value) || /[\r\n\0]/.test(value)) throw new Error('Invalid systemd path');
  return `"${value.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// systemd token quoting differs from shell quoting; values are never evaluated by a shell.
export function serviceDropin(release, root = ROOT) {
  const backend = quoteUnit(path.join(release, 'backend'));
  const envFile = quoteUnit(path.join(root, '.env'));
  const staticDir = quoteUnit(path.join(release, 'frontend/dist'));
  const cacheDir = quoteUnit(path.join(root, 'backend/data/cache'));
  return `${MANAGED}\n[Service]\nWorkingDirectory=${backend}\nEnvironmentFile=\nEnvironmentFile=${envFile}\n` +
    `ExecStart=\nExecStart=/usr/bin/env "SERVE_STATIC_DIR=${staticDir.slice(1, -1)}" ` +
    `"CACHE_DIR=${cacheDir.slice(1, -1)}" /usr/bin/node dist/server.js\n`;
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...options }).trim();
  } catch {
    // Tool output can include registry or feed credentials. Keep failures categorical.
    throw new Error(`Command failed: ${path.basename(command)}`);
  }
}

function gate(sha, runId) {
  const repositoryEnv = { ...process.env };
  delete repositoryEnv.GH_REPO;
  const repo = JSON.parse(run('gh', ['repo', 'view', '--json', 'nameWithOwner'], {
    cwd: ROOT, env: repositoryEnv,
  })).nameWithOwner;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository identity');
  const workflow = JSON.parse(run('gh', ['api', `repos/${repo}/actions/runs/${runId}`]));
  const commit = JSON.parse(run('gh', ['api', `repos/${repo}/commits/main`]));
  verifyGate(workflow, sha, commit.sha);
  return repo;
}

export const RUNTIME_CHECK = String.raw`
      (async () => {
        const { buildApp } = require('./dist/app.js');
        const app = await buildApp({ logger: false });
        try {
          const health = await app.inject('/api/health');
          if (health.statusCode !== 200 || health.json().data?.status !== 'healthy') throw Error();
          const root = await app.inject('/');
          if (root.statusCode !== 200) throw Error();
          const assets = [...root.body.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(m => m[1]);
          if (!assets.some(a => a.endsWith('.js'))) throw Error();
          for (const asset of assets) if ((await app.inject(asset)).statusCode !== 200) throw Error();
        } finally { await app.close(); }
      })().catch(() => process.exit(1));
    `;

function installAndCheck(release) {
  validateRuntime(run(NODE, ['--version']));
  const backend = path.join(release, 'backend');
  run(NODE, [fs.realpathSync('/usr/bin/npm'), 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: backend, timeout: 300_000 });
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'metro3d-release-check-'));
  try {
    run(NODE, ['-e', RUNTIME_CHECK], { cwd: backend, env: { ...process.env, NODE_ENV: 'development',
      ODPT_API_TOKEN: '', ODPT_GTFS_URL: '', ODPT_GTFS_RT_URL: '',
      SERVE_STATIC_DIR: path.join(release, 'frontend/dist'), CACHE_DIR: cache, LOG_LEVEL: 'silent' } });
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
}

function baseline() {
  const target = path.join(RELEASES, 'baseline');
  if (fs.existsSync(path.join(target, 'PREPARED.json'))) return target;
  if (fs.existsSync(target)) throw new Error('Incomplete baseline exists; inspect before retrying');
  fs.mkdirSync(target, { recursive: true });
  try {
    for (const name of CONTENTS) {
      const source = path.join(ROOT, name);
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Baseline source must not be a symlink');
      fs.cpSync(source, path.join(target, name), { recursive: true, errorOnExist: true, force: false,
        filter: sourcePath => {
          if (fs.lstatSync(sourcePath).isSymbolicLink()) throw new Error('Baseline contains a symlink');
          return true;
        } });
    }
    installAndCheck(target);
    fs.writeFileSync(path.join(target, 'PREPARED.json'), JSON.stringify({ baseline: true }), { mode: 0o600 });
    return target;
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

function prepare(sha, runId) {
  const repo = gate(sha, runId);
  baseline();
  const target = path.join(RELEASES, sha);
  if (fs.existsSync(target)) throw new Error('Release already exists; do not overwrite prepared releases');
  const staging = fs.mkdtempSync(path.join(STATE, 'prepare-'));
  try {
    const download = path.join(staging, 'download');
    run('gh', ['run', 'download', runId, '--repo', repo, '--name', 'metro3d-release', '--dir', download]);
    const archive = path.join(download, 'release.tar.gz');
    const names = run('tar', ['-tzf', archive]).split('\n');
    const types = run('tar', ['-tvzf', archive]).split('\n').map(line => line[0]);
    validateArchive(names, types);
    const extracted = path.join(staging, 'release');
    fs.mkdirSync(extracted);
    run('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', extracted]);
    if (fs.readFileSync(path.join(extracted, 'RELEASE_SHA'), 'utf8').trim() !== sha) {
      throw new Error('Artifact RELEASE_SHA does not match the approved CI commit');
    }
    installAndCheck(extracted);
    fs.writeFileSync(path.join(extracted, 'PREPARED.json'), JSON.stringify({ sha, runId, repo }), { mode: 0o600 });
    fs.renameSync(extracted, target);
    console.log(`Prepared release ${sha}; production is unchanged.`);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

async function verifyHttp() {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const options = { signal: AbortSignal.timeout(3000), redirect: 'error' };
      const health = await fetch('http://127.0.0.1:3020/api/health', options);
      if (!health.ok || (await health.json()).data?.status !== 'healthy') throw new Error();
      const root = await fetch('http://127.0.0.1:3020/', { ...options, signal: AbortSignal.timeout(3000) });
      if (!root.ok) throw new Error();
      const html = await root.text();
      const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(m => m[1]);
      if (!assets.some(asset => asset.endsWith('.js'))) throw new Error();
      for (const asset of assets) {
        const response = await fetch(new URL(asset, 'http://127.0.0.1:3020'), { ...options, signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error();
        await response.arrayBuffer();
      }
      return;
    } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  throw new Error('Release health, root, or asset verification failed');
}

function restart() {
  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'restart', SERVICE]);
}

function writeDropin(contents) {
  fs.mkdirSync(path.dirname(DROPIN), { recursive: true });
  const temporary = `${DROPIN}.tmp`;
  fs.writeFileSync(temporary, contents, { mode: 0o600 });
  fs.renameSync(temporary, DROPIN);
}

async function activate(sha, runId) {
  const repo = gate(sha, runId);
  const target = path.join(RELEASES, sha);
  const prepared = JSON.parse(fs.readFileSync(path.join(target, 'PREPARED.json'), 'utf8'));
  if (prepared.sha !== sha || prepared.runId !== runId || prepared.repo !== repo ||
      fs.readFileSync(path.join(target, 'RELEASE_SHA'), 'utf8').trim() !== sha) throw new Error('Release is not prepared for this CI run');
  const fallback = path.join(RELEASES, 'baseline');
  if (!fs.existsSync(path.join(fallback, 'PREPARED.json'))) throw new Error('Prepared baseline rollback is required');
  if (!fs.existsSync(path.join(ROOT, '.env'))) throw new Error('Existing production EnvironmentFile is missing');
  const previous = fs.existsSync(DROPIN) ? fs.readFileSync(DROPIN, 'utf8') : null;
  if (previous !== null && !previous.startsWith(`${MANAGED}\n`)) throw new Error('Refusing to replace an unmanaged drop-in');
  const backup = path.join(STATE, 'backups', `${Date.now()}-${sha}`);
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, 'previous.json'), JSON.stringify({ contents: previous }), { mode: 0o600 });
  // The original unit points to a removed checkout. The baseline drop-in is the first-deploy rollback.
  const rollback = previous ?? serviceDropin(fallback);
  try {
    writeDropin(serviceDropin(target));
    restart();
    await verifyHttp();
    console.log(`Activated ${sha}; local health, root, and linked assets passed.`);
  } catch {
    try {
      writeDropin(rollback);
      restart();
      await verifyHttp();
    } catch {
      try {
        writeDropin(serviceDropin(fallback));
        restart();
        await verifyHttp();
      } catch {
        throw new Error('Activation and baseline rollback failed; inspect the user service and release backups');
      }
    }
    throw new Error('Activation failed; restored and verified the previous release or baseline');
  }
}

async function main() {
  const [mode, sha, runId, ...extra] = process.argv.slice(2);
  if (!['--prepare', '--activate'].includes(mode) || extra.length) throw new Error('Usage: deploy-release.mjs --prepare|--activate <sha> <runid>');
  validateIdentifiers(sha, runId);
  fs.mkdirSync(RELEASES, { recursive: true });
  const lock = path.join(STATE, 'operation.lock');
  try { fs.mkdirSync(lock); } catch { throw new Error('Another release operation is active or requires recovery'); }
  try {
    if (mode === '--prepare') prepare(sha, runId);
    else await activate(sha, runId);
  } finally { fs.rmdirSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
