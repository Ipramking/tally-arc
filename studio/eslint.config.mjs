import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Test doubles (fake wallets, fake RPC replies) are deliberately loosely typed.
  { files: ["test/**/*.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  globalIgnores([".next/**", "out/**", "next-env.d.ts", "node_modules/**"]),
]);
