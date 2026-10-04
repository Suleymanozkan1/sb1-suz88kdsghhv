import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: [".next", "node_modules", "coverage", "playwright-report", "test-results", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name=/^(round|floor|ceil)$/]",
          message: "Use the central decimal rounding helpers in src/domain/money.ts for financial values.",
        },
      ],
    },
  },
  {
    files: ["tests/**", "prisma/**", "playwright.config.ts", "src/components/**", "src/app/**"],
    rules: { "no-restricted-syntax": "off" },
  },
);
