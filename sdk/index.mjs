import { createRequire } from "node:module";

const api = createRequire(import.meta.url)("./index.js");

export const { lookup, describe, LEVELS, chains, defaultChain, studioUrl, getChain, verifyTallyFile, exitCodeFor } = api;
export default api;
