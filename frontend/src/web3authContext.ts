import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK, type Web3AuthOptions } from '@web3auth/modal'
import type { Web3AuthContextConfig } from '@web3auth/modal/vue'

/**
 * Web3Auth requires an absolute https rpcTarget (`new URL(...)`), and the
 * wallet iframe (wallet.web3auth.io) calls it cross-origin — so localhost /
 * same-origin `/api/rpc` cannot be used here. App server routes still proxy
 * via RPC_URL for non-Web3Auth traffic.
 */
const arbitrumSepolia = {
  chainNamespace: CHAIN_NAMESPACES.EIP155,
  chainId: '0x66eee',
  rpcTarget: 'https://sepolia-rollup.arbitrum.io/rpc',
  displayName: 'Arbitrum Sepolia',
  blockExplorerUrl: 'https://sepolia.arbiscan.io',
  ticker: 'ETH',
  tickerName: 'Ether',
  decimals: 18,
  logo: 'https://cryptologos.cc/logos/arbitrum-arb-logo.png',
}

const arbitrumOne = {
  chainNamespace: CHAIN_NAMESPACES.EIP155,
  chainId: '0xa4b1',
  rpcTarget: 'https://arb1.arbitrum.io/rpc',
  displayName: 'Arbitrum One',
  blockExplorerUrl: 'https://arbiscan.io',
  ticker: 'ETH',
  tickerName: 'Ether',
  decimals: 18,
  logo: 'https://cryptologos.cc/logos/arbitrum-arb-logo.png',
}

const web3AuthOptions: Web3AuthOptions = {
  clientId: import.meta.env.VITE_WEB3AUTH_CLIENT_ID,
  web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
  chains: [arbitrumSepolia, arbitrumOne],
  defaultChainId: '0x66eee',
}

const web3AuthContextConfig: Web3AuthContextConfig = {
  web3AuthOptions,
}

export default web3AuthContextConfig
