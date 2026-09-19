import { http, createConfig } from "wagmi";
// Import `injected` from core, not `wagmi/connectors`: the connectors barrel
// pulls in Coinbase's Base Account connector, which needs the optional
// `@x402/evm` module and breaks the build. We only need the injected wallet.
import { injected } from "@wagmi/core";
import { arc } from "./arc";

export const wagmiConfig = createConfig({
  chains: [arc],
  connectors: [injected()],
  transports: {
    [arc.id]: http(),
  },
  ssr: true,
});
