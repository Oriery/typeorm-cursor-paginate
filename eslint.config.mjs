import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "lib/**",
      "node_modules/**",
      "artifacts/**",
      "fixtures/**/*.ts",
      "fixtures/**/*.cts",
      "fixtures/**/*.mts",
      "scripts/esm/**/*.mts",
    ],
  },
  {
    files: ["**/*.cjs", "**/*.js", "**/*.mjs"],
    extends: [eslint.configs.recommended],
    languageOptions: { globals: globals.node, ecmaVersion: 2022 },
  },
  {
    files: ["src/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      globals: globals.jest,
      ecmaVersion: 2022,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Test boundaries intentionally exercise untyped JavaScript and ORM internals.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettier,
);
