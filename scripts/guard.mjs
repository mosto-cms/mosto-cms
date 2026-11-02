#!/usr/bin/env node
/**
 * Repository hygiene guard (runs in CI).
 *
 * Mosto CMS is installed inside other people's websites, so this repository
 * must stay neutral and clean:
 *   1. no credentials, tokens, private keys or env files;
 *   2. no AI agent code: no LLM SDKs, agent frameworks or model-calling code.
 *      The protocol can be driven by AI clients, but they live elsewhere.
 *
 * Patterns are assembled from fragments so this file does not match itself.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const j = (...parts) => parts.join('');

const SECRET_PATTERNS = [
  ['GitHub token', new RegExp(j('\\b(gh', '[pousr]_[A-Za-z0-9]{36,}|github', '_pat_[A-Za-z0-9_]{40,})'))],
  ['Anthropic key', new RegExp(j('\\bsk-', 'ant-[A-Za-z0-9_-]{20,}'))],
  ['OpenAI-style key', new RegExp(j('\\bsk-', '(proj-)?[A-Za-z0-9_-]{32,}'))],
  ['AWS access key', new RegExp(j('\\b(AKIA|ASIA)', '[0-9A-Z]{16}\\b'))],
  ['Slack token', new RegExp(j('\\bxox', '[abprs]-[A-Za-z0-9-]{10,}'))],
  ['Stripe key', new RegExp(j('\\b(sk|rk)_', '(live|test)_[A-Za-z0-9]{16,}'))],
  ['Vercel/Netlify/Supabase token', new RegExp(j('\\b(vcp_|nfp_|sbp_)', '[A-Za-z0-9]{20,}'))],
  ['Private key block', new RegExp(j('-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?', 'PRIVATE KEY-----'))],
  ['JWT', new RegExp(j('\\beyJ[A-Za-z0-9_-]{10,}\\.', 'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}'))],
  ['Google API key', new RegExp(j('\\bAIza', '[0-9A-Za-z_-]{35}\\b'))],
];

const AI_PACKAGES = [
  j('@anthropic', '-ai/'),
  j('open', 'ai'),
  j('@ai', '-sdk/'),
  j('lang', 'chain'),
  j('@lang', 'chain/'),
  j('llama', 'index'),
  j('@google/gen', 'ai'),
  j('@google/generative', '-ai'),
  j('@mistral', 'ai/'),
  j('cohere', '-ai'),
  j('@model', 'contextprotocol/'),
  j('ol', 'lama'),
];

const AI_CODE_PATTERNS = [
  ['model API endpoint', new RegExp(j('api\\.(anthropic|open', 'ai)\\.com'))],
  ['agent entrypoint', new RegExp(j('\\b(run', 'EditAgent|buildSystem', 'Prompt|system', 'Prompt)\\b'))],
  ['credits ledger', new RegExp(j('consume', '_credits|grant', '_credits'))],
  ['model id', new RegExp(j('\\b(claude-(opus|sonnet|haiku|fable)|g', 'pt-[0-9])'))],
];

const FORBIDDEN_FILES = [/(^|\/)\.env(\.|$)(?!example$)/, /\.(pem|p12|pfx|key)$/i, /(^|\/)id_(rsa|ed25519)$/];

const SELF = new Set(['scripts/guard.mjs', 'pnpm-lock.yaml']);

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const problems = [];

for (const file of files) {
  if (FORBIDDEN_FILES.some((re) => re.test(file))) problems.push(`${file}: file type not allowed in the repo`);
  if (SELF.has(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue; // binary
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [name, re] of SECRET_PATTERNS) {
      if (re.test(line)) problems.push(`${file}:${i + 1}: looks like a secret (${name})`);
    }
    for (const [name, re] of AI_CODE_PATTERNS) {
      if (re.test(line)) problems.push(`${file}:${i + 1}: AI code is not allowed here (${name})`);
    }
    if (/\.(m?[jt]sx?|cjs)$/.test(file)) {
      const imp = line.match(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/);
      if (imp && AI_PACKAGES.some((p) => imp[1] === p || imp[1].startsWith(p.endsWith('/') ? p : `${p}/`) || imp[1] === p.replace(/\/$/, ''))) {
        problems.push(`${file}:${i + 1}: AI/LLM package import not allowed ("${imp[1]}")`);
      }
    }
  });
  if (file.endsWith('package.json')) {
    const pkg = JSON.parse(text);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (AI_PACKAGES.some((p) => dep === p.replace(/\/$/, '') || dep.startsWith(p))) {
          problems.push(`${file}: ${field} contains an AI/LLM package ("${dep}")`);
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`guard: ${problems.length} problem(s)\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`guard: ${files.length} files checked, no secrets and no AI code`);
