// Tiny in-memory stand-in for the Supabase query builder, enough for route tests. Not RLS-aware:
// it holds one user's rows, which is what RLS would expose.
type Row = Record<string, unknown>;

export function fakeSupabase(tables: Record<string, Row[]> = {}) {
  let seq = 0;
  const db: Record<string, Row[]> = { conversations: [], messages: [], projects: [], ...tables };
  const uuid = () => crypto.randomUUID();

  class Q {
    private filters: ((r: Row) => boolean)[] = [];
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row | Row[] | null = null;
    private orderBy: string | null = null;
    private returning = false;
    constructor(private table: string) {}
    select() { if (this.op !== "select") this.returning = true; return this; }
    insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
    update(p: Row) { this.op = "update"; this.payload = p; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    gt(c: string, v: number) { this.filters.push((r) => (r[c] as number) > v); return this; }
    order(c: string) { this.orderBy = c; return this; }
    limit() { return this; }
    private run(): Row[] {
      const t = (db[this.table] ??= []);
      if (this.op === "insert") {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) => ({
          id: uuid(), seq: ++seq, status: "complete", kind: "text", project_id: null, ...r,
        }));
        t.push(...rows);
        return rows;
      }
      const hit = t.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") hit.forEach((r) => Object.assign(r, this.payload));
      if (this.op === "delete") db[this.table] = t.filter((r) => !hit.includes(r));
      if (this.orderBy) hit.sort((a, b) => (a[this.orderBy!] as number) - (b[this.orderBy!] as number));
      return hit;
    }
    async single() { const r = this.run(); return { data: r[0] ?? null, error: r[0] ? null : { message: "none" } }; }
    async maybeSingle() { return { data: this.run()[0] ?? null, error: null }; }
    then(ok?: (v: { data: Row[]; error: null }) => unknown, bad?: (e: unknown) => unknown) {
      return Promise.resolve({ data: this.run(), error: null as null }).then(ok, bad);
    }
  }
  return { client: { from: (t: string) => new Q(t) }, db };
}
