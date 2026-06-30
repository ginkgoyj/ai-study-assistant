import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiProxyPlugin } from './server/api-proxy.js';

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
});
