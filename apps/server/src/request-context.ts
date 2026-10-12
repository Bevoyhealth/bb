import { getConnInfo } from "@hono/node-server/conninfo";
import {
  APP_SURFACE_API,
  APP_SURFACE_HEADER_NAME,
  parseRequestAppSurface,
  type RequestAppSurface,
} from "@bb/config/app-surface";
import { isLoopbackAddress } from "@bb/config/loopback";
import type { MessageAuthor } from "@bb/domain";
import type { Context } from "hono";

export const TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY = "bbTrustedRemoteAddress";
const GATE_AUTH_HEADER_NAME = "x-bb-gate-auth";
const GATE_MACHINE_ID_HEADER_NAME = "x-bb-gate-machine-id";
const TAILSCALE_USER_LOGIN_HEADER_NAME = "tailscale-user-login";
const TAILSCALE_USER_NAME_HEADER_NAME = "tailscale-user-name";
const ENCODED_WORD_PATTERN = /^=\?utf-8\?([qb])\?([^?]*)\?=$/iu;
type GateAuthKind = "machine" | "session";

export interface GateAuthHeaderReader {
  req: { header(name: string): string | undefined };
}

interface TrustedRemoteAddressReader {
  get(key: typeof TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY): string | undefined;
}

declare module "hono" {
  interface ContextVariableMap {
    [TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY]: string | undefined;
  }
}

export function captureTrustedRemoteAddress(context: Context): void {
  try {
    context.set(
      TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY,
      getConnInfo(context).remote.address,
    );
  } catch {
    context.set(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY, undefined);
  }
}

export function getTrustedRemoteAddress(
  context: TrustedRemoteAddressReader,
): string | undefined {
  return context.get(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY);
}

export function getGateAuthKind(
  context: GateAuthHeaderReader,
): GateAuthKind | null {
  const value = context.req.header(GATE_AUTH_HEADER_NAME);
  return value === "machine" || value === "session" ? value : null;
}

export function getGateMachineId(context: GateAuthHeaderReader): string | null {
  const value = context.req.header(GATE_MACHINE_ID_HEADER_NAME)?.trim();
  return value ? value : null;
}

export function resolveRequestAppSurface(context: Context): RequestAppSurface {
  return (
    parseRequestAppSurface(context.req.header(APP_SURFACE_HEADER_NAME)) ??
    APP_SURFACE_API
  );
}

function decodeEncodedWord(value: string): string {
  const match = ENCODED_WORD_PATTERN.exec(value);
  if (match === null) return value;
  const [, encoding, text] = match;
  if (encoding === undefined || text === undefined) return value;
  if (encoding.toLowerCase() === "b") {
    return Buffer.from(text, "base64").toString("utf8");
  }
  const bytes = text
    .replace(/_/gu, " ")
    .replace(/=([0-9a-f]{2})/giu, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  return Buffer.from(bytes, "latin1").toString("utf8");
}

export function getRequestAuthor(
  context: GateAuthHeaderReader & TrustedRemoteAddressReader,
): MessageAuthor | null {
  if (getGateAuthKind(context) !== null) return null;
  const remoteAddress = getTrustedRemoteAddress(context);
  if (remoteAddress === undefined || !isLoopbackAddress(remoteAddress)) {
    return null;
  }
  const login = context.req.header(TAILSCALE_USER_LOGIN_HEADER_NAME)?.trim();
  if (!login) return null;
  const rawName = context.req.header(TAILSCALE_USER_NAME_HEADER_NAME)?.trim();
  const name = rawName ? decodeEncodedWord(rawName).trim() : "";
  return { login, name: name || login };
}
