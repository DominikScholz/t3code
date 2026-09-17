import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import type { EnvironmentId, VcsProjectGraph } from "@t3tools/contracts";
import {
  CheckIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
  FolderGit2Icon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
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
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { resolveGraphAvatar } from "./graphAvatar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  BRANCH_LABEL_WIDTH,
  graphAuthorIdentity,
  canCloseGraphWorktree,
  layoutProjectGraph,
  graphEdgePath,
  ROW_HEIGHT,
  NODE_WIDTH,
  type GraphNode,
} from "./projectGraph";

const BRANCH_LABEL_OPACITY = 0.2;

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
  const controls = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} className="max-w-40 shrink-0 truncate text-xs font-medium" />}
        >
          {group.displayName}
        </TooltipTrigger>
        <TooltipPopup>{member.workspaceRoot}</TooltipPopup>
      </Tooltip>
      <Popover>
        <PopoverTrigger
          aria-label="Graph options"
          className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-accent"
        >
          <SettingsIcon className="size-3.5" />
        </PopoverTrigger>
        <PopoverPopup align="start" className="w-80">
          <div className="flex flex-col gap-3 text-xs">
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              {member.workspaceRoot}
            </p>
            {group.memberProjects.length > 1 && (
              <label className="flex flex-col gap-1.5">
                Project checkout
                <select
                  aria-label="Project checkout"
                  className="w-full rounded border border-border bg-background p-1.5"
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
              </label>
            )}
            {environments.length > 1 && (
              <label className="flex flex-col gap-1.5">
                Read Git from
                <select
                  aria-label="Read Git from"
                  className="w-full rounded border border-border bg-background p-1.5"
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
                      {environment.environmentId === member.environmentId
                        ? " (threads live here)"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {gitEnvironment && gitEnvironment !== member.environmentId && (
              <p className="text-[11px] text-muted-foreground">
                Threads stay live on {member.environmentLabel ?? "their environment"}. The Git
                source must have access to the same checkout path.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void navigate({
                  to: "/settings/projects",
                  search: { project: projectKey, machine: member.environmentId },
                })
              }
            >
              Project settings
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
    </>
  );
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <ProjectGraph
        key={`${member.environmentId}:${member.id}`}
        member={member}
        controls={controls}
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
  controls,
}: {
  controls: ReactNode;
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
        <GraphLog
          controls={controls}
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
        <>
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            {controls}
          </div>
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            {query.isPending && !query.data && !query.error
              ? "Reading local branches and worktrees…"
              : query.data?.isRepo === false
                ? "This project is not a Git repository."
                : query.error
                  ? "The graph could not be loaded."
                  : "This environment does not support project graphs yet. Update it, or select a Git source on the same machine above."}
          </div>
        </>
      )}
    </>
  );
}

