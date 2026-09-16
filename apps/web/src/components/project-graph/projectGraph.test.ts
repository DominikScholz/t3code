import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type VcsProjectGraph,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  canCloseGraphWorktree,
  graphEdgePath,
  layoutProjectGraph,
  ROW_HEIGHT,
} from "./projectGraph";

const tree: VcsProjectGraph["worktrees"][number] = {
  path: "/repo/worktree",
  head: "feature",
  branch: "feat/new",
  isMain: false,
  locked: false,
  prunable: false,
};
const graph: VcsProjectGraph = {
  defaultBranch: "main",
  truncated: false,
  branches: [
    { name: "main", head: "root", current: true, merged: true },
    { name: "feat/new", head: "feature", current: false, merged: false },
    { name: "alias", head: "feature", current: false, merged: false },
  ],
  commits: [
    { id: "feature", parents: ["root"], subject: "New work" },
    { id: "root", parents: [], subject: "Initial" },
  ],
  worktrees: [tree],
};
function thread(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    id: ThreadId.make("thread"),
    environmentId: EnvironmentId.make("local"),
    projectId: ProjectId.make("project"),
    title: "Design canvas",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feat/new",
    worktreePath: null,
    latestTurn: null,
    session: null,
    createdAt: "2026-09-16T10:00:00.000Z",
    updatedAt: "2026-09-16T10:00:00.000Z",
    archivedAt: null,
    settledAt: null,
    settledOverride: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    pullRequests: [],
    ...overrides,
  };
}
describe("project graph", () => {
  it("keeps shared-tip branches separate and orders unsettled threads first", () => {
    const layout = layoutProjectGraph(graph, [
      thread({ id: ThreadId.make("settled"), settledAt: "2026-09-16T10:00:00.000Z" }),
      thread(),
      thread({ id: ThreadId.make("alias-thread"), branch: "alias" }),
    ]);
    const feature = layout.nodes.find((entry) => entry.id === "branch:feat/new")!;
    const alias = layout.nodes.find((entry) => entry.id === "branch:alias")!;
    const commit = layout.nodes.find((entry) => entry.id === "feature")!;
    expect(feature.branches.map((branch) => branch.name)).toEqual(["feat/new"]);
    expect(alias.branches.map((branch) => branch.name)).toEqual(["alias"]);
    expect(feature.commitId).toBe(alias.commitId);
    expect(feature.threads.map((entry) => entry.id)).toEqual(["thread", "settled"]);
    expect(alias.threads.map((entry) => entry.id)).toEqual(["alias-thread"]);
    expect(commit.threads).toHaveLength(0);
    expect(alias.y - feature.y).toBe(ROW_HEIGHT);
    expect(feature.height).toBe(ROW_HEIGHT);
    expect(commit.y).toBeGreaterThanOrEqual(alias.y + alias.height);
    expect(layout.edges.map(({ from, to }) => [from.id, to.id])).toEqual([
      ["branch:feat/new", "feature"],
      ["branch:alias", "feature"],
      ["feature", "root"],
      ["branch:main", "root"],
    ]);
  });
  it("keeps three shared-tip worktrees and their threads on their respective branches", () => {
    const branches = ["cube-collection", "cube-draw", "mvp"];
    const worktrees = branches.map((branch) => ({ ...tree, branch, path: `/repo/${branch}` }));
    const layout = layoutProjectGraph(
      {
        ...graph,
        branches: branches.map((name) => ({
          name,
          head: "feature",
          current: false,
          merged: false,
        })),
        worktrees,
      },
      worktrees.map((worktree, index) =>
        thread({
          id: ThreadId.make(`thread-${index}`),
          branch: "stale-branch",
          worktreePath: worktree.path,
        }),
      ),
    );
    const cards = layout.nodes.filter((node) => node.worktrees.length > 0);
    expect(cards).toHaveLength(3);
    for (const [index, card] of cards.entries()) {
      expect(card.branches.map((branch) => branch.name)).toEqual([branches[index]]);
      expect(card.worktrees.map((worktree) => worktree.path)).toEqual([worktrees[index]!.path]);
      expect(card.threads.map((entry) => entry.id)).toEqual([`thread-${index}`]);
    }
    expect(new Set(cards.map((card) => card.y)).size).toBe(3);
    expect(cards.every((card) => card.height === ROW_HEIGHT && card.kind === "ref")).toBe(true);
  });
  it("attaches worktree threads by checkout even when branch metadata is stale", () => {
    const layout = layoutProjectGraph(graph, [thread({ branch: "main", worktreePath: tree.path })]);
    expect(layout.nodes.find((node) => node.id === "branch:feat/new")?.threads).toHaveLength(1);
    expect(layout.nodes.find((node) => node.id === "branch:main")?.threads).toHaveLength(0);
  });
  it("keeps missing worktrees and deleted branches visible without assigning them to live checkouts", () => {
    const layout = layoutProjectGraph(graph, [
      thread({ worktreePath: "/gone" }),
      thread({ id: ThreadId.make("deleted"), branch: "deleted" }),
      thread({ id: ThreadId.make("archived"), archivedAt: "2026-09-16T10:00:00.000Z" }),
    ]);
    expect(layout.nodes.find((node) => node.id === "missing-worktree:/gone")?.threads).toHaveLength(
      1,
    );
    expect(layout.nodes.find((node) => node.id === "missing-branch:deleted")?.threads).toHaveLength(
      1,
    );
    expect(layout.nodes.flatMap((node) => node.threads)).toHaveLength(2);
  });
  it("retains tips outside truncated history and detached worktrees", () => {
    const layout = layoutProjectGraph(
      {
        ...graph,
        commits: [],
        worktrees: [{ ...tree, head: "detached", branch: null }],
        truncated: true,
      },
      [],
    );
    expect(layout.nodes.map((node) => node.id)).toEqual([
      "branch:main",
      "root",
      "branch:feat/new",
      "branch:alias",
      "feature",
      "worktree:/repo/worktree",
      "detached",
    ]);
    expect(layout.nodes.every((node) => Number.isFinite(node.x) && node.height > 0)).toBe(true);
  });
  it("does not mix detached worktrees with branches or other detached checkouts at the same commit", () => {
    const detached = { ...tree, branch: null };
    const second = { ...detached, path: "/repo/other" };
    const layout = layoutProjectGraph({ ...graph, worktrees: [detached, second] }, [
      thread({ worktreePath: detached.path }),
      thread({ id: ThreadId.make("other"), worktreePath: second.path }),
    ]);
    expect(layout.nodes.find((node) => node.id === "branch:feat/new")?.threads).toHaveLength(0);
    const cards = layout.nodes.filter((node) => node.worktrees.length > 0);
    expect(cards.map((node) => node.threads.map((entry) => entry.id))).toEqual([
      ["thread"],
      ["other"],
    ]);
    expect(cards.every((node) => node.commitId === "feature" && node.branches.length === 0)).toBe(
      true,
    );
  });
  it("shows unborn checkouts without a fake all-zero history node", () => {
    const layout = layoutProjectGraph(
      {
        defaultBranch: null,
        truncated: false,
        branches: [],
        commits: [],
        worktrees: [{ ...tree, head: "0".repeat(40) }],
      },
      [thread({ worktreePath: tree.path })],
    );
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]?.commitId).toBeNull();
    expect(layout.nodes[0]?.threads).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
  });
  it("renders every commit in a diverging and merging history with distinct tracks", () => {
    const commits = [
      { id: "merge", parents: ["main-tip", "feature-tip"], subject: "Merge" },
      { id: "main-tip", parents: ["root"], subject: "Main change" },
      { id: "feature-tip", parents: ["feature-start"], subject: "Feature change" },
      { id: "feature-start", parents: ["root"], subject: "Branch starts here" },
      { id: "root", parents: [], subject: "Base" },
    ];
    const layout = layoutProjectGraph({ ...graph, branches: [], worktrees: [], commits }, []);
    expect(layout.nodes.filter((node) => node.kind === "commit").map((node) => node.id)).toEqual(
      commits.map((commit) => commit.id),
    );
    const [merge, main, feature, start, root] = layout.nodes;
    expect(main!.x).toBe(root!.x);
    expect(feature!.x).toBe(start!.x);
    expect(main!.x).not.toBe(feature!.x);
    expect(main!.color).not.toBe(feature!.color);
    expect(layout.edges).toHaveLength(5);
    expect(layout.edges.every(({ from, to }) => from.y < to.y)).toBe(true);
    // The merge's second-parent line leaves before the next main-line commit.
    const path = graphEdgePath(merge!, feature!);
    expect(path).toContain(`V ${merge!.y + ROW_HEIGHT - 8}`);
    expect(graphEdgePath(main!, root!)).toBe(
      `M ${main!.x} ${main!.y + ROW_HEIGHT / 2} V ${root!.y + ROW_HEIGHT / 2}`,
    );
  });
  it("protects main, locked and missing worktrees", () => {
    expect(canCloseGraphWorktree(tree, [])).toBe(true);
    expect(canCloseGraphWorktree({ ...tree, isMain: true }, [])).toBe(false);
    expect(canCloseGraphWorktree({ ...tree, locked: true }, [])).toBe(false);
    expect(canCloseGraphWorktree({ ...tree, prunable: true }, [])).toBe(false);
  });
});

it("protects worktrees with live background tasks and normalizes checkout paths", () => {
  const windowsTree = { ...tree, path: "C:/repo/worktree" };
  const active = thread({ worktreePath: "c:\\repo\\worktree\\", backgroundLiveness: "working" });
  expect(canCloseGraphWorktree(windowsTree, [active])).toBe(false);
  const layout = layoutProjectGraph({ ...graph, worktrees: [windowsTree] }, [active]);
  expect(layout.nodes.find((node) => node.id === "branch:feat/new")?.threads).toHaveLength(1);
});
