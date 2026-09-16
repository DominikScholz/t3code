import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import type { VcsProjectGraph } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

export type GraphStation = { lane: number; x: number; color: string };
export type GraphNode = {
  id: string;
  commitId: string | null;
  subject: string;
  author?: VcsProjectGraph["commits"][number]["author"];
  parents: readonly string[];
  branches: VcsProjectGraph["branches"][number][];
  worktrees: VcsProjectGraph["worktrees"][number][];
  threads: EnvironmentThreadShell[];
  x: number;
  y: number;
  height: number;
  labelX: number;
  color: string;
  kind: "commit" | "ref" | "orphan";
  stations: GraphStation[];
};
export const NODE_WIDTH = 660;
export const ROW_HEIGHT = 36;
export const BRANCH_LABEL_WIDTH = 248;
const GRAPH_LEFT = BRANCH_LABEL_WIDTH + 40;
const LANE_WIDTH = 28;
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
        labelX: 0,
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
    const node = ensure(id, commit?.subject, commit?.parents, id);
    if (commit?.author) node.author = commit.author;
    return node;
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
      x: GRAPH_LEFT + lanes.length * LANE_WIDTH,
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
  const refsByCommit = new Map<string, GraphNode[]>();
  for (const ref of refs) {
    ref.height =
      36 + Math.min(3, ref.threads.filter((thread) => thread.settledAt === null).length) * 24;
    if (ref.commitId) {
      const group = refsByCommit.get(ref.commitId) ?? [];
      group.push(ref);
      refsByCommit.set(ref.commitId, group);
    }
  }
  let y = 24;
  for (const node of ordered) {
    const station = node.stations[0];
    node.x = station?.x ?? GRAPH_LEFT;
    node.color = station?.color ?? LINE_COLORS[0]!;
    node.threads.sort(
      (a, b) =>
        Number(a.settledAt !== null) - Number(b.settledAt !== null) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
    if (node.kind !== "commit") continue;
    const labels = refsByCommit.get(node.id) ?? [];
    const rowHeight = Math.max(
      ROW_HEIGHT,
      labels.reduce((height, ref) => height + ref.height, 0),
    );
    let labelY = y;
    for (const ref of labels) {
      ref.y = labelY;
      labelY += ref.height;
    }
    node.y = y + (rowHeight - ROW_HEIGHT) / 2;
    y += rowHeight;
  }
  // Unborn checkouts still have labels, but no fabricated commit or connector.
  for (const ref of refs.filter((node) => !node.commitId)) {
    ref.y = y;
    y += ref.height;
  }
  const edges = ordered.flatMap((node) =>
    node.parents.flatMap((parent) => {
      const target = nodes.get(parent);
      if (!target) return [];
      return node.stations.map((station) => {
        const targetStation =
          target.stations.find((entry) => entry.lane === station.lane) ?? target.stations[0];
        return {
          from: {
            ...node,
            x: node.kind === "ref" ? BRANCH_LABEL_WIDTH + 8 : station.x,
            color: station.color,
          },
          to: { ...target, x: targetStation?.x ?? target.x },
          color:
            node.kind === "commit" && node.parents.indexOf(parent) > 0
              ? target.color
              : station.color,
        };
      });
    }),
  );
  const commitNodes = ordered.filter((node) => node.kind === "commit");
  // A narrow, fixed graph column keeps commit messages aligned like a Git log.
  const labelX =
    commitNodes.reduce((rightmost, node) => Math.max(rightmost, node.x), GRAPH_LEFT) + 28;
  for (const node of commitNodes) node.labelX = labelX;
  return {
    nodes: ordered,
    commitNodes,
    unlinkedNodes: orphans,
    edges,
    lanes,
    width: commitNodes.reduce(
      (width, node) => Math.max(width, node.labelX + NODE_WIDTH + 24),
      labelX + NODE_WIDTH + 24,
    ),
    height: y + 48,
  };
}

export function graphEdgePath(from: GraphNode, to: GraphNode) {
  const x1 = from.x,
    y1 = from.y + ROW_HEIGHT / 2;
  const x2 = to.x,
    y2 = to.y + ROW_HEIGHT / 2;
  if (from.kind === "ref") {
    const elbow = x1 + (x2 - x1) / 2;
    return `M ${x1} ${y1} C ${elbow} ${y1}, ${elbow} ${y2}, ${x2} ${y2}`;
  }
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

/** Only public GitHub noreply identities have a known portrait; other authors stay local. */
export function graphAuthorIdentity(author: GraphNode["author"]) {
  const name = author?.name.trim() || "Unknown author";
  const words = name.split(/\s+/u);
  const initials = author?.name.trim()
    ? `${Array.from(words[0]!)[0] ?? ""}${words.length > 1 ? (Array.from(words.at(-1)!)[0] ?? "") : ""}`.toUpperCase()
    : "?";
  const login = author?.email.match(
    /^(?:\d+\+)?([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)@users\.noreply\.github\.com$/iu,
  )?.[1];
  return { name, initials, avatarUrl: login ? `https://github.com/${login}.png?size=40` : null };
}
