import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import type { EnvironmentId, VcsProjectGraph } from "@t3tools/contracts";
import {
  GitBranchIcon,
  CheckIcon,
  MaximizeIcon,
  MessageSquareIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
  FolderGit2Icon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildThreadRouteParams } from "../../threadRoutes";
import { readLocalApi } from "../../localApi";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import { readThreadShell, useProjects, useThreadShellsForProjectRefs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { useSettingsProjectGroups } from "../settings/useSettingsProjectGroups";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  canCloseGraphWorktree,
  layoutProjectGraph,
  graphEdgePath,
  ROW_HEIGHT,
  NODE_WIDTH,
  type GraphNode,
} from "./projectGraph";

export function ProjectGraphPage({
  projectKey,
  gitEnvironment,
  checkout,
}: {
  projectKey: string;
  gitEnvironment?: string | undefined;
  checkout?: string | undefined;
}) {
  const { environments } = useEnvironments();
  const groups = useSettingsProjectGroups();
  const group = groups.find((entry) => entry.projectKey === projectKey);
  const navigate = useNavigate();
  const member =
    group?.memberProjects.find((entry) => `${entry.environmentId}:${entry.id}` === checkout) ??
    group?.memberProjects[0];
  if (!group || !member)
    return (
      <div className="p-8 text-sm text-muted-foreground">
        This project is not available. Choose a project from the sidebar.
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <GitBranchIcon className="size-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            {group.displayName}{" "}
            <span className="ml-2 font-normal text-muted-foreground">/ Project graph</span>
          </h1>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {member.workspaceRoot}
          </p>
        </div>
        {group.memberProjects.length > 1 && (
          <select
            aria-label="Project checkout"
            className="max-w-72 rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={`${member.environmentId}:${member.id}`}
            onChange={(event) =>
              void navigate({
                to: "/project-graph/$projectKey",
                params: { projectKey },
                search: {
                  checkout: event.target.value,
                  ...(gitEnvironment ? { gitEnvironment } : {}),
                },
                replace: true,
              })
            }
          >
            {group.memberProjects.map((entry) => (
              <option
                key={`${entry.environmentId}:${entry.id}`}
                value={`${entry.environmentId}:${entry.id}`}
              >
                {entry.environmentLabel ?? "Local"} · {entry.workspaceRoot}
              </option>
            ))}
          </select>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void navigate({
              to: "/settings/projects",
              search: { project: projectKey, machine: member.environmentId },
            })
          }
        >
          <SettingsIcon className="size-4" /> Settings
        </Button>
      </header>
      {environments.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2 text-xs text-muted-foreground">
          <label htmlFor="graph-git-source">Read Git from</label>
          <select
            id="graph-git-source"
            className="max-w-96 rounded-md border border-border bg-background px-2 py-1 text-foreground"
            value={gitEnvironment ?? member.environmentId}
            onChange={(event) =>
              void navigate({
                to: "/project-graph/$projectKey",
                params: { projectKey },
                search: {
                  gitEnvironment: event.target.value,
                  checkout: `${member.environmentId}:${member.id}`,
                },
                replace: true,
              })
            }
          >
            {environments.map((environment) => (
              <option key={environment.environmentId} value={environment.environmentId}>
                {environment.label} · {environment.displayUrl ?? environment.environmentId}
                {environment.environmentId === member.environmentId ? " (threads live here)" : ""}
              </option>
            ))}
          </select>
          {gitEnvironment && gitEnvironment !== member.environmentId && (
            <span>
              Threads stay live on {member.environmentLabel ?? "their environment"}. Choose a Git
              source with access to the same checkout path.
            </span>
          )}
        </div>
      )}
      <ProjectGraph
        key={`${member.environmentId}:${member.id}`}
        member={member}
        gitEnvironmentId={
          environments.find((entry) => entry.environmentId === gitEnvironment)?.environmentId ??
          member.environmentId
        }
      />
    </div>
  );
}

