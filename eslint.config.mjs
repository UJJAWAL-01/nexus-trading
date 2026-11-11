import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Known debt, reported as warnings so CI can gate on everything else.
    // These rules flagged ~190 existing problems when CI was introduced.
    // Fix them file by file and promote each rule back to "error" once its
    // count reaches zero. Do NOT add new violations.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/use-memo": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // New security-critical code is held to the strict standard.
    files: ["src/lib/providers/**", "src/lib/api-guard.ts", "src/lib/ratelimiter.ts", "src/proxy.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
