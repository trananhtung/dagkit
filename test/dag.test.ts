import { DAG, CycleError, topologicalSort, parallelBatches, hasCycle } from "../src/index.js";

// ── DAG class — structure ──────────────────────────────────────────────────

describe("DAG — node and edge management", () => {
  test("addNode / hasNode", () => {
    const g = new DAG<string>();
    g.addNode("a").addNode("b");
    expect(g.hasNode("a")).toBe(true);
    expect(g.hasNode("c")).toBe(false);
    expect(g.nodeCount).toBe(2);
  });

  test("addEdge implicitly adds missing nodes", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b");
    expect(g.hasNode("a")).toBe(true);
    expect(g.hasNode("b")).toBe(true);
    expect(g.hasEdge("a", "b")).toBe(true);
    expect(g.hasEdge("b", "a")).toBe(false);
    expect(g.edgeCount).toBe(1);
  });

  test("nodes() and edges()", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("a", "c");
    expect(new Set(g.nodes())).toEqual(new Set(["a", "b", "c"]));
    expect(new Set(g.edges().map(([f, t]) => `${f}->${t}`))).toEqual(
      new Set(["a->b", "a->c"])
    );
  });

  test("successors and predecessors", () => {
    const g = new DAG<string>();
    g.addEdge("a", "c").addEdge("b", "c").addEdge("c", "d");
    expect(new Set(g.successors("c"))).toEqual(new Set(["d"]));
    expect(new Set(g.predecessors("c"))).toEqual(new Set(["a", "b"]));
    expect(g.predecessors("a")).toEqual([]);
    expect(g.successors("d")).toEqual([]);
  });

  test("removeNode removes edges too", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("b", "c");
    g.removeNode("b");
    expect(g.hasNode("b")).toBe(false);
    expect(g.hasEdge("a", "b")).toBe(false);
    expect(g.hasEdge("b", "c")).toBe(false);
    expect(g.nodeCount).toBe(2);
    expect(g.edgeCount).toBe(0);
  });

  test("removeEdge", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b");
    expect(g.removeEdge("a", "b")).toBe(true);
    expect(g.hasEdge("a", "b")).toBe(false);
    expect(g.removeEdge("a", "b")).toBe(false);
  });
});

// ── Topological sort ───────────────────────────────────────────────────────

describe("DAG — topological sort", () => {
  test("linear chain", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("b", "c").addEdge("c", "d");
    expect(g.sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("single node", () => {
    const g = new DAG<string>();
    g.addNode("a");
    expect(g.sort()).toEqual(["a"]);
  });

  test("empty graph", () => {
    expect(new DAG().sort()).toEqual([]);
  });

  test("diamond dependency: a→b, a→c, b→d, c→d", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("a", "c").addEdge("b", "d").addEdge("c", "d");
    const order = g.sort();
    // a must come first, d must come last
    expect(order[0]).toBe("a");
    expect(order[order.length - 1]).toBe("d");
    // b and c are in between
    expect(new Set(order)).toEqual(new Set(["a", "b", "c", "d"]));
    // verify ordering invariant
    const pos = new Map(order.map((n, i) => [n, i]));
    expect(pos.get("a")! < pos.get("b")!).toBe(true);
    expect(pos.get("a")! < pos.get("c")!).toBe(true);
    expect(pos.get("b")! < pos.get("d")!).toBe(true);
    expect(pos.get("c")! < pos.get("d")!).toBe(true);
  });

  test("nodes with no edges sort in any order", () => {
    const g = new DAG<string>();
    g.addNode("x").addNode("y").addNode("z");
    const result = g.sort();
    expect(result.sort()).toEqual(["x", "y", "z"]);
  });

  test("mixed isolated and connected nodes", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b");
    g.addNode("isolated");
    const result = g.sort();
    expect(result).toHaveLength(3);
    const pos = new Map(result.map((n, i) => [n, i]));
    expect(pos.get("a")! < pos.get("b")!).toBe(true);
  });

  test("throws CycleError on cycle", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("b", "c").addEdge("c", "a");
    expect(() => g.sort()).toThrow(CycleError);
  });

  test("CycleError.cycle contains cycle nodes", () => {
    const g = new DAG<string>();
    g.addEdge("x", "y").addEdge("y", "x");
    try {
      g.sort();
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(CycleError);
      const cycle = (e as CycleError).cycle;
      expect(cycle).toContain("x");
      expect(cycle).toContain("y");
    }
  });
});

