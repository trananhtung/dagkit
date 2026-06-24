export class CycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Cycle detected: ${cycle.join(" → ")}`);
    this.name = "CycleError";
  }
}

/**
 * Directed Acyclic Graph with string node identifiers.
 *
 * Backed by Kahn's BFS algorithm for topological sort — O(V + E).
 * Port of Python graphlib.TopologicalSorter, Java's TopologicalSort (Guava),
 * C#'s dependency-injection topology, Go's gonum/graph.
 *
 * @example
 * const g = new DAG<string>();
 * g.addEdge("build", "test");      // test depends on build
 * g.addEdge("test", "deploy");     // deploy depends on test
 * g.sort();           // ["build", "test", "deploy"]
 * g.batches();        // [["build"], ["test"], ["deploy"]]
 */
export class DAG<T = string> {
  private readonly _nodes = new Set<T>();
  private readonly _edges = new Map<T, Set<T>>(); // node → its successors (dependents)
  private readonly _inEdges = new Map<T, Set<T>>(); // node → its predecessors (dependencies)

  /** Add a node. Idempotent. */
  addNode(node: T): this {
    if (!this._nodes.has(node)) {
      this._nodes.add(node);
      this._edges.set(node, new Set());
      this._inEdges.set(node, new Set());
    }
    return this;
  }

  /**
   * Add a directed edge: `from` must come before `to` (i.e., `to` depends on `from`).
   * Implicitly adds both nodes if not present.
   */
  addEdge(from: T, to: T): this {
    this.addNode(from);
    this.addNode(to);
    this._edges.get(from)!.add(to);
    this._inEdges.get(to)!.add(from);
    return this;
  }

  /** Remove a node and all its edges. */
  removeNode(node: T): boolean {
    if (!this._nodes.has(node)) return false;
    // Remove outgoing edges
    for (const succ of this._edges.get(node) ?? []) {
      this._inEdges.get(succ)?.delete(node);
    }
    // Remove incoming edges
    for (const pred of this._inEdges.get(node) ?? []) {
      this._edges.get(pred)?.delete(node);
    }
    this._edges.delete(node);
    this._inEdges.delete(node);
    this._nodes.delete(node);
    return true;
  }

  /** Remove a directed edge. Returns false if edge didn't exist. */
  removeEdge(from: T, to: T): boolean {
    if (!this._edges.get(from)?.has(to)) return false;
    this._edges.get(from)!.delete(to);
    this._inEdges.get(to)!.delete(from);
    return true;
  }

  /** Test whether a node exists. */
  hasNode(node: T): boolean { return this._nodes.has(node); }

  /** Test whether a directed edge exists. */
  hasEdge(from: T, to: T): boolean { return !!this._edges.get(from)?.has(to); }

  /** All nodes. */
  nodes(): T[] { return [...this._nodes]; }

  /** All edges as [from, to] pairs. */
  edges(): [T, T][] {
    const result: [T, T][] = [];
    for (const [from, succs] of this._edges) {
      for (const to of succs) result.push([from, to]);
    }
    return result;
  }

  /** Successors of node (nodes that depend on this one). */
  successors(node: T): T[] { return [...(this._edges.get(node) ?? [])]; }

  /** Predecessors of node (nodes this one depends on). */
  predecessors(node: T): T[] { return [...(this._inEdges.get(node) ?? [])]; }

  get nodeCount(): number { return this._nodes.size; }
  get edgeCount(): number {
    let c = 0;
    for (const s of this._edges.values()) c += s.size;
    return c;
  }

  /**
   * Topological sort using Kahn's BFS algorithm.
   *
   * Returns nodes in an order where every node's dependencies appear before it.
   * Throws `CycleError` if a cycle exists.
   */
  sort(): T[] {
    const inDegree = new Map<T, number>();
    for (const n of this._nodes) inDegree.set(n, this._inEdges.get(n)!.size);

    const queue: T[] = [];
    for (const [n, d] of inDegree) if (d === 0) queue.push(n);

    const result: T[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);
      for (const succ of this._edges.get(node)!) {
        const d = inDegree.get(succ)! - 1;
        inDegree.set(succ, d);
        if (d === 0) queue.push(succ);
      }
    }

    if (result.length !== this._nodes.size) {
      // Find a cycle for the error message
      throw new CycleError(this._findCycle());
    }

    return result;
  }

  /**
   * Returns levels of nodes that can execute in parallel.
   * Level 0 = no dependencies (can start immediately).
   * Level k = all dependencies are in levels 0..k-1.
   *
   * Throws `CycleError` if a cycle exists.
   *
   * @example
   * g.addEdge("a", "c"); g.addEdge("b", "c"); g.addEdge("c", "d");
   * g.batches()  // [["a", "b"], ["c"], ["d"]]
   */
  batches(): T[][] {
    const inDegree = new Map<T, number>();
    for (const n of this._nodes) inDegree.set(n, this._inEdges.get(n)!.size);

    let current: T[] = [];
    for (const [n, d] of inDegree) if (d === 0) current.push(n);

    const levels: T[][] = [];
    let processed = 0;

    while (current.length > 0) {
      levels.push(current);
      processed += current.length;
      const next: T[] = [];
      for (const node of current) {
        for (const succ of this._edges.get(node)!) {
          const d = inDegree.get(succ)! - 1;
          inDegree.set(succ, d);
          if (d === 0) next.push(succ);
        }
      }
      current = next;
    }

    if (processed !== this._nodes.size) {
      throw new CycleError(this._findCycle());
    }

    return levels;
  }

  /**
   * Returns true if the graph has a cycle.
   * Uses DFS with color marking (white/grey/black).
   */
  hasCycle(): boolean {
    try { this.sort(); return false; }
    catch (e) { return e instanceof CycleError; }
  }

  /**
   * Find all simple cycles (SCCs with more than one node).
   * Uses Tarjan's SCC algorithm.
   */
  findCycles(): T[][] {
    // Tarjan's strongly connected components
    let index = 0;
    const stack: T[] = [];
    const onStack = new Set<T>();
    const idx = new Map<T, number>();
    const low = new Map<T, number>();
    const cycles: T[][] = [];

    const strongConnect = (v: T) => {
      idx.set(v, index);
      low.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      for (const w of this._edges.get(v)!) {
        if (!idx.has(w)) {
          strongConnect(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        }
      }

      if (low.get(v) === idx.get(v)) {
        const scc: T[] = [];
        let w: T;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        if (scc.length > 1) cycles.push(scc.reverse());
      }
    };

    for (const v of this._nodes) {
      if (!idx.has(v)) strongConnect(v);
    }

    return cycles;
  }

  /**
   * Ancestors of a node: all nodes that can reach this node
   * following directed edges (transitively reachable predecessors).
   */
  ancestors(node: T): Set<T> {
    const visited = new Set<T>();
    const queue: T[] = [...(this._inEdges.get(node) ?? [])];
    while (queue.length > 0) {
      const n = queue.shift()!;
      if (!visited.has(n)) {
        visited.add(n);
        for (const p of this._inEdges.get(n) ?? []) queue.push(p);
      }
    }
    return visited;
  }

  /**
   * Descendants of a node: all nodes reachable from this node
   * following directed edges.
   */
  descendants(node: T): Set<T> {
    const visited = new Set<T>();
    const queue: T[] = [...(this._edges.get(node) ?? [])];
    while (queue.length > 0) {
      const n = queue.shift()!;
      if (!visited.has(n)) {
        visited.add(n);
        for (const s of this._edges.get(n) ?? []) queue.push(s);
      }
    }
    return visited;
  }

  private _findCycle(): string[] {
    // DFS to find one cycle; nodes are converted to strings for the error message
    const WHITE = 0, GREY = 1, BLACK = 2;
    const color = new Map<T, number>();
    const parent = new Map<T, T | null>();

    for (const n of this._nodes) color.set(n, WHITE);

    let cycleStart: T | null = null;
    let cycleEnd: T | null = null;

    const dfs = (v: T): boolean => {
      color.set(v, GREY);
      for (const w of this._edges.get(v)!) {
        if (color.get(w) === GREY) {
          cycleStart = w;
          cycleEnd = v;
          return true;
        }
        if (color.get(w) === WHITE) {
          parent.set(w, v);
          if (dfs(w)) return true;
        }
      }
      color.set(v, BLACK);
      return false;
    };

    for (const n of this._nodes) {
      if (color.get(n) === WHITE) {
        parent.set(n, null);
        if (dfs(n)) break;
      }
    }

    if (cycleStart === null) return [];
    const path: string[] = [];
    let cur: T | null = cycleEnd;
    while (cur !== null && cur !== cycleStart) {
      path.push(String(cur));
      cur = parent.get(cur) ?? null;
    }
    path.push(String(cycleStart));
    path.reverse();
    path.push(String(cycleStart));
    return path;
  }
}

// ── Functional API ─────────────────────────────────────────────────────────

/**
 * Functional topological sort.
 *
 * @param nodes  All nodes in the graph (strings or any comparable values).
 * @param edges  Pairs [from, to] meaning `from` must come before `to`.
 *
 * @example
 * topologicalSort(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
 * // ["a", "b", "c"]
 */
export function topologicalSort<T>(nodes: T[], edges: [T, T][]): T[] {
  const g = new DAG<T>();
  for (const n of nodes) g.addNode(n);
  for (const [f, t] of edges) g.addEdge(f, t);
  return g.sort();
}

/**
 * Functional parallel batches — levels of nodes that can run concurrently.
 *
 * @example
 * parallelBatches(["a","b","c","d"], [["a","c"],["b","c"],["c","d"]]);
 * // [["a","b"], ["c"], ["d"]]
 */
export function parallelBatches<T>(nodes: T[], edges: [T, T][]): T[][] {
  const g = new DAG<T>();
  for (const n of nodes) g.addNode(n);
  for (const [f, t] of edges) g.addEdge(f, t);
  return g.batches();
}

/**
 * Check whether edges form a cycle among the given nodes.
 */
export function hasCycle<T>(nodes: T[], edges: [T, T][]): boolean {
  const g = new DAG<T>();
  for (const n of nodes) g.addNode(n);
  for (const [f, t] of edges) g.addEdge(f, t);
  return g.hasCycle();
}
