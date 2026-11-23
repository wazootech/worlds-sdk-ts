/**
 * generateDocJson merges `deno doc --json` output for every package export subpath.
 * Runs under Bun or Node; it shells out to the `deno` CLI, the one remaining
 * Deno-only step (no Bun equivalent of `deno doc` exists).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import jsrJson from "../jsr.json" with { type: "json" };

/** DocJsonEntryPoint records one jsr.json export and its source file. */
interface DocJsonEntryPoint {
  /** subpath is the @worlds/sdk export key (e.g. "./adapters/libsql"). */
  subpath: string;
  /** file is the repository-relative entry file path. */
  file: string;
}

/** DocJsonOutput is the merged documentation graph written to docs/api.json. */
interface DocJsonOutput {
  /** version matches deno doc JSON schema version. */
  version: number;
  /** entryPoints lists every export subpath included in the merge. */
  entryPoints: DocJsonEntryPoint[];
  /** nodes merges symbol graphs from all entry points. */
  nodes: Record<string, unknown>;
}

const exportsMap = jsrJson.exports as Record<string, string>;
const outputPath = new URL("../docs/api.json", import.meta.url);

const merged: DocJsonOutput = {
  version: 2,
  entryPoints: [],
  nodes: {},
};

for (const [subpath, filePath] of Object.entries(exportsMap)) {
  const { status, stdout, stderr } = spawnSync(
    "deno",
    ["doc", "--json", filePath],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );

  if (status !== 0) {
    throw new Error(
      `deno doc --json ${filePath} failed (exit ${status}): ${stderr}`,
    );
  }

  const document = JSON.parse(stdout) as {
    nodes?: Record<string, unknown>;
  };

  merged.entryPoints.push({ subpath, file: filePath });
  Object.assign(merged.nodes, document.nodes ?? {});
}

mkdirSync(fileURLToPath(new URL("../docs/", import.meta.url)), {
  recursive: true,
});
writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`);

console.log(
  `Wrote ${merged.entryPoints.length} entry points to docs/api.json`,
);
