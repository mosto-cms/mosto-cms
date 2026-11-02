/**
 * Starts the built starter with `next start` on a free port, against a
 * temporary copy of content/ that is a git repository (so /admin has history
 * and undo through the fs adapter's git mode).
 *
 * `next start` writes regenerated pages (ISR) back into `.next`, so a server
 * would see the pages another test published. Each server starts from the
 * build output as `next build` left it; e2e files run one at a time.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashPassword } from '@mosto-cms/auth';

export const starter = join(dirname(fileURLToPath(import.meta.url)), '..');
export const EDITOR = { email: 'anna@example.com', name: 'Anna Rossi', password: 'correct horse battery' };

export type StarterServer = { base: string; contentRoot: string; secret: string; log(): string; stop(): Promise<void> };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    // All interfaces: Next listens on IPv6 too, and "localhost" may resolve to ::1.
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/** Build outputs that `next start` rewrites when it regenerates a page. */
const REGENERATED = ['.next/server/app', '.next/server/route-cache', '.next/cache/fetch-cache'];

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * Put the build output back as `next build` left it. The first server after a
 * build keeps a pristine copy (keyed by BUILD_ID); every server starts from it.
 */
async function resetBuildOutput(): Promise<void> {
  const buildId = (await readFile(join(starter, '.next/BUILD_ID'), 'utf8')).trim();
  const pristine = join(tmpdir(), `mosto-cms-starter-build-${buildId}`);
  if (!(await exists(pristine))) {
    const staging = await mkdtemp(join(tmpdir(), 'mosto-cms-starter-staging-'));
    for (const rel of REGENERATED) {
      if (await exists(join(starter, rel))) await cp(join(starter, rel), join(staging, rel), { recursive: true });
    }
    await rename(staging, pristine).catch(() => rm(staging, { recursive: true, force: true }));
  }
  for (const rel of REGENERATED) {
    await rm(join(starter, rel), { recursive: true, force: true });
    if (await exists(join(pristine, rel))) await cp(join(pristine, rel), join(starter, rel), { recursive: true });
  }
}

export async function startStarter(extraEnv: Record<string, string> = {}): Promise<StarterServer> {
  const secret = `e2e-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const contentRoot = await mkdtemp(join(tmpdir(), 'mosto-cms-starter-'));
  await cp(join(starter, 'content'), join(contentRoot, 'content'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', '-C', contentRoot, ...args]);
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'Initial content');

  const passwordHash = await hashPassword(EDITOR.password, { logN: 10 });
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('MOSTO_CMS_')) env[k] = v;
  Object.assign(env, {
    NODE_ENV: 'production',
    MOSTO_CMS_SECRET: secret,
    MOSTO_CMS_EDITORS: JSON.stringify([{ email: EDITOR.email, name: EDITOR.name, passwordHash }]),
    MOSTO_CMS_CONTENT_ROOT: contentRoot,
    MOSTO_CMS_FS_GIT: '1',
    ...extraEnv,
  });
  await resetBuildOutput();
  const nextBin = createRequire(join(starter, 'package.json')).resolve('next/dist/bin/next');
  let log = '';
  const server: ChildProcess = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: starter,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so stopping it also stops Next's worker processes.
    detached: true,
  });
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));

  const start = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${base}/api/mosto-cms`)).ok) break;
    } catch {
      // not up yet
    }
    if (server.exitCode !== null) throw new Error(`next start exited:\n${log}`);
    if (Date.now() - start > 60_000) throw new Error(`server did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    base,
    contentRoot,
    secret,
    log: () => log,
    async stop() {
      if (server.exitCode === null && server.pid) {
        const exited = new Promise((r) => server.once('exit', r));
        try {
          process.kill(-server.pid, 'SIGTERM');
        } catch {
          server.kill('SIGTERM');
        }
        await exited;
      }
      // Wait until nothing answers on the port any more (Next's workers exit after the parent).
      for (let i = 0; i < 100; i++) {
        const open = await fetch(`${base}/api/mosto-cms`).then(
          () => true,
          () => false,
        );
        if (!open) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await rm(contentRoot, { recursive: true, force: true });
    },
  };
}

export async function eventually(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('condition not met in time');
}
