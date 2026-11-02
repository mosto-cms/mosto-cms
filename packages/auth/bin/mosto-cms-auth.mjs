#!/usr/bin/env node
/**
 * mosto-cms-auth: credentials for a Mosto CMS site, from the terminal.
 *
 *   mosto-cms-auth secret                 print a new random site secret (MOSTO_CMS_SECRET)
 *   mosto-cms-auth hash-password          read a password (hidden prompt or stdin), print its hash
 *   mosto-cms-auth create-key [options]   mint a connector key (needs MOSTO_CMS_SECRET in the env)
 *       --write                 allow publish / upload / revert (default: read-only)
 *       --collections a,b       limit to these collections (default: all)
 *       --actor ai|human        default human
 *       --label "Mosto"         shown as the commit author of writes made with the key
 *       --expires-days 90       default: no expiry
 *   mosto-cms-auth key-id <key>           print the id of a key (to revoke it)
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

import { createConnectorKey, hashPassword, keyIdOf } from '../dist/index.js';

const [cmd, ...args] = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

async function readPassword() {
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, '');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = rl._writeToOutput?.bind(rl);
  rl._writeToOutput = (s) => {
    if (s.includes('Password:')) write?.(s);
  };
  const answer = await new Promise((resolve) => rl.question('Password: ', resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function main() {
  switch (cmd) {
    case 'secret':
      console.log(randomBytes(32).toString('base64url'));
      return;
    case 'hash-password':
      console.log(await hashPassword(await readPassword()));
      return;
    case 'create-key': {
      const collections = flag('collections');
      const days = flag('expires-days');
      const { key, kid } = createConnectorKey({
        secret: process.env.MOSTO_CMS_SECRET ?? '',
        epoch: process.env.MOSTO_CMS_KEY_EPOCH ?? 0,
        write: flag('write') === true,
        actor: flag('actor') === 'ai' ? 'ai' : 'human',
        ...(typeof collections === 'string' ? { collections: collections.split(',').map((c) => c.trim()).filter(Boolean) } : {}),
        ...(typeof flag('label') === 'string' ? { label: flag('label') } : {}),
        ...(typeof days === 'string' ? { expiresInSeconds: Number(days) * 86400 } : {}),
      });
      console.error(`key id: ${kid} (add it to MOSTO_CMS_REVOKED_KEYS to revoke the key)`);
      console.log(key);
      return;
    }
    case 'key-id': {
      const kid = keyIdOf(args[0] ?? '');
      if (!kid) throw new Error('not a Mosto CMS connector key');
      console.log(kid);
      return;
    }
    default:
      console.error('usage: mosto-cms-auth secret | hash-password | create-key [--write] [--collections a,b] [--actor ai] [--label x] [--expires-days n] | key-id <key>');
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
