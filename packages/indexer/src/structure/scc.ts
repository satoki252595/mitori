/** Iterative Tarjan SCC + bottom-up topological order of the condensation (spec §6.5). */

/** Strongly connected components (each as node list); iterative, so deep graphs do not overflow the stack. */
export function tarjan(n: number, adj: readonly (readonly number[])[]): number[][] {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const out: number[][] = [];
  let counter = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const work: [number, number][] = [[s, 0]];
    index[s] = low[s] = counter++;
    stack.push(s);
    onStack[s] = 1;
    while (work.length > 0) {
      const top = work[work.length - 1] as [number, number];
      const [v, i] = top;
      const succ = adj[v] ?? [];
      if (i < succ.length) {
        top[1] = i + 1;
        const w = succ[i] as number;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v] as number, index[w] as number);
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low[parent[0]] = Math.min(low[parent[0]] as number, low[v] as number);
      if (low[v] === index[v]) {
        const comp: number[] = [];
        for (;;) {
          const w = stack.pop() as number;
          onStack[w] = 0;
          comp.push(w);
          if (w === v) break;
        }
        out.push(comp);
      }
    }
  }
  return out;
}

/**
 * Order nodes so that dependencies come first (edge u → v = "u depends on v" ⇒ v before u). Within the condensation,
 * ready components are taken by `cmp` of their best member; nodes inside a component are sorted by `cmp`.
 */
export function bottomUpOrder(n: number, adj: readonly (readonly number[])[], cmp: (a: number, b: number) => number): { order: number[]; sccs: number[][] } {
  const sccs = tarjan(n, adj).map((c) => c.sort(cmp));
  const compOf = new Int32Array(n);
  sccs.forEach((c, i) => {
    for (const v of c) compOf[v] = i;
  });
  // remaining out-degree (towards other components) per component; a component is ready when all its deps are placed
  const pending = new Int32Array(sccs.length);
  const dependents: Set<number>[] = sccs.map(() => new Set());
  for (let u = 0; u < n; u++)
    for (const v of adj[u] ?? []) {
      const cu = compOf[u] as number;
      const cv = compOf[v] as number;
      if (cu !== cv && !dependents[cv]?.has(cu)) {
        dependents[cv]?.add(cu);
        pending[cu] = (pending[cu] as number) + 1;
      }
    }
  const ready: number[] = [];
  for (let c = 0; c < sccs.length; c++) if (pending[c] === 0) ready.push(c);
  const cmpComp = (a: number, b: number) => cmp((sccs[a] as number[])[0] as number, (sccs[b] as number[])[0] as number);
  const order: number[] = [];
  while (ready.length > 0) {
    ready.sort(cmpComp);
    const c = ready.shift() as number;
    order.push(...(sccs[c] as number[]));
    for (const d of dependents[c] ?? []) {
      pending[d] = (pending[d] as number) - 1;
      if (pending[d] === 0) ready.push(d);
    }
  }
  return { order, sccs };
}
