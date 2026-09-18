import { http, createConfig } from '@wagmi/vue'
import { arbitrum, arbitrumSepolia } from '@wagmi/vue/chains'
import { injected } from '@wagmi/vue/connectors'

/** Browser calls go through the API proxy → RPC_URL from server .env */
const rpc = http('/api/rpc')

export const config = createConfig({
  chains: [arbitrumSepolia, arbitrum],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [arbitrumSepolia.id]: rpc,
    [arbitrum.id]: rpc,
  },
})

declare module '@wagmi/vue' {
  interface Register {
    config: typeof config
  }
}
