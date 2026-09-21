import tseslint from "typescript-eslint";

// I/O of any kind is forbidden inside the rules engine. It must stay a pure function of its inputs
// (docs/planning/02_architecture.md §3 invariant 1; docs/planning/05_decisioning_design.md §1.2).
const ioModules = ["fs", "node:fs", "fs/promises", "node:fs/promises", "path", "node:path", "http", "node:http", "https", "node:https", "net", "node:net", "child_process", "node:child_process", "pg", "postgres", "undici", "node-fetch", "axios", "ky", "got"];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "services/**"] },
  { files: ["**/*.ts", "**/*.tsx", "**/*.mjs"], languageOptions: { parser: tseslint.parser } },
  {
    files: ["packages/rules-engine/**/*.ts"],
    ignores: ["**/*.test.ts", "**/fixtures/**"], // tests and test fixtures may use node:*; the engine itself may not
    rules: {
      "no-restricted-imports": ["error", {
        paths: ioModules.map((name) => ({ name, message: "rules-engine is pure: no I/O imports (see 02_architecture.md §3)." })),
        patterns: [
          { group: ["node:*", "@parcelpilot/db", "@parcelpilot/db/*", "@parcelpilot/zoning-core", "@parcelpilot/zoning-core/*"], message: "rules-engine is pure: no I/O or service imports." },
        ],
      }],
    },
  },
);
