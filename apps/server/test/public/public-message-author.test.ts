import { listQueuedThreadMessages } from "@bb/db";
import { threadQueuedMessageSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const LOOPBACK_PEER = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const NETWORK_PEER = { incoming: { socket: { remoteAddress: "100.64.0.7" } } };
const PETER_HEADERS = {
  "tailscale-user-login": "peter@medfinder.com",
  "tailscale-user-name": "Peter",
};

function seedBusyThread(harness: TestAppHarness, value: number) {
  const { host } = seedHostSession(harness.deps, {
    id: `host-message-author-${value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/message-author-${value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/message-author-${value}`,
    status: "ready",
  });
  return seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "active",
  });
}

async function queueMessage(
  harness: TestAppHarness,
  threadId: string,
  text: string,
  headers: Record<string, string>,
  peer: object | undefined,
): Promise<Response> {
  return harness.app.request(
    `/api/v1/threads/${threadId}/queued-messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        input: [{ type: "text", text }],
        model: "gpt-5",
      }),
    },
    peer,
  );
}

describe("message author from the Tailscale identity", () => {
  it("records the Tailscale login of a loopback request on the queued message", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedBusyThread(harness, 1);

      const response = await queueMessage(
        harness,
        thread.id,
        "from Peter",
        PETER_HEADERS,
        LOOPBACK_PEER,
      );

      const body = await readJson(response);
      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body).toMatchObject({
        initiator: "user",
        author: { login: "peter@medfinder.com", name: "Peter" },
      });
      const [row] = listQueuedThreadMessages(harness.db, thread.id);
      expect(row).toMatchObject({
        authorLogin: "peter@medfinder.com",
        authorName: "Peter",
      });
    });
  });

  it("decodes an encoded display name and falls back to the login", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedBusyThread(harness, 2);

      const encoded = await queueMessage(
        harness,
        thread.id,
        "encoded name",
        {
          "tailscale-user-login": "sveinn@insitohealth.com",
          "tailscale-user-name": "=?utf-8?q?Sveinn_=C3=9E=C3=B3r?=",
        },
        LOOPBACK_PEER,
      );
      const nameless = await queueMessage(
        harness,
        thread.id,
        "no name",
        { "tailscale-user-login": "luke@medfinder.com" },
        LOOPBACK_PEER,
      );

      expect(await readJson(encoded)).toMatchObject({
        author: { login: "sveinn@insitohealth.com", name: "Sveinn Þór" },
      });
      expect(await readJson(nameless)).toMatchObject({
        author: { login: "luke@medfinder.com", name: "luke@medfinder.com" },
      });
    });
  });

  it.each<{
    label: string;
    headers: Record<string, string>;
    peer: object | undefined;
  }>([
    { label: "a network peer", headers: {}, peer: NETWORK_PEER },
    { label: "an unknown peer", headers: {}, peer: undefined },
    {
      label: "a bb connect request",
      headers: { "x-bb-gate-auth": "session" },
      peer: LOOPBACK_PEER,
    },
    {
      label: "an unrecognized bb connect marker",
      headers: { "x-bb-gate-auth": "other" },
      peer: LOOPBACK_PEER,
    },
    {
      label: "an empty bb connect marker",
      headers: { "x-bb-gate-auth": "" },
      peer: LOOPBACK_PEER,
    },
  ])("ignores the Tailscale headers from $label", async ({ headers, peer }) => {
    await withTestHarness(async (harness) => {
      const thread = seedBusyThread(harness, 3);

      const response = await queueMessage(
        harness,
        thread.id,
        "forged",
        { ...PETER_HEADERS, ...headers },
        peer,
      );

      expect(response.status).toBe(201);
      expect(await readJson(response)).toMatchObject({ author: null });
      const [row] = listQueuedThreadMessages(harness.db, thread.id);
      expect(row).toMatchObject({ authorLogin: null, authorName: null });
    });
  });

  it("refuses to group queued messages from two authors into one turn", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedBusyThread(harness, 4);
      const first = threadQueuedMessageSchema.parse(
        await readJson(
          await queueMessage(
            harness,
            thread.id,
            "first",
            PETER_HEADERS,
            LOOPBACK_PEER,
          ),
        ),
      );
      const second = threadQueuedMessageSchema.parse(
        await readJson(
          await queueMessage(
            harness,
            thread.id,
            "second",
            {
              "tailscale-user-login": "simran@insitohealth.com",
              "tailscale-user-name": "Simran",
            },
            LOOPBACK_PEER,
          ),
        ),
      );

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/group-boundary`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedGroupedPrefixQueuedMessageIds: [first.id, second.id],
            groupBoundaryQueuedMessageId: second.id,
          }),
        },
      );

      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        message: "Queued messages from different senders cannot be grouped",
      });
    });
  });
});
