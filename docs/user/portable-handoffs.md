# Context in portable handoffs

T3 Code transfers conversation context when you switch providers, continue through a portable
restart, or use a fork that the provider cannot resume itself.

Short conversations transfer intact. For longer conversations, T3 Code favors recent requests and
answers, the original request, and relevant activity such as command outcomes. Selected messages
keep their full text, order, and user or assistant role, including partial work from failed or
interrupted turns. Your new request stays separate and is never shortened to make history fit.

Codex receives historical messages directly when its installed version supports that operation.
Other providers receive the same selection as attributed conversation context. A handoff does not
copy the outgoing provider's reasoning, tool-call state, or attachments.

The handoff includes references to omitted history. The agent can use T3 Code's thread-reading tool
to retrieve saved messages and activity, including the remainder of a long item. For an important
constraint, you can still repeat it in your next message. A handoff is a budgeted selection, not an
agent-written summary.

## Context limits

A handoff must leave room for existing provider context, your request and attachments, instructions,
tools, and subsequent work. If even its retrieval references cannot fit, T3 Code reports an error
instead of shortening your request. Compact the target conversation or select a larger-context
model before trying again.

Server operators can set `T3CODE_CONTEXT_HANDOFF_TOKEN_CAP` to change the initial history allowance
(default 16,000; clamped to 1,024–64,000). This is an upper bound, not a provider context-window
guarantee. Accounting conservatively charges one token per UTF-8 byte, including attribution and
JSON escaping, and caps handoff plus current-input accounting at 64,000 bytes. Attachments reserve
at least 4,096 units each, or their byte size when larger.

When provider context telemetry is unavailable, T3 Code assumes a 32,000-token window, reserves at
least 16,000 for instructions, tools, and work, and estimates existing context from saved activity.
Custom models and hidden native context can differ, so the provider may still reject an input.
