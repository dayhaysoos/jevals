# jevals

A local workbench for testing [Jev](https://docs.typesafe.ai/introduction) questions against examples with expected answers. Create evaluations, run them, and compare saved results.

Supports **Noul** (yes/no), **Choice** (select an option), **Score** (an ordered rubric), and combinations of all three.

## Get started

Requires Node.js 22.13 or newer.

```sh
npx jevals
```

The command starts a local server and opens the workbench in your browser. Create a `.env` file in your workspace to enable runs:

```dotenv
TYPESAFE_API_KEY=your_api_key
```

You can create and edit evaluations without a key. Restart after changing it.

```sh
npx jevals --dir ./my-evals   # Choose a workspace
npx jevals --port 4318       # Choose another port
npx jevals --no-open         # Print the URL without opening a browser
```

For a project-local installation:

```sh
npm install --save-dev jevals
npx jevals
```

## Try the examples

```sh
npx jevals seed
```

Adds seven example evaluations covering sandwich classification, minifridges, personal information, distributed systems, bug severity, and support-ticket quality. Re-running the command preserves existing evaluations and edits. No API requests are made during seeding. Stop the server before seeding the same database; each database has one owner at a time.

## Basic workflow

1. Create a Jeval and add questions in **Definition**.
2. Add examples in **Cases**. Each expected answer is the answer you believe is correct, with a short explanation.
3. **Save changes**, then **Run evaluation**.
4. Inspect **Results** and compare previous runs in **Runs**.

Define a state schema to generate case forms, or enter plain text or JSON. Use **Glossary** in the sidebar for terminology.

Definitions and run history are saved in your workspace’s `.data/jevals.sqlite`, separately from the installed package. Back up this folder to preserve your work; package upgrades do not replace it. On shutdown, the server gives accepted Runs up to five seconds to finish. Any unfinished Runs are marked failed on the next startup, preserving their saved answers and traces. Runs send case data to TypeSafe using your server-side API key and may incur cost. Results include correctness, probabilities, tokens, latency, estimated costs, and request traces.

## Development

From a source checkout:

```sh
npm install
cp .env.example .env
npm run seed
npm run dev
```

Open [localhost:4317](http://localhost:4317).

```sh
npm run typecheck
npm test
npm run test:browser
npm run test:package
```

Browser checks require Google Chrome with WebMCP support. Tests use simulated requests and isolated databases. The package check installs the actual npm artifact without development dependencies and verifies startup, seeding, runs, errors, and persistence.

WebMCP lets compatible browser agents create, edit, run, and inspect evaluations. Not affiliated with TypeSafe.

## Agent skill

The [Jevals skill](skills/jevals/SKILL.md) guides browser agents through creating evaluations, reviewing expected answers, running experiments, and inspecting results through WebMCP. Read it directly or install the `skills/jevals` folder with your agent’s skill manager.

[Detailed workbench notes](docs/workbench-details.md)

## License

[MIT](LICENSE). Bundled Inter fonts retain their [SIL Open Font License](public/fonts/Inter-OFL.txt).