function ProjectGraph({
  member,
  gitEnvironmentId,
}: {
  member: SidebarProjectGroupMember;
  gitEnvironmentId: EnvironmentId;
}) {
  const [commitLimit, setCommitLimit] = useState(2_000);
  const query = useEnvironmentQuery(
    vcsEnvironment.listRefs({
      environmentId: gitEnvironmentId,
      input: {
        cwd: member.workspaceRoot,
        includeGraph: true,
        graphCommitLimit: commitLimit,
        refKind: "local",
        refresh: true,
      },
    }),
  );
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, {
    label: "close graph worktree",
    reportFailure: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const closingRef = useRef(false);
  const navigate = useNavigate();
  const [loadedGraph, setLoadedGraph] = useState<{
    environmentId: EnvironmentId;
    graph: VcsProjectGraph;
  } | null>(null);

  const graph =
    query.data?.graph ??
    (loadedGraph?.environmentId === gitEnvironmentId ? loadedGraph.graph : undefined);
  const projects = useProjects();
  const projectRefs = useMemo(() => {
    const roots = new Set(
      graph?.worktrees.map((tree) => normalizeProjectPathForComparison(tree.path)) ?? [],
    );
    return projects
      .filter(
        (project) =>
          project.environmentId === member.environmentId &&
          (project.id === member.id ||
            roots.has(normalizeProjectPathForComparison(project.workspaceRoot))),
      )
      .map((project) => scopeProjectRef(project.environmentId, project.id));
  }, [graph?.worktrees, member.environmentId, member.id, projects]);
  const threads = useThreadShellsForProjectRefs(projectRefs);
  const refresh = query.refresh;
  const openThread = useCallback(
    (thread: EnvironmentThreadShell) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    },
    [navigate],
  );
  const worktreeMenu = useCallback(
    async (tree: VcsProjectGraph["worktrees"][number], position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      let startedRemoval = false;
      try {
        const canClose = canCloseGraphWorktree(tree, threads) && closing === null;
        const choice = await api.contextMenu.show(
          [
            { id: "copy", label: "Copy worktree path" },
            {
              id: "close",
              label: tree.isMain
                ? "Main checkout cannot be closed"
                : tree.locked
                  ? "Worktree is locked"
                  : tree.prunable
                    ? "Worktree is missing"
                    : !canClose
                      ? "Worktree is in use"
                      : "Close worktree…",
              destructive: true,
              disabled: !canClose,
              separatorBefore: true,
            },
          ],
          position,
        );
        if (choice === "copy") {
          await navigator.clipboard.writeText(tree.path);
          return;
        }
        if (choice !== "close" || !canClose) return;
        const count = threads.filter((thread) => thread.worktreePath === tree.path).length;
        if (
          !(await api.dialogs.confirm(
            `Close worktree ${tree.path}?\n\nThe branch and ${count} thread${count === 1 ? "" : "s"} will be kept. Threads using this checkout will need another workspace to continue. Git will refuse removal if there are uncommitted or untracked files.`,
            { variant: "destructive" },
          ))
        )
          return;
        const currentThreads = threads.map(
          (thread) => readThreadShell(scopeThreadRef(thread.environmentId, thread.id)) ?? thread,
        );
        if (!canCloseGraphWorktree(tree, currentThreads)) {
          setError("This worktree is now in use. Stop its running sessions before closing it.");
          return;
        }
        if (closingRef.current) return;
        closingRef.current = true;
        startedRemoval = true;
        setClosing(tree.path);
        setError(null);
        const result = await removeWorktree({
          environmentId: member.environmentId,
          input: { cwd: member.workspaceRoot, path: tree.path, force: false },
        });
        if (result._tag === "Failure") {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : "Could not close worktree.");
        } else refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Worktree action failed.");
      } finally {
        if (startedRemoval) {
          closingRef.current = false;
          setClosing(null);
        }
      }
    },
    [closing, member.environmentId, member.workspaceRoot, refresh, removeWorktree, threads],
  );
  return (
    <>
      {(error || query.error) && (
        <div
          role="alert"
          className="border-b border-destructive/30 bg-destructive/10 px-5 py-3 text-sm text-destructive"
        >
          {error || query.error}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(null);
              query.refresh();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {graph ? (
        <GraphCanvas
          graph={graph}
          threads={threads}
          onOpenThread={openThread}
          onWorktreeMenu={worktreeMenu}
          refresh={query.refresh}
          closing={closing}
          loadOlder={() => {
            setLoadedGraph({ environmentId: gitEnvironmentId, graph });
            setCommitLimit((limit) => limit + 2_000);
          }}
          loadingOlder={!query.data?.graph && !query.error}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          {query.isPending && !query.data && !query.error
            ? "Reading local branches and worktrees…"
            : query.data?.isRepo === false
              ? "This project is not a Git repository."
              : query.error
                ? "The graph could not be loaded."
                : "This environment does not support project graphs yet. Update it, or select a Git source on the same machine above."}
        </div>
      )}
    </>
  );
}

type GraphCanvasProps = {
  graph: VcsProjectGraph;
  threads: readonly EnvironmentThreadShell[];
  onOpenThread: (thread: EnvironmentThreadShell) => void;
  onWorktreeMenu: (
    tree: VcsProjectGraph["worktrees"][number],
    position: { x: number; y: number },
  ) => void;
  refresh: () => void;
  closing: string | null;
  loadOlder: () => void;
  loadingOlder: boolean;
};
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;

function GraphCanvas({
  graph,
  threads,
  onOpenThread,
  onWorktreeMenu,
  refresh,
  closing,
  loadOlder,
  loadingOlder,
}: GraphCanvasProps) {
  const layout = useMemo(() => layoutProjectGraph(graph, threads), [graph, threads]);
  const [view, setView] = useState({ x: 16, y: 12, zoom: 1 });
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [unsettledOnly, setUnsettledOnly] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const selected = useMemo(() => {
    const node = layout.nodes.find((entry) => entry.id === selectedId);
    if (!node || node.kind !== "commit") return node;
    const refs = layout.nodes.filter((entry) => entry.kind === "ref" && entry.commitId === node.id);
    return {
      ...node,
      branches: refs.flatMap((ref) => ref.branches),
      worktrees: refs.flatMap((ref) => ref.worktrees),
      threads: refs.flatMap((ref) => ref.threads),
    };
  }, [layout.nodes, selectedId]);
  const query = search.trim().toLowerCase();
  const matches = useMemo(
    () =>
      new Set(
        layout.nodes
          .filter(
            (node) =>
              (!unsettledOnly || node.threads.some((thread) => thread.settledAt === null)) &&
              (!query ||
                [
                  ...node.branches.map((branch) => branch.name),
                  ...node.threads.map((thread) => thread.title),
                  ...node.worktrees.map((tree) => tree.path),
                  node.id,
                  node.commitId ?? "",
                  node.subject,
                ].some((text) => text.toLowerCase().includes(query))),
          )
          .map((node) => node.id),
      ),
    [layout.nodes, query, unsettledOnly],
  );
  const filtering = query.length > 0 || unsettledOnly;
  const unsettledCount = threads.filter(
    (thread) => thread.archivedAt === null && thread.settledAt === null,
  ).length;
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  const zoomAt = useCallback(
    (factor: number, x: number, y: number) =>
      setView((old) => {
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, old.zoom * factor));
        return {
          x: x - ((x - old.x) * zoom) / old.zoom,
          y: y - ((y - old.y) * zoom) / old.zoom,
          zoom,
        };
      }),
    [],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
      } else setView((old) => ({ ...old, x: old.x - event.deltaX, y: old.y - event.deltaY }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoomAt]);
  const fit = () => {
    const zoom = Math.max(
      MIN_ZOOM,
      Math.min(1, (size.width - 96) / layout.width, (size.height - 96) / layout.height),
    );
    setView({
      x: (size.width - layout.width * zoom) / 2,
      y: (size.height - layout.height * zoom) / 2,
      zoom,
    });
  };
  const focus = (node: GraphNode) => {
    setSelectedId(node.id);
    setView({
      zoom: 1,
      x: 24,
      y: Math.max(64, (size.height - node.height) / 2) - node.y,
    });
  };
  const bounds = {
    left: -view.x / view.zoom - 400,
    top: -view.y / view.zoom - 300,
    right: (size.width - view.x) / view.zoom + 400,
    bottom: (size.height - view.y) / view.zoom + 300,
  };
  const visible = layout.nodes.filter(
    (node) =>
      layout.labelX + NODE_WIDTH >= bounds.left &&
      node.x <= bounds.right &&
      node.y + node.height >= bounds.top &&
      node.y <= bounds.bottom,
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-2.5">
        <div className="relative w-64">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            aria-label="Find branch, thread or worktree"
            placeholder="Find branch, thread or worktree…"
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant={unsettledOnly ? "secondary" : "ghost"}
          aria-pressed={unsettledOnly}
          onClick={() => setUnsettledOnly((value) => !value)}
        >
          <span className="size-1.5 rounded-full bg-amber-500" />
          {unsettledCount} unsettled
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {graph.commits.length} commits · {graph.branches.length} branches ·{" "}
          {graph.worktrees.length} worktrees
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh graph" onClick={refresh}>
          <RefreshCwIcon className="size-4" />
        </Button>
      </div>
      <div
        ref={canvas}
        role="region"
        aria-label="Project branch graph. Drag or scroll to pan. Pinch or use zoom buttons to zoom. Arrow keys pan; F fits the graph."
        tabIndex={0}
        className="relative min-h-0 flex-1 touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        style={{
          cursor: "grab",
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, input"))
            return;
          drag.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
        }}
        onPointerMove={(event) => {
          const previous = drag.current;
          if (!previous || previous.pointer !== event.pointerId) return;
          const dx = event.clientX - previous.x,
            dy = event.clientY - previous.y;
          drag.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
          setView((old) => ({ ...old, x: old.x + dx, y: old.y + dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [80, 0],
            ArrowRight: [-80, 0],
            ArrowUp: [0, 80],
            ArrowDown: [0, -80],
          };
          const direction = directions[event.key];
          if (direction) {
            event.preventDefault();
            setView((old) => ({ ...old, x: old.x + direction[0], y: old.y + direction[1] }));
          }
          if (event.key.toLowerCase() === "f") fit();
          if (event.key === "Escape") setSelectedId(null);
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          {layout.lanes.map((lane) => (
            <Tooltip key={lane.id}>
              <TooltipTrigger
                className="absolute w-28 truncate text-center font-mono text-[11px]"
                style={{ left: lane.x - 56, top: 12, color: lane.color }}
                onClick={() => {
                  const node =
                    layout.nodes.find((entry) => entry.id === lane.id) ??
                    layout.nodes.find(
                      (entry) =>
                        entry.kind === "commit" &&
                        entry.stations.some((station) => station.lane === lane.lane),
                    );
                  if (node) focus(node);
                }}
                aria-label={`Branch lane ${lane.name}`}
              >
                {lane.name}
              </TooltipTrigger>
              <TooltipPopup>{lane.name}</TooltipPopup>
            </Tooltip>
          ))}
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={1}
            height={1}
            aria-hidden="true"
          >
            {layout.edges
              .filter(
                ({ from, to }) =>
                  Math.max(from.y, to.y) >= bounds.top && Math.min(from.y, to.y) <= bounds.bottom,
              )
              .map(({ from, to, color }) => (
                <path
                  key={`${from.id}:${from.x}:${to.id}:${to.x}`}
                  d={graphEdgePath(from, to)}
                  fill="none"
                  stroke={color}
                  strokeWidth={from.kind === "ref" ? 1.5 : 2.5}
                  strokeDasharray={from.kind === "ref" ? "3 4" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={from.kind === "ref" ? 0.5 : 0.85}
                />
              ))}
          </svg>
          {visible.map((node) => (
            <GraphRow
              key={node.id}
              node={node}
              labelX={layout.labelX}
              selected={node.id === selectedId}
              dimmed={filtering && !matches.has(node.id)}
              defaultBranch={graph.defaultBranch}
              onSelect={setSelectedId}
              onWorktreeMenu={onWorktreeMenu}
            />
          ))}
        </div>
        {layout.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No local branches yet. Create your first commit to start the graph.
          </div>
        )}
      </div>
      {filtering && (
        <div className="absolute left-4 top-16 z-10 max-h-64 w-72 overflow-auto rounded-lg border border-border bg-popover p-2 shadow-lg">
          <p className="px-2 py-1 text-[11px] text-muted-foreground">
            {matches.size} matching nodes
          </p>
          {layout.nodes
            .filter((node) => matches.has(node.id))
            .slice(0, 30)
            .map((node) => (
              <button
                key={node.id}
                className="block w-full truncate rounded px-2 py-2 text-left text-xs hover:bg-accent"
                onClick={() => focus(node)}
              >
                {node.branches.map((branch) => branch.name).join(", ") ||
                  node.threads[0]?.title ||
                  node.subject}
              </button>
            ))}
        </div>
      )}
      {selected && (
        <aside
          aria-label="Graph node details"
          className="absolute right-3 top-16 bottom-14 z-10 flex w-80 max-w-[calc(100%-24px)] flex-col overflow-auto rounded-xl border border-border bg-popover p-4 shadow-xl"
        >
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {selected.kind === "commit" ? "COMMIT DETAILS" : "BRANCH & WORKTREE"}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close details"
              onClick={() => setSelectedId(null)}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
          <p className="mb-1 text-sm font-medium">{selected.subject}</p>
          <p className="mb-5 break-all font-mono text-[10px] text-muted-foreground">
            {selected.commitId ??
              (selected.id.startsWith("missing-") ? "No matching local ref" : "No commits yet")}
          </p>
          <h2 className="mb-2 text-xs font-semibold">Branches</h2>
          {selected.branches.map((branch) => (
            <div key={branch.name} className="mb-2 rounded-md border border-border p-2">
              <p className="break-all font-mono text-xs">{branch.name}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {branch.name === graph.defaultBranch
                  ? "Default branch"
                  : branch.merged === null
                    ? "Merge status unavailable"
                    : branch.merged
                      ? `Merged into ${graph.defaultBranch}`
                      : `Not merged into ${graph.defaultBranch}`}
                {branch.current ? " · Current checkout" : ""}
              </p>
            </div>
          ))}
          <h2 className="mb-2 mt-4 text-xs font-semibold">Worktrees</h2>
          {selected.worktrees.length === 0 && (
            <p className="text-xs text-muted-foreground">No worktree attached to this node.</p>
          )}
          {selected.worktrees.map((tree) => (
            <button
              key={tree.path}
              className="mb-2 flex items-center gap-2 rounded-md border border-border p-2 text-left hover:bg-accent"
              onClick={(event) => onWorktreeMenu(tree, { x: event.clientX, y: event.clientY })}
              onContextMenu={(event) => {
                event.preventDefault();
                onWorktreeMenu(tree, { x: event.clientX, y: event.clientY });
              }}
            >
              <FolderGit2Icon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block break-all font-mono text-[11px]">{tree.path}</span>
                <span className="text-[10px] text-muted-foreground">
                  {closing === tree.path
                    ? "Closing…"
                    : tree.isMain
                      ? "Main checkout"
                      : tree.locked
                        ? "Locked"
                        : tree.prunable
                          ? "Missing"
                          : tree.branch === null
                            ? "Detached HEAD"
                            : "Linked worktree"}
                </span>
              </span>
              <MoreHorizontalIcon className="size-4 shrink-0" />
            </button>
          ))}
          <h2 className="mb-2 mt-4 text-xs font-semibold">Threads · {selected.threads.length}</h2>
          {selected.threads.length === 0 && (
            <p className="text-xs text-muted-foreground">No local threads at this commit.</p>
          )}
          {selected.threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => onOpenThread(thread)}
              className="mb-1 rounded-md p-2 text-left hover:bg-accent"
            >
              <p className="text-xs">{thread.title}</p>
              <p
                className={`mt-1 text-[11px] ${thread.settledAt === null ? "text-amber-500" : "text-muted-foreground"}`}
              >
                {thread.settledAt !== null
                  ? "Settled"
                  : thread.session?.status === "running"
                    ? "Running · unsettled"
                    : thread.hasPendingApprovals || thread.hasPendingUserInput
                      ? "Needs attention · unsettled"
                      : "Unsettled"}
              </p>
            </button>
          ))}
        </aside>
      )}
      <footer className="flex flex-wrap items-center gap-3 border-t border-border bg-background px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CheckIcon className="size-3.5 text-emerald-500" />
          {graph.defaultBranch
            ? `Merged = reachable from ${graph.defaultBranch}`
            : "No default branch; merge status unknown"}
        </span>
        <span className="hidden lg:inline">
          One dot per commit · dotted lines connect branch labels · solid lines show ancestry
        </span>
        {graph.truncated && (
          <span className="text-amber-500">
            {graph.commits.length.toLocaleString()} commits loaded.
            <button
              className="ml-2 underline underline-offset-4 hover:text-foreground"
              onClick={loadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder ? "Loading…" : "Load older commits"}
            </button>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => zoomAt(0.8, size.width / 2, size.height / 2)}
          >
            <MinusIcon className="size-3.5" />
          </Button>
          <span className="w-10 text-center font-mono">{Math.round(view.zoom * 100)}%</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => zoomAt(1.25, size.width / 2, size.height / 2)}
          >
            <PlusIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Fit graph" onClick={fit}>
            <MaximizeIcon className="size-3.5" />
          </Button>
        </div>
      </footer>
    </div>
  );
}

