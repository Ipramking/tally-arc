import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { arc } from "./arc";

export const wagmiConfig = createConfig({
  chains: [arc],
  connectors: [injected()],
  transports: {
    [arc.id]: http(),
  },
  ssr: true,
});
