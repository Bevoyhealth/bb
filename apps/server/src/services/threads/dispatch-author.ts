import type {
  MessageAuthor,
  StartedOnBehalfOf,
  ThreadTurnInitiator,
} from "@bb/domain";

interface ResolveDispatchAuthorArgs {
  messageAuthor: MessageAuthor | null;
  retrying: boolean;
  senderThreadId: string | null;
  startedOnBehalfOf: StartedOnBehalfOf | null;
}

interface DispatchAuthor {
  author: MessageAuthor | null;
  initiator: ThreadTurnInitiator;
  senderThreadId: string | null;
}

export function resolveDispatchAuthor(
  args: ResolveDispatchAuthorArgs,
): DispatchAuthor {
  if (args.retrying) {
    return { author: null, initiator: "system", senderThreadId: null };
  }
  if (args.senderThreadId !== null) {
    return {
      author: null,
      initiator: "agent",
      senderThreadId: args.senderThreadId,
    };
  }
  if (args.startedOnBehalfOf !== null) {
    return {
      author: null,
      initiator: args.startedOnBehalfOf.initiator,
      senderThreadId: args.startedOnBehalfOf.senderThreadId,
    };
  }
  return {
    author: args.messageAuthor,
    initiator: "user",
    senderThreadId: null,
  };
}
