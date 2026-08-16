/**
 * generateDocJson merges `deno doc --json` output for every package export subpath.
 */
import denoJson from "../deno.json" with { type: "json" };

/** DocJsonEntryPoint records one deno.json export and its source file. */
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

const exportsMap = denoJson.exports as Record<string, string>;
const outputPath = new URL("../docs/api.json", import.meta.url);

const merged: DocJsonOutput = {
  version: 2,
  entryPoints: [],
  nodes: {},
};

for (const [subpath, filePath] of Object.entries(exportsMap)) {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["doc", "--json", filePath],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(
      `deno doc --json ${filePath} failed (exit ${code}): ${errorText}`,
    );
  }

  const document = JSON.parse(new TextDecoder().decode(stdout)) as {
    nodes?: Record<string, unknown>;
  };

  merged.entryPoints.push({ subpath, file: filePath });
  Object.assign(merged.nodes, document.nodes ?? {});
}

await Deno.mkdir(new URL("../docs/", import.meta.url), { recursive: true });
await Deno.writeTextFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`);

console.log(
  `Wrote ${merged.entryPoints.length} entry points to docs/api.json`,
);
