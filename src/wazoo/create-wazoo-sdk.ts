import { type Client, createClient } from "@worlds/client";
import { WorldsSdk } from "@/client/client.ts";
import type { WorldsSdkInterface } from "@/client/client.ts";
import { RemoteQuadStore } from "./remote-quad-store.ts";
import { RemoteSearchIndex } from "./remote-search-index.ts";
import { RemoteSparqlEngine } from "./remote-sparql-engine.ts";

/**
 * CreateWazooSdkOptions configures the remote Worlds SDK client.
 */
export interface CreateWazooSdkOptions {
  /** baseUrl is the root URL of the Worlds data-plane API. */
  baseUrl: string;

  /** token is the Bearer token used to authenticate requests. */
  token: string;

  /** worldId is the canonical world identifier (e.g. w_<uuid>). */
  worldId: string;
}

/**
 * createWazooSdk assembles a WorldsSdk backed by the remote Worlds API.
 *
 * It wires RemoteQuadStore, RemoteSearchIndex, and RemoteSparqlEngine adapters
 * behind the standard SdkInterface, giving consumers a one-call remote
 * connection to any hosted Worlds API instance.
 *
 * @example
 * ```ts
 * import { createWazooSdk } from "@worlds/sdk/wazoo";
 *
 * const sdk = createWazooSdk({
 *   baseUrl: "https://worlds-api.wazoo.dev",
 *   token: process.env.WORLDS_TOKEN!,
 *   worldId: "w_my-world",
 * });
 *
 * const results = await sdk.search({ query: "explores" });
 * ```
 */
export function createWazooSdk(
  options: CreateWazooSdkOptions,
): WorldsSdkInterface {
  const client: Client = createClient({
    baseUrl: options.baseUrl,
    headers: {
      Authorization: `Bearer ${options.token}`,
    },
  });

  const quadStore = new RemoteQuadStore(client, options.worldId);
  const searchIndex = new RemoteSearchIndex(client, options.worldId);
  const sparqlEngine = new RemoteSparqlEngine(client, options.worldId);

  return new WorldsSdk({ quadStore, searchIndex, sparqlEngine });
}