// ── Parallel batches ───────────────────────────────────────────────────────

describe("DAG — parallel batches", () => {
  test("linear chain → sequential batches", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("b", "c");
    expect(g.batches()).toEqual([["a"], ["b"], ["c"]]);
  });

  test("two independent roots merge at one node", () => {
    // a, b → c → d
    const g = new DAG<string>();
    g.addEdge("a", "c").addEdge("b", "c").addEdge("c", "d");
    const batches = g.batches();
    expect(batches).toHaveLength(3);
    expect(new Set(batches[0])).toEqual(new Set(["a", "b"]));
    expect(batches[1]).toEqual(["c"]);
    expect(batches[2]).toEqual(["d"]);
  });

  test("fully parallel graph (no edges)", () => {
    const g = new DAG<string>();
    g.addNode("a").addNode("b").addNode("c");
    const batches = g.batches();
    expect(batches).toHaveLength(1);
    expect(new Set(batches[0])).toEqual(new Set(["a", "b", "c"]));
  });

  test("complex build-system example", () => {
    // compile-a and compile-b can run in parallel
    // link depends on both
    // test depends on link
    // package depends on test
    const g = new DAG<string>();
    g.addEdge("compile-a", "link");
    g.addEdge("compile-b", "link");
    g.addEdge("link", "test");
    g.addEdge("test", "package");
    const batches = g.batches();
    expect(new Set(batches[0])).toEqual(new Set(["compile-a", "compile-b"]));
    expect(batches[1]).toEqual(["link"]);
    expect(batches[2]).toEqual(["test"]);
    expect(batches[3]).toEqual(["package"]);
  });

  test("throws CycleError on cycle", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("b", "a");
    expect(() => g.batches()).toThrow(CycleError);
  });
});

// ── Cycle detection ────────────────────────────────────────────────────────

describe("DAG — cycle detection", () => {
  test("hasCycle returns false for acyclic graph", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("b", "c");
    expect(g.hasCycle()).toBe(false);
  });

  test("hasCycle returns true for simple cycle", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("b", "a");
    expect(g.hasCycle()).toBe(true);
  });

  test("hasCycle detects self-loop", () => {
    const g = new DAG<string>();
    g.addEdge("a", "a");
    expect(g.hasCycle()).toBe(true);
  });

  test("findCycles returns all SCCs with > 1 node", () => {
    const g = new DAG<string>();
    // Two separate cycles: a→b→a and c→d→e→c
    g.addEdge("a", "b").addEdge("b", "a");
    g.addEdge("c", "d").addEdge("d", "e").addEdge("e", "c");
    const cycles = g.findCycles();
    expect(cycles).toHaveLength(2);
    // Each cycle contains the right nodes
    const cycleSets = cycles.map(c => new Set(c));
    expect(cycleSets.some(s => s.has("a") && s.has("b"))).toBe(true);
    expect(cycleSets.some(s => s.has("c") && s.has("d") && s.has("e"))).toBe(true);
  });

  test("findCycles returns empty array for acyclic graph", () => {
    const g = new DAG<string>();
    g.addEdge("a", "b").addEdge("b", "c");
    expect(g.findCycles()).toEqual([]);
  });
});

// ── Ancestors / descendants ────────────────────────────────────────────────

describe("DAG — ancestors and descendants", () => {
  let g: DAG<string>;
  beforeEach(() => {
    g = new DAG<string>();
    // a → b → d
    // a → c → d
    //     c → e
    g.addEdge("a", "b").addEdge("a", "c");
    g.addEdge("b", "d").addEdge("c", "d").addEdge("c", "e");
  });

  test("ancestors of d", () => {
    expect(g.ancestors("d")).toEqual(new Set(["a", "b", "c"]));
  });

  test("ancestors of root (none)", () => {
    expect(g.ancestors("a")).toEqual(new Set());
  });

  test("ancestors of b", () => {
    expect(g.ancestors("b")).toEqual(new Set(["a"]));
  });

  test("descendants of a", () => {
    expect(g.descendants("a")).toEqual(new Set(["b", "c", "d", "e"]));
  });

  test("descendants of c", () => {
    expect(g.descendants("c")).toEqual(new Set(["d", "e"]));
  });

  test("descendants of leaf (none)", () => {
    expect(g.descendants("d")).toEqual(new Set());
  });
});

