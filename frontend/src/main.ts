import { Buffer } from 'buffer'
import process from 'process'
import { createApp } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import './style.css'

window.Buffer = Buffer
window.process = process

const queryClient = new QueryClient()

createApp(App).use(VueQueryPlugin, { queryClient }).mount('#app')
