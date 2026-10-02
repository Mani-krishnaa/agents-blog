import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "data", "content", "assets", "blog", "vendor", "dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Adapters must only be reachable through the publish gate.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/publishing/adapters/*"],
              message: "Import adapters only inside src/publishing/ (publish-service.ts).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/publishing/**"],
    rules: { "no-restricted-imports": "off" },
  },
);
