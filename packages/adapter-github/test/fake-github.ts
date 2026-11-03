/**
 * A tiny in-memory GitHub REST API: just the endpoints the adapter uses, with
 * real git semantics (content-addressed blobs, trees, commits, fast-forward
 * ref updates).
 */
import { createHash, createVerify } from 'node:crypto';

type Tree = Map<string, string>; // path -> blob sha
type Commit = {
  sha: string;
  tree: string;
  parents: string[];
  message: string;
  author: { name: string; email: string; date: string };
  committer: { name: string; email: string };
};

export class FakeGithub {
  blobs = new Map<string, Buffer>();
  trees = new Map<string, Tree>();
  commits = new Map<string, Commit>();
  refs = new Map<string, string>();
  calls: string[] = [];
  token = 'test-token';
  /** Called right before a ref update is applied (to simulate races). */
  beforeRefUpdate?: () => void;
  /**
   * Fault injection: called for every request before it is served. Return a
   * Response to answer with it instead ('after' answers AFTER the request was
   * applied, like a lost or failed answer), or throw to simulate no answer.
   */
  fault?: (call: string) => { when: 'before' | 'after'; response: Response } | { when: 'before'; throws: Error } | undefined;
  appPublicKey?: string;
  private clock = 0;

  constructor(owner = 'acme', repo = 'site') {
    this.prefix = `/repos/${owner}/${repo}`;
    this.commitFiles({}, 'init');
  }
  private prefix: string;

  private sha(kind: string, data: Buffer | string): string {
    return createHash('sha1').update(kind).update('\0').update(data).digest('hex');
  }

  putBlob(data: Buffer): string {
    const sha = this.sha('blob', data);
    this.blobs.set(sha, data);
    return sha;
  }

  private putTree(tree: Tree): string {
    const sha = this.sha('tree', JSON.stringify([...tree].sort()));
    this.trees.set(sha, tree);
    return sha;
  }

  private putCommit(
    tree: string,
    parents: string[],
    message: string,
    author?: { name: string; email: string },
    committer?: { name: string; email: string },
  ): string {
    const date = new Date(Date.UTC(2026, 10, 2, 12, 0, ++this.clock)).toISOString();
    const a = { name: author?.name ?? 'dev', email: author?.email ?? 'dev@example.com', date };
    const c = committer ? { name: committer.name, email: committer.email } : { name: a.name, email: a.email };
    const sha = this.sha('commit', `${tree}${parents.join()}${message}${date}`);
    this.commits.set(sha, { sha, tree, parents, message, author: a, committer: c });
    return sha;
  }

  head(branch = 'main'): string | undefined {
    return this.refs.get(branch);
  }

  /** Commit files directly (someone else pushing). */
  commitFiles(files: Record<string, string>, message: string, branch = 'main'): string {
    const parent = this.refs.get(branch);
    const tree: Tree = new Map(parent ? this.trees.get(this.commits.get(parent)!.tree) : []);
    for (const [p, text] of Object.entries(files)) tree.set(p, this.putBlob(Buffer.from(text)));
    const sha = this.putCommit(this.putTree(tree), parent ? [parent] : [], message);
    this.refs.set(branch, sha);
    return sha;
  }

  fileAt(path: string, ref = 'main'): string | undefined {
    const c = this.commits.get(this.refs.get(ref) ?? ref);
    const blob = c && this.trees.get(c.tree)!.get(path);
    return blob ? this.blobs.get(blob)!.toString('utf8') : undefined;
  }

  private changed(c: Commit): string[] {
    const t = this.trees.get(c.tree)!;
    const p = c.parents[0] ? this.trees.get(this.commits.get(c.parents[0])!.tree)! : new Map<string, string>();
    return [...t].filter(([k, v]) => p.get(k) !== v).map(([k]) => k);
  }

