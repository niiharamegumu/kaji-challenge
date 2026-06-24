import tsParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/api/generated/**"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    ...reactHooks.configs.flat["recommended-latest"],
  },
]);