// ── Functional API ─────────────────────────────────────────────────────────

describe("topologicalSort() — functional", () => {
  test("basic sort", () => {
    const result = topologicalSort(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
    expect(result).toEqual(["a", "b", "c"]);
  });

  test("package dependency resolution", () => {
    const packages = ["react", "react-dom", "my-app", "lodash"];
    const deps: [string, string][] = [
      ["react", "react-dom"],
      ["react", "my-app"],
      ["react-dom", "my-app"],
      ["lodash", "my-app"],
    ];
    const order = topologicalSort(packages, deps);
    const pos = new Map(order.map((p, i) => [p, i]));
    expect(pos.get("react")! < pos.get("react-dom")!).toBe(true);
    expect(pos.get("react")! < pos.get("my-app")!).toBe(true);
    expect(pos.get("react-dom")! < pos.get("my-app")!).toBe(true);
  });

  test("throws on cycle", () => {
    expect(() => topologicalSort(["a", "b"], [["a", "b"], ["b", "a"]])).toThrow(CycleError);
  });
});

describe("parallelBatches() — functional", () => {
  test("CI pipeline: compile in parallel, then test, then deploy", () => {
    const tasks = ["compile-a", "compile-b", "test", "deploy"];
    const deps: [string, string][] = [
      ["compile-a", "test"],
      ["compile-b", "test"],
      ["test", "deploy"],
    ];
    const batches = parallelBatches(tasks, deps);
    expect(new Set(batches[0])).toEqual(new Set(["compile-a", "compile-b"]));
    expect(batches[1]).toEqual(["test"]);
    expect(batches[2]).toEqual(["deploy"]);
  });
});

describe("hasCycle() — functional", () => {
  test("acyclic returns false", () => {
    expect(hasCycle(["a", "b", "c"], [["a", "b"], ["b", "c"]])).toBe(false);
  });

  test("cyclic returns true", () => {
    expect(hasCycle(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]])).toBe(true);
  });
});

// ── Numeric node IDs ───────────────────────────────────────────────────────

describe("DAG — numeric nodes", () => {
  test("sort with numeric task IDs", () => {
    const g = new DAG<number>();
    g.addEdge(1, 2).addEdge(2, 3).addEdge(1, 3);
    const order = g.sort();
    const pos = new Map(order.map((n, i) => [n, i]));
    expect(pos.get(1)! < pos.get(2)!).toBe(true);
    expect(pos.get(1)! < pos.get(3)!).toBe(true);
    expect(pos.get(2)! < pos.get(3)!).toBe(true);
  });
});

// ── Large graph stress test ────────────────────────────────────────────────

describe("DAG — stress test", () => {
  test("500-node linear chain", () => {
    const g = new DAG<number>();
    for (let i = 0; i < 499; i++) g.addEdge(i, i + 1);
    const result = g.sort();
    expect(result).toHaveLength(500);
    for (let i = 0; i < 500; i++) expect(result[i]).toBe(i);
  });

  test("100-node layer graph: batches are correct", () => {
    // Layer 0: nodes 0-9; Layer 1: nodes 10-19 depend on all of layer 0; etc.
    const g = new DAG<number>();
    for (let layer = 0; layer < 4; layer++) {
      for (let n = 0; n < 10; n++) {
        g.addNode(layer * 10 + n);
        if (layer > 0) {
          for (let prev = 0; prev < 10; prev++) {
            g.addEdge((layer - 1) * 10 + prev, layer * 10 + n);
          }
        }
      }
    }
    const batches = g.batches();
    expect(batches).toHaveLength(4);
    for (let l = 0; l < 4; l++) {
      expect(batches[l]).toHaveLength(10);
    }
  });
});