type GraphLogProps = {
  controls: ReactNode;
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

function GraphLog({
  controls,
  graph,
  threads,
  onOpenThread,
  onWorktreeMenu,
  refresh,
  closing,
  loadOlder,
  loadingOlder,
}: GraphLogProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [unsettledOnly, setUnsettledOnly] = useState(false);
  const [collapse, setCollapse] = useState(true);
  const [compactLanes, setCompactLanes] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const layout = useMemo(
    () =>
      layoutProjectGraph(graph, threads, {
        collapse: collapse && !search.trim() && !unsettledOnly,
        expanded,
        compactLanes,
      }),
    [graph, threads, collapse, expanded, compactLanes, search, unsettledOnly],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => {
    if (selectedId === "unlinked" && layout.unlinkedNodes[0])
      return {
        ...layout.unlinkedNodes[0],
        subject: "Threads without a local checkout",
        threads: layout.unlinkedNodes.flatMap((node) => node.threads),
      };
    const node = layout.nodes.find((entry) => entry.id === selectedId);
    if (!node || node.kind !== "commit") return node;
    const refs = layout.nodes.filter((entry) => entry.kind === "ref" && entry.commitId === node.id);
    return {
      ...node,
      branches: refs.flatMap((ref) => ref.branches),
      worktrees: refs.flatMap((ref) => ref.worktrees),
      threads: refs.flatMap((ref) => ref.threads),
    };
  }, [layout.nodes, layout.unlinkedNodes, selectedId]);
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
    if (!scroller.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  const focus = (node: GraphNode) => {
    setSelectedId(node.id);
    scroller.current?.scrollTo({ top: Math.max(0, node.y - size.height / 2), left: 0 });
  };
  const bounds = { top: scrollTop - 320, bottom: scrollTop + size.height + 320 };
  const visibleRows = layout.rows.slice(
    Math.max(0, Math.floor(bounds.top / ROW_HEIGHT)),
    Math.ceil(bounds.bottom / ROW_HEIGHT),
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {controls}
        <div className="relative min-w-20 max-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
          <Input
            aria-label="Find branch, thread or worktree"
            placeholder="Find in graph…"
            className="h-7 pl-7 text-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          className="h-7 shrink-0 px-2 text-[11px]"
          variant={unsettledOnly ? "secondary" : "ghost"}
          aria-pressed={unsettledOnly}
          onClick={() => setUnsettledOnly((value) => !value)}
        >
          {unsettledCount} unsettled
        </Button>
        {layout.unlinkedNodes.length > 0 && (
          <Button
            size="sm"
            className="h-7 shrink-0 px-2 text-[11px]"
            variant="ghost"
            onClick={() => setSelectedId("unlinked")}
          >
            {layout.unlinkedNodes.reduce((count, node) => count + node.threads.length, 0)} unlinked
          </Button>
        )}
        <span className="ml-auto hidden shrink-0 text-[10px] text-muted-foreground xl:inline">
          {graph.commits.length} commits · {graph.branches.length} branches
        </span>
        <Button
          variant={compactLanes ? "secondary" : "ghost"}
          size="sm"
          className="h-7 shrink-0 text-[11px]"
          aria-pressed={compactLanes}
          title="Reuse columns for branch histories that do not overlap"
          onClick={() => setCompactLanes((value) => !value)}
        >
          Compact lanes
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-[11px]"
          onClick={() => {
            setCollapse((value) => !value);
            setExpanded(new Set());
          }}
        >
          {collapse ? "Expand all" : "Collapse all"}
        </Button>
        {graph.truncated && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-[11px]"
            onClick={loadOlder}
            disabled={loadingOlder}
          >
            {loadingOlder ? "Loading…" : "Load older"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Refresh graph"
          onClick={refresh}
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
      <div
        ref={scroller}
        role="region"
        aria-label="Project branch graph. Scroll vertically for history and horizontally for details."
        tabIndex={0}
        className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setSelectedId(null);
        }}
      >
        <div
          className="relative min-w-full"
          style={{ width: layout.width, height: Math.max(layout.height, size.height) }}
        >
          {visibleRows.map((row) => (
            <div
              key={`band:${row.id}`}
              className={`absolute left-0 w-full border-b border-border/25 ${selectedId === row.id || (row.ref && selectedId === row.ref.id) ? "bg-accent/60" : ""}`}
              style={{
                top: row.y,
                height: ROW_HEIGHT,
              }}
            />
          ))}
          {visibleRows.map((row) => {
            const node = row.commit ?? (row.thread ? undefined : row.ref);
            if (!node) return null;
            return (
              <div
                key={`track-band:${row.id}`}
                aria-hidden="true"
                className="pointer-events-none absolute border-r-2"
                style={{
                  left: node.x,
                  top: row.y + 2,
                  width: layout.labelX - node.x,
                  height: ROW_HEIGHT - 4,
                  backgroundColor: `color-mix(in srgb, ${node.color} 6%, transparent)`,
                  borderColor: `color-mix(in srgb, ${node.color} 50%, transparent)`,
                  opacity: row.ref ? 0.5 : 1,
                }}
              />
            );
          })}
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={1}
            height={1}
            aria-hidden="true"
          >
            {layout.edges
              .filter(
                ({ from, to }) =>
                  Math.max(from.y, to.y) + ROW_HEIGHT >= bounds.top &&
                  Math.min(from.y, to.y) <= bounds.bottom,
              )
              .map(({ from, to, color }) => {
                const pending = from.kind === "ref" && from.worktrees.some((tree) => tree.dirty);
                return (
                  <g key={`${from.id}:${from.x}:${to.id}:${to.x}`}>
                    {pending && (
                      <path
                        d={`M ${BRANCH_LABEL_WIDTH + 8} ${from.y + ROW_HEIGHT / 2} H ${from.x}`}
                        stroke={color}
                        strokeWidth={1}
                        opacity={BRANCH_LABEL_OPACITY}
                      />
                    )}
                    <path
                      d={graphEdgePath(from, to, !pending)}
                      fill="none"
                      stroke={color}
                      strokeWidth={from.kind === "ref" ? 1.5 : 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={pending ? "3 4" : undefined}
                      opacity={from.kind === "ref" ? (pending ? 0.6 : BRANCH_LABEL_OPACITY) : 0.85}
                    />
                  </g>
                );
              })}
          </svg>
          {visibleRows.map((row) =>
            row.collapsed ? (
              <button
                key={row.id}
                className="absolute flex items-center gap-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
                style={{ left: layout.labelX + 8, top: row.y, height: ROW_HEIGHT }}
                aria-expanded={row.expanded}
                onClick={() =>
                  setExpanded((old) => {
                    const next = new Set(old);
                    if (next.has(row.id)) next.delete(row.id);
                    else next.add(row.id);
                    return next;
                  })
                }
              >
                {row.expanded ? (
                  <ChevronDownIcon className="size-3.5" />
                ) : (
                  <ChevronRightIcon className="size-3.5" />
                )}
                {row.expanded ? "Collapse" : "Show"} {row.collapsed.length} commits
              </button>
            ) : row.thread ? (
              <Tooltip key={row.id}>
                <TooltipTrigger
                  className="absolute left-3 flex items-center gap-2 truncate px-2 text-left text-[11px] text-foreground/75 hover:bg-accent"
                  style={{ top: row.y, height: ROW_HEIGHT, width: BRANCH_LABEL_WIDTH - 8 }}
                  aria-label={`Open unsettled thread: ${row.thread.title}`}
                  onClick={() => onOpenThread(row.thread!)}
                >
                  <MessageSquareIcon className="size-3 shrink-0" />
                  <span className="truncate">{row.thread.title}</span>
                </TooltipTrigger>
                <TooltipPopup>Unsettled · {row.thread.title}</TooltipPopup>
              </Tooltip>
            ) : (
              <div key={row.id}>
                {(row.refs ?? []).map((ref, index, refs) => (
                  <GraphBranchLabel
                    key={ref.id}
                    node={ref}
                    defaultBranch={graph.defaultBranch}
                    selected={selectedId === ref.id}
                    dimmed={filtering && !matches.has(ref.id)}
                    onSelect={setSelectedId}
                    onWorktreeMenu={onWorktreeMenu}
                    labelIndex={index}
                    labelCount={refs.length}
                  />
                ))}
                {row.ref && (
                  <GraphBranchLabel
                    node={row.ref}
                    defaultBranch={graph.defaultBranch}
                    selected={selectedId === row.ref.id}
                    dimmed={filtering && !matches.has(row.ref.id)}
                    onSelect={setSelectedId}
                    onWorktreeMenu={onWorktreeMenu}
                  />
                )}
                {row.commit ? (
                  <GraphRow
                    node={row.commit}
                    labelX={layout.labelX}
                    selected={row.commit.id === selectedId}
                    dimmed={
                      filtering &&
                      !matches.has(row.commit.id) &&
                      !(row.ref && matches.has(row.ref.id)) &&
                      !row.refs?.some((ref) => matches.has(ref.id))
                    }
                    onSelect={setSelectedId}
                  />
                ) : (
                  row.ref && (
                    <>
                      <button
                        className="absolute flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{
                          left: row.ref.x - 14,
                          top: row.y + ROW_HEIGHT / 2 - 14,
                        }}
                        aria-label={`Inspect branch ${row.ref.branches[0]?.name ?? "detached checkout"}`}
                        onClick={() => setSelectedId(row.ref!.id)}
                      >
                        <span
                          className="size-2.5 rounded-full ring-[3px] ring-background"
                          style={{ backgroundColor: row.ref.color }}
                        />
                      </button>
                      <button
                        className="absolute flex items-center text-[11px] text-muted-foreground hover:text-foreground"
                        style={{ left: layout.labelX + 8, top: row.y, height: ROW_HEIGHT }}
                        onClick={() => setSelectedId(row.ref!.id)}
                      >
                        {row.ref.commitId ? "Uncommitted changes" : "No commits yet"}
                      </button>
                    </>
                  )
                )}
              </div>
            ),
          )}
        </div>
        {layout.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No local branches yet. Create your first commit to start the graph.
          </div>
        )}
      </div>
      {filtering && (
        <div className="absolute left-4 top-11 z-10 max-h-64 w-72 overflow-auto rounded-lg border border-border bg-popover p-2 shadow-lg">
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
          className="absolute right-3 top-11 bottom-3 z-10 flex w-80 max-w-[calc(100%-24px)] flex-col overflow-auto rounded-xl border border-border bg-popover p-4 shadow-xl"
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
          {selected.historyDetail && (
            <p className="mb-3 text-xs text-muted-foreground">{selected.historyDetail}</p>
          )}
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
                className={`mt-1 text-[11px] ${thread.settledAt === null ? "text-foreground" : "text-muted-foreground"}`}
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
    </div>
  );
}

const GraphBranchLabel = memo(function GraphBranchLabel({
  node,
  defaultBranch,
  selected,
  dimmed,
  onSelect,
  onWorktreeMenu,
  labelIndex = 0,
  labelCount = 1,
}: {
  labelIndex?: number;
  labelCount?: number;
  node: GraphNode;
  defaultBranch: string | null;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onWorktreeMenu: GraphLogProps["onWorktreeMenu"];
}) {
  const branch = node.branches[0];
  const name = branch?.name ?? "Detached checkout";
  const unsettled = node.threads.filter((thread) => thread.settledAt === null).length;
  const status =
    branch?.name === defaultBranch
      ? "Default branch"
      : branch?.merged === true
        ? `Merged into ${defaultBranch}`
        : branch?.merged === false
          ? `Not merged into ${defaultBranch}`
          : "Merge status unknown";
  const worktreeMenu = (event: MouseEvent) => {
    const tree = node.worktrees[0];
    if (tree && node.worktrees.length === 1)
      onWorktreeMenu(tree, { x: event.clientX, y: event.clientY });
    else onSelect(node.id);
  };
  return (
    <div
      className={`absolute flex items-center gap-1 rounded-sm px-2 text-foreground ${selected ? "ring-1 ring-inset ring-foreground/40" : ""}`}
      style={{
        left: 8 + labelIndex * (BRANCH_LABEL_WIDTH / labelCount),
        top: node.y + 4,
        width: BRANCH_LABEL_WIDTH / labelCount - (labelCount > 1 ? 3 : 0),
        height: ROW_HEIGHT - 8,
        backgroundColor: `color-mix(in srgb, ${node.color} ${BRANCH_LABEL_OPACITY * 100}%, var(--background))`,
        opacity: dimmed ? 0.3 : 1,
      }}
    >
      <Tooltip>
        <TooltipTrigger
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-[11px]"
          aria-label={`Branch lane ${name}`}
          onClick={() => onSelect(node.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            worktreeMenu(event);
          }}
        >
          {branch?.current && <CheckIcon className="size-3 shrink-0" />}
          <span className="truncate">{labelCount > 1 ? name.split("/").at(-1) : name}</span>
          {branch?.merged === true && !branch.current && (
            <CheckIcon className="size-3 shrink-0 opacity-60" />
          )}
        </TooltipTrigger>
        <TooltipPopup>
          {name} · {status}
          {branch?.current ? " · HEAD" : ""}
        </TooltipPopup>
      </Tooltip>
      {node.worktrees.length > 0 && labelCount === 1 && (
        <Tooltip>
          <TooltipTrigger
            className="flex shrink-0 items-center gap-1 rounded px-1 text-[10px] opacity-75 hover:bg-white/10 hover:opacity-100"
            aria-label={`${name}: ${node.worktrees.length} worktree${node.worktrees.length === 1 ? "" : "s"}`}
            onClick={worktreeMenu}
            onContextMenu={(event) => {
              event.preventDefault();
              worktreeMenu(event);
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
      {node.threads.length > 0 && labelCount === 1 && (
        <Tooltip>
          <TooltipTrigger
            className="flex shrink-0 items-center gap-1 rounded px-1 text-[10px] opacity-75 hover:bg-white/10 hover:opacity-100"
            aria-label={`${name}: ${node.threads.length} threads, ${unsettled} unsettled`}
            onClick={() => onSelect(node.id)}
          >
            <MessageSquareIcon className="size-3" />
            {node.threads.length}
          </TooltipTrigger>
          <TooltipPopup>
            {node.threads.length} threads · {unsettled} unsettled
          </TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
});

const GraphRow = memo(function GraphRow({
  node,
  labelX,
  selected,
  dimmed,
  onSelect,
}: {
  node: GraphNode;
  labelX: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}) {
  const author = useMemo(() => graphAuthorIdentity(node.author), [node.author]);
  const [failedAvatars, setFailedAvatars] = useState<readonly string[]>([]);
  const directAvatar = [author.avatarUrl, author.gravatarUrl].find(
    (url) => url && !failedAvatars.includes(url),
  );
  const email = node.author?.email.trim().toLowerCase() ?? "";
  const [resolved, setResolved] = useState<{ email: string; url: string | null } | null>(null);
  useEffect(() => {
    if (directAvatar || !email) return;
    let active = true;
    void resolveGraphAvatar(email).then((url) => {
      if (active) setResolved({ email, url });
    });
    return () => {
      active = false;
    };
  }, [directAvatar, email]);
  const fallback = resolved?.email === email ? resolved.url : null;
  const avatarUrl =
    directAvatar ?? (fallback && !failedAvatars.includes(fallback) ? fallback : null);
  return (
    <div style={{ opacity: dimmed ? 0.25 : 1 }}>
      {node.historyLabel && (
        <Tooltip>
          <TooltipTrigger
            className="absolute left-3 flex h-6 items-center gap-2 rounded px-2 text-left text-[11px] text-muted-foreground hover:bg-accent"
            style={{ top: node.y + 4, width: BRANCH_LABEL_WIDTH }}
            onClick={() => onSelect(node.id)}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: node.color }}
            />
            <span className="truncate">{node.historyLabel}</span>
          </TooltipTrigger>
          <TooltipPopup>{node.historyDetail}</TooltipPopup>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          className="absolute flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: node.x - 14, top: node.y + ROW_HEIGHT / 2 - 14 }}
          aria-label={`Inspect ${node.subject}, by ${author.name}`}
          onClick={() => onSelect(node.id)}
        >
          <span
            className={`flex size-[22px] items-center justify-center overflow-hidden rounded-full border-2 text-[8px] font-semibold ${selected ? "ring-4 ring-primary/20" : ""}`}
            style={{ borderColor: node.color, backgroundColor: node.color, color: "#101018" }}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="size-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setFailedAvatars((urls) => [...urls, avatarUrl])}
              />
            ) : (
              author.initials
            )}
          </span>
        </TooltipTrigger>
        <TooltipPopup>
          {author.name}
          {node.author?.email ? ` <${node.author.email}>` : ""}
          <br />
          {node.commitId?.slice(0, 8)} · {node.subject}
        </TooltipPopup>
      </Tooltip>
      <div
        className={`absolute flex items-center gap-2 rounded px-2 ${selected ? "bg-primary/10" : "hover:bg-muted/40"}`}
        style={{ left: labelX, top: node.y, height: ROW_HEIGHT, width: NODE_WIDTH }}
      >
        <Tooltip>
          <TooltipTrigger
            className="min-w-0 flex-1 truncate text-left text-xs text-foreground/80"
            onClick={() => onSelect(node.id)}
          >
            {node.subject}
          </TooltipTrigger>
          <TooltipPopup>{node.subject}</TooltipPopup>
        </Tooltip>
        <button
          onClick={() => onSelect(node.id)}
          className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70"
        >
          {node.commitId?.slice(0, 8)}
        </button>
      </div>
    </div>
  );
});
