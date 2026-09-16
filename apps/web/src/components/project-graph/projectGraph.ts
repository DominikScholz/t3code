import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import type { VcsProjectGraph } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

export type GraphStation = { lane: number; x: number; color: string };
export type GraphNode = {
  id: string;
  commitId: string | null;
  subject: string;
  parents: readonly string[];
  branches: VcsProjectGraph["branches"][number][];
  worktrees: VcsProjectGraph["worktrees"][number][];
  threads: EnvironmentThreadShell[];
  x: number;
  y: number;
  height: number;
  color: string;
  kind: "commit" | "ref" | "orphan";
  stations: GraphStation[];
};
export const NODE_WIDTH = 660;
export const ROW_HEIGHT = 36;
const LANE_WIDTH = 112;
const LINE_COLORS = ["#60a5fa", "#a78bfa", "#34d399", "#fb923c", "#f472b6", "#22d3ee"];

/** Worktree identity wins over stale thread branch metadata after a checkout switch. */
export function layoutProjectGraph(
  graph: VcsProjectGraph,
  threads: readonly EnvironmentThreadShell[],
) {
  const nodes = new Map<string, GraphNode>();
  const ensure = (
    id: string,
    subject = "History outside this view",
    parents: readonly string[] = [],
    commitId: string | null = null,
  ) => {
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        commitId,
        subject,
        parents,
        branches: [],
        worktrees: [],
        threads: [],
        x: 0,
        y: 0,
        height: ROW_HEIGHT,
        color: LINE_COLORS[0]!,
        kind: commitId === id ? "commit" : commitId ? "ref" : "orphan",
        stations: [],
      };
      nodes.set(id, node);
    }
    return node;
  };
  const commits = new Map(graph.commits.map((commit) => [commit.id, commit]));
  const ensureCommit = (id: string) => {
    const commit = commits.get(id);
    return ensure(id, commit?.subject, commit?.parents, id);
  };
  for (const commit of graph.commits) ensureCommit(commit.id);
  const ensureCard = (id: string, head: string, fallback: string) => {
    const existing = nodes.get(id);
    if (existing) return existing;
    // An unborn worktree reports an empty or all-zero object id.
    const commit = head && !/^0+$/.test(head) ? ensureCommit(head) : null;
    const card = ensure(id, commit?.subject ?? fallback, commit ? [commit.id] : [], commit?.id);
    return card;
  };
  const branchesByName = new Map(
    graph.branches.map((branch) => {
      const node = ensureCard(`branch:${branch.name}`, branch.head, "Unborn branch");
      node.branches.push(branch);
      return [branch.name, node] as const;
    }),
  );
  const treesByPath = new Map<string, GraphNode>();
  for (const tree of graph.worktrees) {
    const branchNode = tree.branch ? branchesByName.get(tree.branch) : undefined;
    const node =
      branchNode?.commitId === tree.head
        ? branchNode
        : ensureCard(`worktree:${tree.path}`, tree.head, "Unborn checkout");
    node.worktrees.push(tree);
    treesByPath.set(normalizeProjectPathForComparison(tree.path), node);
  }
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const treeNode = thread.worktreePath
      ? treesByPath.get(normalizeProjectPathForComparison(thread.worktreePath))
      : undefined;
    const branchNode = thread.branch ? branchesByName.get(thread.branch) : undefined;
    const node =
      treeNode ??
      (thread.worktreePath
        ? ensure(`missing-worktree:${thread.worktreePath}`, "Worktree no longer present")
        : (branchNode ??
          ensure(
            `missing-branch:${thread.branch ?? "unassigned"}`,
            `Branch no longer present: ${thread.branch ?? "unassigned"}`,
          )));
    node.threads.push(thread);
  }
  const refs = [...nodes.values()].filter(
    (node) => node.kind !== "commit" && !node.id.startsWith("missing-"),
  );
  const refName = (node: GraphNode) => node.branches[0]?.name ?? node.worktrees[0]?.path ?? node.id;
  refs.sort(
    (a, b) =>
      Number(b.branches[0]?.name === graph.defaultBranch) -
        Number(a.branches[0]?.name === graph.defaultBranch) ||
      (a.branches[0]?.createdAtEpochSeconds ?? Number.MAX_SAFE_INTEGER) -
        (b.branches[0]?.createdAtEpochSeconds ?? Number.MAX_SAFE_INTEGER) ||
      refName(a).localeCompare(refName(b)),
  );
  // Keep sources to the left of descendants even if names or timestamps disagree.
  // Creation time orders siblings; missing provenance falls back to the stable name sort.
  const lineageOrder: GraphNode[] = [];
  const visitedRefs = new Set<string>();
  const appendRef = (ref: GraphNode) => {
    if (visitedRefs.has(ref.id)) return;
    visitedRefs.add(ref.id);
    const originName = ref.branches[0]?.createdFrom;
    const origin = originName ? branchesByName.get(originName) : undefined;
    if (origin) appendRef(origin);
    lineageOrder.push(ref);
  };
  const defaultRef = refs.find((ref) => ref.branches[0]?.name === graph.defaultBranch);
  if (defaultRef) {
    visitedRefs.add(defaultRef.id);
    lineageOrder.push(defaultRef);
  }
  for (const ref of refs) appendRef(ref);
  refs.splice(0, refs.length, ...lineageOrder);
  const lanes: (GraphStation & { id: string; name: string })[] = [];
  const addLane = (id: string, name: string) => {
    const lane = {
      id,
      name,
      lane: lanes.length,
      x: 72 + lanes.length * LANE_WIDTH,
      color: LINE_COLORS[lanes.length % LINE_COLORS.length]!,
    };
    lanes.push(lane);
    return lane;
  };
  const walk = (start: string, lane: GraphStation) => {
    let id: string | undefined = start;
    while (id) {
      const node = nodes.get(id);
      // A commit is one Git object, even when many branches can reach it.
      // Joining an assigned node ends this track instead of duplicating its ancestry.
      if (!node || node.kind !== "commit" || node.stations.length > 0) break;
      node.stations.push(lane);
      id = node.parents[0];
    }
  };
  for (const ref of refs) {
    ref.stations.push(addLane(ref.id, ref.branches[0]?.name ?? "Detached checkout"));
  }
  // Claim source-branch ancestry before its descendants. Reflog provenance resolves
  // equal tips without inventing a separate shared branch or duplicating commits.
  const assignedRefs = new Set<string>();
  const assignHistory = (ref: GraphNode) => {
    if (assignedRefs.has(ref.id)) return;
    assignedRefs.add(ref.id);
    const originName = ref.branches[0]?.createdFrom;
    const origin = originName ? branchesByName.get(originName) : undefined;
    if (origin) assignHistory(origin);
    if (ref.commitId) walk(ref.commitId, ref.stations[0]!);
  };
  const base = refs.find((ref) => ref.branches[0]?.name === graph.defaultBranch);
  if (base) {
    assignedRefs.add(base.id);
    if (base.commitId) walk(base.commitId, base.stations[0]!);
  }
  for (const ref of refs) assignHistory(ref);
  // Merged ancestry without a live ref still has exactly one track.
  for (const node of nodes.values()) {
    if (node.kind === "commit" && node.stations.length === 0) {
      walk(node.id, addLane(`history:${node.id}`, "Merged history"));
    }
  }
  const orphans = [...nodes.values()].filter((node) => node.id.startsWith("missing-"));
  const ordered = [
    ...refs,
    ...[...nodes.values()].filter((node) => node.kind === "commit"),
    ...orphans,
  ];
  let y = 60;
  for (const node of ordered) {
    const station = node.stations[0];
    node.x = station?.x ?? 72;
    node.color = station?.color ?? LINE_COLORS[0]!;
    node.y = y;
    node.threads.sort(
      (a, b) =>
        Number(a.settledAt !== null) - Number(b.settledAt !== null) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
    y += ROW_HEIGHT;
  }
  const edges = ordered.flatMap((node) =>
    node.parents.flatMap((parent) => {
      const target = nodes.get(parent);
      if (!target) return [];
      return node.stations.map((station) => {
        const targetStation =
          target.stations.find((entry) => entry.lane === station.lane) ?? target.stations[0];
        return {
          from: { ...node, x: station.x, color: station.color },
          to: { ...target, x: targetStation?.x ?? target.x },
          color: station.color,
        };
      });
    }),
  );
  return {
    nodes: ordered,
    edges,
    lanes,
    labelX: 72 + lanes.length * LANE_WIDTH,
    width: 72 + lanes.length * LANE_WIDTH + NODE_WIDTH + 48,
    height: y + 48,
  };
}

