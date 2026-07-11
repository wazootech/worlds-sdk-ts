# Troubleshooting and gotchas decision tree

Use this guide to diagnose and resolve common errors and environment issues
encountered when setting up or developing in the `wazoo-worlds` repository.

## Deno or JSR command errors

```
Is Deno installed globally on your machine?
  ├── [No]  ──> Go to https://deno.land and install Deno.
  └── [Yes] ──> Is Deno up to date?
                  ├── [No]  ──> Run: Deno upgrade
                  └── [Yes] ──> 1. Run: Deno install --allow-scripts
                                2. Run a task from workspace deno.json
```

### Symptoms

- Command `deno` not found.
- Syntax errors or package resolution failures due to outdated runtime versions.

## TensorFlow.js USE offline models missing

```
Are you running Semantic Search and getting file loading errors?
  ├── [Yes] ──> Did you run the TFJS-USE download task?
  │               ├── [No]  ──> Run: deno task download:tfjs-use
  │               └── [Yes] ──> From the workspace root, check if 'src/tfjs-universal-sentence-encoder/model/' contains .bin and .json files.
  └── [No]  ──> Continue setup.
```

### Symptoms

- Search functions return empty arrays.
- Runtime errors like
  `TypeError: Cannot read properties of undefined (reading 'load')` or model
  fetch failures.
- Offline vectorization throws file-not-found exceptions.

## Missing environment variables

```
Running the AI SDK example and getting API key errors?
  ├── [Yes] ──> Do you have a '.env' file in the root with your API key?
  │               ├── [No]  ──> Create '.env' containing the required provider key (e.g., GEMINI_API_KEY=your_key)
  │               └── [Yes] ──> Did you pass the '--env' flag to Deno?
  │                               ├── [No]  ──> Run the task with the '--env' flag (e.g. 'deno task example:ai-sdk-hello-world')
  │                               └── [Yes] ──> Verify that your key has permissions for the configured model.
  └── [No]  ──> Continue setup.
```

### Symptoms

- Error: `API_KEY_INVALID` or `API key not found`.
- Google Generative AI crashes on instantiation.

## Formatting, lint, or Unix line endings checks failing in CI

```
Are your changes rejected by the CI formatting pipeline?
  ├── [Yes] ──> Are you on a Windows machine?
  │               ├── [Yes] ──> 1. Set Git line endings to LF: git config core.autocrlf false
  │               │             2. Run formatter: deno task fmt
  │               └── [No]  ──> Run formatter: deno task fmt
  └── [No]  ──> Check deno task lint output.
```

### Symptoms

- CI check `fmt:check` fails.
- Formatting differences in Git diff showing `\r\n` (CRLF) characters.

## JSR publish and import convention errors

```
Are you getting import resolution errors during local test execution or when doing a dry-run publish?
  ├── [Yes] ──> Search modified files under 'src/' in the workspace for imports starting with '@worlds/client'
  │               ├── [Found] ──> Replace them with relative imports or '@/' (e.g. '@/client/quad-store/mod.ts').
  │               └── [None]  ──> Run: deno task publish:dry to check export maps in workspace deno.json.
  └── [No]  ──> Continue setup.
```

### Symptoms

- Errors such as: `export '...' not found in jsr:@worlds/client` or
  `unresolvable 'jsr:' dependency`.
- JSR publish dry-run fails with diagnostic errors.

## Installing the client package in full-stack projects or console prior art

```
Integrating this client into a new project or checking out console prior art?
  ├── [Step 1] ──> Initialize your Node/Bun project or checkout the prior art repository.
  ├── [Step 2] ──> In the project directory, run:
  │                  ├── [Using Node/npm] ──> npx jsr add @worlds/client
  │                  ├── [Using Bun]      ──> bunx jsr add @worlds/client
  │                  └── [Using Yarn]     ──> yarn dlx jsr add @worlds/client
  └── [Step 3] ──> Import and configure the Client to start building your application.
```
