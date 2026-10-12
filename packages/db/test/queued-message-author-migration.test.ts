import { readFileSync } from "node:fs";
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
    const journal = JSON.parse(
      readFileSync(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: { tag: string; when: number }[] };
    const authorMigration = journal.entries.find(
      (entry) => entry.tag === "0134_queued_message_author",
    );
    if (authorMigration === undefined) {
      throw new Error("Migration 0134_queued_message_author is missing");
    }
    db.$client
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
      .run(authorMigration.when);

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
