import type { ProviderAdapterV2HistoricalContext } from "./ProviderAdapter.ts";
import { assert, describe, it } from "@effect/vitest";
import {
  ContextHandoffId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  OrchestrationV2ContextHandoff,
  type OrchestrationV2HistoricalMessage,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  handoffBudget,
  historyCost,
  historyResponseItems,
  selectHistory,
  historicalMessage,
} from "./ContextHandoffBudget.ts";
import { projectContextHandoffForWire } from "./WireProjection.ts";
import { deliverContextHandoffs } from "./ContextHandoffDelivery.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeHandoff = Schema.decodeUnknownSync(OrchestrationV2ContextHandoff);

const now = DateTime.makeUnsafe("2026-09-17T00:00:00Z");
const threadId = ThreadId.make("thread:handoff");
const providerThread: OrchestrationV2ProviderThread = {
  id: ProviderThreadId.make("provider-thread:target"),
  driver: ProviderDriverKind.make("codex"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerSessionId: null,
  appThreadId: threadId,
  ownerNodeId: null,
  nativeThreadRef: {
    driver: ProviderDriverKind.make("codex"),
    strength: "strong",
    nativeId: "native:target",
  },
  nativeConversationHeadRef: null,
  status: "idle",
  firstRunOrdinal: null,
  lastRunOrdinal: null,
  handoffIds: [],
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
};
const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
): OrchestrationV2HistoricalMessage => ({
  itemId: TurnItemId.make(id),
  role,
  text,
  threadId,
  runId: RunId.make("run:source"),
  providerThreadId: ProviderThreadId.make("provider-thread:source"),
  status: "interrupted",
  kind: role === "user" ? "user_message" : "assistant_message",
});
const messages = [
  message("item:one", "user", "Preserve every line.\n\n  And this indentation.\n"),
  message("item:two", "assistant", "Partial work: 日本語 🧪 مرحبا\n" + "x".repeat(600)),
];
const handoff: OrchestrationV2ContextHandoff = {
  id: ContextHandoffId.make("handoff:one"),
  threadId,
  targetRunId: RunId.make("run:target"),
  fromProviderThreadIds: [],
  toProviderThreadId: providerThread.id,
  coveredRunOrdinals: { from: 1, to: 2 },
  strategy: "full_thread_summary",
  status: "ready",
  summaryMessageId: null,
  summaryText: "",
  history: {
    messages,
    coverage: "Historical context; retrieve thread:handoff with t3_thread_read.",
    omittedItems: 0,
  },
  createdByProviderInstanceId: null,
  createdAt: now,
  updatedAt: now,
};

