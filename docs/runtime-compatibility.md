# Runtime compatibility

`@worlds/sdk` is authored for Deno and published to JSR. Node.js/npm, pnpm and
Bun consume the same release through JSR's npm compatibility layer
(`npx jsr add @worlds/sdk`, `bunx jsr add @worlds/sdk`). Deno stays first-class;
it is not the only supported path.

Measured 2026-11-18 against `@worlds/sdk` 0.9.0 on Node 24.11, npm 11.6, Bun
1.3.14. Re-run after each publish with
`node scripts/consumer-smoke.mjs <node|bun>`, which the `Consumer smoke`
workflow also runs after each `Publish`; it installs the published package into
a throwaway project and runs import, search and SPARQL.

## Matrix

| Toolchain          | Install                         | Core + `/rdfjs` (import, search, SPARQL) | Every subpath imports | TypeScript types     |
| ------------------ | ------------------------------- | ---------------------------------------- | --------------------- | -------------------- |
| Deno               | `deno add jsr:@worlds/sdk`      | Yes (repo CI)                            | Yes (repo CI)         | Yes (`deno task ci`) |
| Node.js + npm      | `npx jsr add @worlds/sdk`       | Yes                                      | 11 of 12, see below   | Fails, see below     |
| Bun                | `bunx jsr add @worlds/sdk`      | Yes                                      | 12 of 12              | Not tested           |
| pnpm, Yarn         | `pnpm dlx jsr add` / `yarn dlx` | Not tested                               | Not tested            | Not tested           |
| Cloudflare Workers | n/a                             | Not tested                               | Not tested            | Not tested           |

"Every subpath" means a bare `import("@worlds/sdk/<subpath>")` for each key in
`deno.json` `exports`. The Deno KV backend named in older docs is not an export
of `@worlds/sdk` 0.9.0.

## Known limitations

- **`@worlds/sdk/ai-sdk` on npm needs `zod`.** The import fails with
  `Cannot find package 'zod'` from `ai/dist/index.mjs`: `ai` declares `zod` as a
  peer dependency and a plain `npx jsr add` did not install it. `npm i zod@4`
  fixes it (verified). Bun installed it automatically.
- **TypeScript under Node: `MemoryStore` is not assignable to `Store<Quad>`.**
  With `tsc` 5 (`nodenext`, `strict`, `@types/node` 24), the hello-world
  `new RdfjsQuadStore({ store })` and `new RdfjsSearchIndex(store)` calls report
  that `MemoryStore.remove()` returns `RdfStream<RdfQuad>`, which lacks
  `EventEmitter` members. The program runs correctly; only the type check fails.
  Tracking is in
  [worlds-sdk-ts#134](https://github.com/wazootech/worlds-sdk-ts/issues/134).