export function graphEdgePath(from: GraphNode, to: GraphNode) {
  const x1 = from.x,
    y1 = from.y + ROW_HEIGHT / 2;
  const x2 = to.x,
    y2 = to.y + ROW_HEIGHT / 2;
  if (x1 === x2) return `M ${x1} ${y1} V ${y2}`;
  const direction = Math.sign(x2 - x1);
  const radius = Math.min(8, Math.abs(x2 - x1) / 2);
  const bendY =
    from.kind === "commit" && from.parents.indexOf(to.id) > 0
      ? y1 + ROW_HEIGHT / 2
      : y2 - ROW_HEIGHT / 2;
  return `M ${x1} ${y1} V ${bendY - radius} Q ${x1} ${bendY} ${x1 + direction * radius} ${bendY} H ${x2 - direction * radius} Q ${x2} ${bendY} ${x2} ${bendY + radius} V ${y2}`;
}

export function canCloseGraphWorktree(
  tree: VcsProjectGraph["worktrees"][number],
  threads: readonly EnvironmentThreadShell[],
) {
  return (
    !tree.isMain &&
    !tree.locked &&
    !tree.prunable &&
    !threads.some(
      (thread) =>
        thread.worktreePath !== null &&
        normalizeProjectPathForComparison(thread.worktreePath) ===
          normalizeProjectPathForComparison(tree.path) &&
        (thread.session?.status === "running" ||
          thread.session?.status === "starting" ||
          thread.backgroundLiveness != null),
    )
  );
}