const GraphRow = memo(function GraphRow({
  node,
  labelX,
  selected,
  dimmed,
  defaultBranch,
  onSelect,
  onWorktreeMenu,
}: {
  node: GraphNode;
  labelX: number;
  selected: boolean;
  dimmed: boolean;
  defaultBranch: string | null;
  onSelect: (id: string) => void;
  onWorktreeMenu: GraphCanvasProps["onWorktreeMenu"];
}) {
  const unsettled = node.threads.filter((thread) => thread.settledAt === null).length;
  const branch = node.branches[0];
  const name = branch?.name ?? (node.kind === "ref" ? "Detached HEAD" : node.subject);
  return (
    <div style={{ opacity: dimmed ? 0.25 : 1 }}>
      {(node.stations.length ? node.stations : [{ lane: -1, x: node.x, color: node.color }]).map(
        (station) => (
          <Tooltip key={station.lane}>
            <TooltipTrigger
              className="absolute flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                left: station.x - 14,
                top: node.y + ROW_HEIGHT / 2 - 14,
                color: station.color,
              }}
              aria-label={`Inspect ${name}`}
              onClick={() => onSelect(node.id)}
            >
              {node.kind === "commit" ? (
                <span
                  className={`size-2.5 rounded-full border-2 ${selected ? "ring-4 ring-primary/20" : ""}`}
                  style={{
                    borderColor: station.color,
                    backgroundColor: node.parents.length > 1 ? "var(--background)" : station.color,
                  }}
                />
              ) : node.kind === "ref" ? (
                <GitBranchIcon className="size-3.5 bg-background" />
              ) : (
                <MessageSquareIcon className="size-3.5 bg-background text-amber-500" />
              )}
            </TooltipTrigger>
            <TooltipPopup>
              {node.kind === "commit" ? `${node.commitId?.slice(0, 8)} · ${node.subject}` : name}
            </TooltipPopup>
          </Tooltip>
        ),
      )}
      <div
        className={`absolute flex items-center gap-2 rounded px-2 ${selected ? "bg-primary/10" : "hover:bg-muted/40"}`}
        style={{ left: labelX, top: node.y, height: ROW_HEIGHT, width: NODE_WIDTH }}
      >
        <Tooltip>
          <TooltipTrigger
            className={`min-w-0 truncate text-left text-xs ${branch ? "max-w-64 shrink-0 rounded border px-2 py-0.5 font-mono" : "flex-1 text-foreground/80"}`}
            style={branch ? { color: node.color, borderColor: node.color + "55" } : undefined}
            aria-label={name}
            onClick={() => onSelect(node.id)}
          >
            {name}
          </TooltipTrigger>
          <TooltipPopup>{name}</TooltipPopup>
        </Tooltip>
        {branch && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {branch.name === defaultBranch
              ? "base"
              : branch.merged === true
                ? "merged"
                : branch.merged === false
                  ? "unmerged"
                  : "unknown"}
            {branch.current ? " · HEAD" : ""}
          </span>
        )}
        {node.worktrees.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`${name}: ${node.worktrees.length} worktree${node.worktrees.length === 1 ? "" : "s"}`}
              onClick={(event) => {
                const tree = node.worktrees[0];
                if (tree && node.worktrees.length === 1)
                  onWorktreeMenu(tree, { x: event.clientX, y: event.clientY });
                else onSelect(node.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                const tree = node.worktrees[0];
                if (tree && node.worktrees.length === 1)
                  onWorktreeMenu(tree, { x: event.clientX, y: event.clientY });
                else onSelect(node.id);
              }}
            >
              <FolderGit2Icon className="size-3" />
              {node.worktrees.length}
            </TooltipTrigger>
            <TooltipPopup>
              {node.worktrees.map((tree) => (
                <div key={tree.path} className="max-w-96 break-all font-mono text-[11px]">
                  {tree.path}
                </div>
              ))}
            </TooltipPopup>
          </Tooltip>
        )}
        {node.threads.length > 0 && (
          <button
            className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-accent ${unsettled ? "text-amber-500" : "text-muted-foreground"}`}
            aria-label={`${name}: ${node.threads.length} threads, ${unsettled} unsettled`}
            onClick={() => onSelect(node.id)}
          >
            <MessageSquareIcon className="size-3" />
            {node.threads.length}
            {unsettled > 0 && <span>· {unsettled} unsettled</span>}
          </button>
        )}
        {node.commitId && (
          <button
            onClick={() => onSelect(node.id)}
            className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70"
          >
            {node.commitId.slice(0, 8)}
          </button>
        )}
      </div>
    </div>
  );
});