describe("handoff budget", () => {
  it("keeps old preview handoffs readable and delivery history off the wire", () => {
    const projected = projectContextHandoffForWire({
      ...handoff,
      summaryText: "private transcript and command output",
      delivery: {
        nativeThreadId: "native:target",
        status: "injected",
        itemIds: [messages[0]!.itemId],
      },
    });
    assert.equal(projected.summaryText, "");
    assert.isUndefined(projected.history);
    assert.isUndefined(projected.delivery);
    assert.equal(decodeHandoff(projected).id, handoff.id);
    assert.deepEqual(handoff.history?.messages, messages);
  });
  it("carries command outcomes as attributed activity and excludes reasoning", () => {
    const base = {
      id: TurnItemId.make("item:command"),
      threadId,
      runId: RunId.make("run:source"),
      nodeId: null,
      providerThreadId: providerThread.id,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "failed" as const,
      title: null,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    };
    const command = historicalMessage({
      ...base,
      type: "command_execution",
      input: "vp test",
      output: "Failure near the end: " + "界".repeat(300),
      exitCode: 1,
    });
    assert.equal(command?.role, "assistant");
    assert.equal(command?.kind, "command_execution");
    assert.include(command!.text, "Exit code: 1");
    assert.include(command!.text, "界".repeat(300));
    assert.isNull(
      historicalMessage({
        ...base,
        type: "reasoning",
        text: "private reasoning",
        streaming: false,
      }),
    );
    assert.equal(historyResponseItems([command!], "Activity")[1]?.type, "message");
  });

  it("retains short conversations verbatim in role and order", () => {
    const selected = selectHistory({ messages, coverage: "History", budget: 16_000 });
    assert.deepEqual(selected.messages, messages);
    const items = historyResponseItems(selected.messages, selected.context);
    assert.deepEqual(
      items.map((item) => item.role),
      ["user", "user", "assistant"],
    );
    assert.include(items[1]!.content[0]!.text, messages[0]!.text);
    assert.include(items[2]!.content[0]!.text, messages[1]!.text);
    assert.equal(selected.omittedItems, 0);
  });

  it("omits oversized multilingual items whole, preserves original constraints and recent work", () => {
    const candidates = [
      messages[0]!,
      message("huge", "assistant", "界🧪".repeat(20_000)),
      message("old", "assistant", "a".repeat(4_000)),
      messages[1]!,
    ];
    const selected = selectHistory({
      messages: candidates,
      coverage: "thread:handoff runs 1-4",
      budget: 3_000,
    });
    assert.deepEqual(selected.messages, messages);
    assert.equal(selected.omittedItems, 2);
    assert.isAtMost(historyCost(selected.messages, selected.context), 3_000);
  });

  it("counts JSON escaping and UTF-8 bytes across many messages", () => {
    const candidates = Array.from({ length: 500 }, (_, i) =>
      message(`item:${i}`, i % 2 ? "assistant" : "user", '\u0000\\"🧪界'.repeat(15)),
    );
    for (const budget of [1_024, 4_000, 16_000]) {
      const selected = selectHistory({
        messages: candidates,
        coverage: "Retrieve omitted history",
        budget,
      });
      assert.isAtMost(historyCost(selected.messages, selected.context), budget);
      assert.isAbove(selected.omittedItems, 0);
    }
  });

  it("subtracts native usage, input, attachments, instructions and space for work", () => {
    const base = {
      tokenCap: 16_000,
      userText: "Continue",
      attachments: [],
      providerThread,
      nativeContextBytes: 0,
    };
    assert.isBelow(handoffBudget(base), 16_000);
    assert.isBelow(handoffBudget({ ...base, nativeContextBytes: 8_000 }), handoffBudget(base));
    assert.equal(handoffBudget({ ...base, userText: "界".repeat(30_000) }), 0);
    assert.equal(
      handoffBudget({
        ...base,
        providerThread: {
          ...providerThread,
          contextUsage: { usedTokens: 23_000, maxTokens: 24_000 },
        },
      }),
      0,
    );
    assert.equal(
      handoffBudget({
        ...base,
        attachments: [
          {
            type: "image",
            id: "attachment",
            name: "image.png",
            mimeType: "image/png",
            sizeBytes: 40_000,
          },
        ],
      }),
      0,
    );
    assert.equal(handoffBudget({ ...base, tokenCap: 2_000 }), 2_000);
  });
});

