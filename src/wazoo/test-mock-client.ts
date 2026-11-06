// --- Mock client factory ---

export interface MockCall {
  url: string;
  method: string;
  body?: unknown;
  query?: unknown;
}

export function createMockClient(
  responses: Record<string, unknown>,
): { client: unknown; calls: MockCall[] } {
  const calls: MockCall[] = [];

  const handler = {
    get(
      _target: unknown,
      prop: string,
    ): unknown {
      if (
        prop === "get" || prop === "post" || prop === "delete" ||
        prop === "patch"
      ) {
        return (config: Record<string, unknown>) => {
          calls.push({
            url: config.url as string,
            method: prop.toUpperCase(),
            body: config.body,
            query: config.query,
          });

          const url = config.url as string;
          const responseData = responses[url];

          if (responseData === undefined) {
            return Promise.resolve({
              data: null,
              error: { error: { code: "NOT_FOUND", message: "Not found" } },
            });
          }

          return Promise.resolve({ data: responseData, error: null });
        };
      }
      return undefined;
    },
  };

  return { client: new Proxy({}, handler), calls };
}
