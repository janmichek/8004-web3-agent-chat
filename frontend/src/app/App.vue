<script setup lang="ts">
import { Web3AuthProvider } from '@web3auth/modal/vue'
import { WagmiProvider } from '@web3auth/modal/vue/wagmi'
import { HomePage } from '@/pages/home'
import web3AuthContextConfig from './auth/web3authContext'
</script>

<template>
  <Web3AuthProvider :config="web3AuthContextConfig">
    <WagmiProvider>
      <HomePage />
    </WagmiProvider>
  </Web3AuthProvider>
</template>
