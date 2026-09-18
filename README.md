# jevals

A local workbench for testing [Jev](https://docs.typesafe.ai/introduction) questions against examples with expected answers. Create evaluations, run them, and compare saved results.

Supports **Noul** (yes/no), **Choice** (select an option), **Score** (an ordered rubric), and combinations of all three.

## Get started

Requires Node.js 22.13 or newer. Run these commands from the project directory:

```sh
npm install
cp .env.example .env
```

Add your TypeSafe API key to `.env`:

```dotenv
TYPESAFE_API_KEY=your_api_key
```

Start the app:

```sh
npm run dev
```

Open [localhost:4317](http://localhost:4317). You can create and edit evaluations without an API key; running them requires one. Restart the server after changing the key.

## Try the examples

```sh
npm run seed
```

Adds seven example evaluations covering sandwich classification, minifridges, personal information, distributed systems, bug severity, and support-ticket quality. Re-running the command preserves existing evaluations and edits. No API requests are made during seeding.

## Basic workflow

1. Create a Jeval and add questions in **Definition**.
2. Add examples in **Cases**. Each expected answer is the answer you believe is correct, with a short explanation.
3. **Save changes**, then **Run evaluation**.
4. Inspect **Results** and compare previous runs in **Runs**.

Define a state schema to generate case forms, or enter plain text or JSON. Use **Glossary** in the sidebar for terminology.

Definitions and run history are saved locally in `.data/jevals.sqlite`. Runs send case data to TypeSafe using your server-side API key and may incur cost. Results include correctness, probabilities, tokens, latency, estimated costs, and request traces.

## Development

```sh
npm run typecheck
npm test
npm run test:browser
```

Browser checks require Google Chrome with WebMCP support and use simulated requests. WebMCP lets compatible browser agents create, edit, run, and inspect evaluations.

This workbench currently runs from a source checkout; the install-and-run npm CLI is not packaged yet. Not affiliated with TypeSafe.

## Agent skill

The [Jevals skill](skills/jevals/SKILL.md) guides browser agents through creating evaluations, reviewing expected answers, running experiments, and inspecting results through WebMCP. Read it directly or install the `skills/jevals` folder with your agent’s skill manager.

[Detailed workbench notes](docs/workbench-details.md)

## License

[MIT](LICENSE). Bundled Inter fonts retain their [SIL Open Font License](public/fonts/Inter-OFL.txt).
