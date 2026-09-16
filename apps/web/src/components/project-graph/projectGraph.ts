import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import type { VcsProjectGraph } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

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
};
export const NODE_WIDTH = 660;
export const ROW_HEIGHT = 36;
const LANE_WIDTH = 24;
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
      };
      nodes.set(id, node);
    }
    return node;
  };
  const commits = new Map(graph.commits.map((commit) => [commit.id, commit]));
  const cardsByCommit = new Map<string, GraphNode[]>();
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
    if (commit) {
      const cards = cardsByCommit.get(commit.id) ?? [];
      cards.push(card);
      cardsByCommit.set(commit.id, cards);
    }
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
  // Refs get compact, separate rows. They point at real commits, never stand in for them.
  const ordered: GraphNode[] = [];
  for (const node of nodes.values()) {
    if (node.kind === "commit") {
      ordered.push(...(cardsByCommit.get(node.id) ?? []), node);
    } else if (node.commitId === null) {
      ordered.push(node);
    }
  }
  const lanes: (string | null)[] = [];
  let y = 24;
  let maxLane = 0;
  for (const node of ordered) {
    let lane = lanes.indexOf(node.id);
    if (lane < 0) {
      lane = lanes.indexOf(null);
      if (lane < 0) lane = lanes.length;
    }
    lanes[lane] = null;
    for (const [index, parent] of node.parents.entries()) {
      if (lanes.includes(parent)) continue;
      let target = index === 0 ? lane : lanes.indexOf(null);
      if (target < 0) target = lanes.length;
      lanes[target] = parent;
    }
    node.x = 32 + lane * LANE_WIDTH;
    node.y = y;
    node.color = LINE_COLORS[lane % LINE_COLORS.length]!;
    node.threads.sort(
      (a, b) =>
        Number(a.settledAt !== null) - Number(b.settledAt !== null) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
    maxLane = Math.max(maxLane, lane, lanes.length - 1);
    y += ROW_HEIGHT;
  }
  for (const node of ordered) {
    if (node.kind === "ref" && node.commitId)
      node.color = nodes.get(node.commitId)?.color ?? node.color;
  }
  const edges = ordered.flatMap((node) =>
    node.parents.flatMap((parent) => {
      const target = nodes.get(parent);
      return target
        ? [
            {
              from: node,
              to: target,
              color: node.parents.indexOf(parent) === 0 ? node.color : target.color,
            },
          ]
        : [];
    }),
  );
  return {
    nodes: ordered,
    edges,
    labelX: 32 + (maxLane + 1) * LANE_WIDTH + 16,
    width: 32 + (maxLane + 1) * LANE_WIDTH + NODE_WIDTH + 48,
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
