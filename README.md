# dagkit

Zero-dependency TypeScript DAG (Directed Acyclic Graph) utilities: topological sort, parallel execution batches, cycle detection, ancestors/descendants. Port of Python `graphlib` (stdlib since 3.9), Java Guava `Graph`, Go `gonum/graph`.

[![npm](https://img.shields.io/npm/v/dagkit)](https://www.npmjs.com/package/dagkit)
[![license](https://img.shields.io/npm/l/dagkit)](LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)

## Install

```bash
npm install dagkit
```

## Why?

The most downloaded topological sort package on npm (`toposort`, 12M/week) has been abandoned since 2018 with no TypeScript types. Python added `graphlib.TopologicalSorter` to its **standard library** in Python 3.9 — DAG utilities are a first-class primitive.

`dagkit` fills this gap with a full TypeScript-native DAG class plus functional helpers.

## Quick start

```typescript
import { DAG } from "dagkit";

const g = new DAG<string>();

// Build a build pipeline: "compile" must happen before "test", "test" before "deploy"
g.addEdge("compile", "test");
g.addEdge("test", "deploy");

// Topological order
g.sort();    // ["compile", "test", "deploy"]

// Which steps can run in parallel?
g.batches(); // [["compile"], ["test"], ["deploy"]]
```

## Functional API

For one-shot usage without creating a `DAG` object:

```typescript
import { topologicalSort, parallelBatches, hasCycle } from "dagkit";

// Install packages in dependency order
const packages = ["react-dom", "react", "my-app", "lodash"];
const deps: [string, string][] = [
  ["react", "react-dom"],
  ["react", "my-app"],
  ["react-dom", "my-app"],
  ["lodash", "my-app"],
];
topologicalSort(packages, deps);
// e.g. ["react", "lodash", "react-dom", "my-app"]

// CI: compile-a and compile-b in parallel, then test, then deploy
parallelBatches(
  ["compile-a", "compile-b", "test", "deploy"],
  [["compile-a", "test"], ["compile-b", "test"], ["test", "deploy"]]
);
// [["compile-a", "compile-b"], ["test"], ["deploy"]]

hasCycle(["a", "b"], [["a", "b"], ["b", "a"]]);  // true
```

## DAG class

```typescript
const g = new DAG<string>();

// ── Build the graph ──────────────────────────────────────────────────────
g.addNode("isolated");          // standalone node
g.addEdge("a", "b");            // a → b (b depends on a); also adds a and b
g.removeEdge("a", "b");         // remove edge
g.removeNode("b");              // remove node and all its edges

// ── Query ────────────────────────────────────────────────────────────────
g.hasNode("a");                 // true
g.hasEdge("a", "b");            // false (removed)
g.nodes();                      // ["isolated", "a", ...]
g.edges();                      // [["from", "to"], ...]
g.successors("a");              // nodes that depend on a (direct)
g.predecessors("b");            // nodes a depends on (direct)
g.nodeCount;                    // number of nodes
g.edgeCount;                    // number of edges

// ── Topological sort — Kahn's BFS, O(V + E) ─────────────────────────────
g.sort();                       // sorted order; throws CycleError if cycle

// ── Parallel batches — levels for concurrent execution ───────────────────
g.batches();                    // [[level0], [level1], ...]; throws CycleError

// ── Cycle detection ──────────────────────────────────────────────────────
g.hasCycle();                   // boolean
g.findCycles();                 // T[][] — all SCCs (Tarjan's algorithm)

// ── Reachability ─────────────────────────────────────────────────────────
g.ancestors("d");               // Set of all nodes from which d is reachable
g.descendants("a");             // Set of all nodes reachable from a
```

## Real-world examples

### Package dependency installation order

```typescript
import { topologicalSort, CycleError } from "dagkit";

interface Package { name: string; deps: string[] }

function installOrder(packages: Package[]): string[] {
  const names = packages.map(p => p.name);
  const edges: [string, string][] = packages.flatMap(p =>
    p.deps.map(dep => [dep, p.name] as [string, string])
  );
  try {
    return topologicalSort(names, edges);
  } catch (e) {
    if (e instanceof CycleError) {
      throw new Error(`Circular dependency detected: ${e.cycle.join(" → ")}`);
    }
    throw e;
  }
}
```

### CI/CD pipeline with parallel steps

```typescript
import { DAG } from "dagkit";

const pipeline = new DAG<string>();

// Setup
pipeline.addEdge("checkout", "lint");
pipeline.addEdge("checkout", "unit-tests");
pipeline.addEdge("checkout", "type-check");

// Build (waits for all checks)
pipeline.addEdge("lint", "build");
pipeline.addEdge("unit-tests", "build");
pipeline.addEdge("type-check", "build");

// Deploy
pipeline.addEdge("build", "integration-tests");
pipeline.addEdge("integration-tests", "deploy");

const schedule = pipeline.batches();
// [
//   ["checkout"],
//   ["lint", "unit-tests", "type-check"],  // runs in parallel
//   ["build"],
//   ["integration-tests"],
//   ["deploy"]
// ]

// Total wall-clock time = sum of slowest step per batch
// vs. sequential = sum of ALL steps
```

### Task scheduler: affected tasks when a file changes

```typescript
import { DAG } from "dagkit";

const taskGraph = new DAG<string>();
taskGraph.addEdge("parse", "typecheck");
taskGraph.addEdge("parse", "lint");
taskGraph.addEdge("typecheck", "bundle");
taskGraph.addEdge("lint", "bundle");
taskGraph.addEdge("bundle", "test");

// File changed → "parse" must re-run. What else needs re-running?
const affected = taskGraph.descendants("parse");
// Set { "typecheck", "lint", "bundle", "test" }
```

### Validate no circular imports

```typescript
import { hasCycle, CycleError, DAG } from "dagkit";

// From your bundler's import graph
const modules = ["app", "utils", "types", "config"];
const imports: [string, string][] = [
  ["config", "utils"],
  ["utils", "types"],
  ["types", "app"],
  // ["app", "config"],  // would create a cycle!
];

if (hasCycle(modules, imports)) {
  const g = new DAG<string>();
  for (const m of modules) g.addNode(m);
  for (const [f, t] of imports) g.addEdge(f, t);
  const cycles = g.findCycles();
  throw new Error(`Circular imports: ${cycles.map(c => c.join(" → ")).join(", ")}`);
}
```

## API Reference

### `new DAG<T>()`

| Method | Returns | Description |
|---|---|---|
| `addNode(node)` | `this` | Add node (idempotent) |
| `addEdge(from, to)` | `this` | Add directed edge; adds nodes if missing |
| `removeNode(node)` | `boolean` | Remove node and all its edges |
| `removeEdge(from, to)` | `boolean` | Remove specific edge |
| `hasNode(node)` | `boolean` | Test node existence |
| `hasEdge(from, to)` | `boolean` | Test edge existence |
| `nodes()` | `T[]` | All nodes |
| `edges()` | `[T,T][]` | All edges as from/to pairs |
| `successors(node)` | `T[]` | Direct dependents of node |
| `predecessors(node)` | `T[]` | Direct dependencies of node |
| `nodeCount` | `number` | Total nodes |
| `edgeCount` | `number` | Total edges |
| `sort()` | `T[]` | Topological order; throws `CycleError` on cycle |
| `batches()` | `T[][]` | Parallel execution levels; throws `CycleError` on cycle |
| `hasCycle()` | `boolean` | True if graph has a cycle |
| `findCycles()` | `T[][]` | All strongly-connected components (Tarjan's) |
| `ancestors(node)` | `Set<T>` | All nodes that can reach this node |
| `descendants(node)` | `Set<T>` | All nodes reachable from this node |

### Functional helpers

| Function | Description |
|---|---|
| `topologicalSort(nodes, edges)` | One-shot toposort; throws `CycleError` |
| `parallelBatches(nodes, edges)` | One-shot batch levels; throws `CycleError` |
| `hasCycle(nodes, edges)` | Returns `boolean` |

### `CycleError`

```typescript
class CycleError extends Error {
  readonly cycle: string[];  // path showing the cycle
}
```

## License

MIT
