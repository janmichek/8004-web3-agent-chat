import { createApp } from 'vue'
import { WagmiPlugin } from '@wagmi/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { config } from './wagmi'
import App from './App.vue'
import './style.css'

const queryClient = new QueryClient()

createApp(App)
  .use(WagmiPlugin, { config })
  .use(VueQueryPlugin, { queryClient })
  .mount('#app')
