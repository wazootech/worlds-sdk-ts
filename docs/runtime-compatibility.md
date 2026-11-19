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

| Toolchain          | Install                        | Core + `/rdfjs` (import, search, SPARQL) | Every subpath imports | TypeScript types     |
| ------------------ | ------------------------------ | ---------------------------------------- | --------------------- | -------------------- |
| Deno               | `deno add jsr:@worlds/sdk`     | Yes (repo CI)                            | Yes (repo CI)         | Yes (`deno task ci`) |
| Node.js + npm      | `npx jsr add @worlds/sdk`      | Yes                                      | 11 of 12, see below   | Fails, see below     |
| Bun                | `bunx jsr add @worlds/sdk`     | Yes                                      | 12 of 12              | Not tested           |
| pnpm 12            | `pnpm dlx jsr add @worlds/sdk` | Yes                                      | 12 of 12              | Not tested           |
| Yarn               | `yarn dlx jsr add @worlds/sdk` | Not tested                               | Not tested            | Not tested           |
| Cloudflare Workers | n/a                            | Not tested                               | Not tested            | Not tested           |

"Every subpath" means a bare `import("@worlds/sdk/<subpath>")` for each key in
`deno.json` `exports`. The Deno KV backend named in older docs is not an export
of `@worlds/sdk` 0.9.0.

## Known limitations

- **`pnpm dlx jsr add` exits 1 on pnpm 12.** The packages are installed and the
  hello-world flow and all 12 subpaths work, but pnpm reports
  `ERR_PNPM_IGNORED_BUILDS` for `core-js@3.29.1` (a build script pulled in
  through the TensorFlow.js dependency) and fails the command. Run
  `pnpm approve-builds` or allow that build in the project's pnpm settings. pnpm
  also installed `zod`, so the `ai-sdk` subpath imports there.

- **`@worlds/sdk/ai-sdk` on npm needs `zod`.** The import fails with
  `Cannot find package 'zod'` from `ai/dist/index.mjs`: `ai` declares `zod` as a
  peer dependency and a plain `npx jsr add` did not install it. `npm i zod@4`
  fixes it (verified). Bun installed it automatically.
- **TypeScript under Node with `@worlds/sdk` 0.9.0 and `@wazoo/sparql-engine`
  0.5.0.** The hello-world `MemoryStore` failed the type check
  ([worlds-sdk-ts#268](https://github.com/wazootech/worlds-sdk-ts/issues/268)).
  Fixed in 0.9.1 (requires engine `^0.5.0`); the consumer smoke script now
  type-checks as well as runs.
