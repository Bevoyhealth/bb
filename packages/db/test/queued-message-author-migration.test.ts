import { expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  createConnection,
  createQueuedThreadMessage,
  createThread,
  migrate,
  noopNotifier,
} from "../src/index.js";

it("keeps queued message authors when the author migration runs again", () => {
  const db = createConnection(":memory:");
  try {
    migrate(db);
    const thread = createThread(db, noopNotifier, {
      projectId: PERSONAL_PROJECT_ID,
      providerId: "test-provider",
      status: "idle",
    });
    const queued = createQueuedThreadMessage(db, noopNotifier, {
      threadId: thread.id,
      author: { login: "peter@medfinder.com", name: "Peter" },
      content: [{ type: "text", text: "Queued by Peter", mentions: [] }],
      model: "test-model",
      reasoningLevel: "medium",
      permissionMode: "auto",
      serviceTier: "default",
      waitingOn: null,
      sendAt: null,
      payload: { kind: "inline" },
      systemNotice: null,
    });
    const migrationCreatedAt = db.$client
      .prepare(
        "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
      )
      .pluck()
      .get();
    db.$client
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?")
      .run(migrationCreatedAt);

    migrate(db);

    expect(
      db.$client
        .prepare(
          "SELECT author_login, author_name FROM queued_thread_messages WHERE id = ?",
        )
        .get(queued.id),
    ).toEqual({ author_login: "peter@medfinder.com", author_name: "Peter" });
    expect(
      db.$client
        .prepare(
          "SELECT name FROM pragma_table_info('queued_thread_messages') WHERE name LIKE '_bb_queued_%'",
        )
        .all(),
    ).toEqual([]);
  } finally {
    db.$client.close();
  }
});
