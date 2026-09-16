import { GitCommandError, type VcsProjectGraph } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { GitVcsDriver } from "./GitVcsDriver.ts";

const GRAPH_COMMIT_LIMIT = 2_000;

/** Reads local refs only. Remote tracking refs are used solely to identify the default branch. */
export const readProjectGraph = Effect.fn("GitVcsDriver.projectGraph")(function* (
  cwd: string,
  execute: GitVcsDriver["Service"]["execute"],
  commitLimit = GRAPH_COMMIT_LIMIT,
) {
  const run = (args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    execute({
      operation: "GitVcsDriver.projectGraph",
      cwd,
      args,
      allowNonZeroExit,
      timeoutMs: 30_000,
      maxOutputBytes: 16 * 1024 * 1024,
    }).pipe(
      Effect.flatMap((result) =>
        result.stdoutTruncated
          ? Effect.fail(
              new GitCommandError({
                operation: "GitVcsDriver.projectGraph",
                cwd,
                command: "git",
                detail:
                  "The repository graph exceeds the output limit. Refusing to display an incomplete branch inventory.",
              }),
            )
          : Effect.succeed(result),
      ),
    );
  const [refs, worktreeResult, defaultResult, currentResult] = yield* Effect.all(
    [
      run(["for-each-ref", "--format=%(refname:strip=2)%00%(objectname)", "refs/heads"]),
      run(["worktree", "list", "--porcelain", "-z"]),
      run(["symbolic-ref", "refs/remotes/origin/HEAD"], true),
      run(["symbolic-ref", "--short", "HEAD"], true),
    ],
    { concurrency: 2 },
  );
  const heads = refs.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", head = ""] = line.split("\0");
      return { name, head };
    });
  const worktrees: Array<VcsProjectGraph["worktrees"][number]> = [];
  for (const record of worktreeResult.stdout.split("\0\0")) {
    const fields = record.split("\0");
    const worktreePath = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    if (!worktreePath) continue;
    worktrees.push({
      path: worktreePath,
      head: fields.find((field) => field.startsWith("HEAD "))?.slice(5) ?? "",
      branch: fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18) ?? null,
      isMain: worktrees.length === 0,
      locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
      prunable: fields.some((field) => field === "prunable" || field.startsWith("prunable ")),
    });
  }
  const remoteDefault =
    defaultResult.exitCode === 0
      ? defaultResult.stdout.trim().replace(/^refs\/remotes\/origin\//, "")
      : null;
  const candidateDefault =
    remoteDefault ??
    ["main", "master"].find((name) => heads.some((ref) => ref.name === name)) ??
    null;
  const localDefault = heads.find((ref) => ref.name === candidateDefault);
  const remoteBase =
    !localDefault && remoteDefault
      ? yield* run(["rev-parse", "--verify", `refs/remotes/origin/${remoteDefault}^{commit}`], true)
      : null;
  const baseRef =
    localDefault?.head ?? (remoteBase?.exitCode === 0 ? remoteBase.stdout.trim() : null);
  const defaultBranch = baseRef === null ? null : candidateDefault;
  const detachedHeads = worktrees
    .filter(
      (tree) =>
        tree.branch === null && /^[a-f0-9]{40,64}$/.test(tree.head) && !/^0+$/.test(tree.head),
    )
    .map((tree) => tree.head);
  const [mergedResult, history] = yield* Effect.all(
    [
      baseRef === null
        ? Effect.succeed(null)
        : run(["for-each-ref", `--merged=${baseRef}`, "--format=%(refname:strip=2)", "refs/heads"]),
      heads.length === 0 && detachedHeads.length === 0
        ? Effect.succeed(null)
        : run([
            "log",
            "--branches",
            ...detachedHeads,
            "--topo-order",
            "--parents",
            `--max-count=${commitLimit + 1}`,
            "--format=%H%x00%P%x00%s",
            "--",
          ]),
    ],
    { concurrency: 2 },
  );
  const merged = new Set(mergedResult?.stdout.trim().split("\n") ?? []);
  const commits = (history?.stdout.trim().split("\n").filter(Boolean) ?? []).map((line) => {
    const [id = "", parents = "", subject = ""] = line.split("\0");
    return { id, parents: parents.split(" ").filter(Boolean), subject };
  });
  return {
    defaultBranch,
    branches: heads.map((ref) => ({
      ...ref,
      current: ref.name === currentResult.stdout.trim(),
      merged: baseRef === null ? null : merged.has(ref.name),
    })),
    commits: commits.slice(0, commitLimit),
    worktrees,
    truncated: commits.length > commitLimit,
  } satisfies VcsProjectGraph;
});
