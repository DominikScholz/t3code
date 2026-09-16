# Settings and project overrides

The Settings breadcrumb ends with the environment and project a change applies to. They start
at **All environments** and **All projects** and stay selected as you move between categories or
search for a setting.

Preferences saved on this device, such as appearance, confirmations and browser profiles, always
show and ignore the selection. Everything else is stored on a server. Choose one environment to
edit its settings, or leave **All environments** to edit every connected environment at once.
Offline environments keep their current values; this is a bulk edit, not a synced global default.

Choose a project to override settings for it on the selected environments. A layers icon beside
each server row's title shows where the value comes from: the built-in default, the environment,
or a project override. Click it to see that chain on every selected environment. An override can
be reset to inherit again. Settings that cannot be overridden by a project are shown read-only
while a project is selected.

When the selected environments disagree, the control shows **Mixed** in place of a value and the
layers icon turns amber. Picking a value applies it to every selected environment.

Changing an environment value never touches a project's own override. When projects override the
setting you are editing, the layers icon counts them and the chain lists each one with its value:
click a project to jump to it, or **Reset all** to make those projects follow the environment
again.

Providers and diagnostics are per machine: they show one environment at a time, the primary
one until you pick another. Every other setting fans out to the selection.

## Defaults and inheritance

General contains the model and workspace for new threads. Integrations controls agent browser
access. Source Control contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

The Project category, shown while a project is selected, holds the project's name, icon, actions,
checkouts and removal. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`t3.json` actions can be imported there.

For workspace mode, a project's `t3.json` preference applies when the project has no override.
Browser access changes apply when an agent session next starts.

## Project icons

Select the project and open Project to choose an icon, emoji, monogram, or image. The choice applies to
every checkout in the project group and appears on connected clients. Choose **Automatic** to let
T3 Code detect an icon again.

Choose **Monogram** in the icon picker to set one or two letters or numbers and a color.

When no image is found, web and desktop show a two-character monogram with a color
from the icon palette, derived from the saved project name. For example, `Nebula` becomes `NA`,
`Silver Orchard` becomes `SO`, and `M7 Forge` becomes `M7`.

## Keep the default branch current

In Source Control, enable **Automatically pull** to keep the default-branch checkout up to date
with its configured upstream. Choose an environment to set the default or a project to override it.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.

## Project graph

On web and desktop, open **Project graph** from the project picker, Project Settings, or the
command palette. Branch labels have separate entry lanes: the default branch first, then source branches before their
descendants. Newer sibling branches appear farther right, using creation times from the reflog;
missing metadata falls back to alphabetical order. Dotted lines connect each label to its tip. Branches sharing a tip
converge on the originating branch’s track when its origin is recoverable from local reflogs,
including branch renames. Otherwise the default branch, then alphabetical order, determines
which branch displays common history. Every commit appears exactly once; solid lines show its
parent relationships, including real forks and merges. Separate branch names do not imply
separate commit histories or reveal when a branch name was created. Worktree and thread counts
remain attached to the individual branch labels.
Select a dot or label for details and threads. Unsettled thread counts are highlighted.
For projects with multiple checkouts or environments, choose which checkout to explore.

To see threads from another running T3 Code app, pair it under **Settings → Connections →
Add environment**, then choose its project in the picker. Threads update live from that app.
If its version does not support graphs yet, **Read Git from** can use another connected environment
on the same machine with access to the same checkout path. Thread actions still use the app
that owns the threads. The graph URL keeps your checkout and Git source selections.

Drag or scroll to pan, pinch or use the zoom buttons to zoom, and press **F** while the canvas
is focused to fit the graph. Search finds branches, thread titles and worktree paths. Refresh
reads changes made by external Git tools without fetching from a remote.

**Merged** means the branch tip is reachable from the local default branch, or its remote-tracking
ref if no local default branch exists. Squash and rebase merges may still appear unmerged.
Merge status is unknown when the default branch cannot be determined. Large histories are
loaded 2,000 commits at a time; use **Load older commits** to extend the graph. All local branch
labels remain visible, including tips outside the loaded history.

Open a worktree's context menu to close it. Closing removes the checkout directory but keeps
its branch and threads. Git refuses to remove uncommitted or untracked files. Main checkouts,
locked worktrees and worktrees with running thread sessions cannot be closed here. Threads
whose worktree or branch disappeared remain visible separately, so unfinished work can be found.
