// Consumer smoke test: installs the PUBLISHED @worlds/sdk from JSR's npm
// compatibility layer into a throwaway project and runs the hello-world flow
// (import, search, SPARQL) under Node.js/npm or Bun, then type-checks the same
// file with tsc as a consumer would.
//
//   node scripts/consumer-smoke.mjs node
//   node scripts/consumer-smoke.mjs bun
//
// It tests what is on JSR, not this checkout, so run it after a publish.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtime = process.argv[2];
const plans = {
  node: {
    add: ["npx", "-y", "jsr", "add"],
    run: ["node", "smoke.mjs"],
    addDev: ["npm", "install", "-D", "typescript@5", "@types/node@24"],
    tsc: ["npx", "tsc"],
  },
  bun: {
    add: ["bunx", "jsr", "add"],
    run: ["bun", "smoke.mjs"],
    addDev: ["bun", "add", "-d", "typescript@5", "@types/node@24"],
    tsc: ["bunx", "tsc"],
  },
};
const plan = plans[runtime];
if (!plan) {
  console.error("usage: consumer-smoke.mjs <node|bun>");
  process.exit(2);
}

const SMOKE = `
import { WorldsSdk } from "@worlds/sdk";
import { MemoryStore, WazooSparqlEngine } from "@wazoo/sparql-engine";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/sdk/rdfjs";
const store = new MemoryStore();
const client = new WorldsSdk({
  quadStore: new RdfjsQuadStore({ store }),
  searchIndex: new RdfjsSearchIndex(store),
  sparqlEngine: new WazooSparqlEngine({ store }),
});
await client.import({ source: { kind: "serialized", contentType: "text/turtle",
  data: '<http://example.com/s> <http://example.com/p> "Hello, World!" .' } });
const found = await client.search({ query: "Hello" });
const rows = await client.sparql({ query: "SELECT ?o WHERE { ?s ?p ?o }" });
if (!found.results?.length) throw new Error("search returned no results");
if (rows.kind !== "select" || rows.data.results.bindings.length !== 1) {
  throw new Error("bad SPARQL rows");
}
console.log("ok: import, search and sparql");
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    module: "nodenext",
    moduleResolution: "nodenext",
    target: "es2022",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
  files: ["smoke.ts"],
});

const dir = mkdtempSync(join(tmpdir(), `worlds-sdk-${runtime}-`));
// Every argument is a constant above, so joining into one shell string is safe.
const sh = (cmd) => execSync(cmd.join(" "), { cwd: dir, stdio: "inherit" });
try {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  writeFileSync(join(dir, "smoke.mjs"), SMOKE);
  writeFileSync(join(dir, "smoke.ts"), SMOKE);
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
  sh([...plan.add, "@worlds/sdk", "@wazoo/sparql-engine"]);
  sh(plan.run);
  // A consumer's type-check is a separate failure mode from running (#268).
  sh(plan.addDev);
  sh(plan.tsc);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