describe("handoff delivery", () => {
  it.effect("persists successful injection before turn start and skips it on retry", () =>
    Effect.gen(function* () {
      let durable = handoff;
      const history: unknown[] = [];
      const statuses: string[] = [];
      const input = {
        providerThread,
        budget: 16_000,
        alreadyDeliveredItemIds: new Set<string>(),
        inject: (value: ProviderAdapterV2HistoricalContext) =>
          Effect.sync(() => {
            history.push(...historyResponseItems(value.messages, value.context));
            return true;
          }),
        persist: (value: OrchestrationV2ContextHandoff) =>
          Effect.sync(() => {
            durable = value;
            statuses.push(value.delivery!.status);
          }),
      };
      const first = yield* deliverContextHandoffs({ ...input, handoffs: [durable] });
      assert.equal(first.context, "");
      assert.deepEqual(statuses, ["pending", "injected"]);
      assert.lengthOf(history, 3);
      // No turn has started. Reconstruct from the durable projection as a retry would.
      const second = yield* deliverContextHandoffs({ ...input, handoffs: [durable] });
      assert.equal(second.context, "");
      assert.lengthOf(history, 3);
    }),
  );

  it.effect(
    "uses the same selection on explicit native fallback, marking only accepted input",
    () =>
      Effect.gen(function* () {
        let durable = handoff;
        const result = yield* deliverContextHandoffs({
          handoffs: [handoff],
          providerThread,
          budget: 16_000,
          alreadyDeliveredItemIds: new Set(),
          inject: () => Effect.succeed(false),
          persist: (value) =>
            Effect.sync(() => {
              durable = value;
            }),
        });
        assert.include(result.context, messages[0]!.text);
        assert.include(result.context, messages[1]!.text);
        assert.equal(durable.delivery?.status, "pending");
        yield* result.delivered;
        assert.equal(durable.delivery?.status, "inline");
      }),
  );

  it.effect(
    "defers unsupported compaction history until a normal turn without marking delivery uncertain",
    () =>
      Effect.gen(function* () {
        let durable = handoff;
        const persist = (value: OrchestrationV2ContextHandoff) =>
          Effect.sync(() => {
            durable = value;
          });
        const compact = yield* deliverContextHandoffs({
          handoffs: [durable],
          providerThread,
          budget: 16_000,
          alreadyDeliveredItemIds: new Set(),
          deferInline: true,
          inject: () => Effect.succeed(false),
          persist,
        });
        yield* compact.delivered;
        assert.equal(compact.context, "");
        assert.isUndefined(durable.delivery);
        const next = yield* deliverContextHandoffs({
          handoffs: [durable],
          providerThread,
          budget: 16_000,
          alreadyDeliveredItemIds: new Set(),
          persist,
        });
        assert.include(next.context, messages[0]!.text);
        yield* next.delivered;
        assert.equal(durable.delivery?.status, "inline");
      }),
  );

  it.effect("does not redeliver after ambiguous injection failure", () =>
    Effect.gen(function* () {
      let durable = handoff;
      let calls = 0;
      const input = {
        providerThread,
        budget: 16_000,
        alreadyDeliveredItemIds: new Set<string>(),
        inject: () =>
          Effect.sync(() => {
            calls++;
          }).pipe(Effect.andThen(Effect.fail("connection lost"))),
        persist: (value: OrchestrationV2ContextHandoff) =>
          Effect.sync(() => {
            durable = value;
          }),
      };
      yield* deliverContextHandoffs({ ...input, handoffs: [durable] }).pipe(Effect.result);
      assert.equal(durable.delivery?.status, "pending");
      const retry = yield* deliverContextHandoffs({ ...input, handoffs: [durable] }).pipe(
        Effect.result,
      );
      assert.equal(retry._tag, "Failure");
      assert.equal(calls, 1);
    }),
  );

  it.effect("budgets multiple handoffs together and skips previously delivered items", () =>
    Effect.gen(function* () {
      const extra = {
        ...handoff,
        id: ContextHandoffId.make("handoff:two"),
        history: {
          ...handoff.history!,
          messages: [...messages, message("item:three", "assistant", "Latest result")],
        },
      };
      let delivered: ReadonlyArray<unknown> = [];
      yield* deliverContextHandoffs({
        handoffs: [handoff, extra],
        providerThread,
        budget: 2_500,
        alreadyDeliveredItemIds: new Set(["item:one"]),
        inject: (value) =>
          Effect.sync(() => {
            delivered = historyResponseItems(value.messages, value.context);
            return true;
          }),
        persist: () => Effect.void,
      });
      const serialized = yield* encodeJson(delivered);
      assert.isAtMost(Buffer.byteLength(serialized), 2_500);
      assert.notInclude(serialized, "Preserve every line");
      assert.equal(serialized.split("Partial work").length - 1, 1);
      assert.include(serialized, "Latest result");
    }),
  );

  it.effect("fails before delivery when even the coverage marker cannot fit", () =>
    Effect.gen(function* () {
      let calls = 0;
      const result = yield* deliverContextHandoffs({
        handoffs: [handoff],
        providerThread,
        budget: 0,
        alreadyDeliveredItemIds: new Set(),
        inject: () =>
          Effect.sync(() => {
            calls++;
            return true;
          }),
        persist: () => Effect.void,
      }).pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      assert.equal(calls, 0);
    }),
  );
});
