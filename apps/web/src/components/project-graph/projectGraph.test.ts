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
    expect(feature.y - alias.y).toBe(ROW_HEIGHT);
    expect(feature.height).toBe(ROW_HEIGHT);
    expect(commit.y).toBeGreaterThanOrEqual(alias.y + alias.height);
    expect(layout.lanes.map((lane) => lane.name)).toEqual(["main", "alias", "feat/new"]);
    expect(commit.stations).toHaveLength(1);
    expect(commit.x).toBe(alias.x);
    expect(
      layout.edges.filter(({ from, to }) => from.id === "feature" && to.id === "root"),
    ).toHaveLength(1);
    expect(layout.edges.every(({ from, to }) => from.y < to.y)).toBe(true);
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
    expect(new Set(layout.nodes.map((node) => node.id))).toEqual(
      new Set([
        "branch:main",
        "root",
        "branch:feat/new",
        "branch:alias",
        "feature",
        "worktree:/repo/worktree",
        "detached",
      ]),
    );
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
    expect(
      cards
        .find((node) => node.worktrees[0]?.path === detached.path)
        ?.threads.map((entry) => entry.id),
    ).toEqual(["thread"]);
    expect(
      cards
        .find((node) => node.worktrees[0]?.path === second.path)
        ?.threads.map((entry) => entry.id),
    ).toEqual(["other"]);
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
  it("keeps four branch lanes and draws common history exactly once on the originating branch", () => {
    const branches = ["mvp", "cube-draw", "main", "cube-collection"].map((name) => ({
      name,
      head: name === "main" ? "root" : "feature",
      current: name === "main",
      merged: name === "main",
      ...(!["main", "mvp"].includes(name) ? { createdFrom: "mvp" } : {}),
    }));
    const first = layoutProjectGraph({ ...graph, branches, worktrees: [] }, []);
    const reordered = layoutProjectGraph(
      { ...graph, branches: branches.toReversed(), worktrees: [] },
      [],
    );
    expect(first.lanes.map((lane) => lane.name)).toEqual([
      "main",
      "mvp",
      "cube-collection",
      "cube-draw",
    ]);
    expect(first.lanes).toEqual(reordered.lanes);
    const tip = first.nodes.find((node) => node.id === "feature")!;
    const root = first.nodes.find((node) => node.id === "root")!;
    expect(tip.stations).toHaveLength(1);
    expect(tip.x).toBe(first.lanes[1]?.x);
    expect(root.stations).toHaveLength(1);
    expect(root.x).toBe(first.lanes[0]?.x);
    expect(
      first.edges.filter(({ from, to }) => from.id === "feature" && to.id === "root"),
    ).toHaveLength(1);
    for (const lane of first.lanes.slice(1, 4)) {
      const ref = first.nodes.find((node) => node.id === lane.id)!;
      expect(ref.x).toBe(lane.x);
      expect(first.edges.find(({ from, to }) => from.id === ref.id && to.id === tip.id)?.to.x).toBe(
        tip.x,
      );
    }
  });
  it("draws diverging branches separately until their common ancestor, with no repeated commit dots", () => {
    const history: VcsProjectGraph = {
      defaultBranch: "main",
      truncated: false,
      worktrees: [],
      branches: [
        { name: "main", head: "root", current: true, merged: true },
        { name: "left", head: "left-tip", current: false, merged: false },
        { name: "right", head: "right-tip", current: false, merged: false },
      ],
      commits: [
        { id: "left-tip", parents: ["shared"], subject: "Left only" },
        { id: "right-tip", parents: ["shared"], subject: "Right only" },
        { id: "shared", parents: ["root"], subject: "Common history" },
        { id: "root", parents: [], subject: "Base" },
      ],
    };
    const layout = layoutProjectGraph(history, []);
    const commits = layout.nodes.filter((node) => node.kind === "commit");
    expect(commits).toHaveLength(4);
    expect(commits.every((node) => node.stations.length === 1)).toBe(true);
    expect(commits.find((node) => node.id === "left-tip")?.x).not.toBe(
      commits.find((node) => node.id === "right-tip")?.x,
    );
    const incoming = layout.edges.filter(
      ({ from, to }) => from.kind === "commit" && to.id === "shared",
    );
    expect(incoming).toHaveLength(2);
    expect(new Set(incoming.map(({ to }) => to.x)).size).toBe(1);
    expect(layout.edges.filter(({ from }) => from.id === "shared")).toHaveLength(1);
  });
  it("handles cyclic or missing origin hints without duplicating commits", () => {
    const layout = layoutProjectGraph(
      {
        ...graph,
        branches: graph.branches.map((branch) => ({
          ...branch,
          createdFrom: branch.name === "alias" ? "feat/new" : "alias",
        })),
      },
      [],
    );
    expect(
      layout.nodes
        .filter((node) => node.kind === "commit")
        .every((node) => node.stations.length === 1),
    ).toBe(true);
    expect(layout.lanes.map((lane) => lane.name)).not.toContain("Shared history");
  });
  it("places source branches first and newer siblings to the right regardless of names", () => {
    const branches = [
      {
        name: "aaa-new",
        head: "feature",
        current: false,
        merged: false,
        createdFrom: "mvp",
        createdAtEpochSeconds: 300,
      },
      {
        name: "zzz-old",
        head: "feature",
        current: false,
        merged: false,
        createdFrom: "mvp",
        createdAtEpochSeconds: 200,
      },
      {
        name: "mvp",
        head: "feature",
        current: false,
        merged: false,
        createdFrom: "main",
        createdAtEpochSeconds: 100,
      },
      { name: "main", head: "root", current: true, merged: true },
    ];
    const layout = layoutProjectGraph({ ...graph, branches, worktrees: [] }, []);
    expect(layout.lanes.map((lane) => lane.name)).toEqual(["main", "mvp", "zzz-old", "aaa-new"]);
    const appended = layoutProjectGraph(
      {
        ...graph,
        branches: [
          ...branches,
          {
            name: "000-latest",
            head: "feature",
            current: false,
            merged: false,
            createdFrom: "mvp",
            createdAtEpochSeconds: 400,
          },
        ],
        worktrees: [],
      },
      [],
    );
    expect(appended.lanes.slice(0, 4)).toEqual(layout.lanes);
    expect(appended.lanes[4]?.name).toBe("000-latest");
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