  private ancestry(sha: string): Commit[] {
    const out: Commit[] = [];
    let c = this.commits.get(sha);
    while (c) {
      out.push(c);
      c = c.parents[0] ? this.commits.get(c.parents[0]) : undefined;
    }
    return out;
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  private checkAppJwt(auth: string): boolean {
    const jwt = auth.replace(/^Bearer /, '');
    const [h, p, s] = jwt.split('.');
    if (!this.appPublicKey || !h || !p || !s) return false;
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${p}`);
    return v.verify(this.appPublicKey, Buffer.from(s, 'base64url'));
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const fault = this.fault?.(`${method} ${new URL(String(input)).pathname}`);
    if (fault && 'throws' in fault) throw fault.throws;
    if (fault?.when === 'before') return fault.response;
    const res = await this.serve(input, init);
    return fault?.when === 'after' ? fault.response : res;
  };

  private serve = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
    const path = url.pathname;
    this.calls.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (path.startsWith('/app/') || path.endsWith('/installation')) {
      if (!this.checkAppJwt(auth)) return this.json(401, { message: 'bad jwt' });
      if (path.endsWith('/installation')) return this.json(200, { id: 42 });
      return this.json(201, { token: this.token, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (auth !== `Bearer ${this.token}`) return this.json(401, { message: 'Bad credentials' });
    if (!path.startsWith(this.prefix)) return this.json(404, { message: 'Not Found' });
    const rest = path.slice(this.prefix.length);
    let m: RegExpMatchArray | null;

    if (method === 'GET' && (m = rest.match(/^\/contents\/(.+)$/))) {
      const file = decodeURIComponent(m[1]!);
      const ref = url.searchParams.get('ref') ?? 'main';
      const c = this.commits.get(this.refs.get(ref) ?? ref);
      if (!c) return this.json(404, { message: 'No commit found for the ref' });
      const blob = this.trees.get(c.tree)!.get(file);
      if (!blob) return this.json(404, { message: 'Not Found' });
      const data = this.blobs.get(blob)!;
      const big = data.length > 1_000_000;
      return this.json(200, { sha: blob, size: data.length, encoding: big ? 'none' : 'base64', content: big ? '' : data.toString('base64') });
    }
    if (method === 'GET' && (m = rest.match(/^\/git\/blobs\/([0-9a-f]+)$/))) {
      const data = this.blobs.get(m[1]!);
      return data ? this.json(200, { sha: m[1], content: data.toString('base64'), encoding: 'base64' }) : this.json(404, {});
    }
    if (method === 'GET' && (m = rest.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = this.refs.get(decodeURIComponent(m[1]!));
      return sha ? this.json(200, { object: { sha } }) : this.json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = rest.match(/^\/git\/commits\/([0-9a-f]+)$/))) {
      const c = this.commits.get(m[1]!);
      return c ? this.json(200, { sha: c.sha, tree: { sha: c.tree } }) : this.json(404, {});
    }
    if (method === 'POST' && rest === '/git/blobs') {
      const data = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : Buffer.from(body.content, 'utf8');
      return this.json(201, { sha: this.putBlob(data) });
    }
    if (method === 'POST' && rest === '/git/trees') {
      const base = this.trees.get(body.base_tree);
      if (!base) return this.json(422, { message: 'base_tree not found' });
      const tree: Tree = new Map(base);
      for (const t of body.tree) tree.set(t.path, t.sha);
      return this.json(201, { sha: this.putTree(tree) });
    }
    if (method === 'POST' && rest === '/git/commits') {
      const sha = this.putCommit(body.tree, body.parents, body.message, body.author, body.committer);
      return this.json(201, { sha, html_url: `https://github.example/commit/${sha}` });
    }
    if (method === 'PATCH' && (m = rest.match(/^\/git\/refs\/heads\/(.+)$/))) {
      this.beforeRefUpdate?.();
      const branch = decodeURIComponent(m[1]!);
      const current = this.refs.get(branch)!;
      const next = this.commits.get(body.sha);
      if (!next || (!body.force && next.parents[0] !== current)) {
        return this.json(422, { message: 'Update is not a fast forward' });
      }
      this.refs.set(branch, body.sha);
      return this.json(200, { object: { sha: body.sha } });
    }
    if (method === 'GET' && rest === '/commits') {
      const start = this.refs.get(url.searchParams.get('sha') ?? 'main')!;
      const file = url.searchParams.get('path');
      const per = Number(url.searchParams.get('per_page') ?? 30);
      const list = this.ancestry(start)
        .filter((c) => !file || this.changed(c).includes(file))
        .slice(0, per)
        .map((c) => ({ sha: c.sha, parents: c.parents.map((sha) => ({ sha })), commit: { message: c.message, author: c.author } }));
      return this.json(200, list);
    }
    if (method === 'GET' && (m = rest.match(/^\/commits\/(.+)$/))) {
      const c = this.commits.get(m[1]!);
      if (!c) return this.json(422, { message: 'No commit found for SHA' });
      return this.json(200, {
        sha: c.sha,
        parents: c.parents.map((sha) => ({ sha })),
        commit: { message: c.message, author: c.author },
        files: this.changed(c).map((filename) => ({ filename })),
      });
    }
    return this.json(404, { message: `fake: no route for ${method} ${rest}` });
  };
}
