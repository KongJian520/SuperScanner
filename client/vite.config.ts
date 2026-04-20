import path from 'path';
import {defineConfig} from 'vite';
import react from "@vitejs/plugin-react";
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => {

  return {
    plugins: [react(),tailwindcss()],
    clearScreen: false,
    define: {

    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
      }
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
          protocol: "ws",
          host,
          port: 1421,
        }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            if (id.includes('react-router') || id.includes('react-dom') || id.includes('react/')) {
              return 'vendor-react';
            }
            if (id.includes('@tanstack/react-query')) {
              return 'vendor-query';
            }
            if (id.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (id.includes('recharts') || id.includes('/d3-')) {
              return 'vendor-charts';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('@radix-ui')) {
              return 'vendor-radix';
            }
            if (id.includes('i18next') || id.includes('react-i18next')) {
              return 'vendor-i18n';
            }
            return undefined;
          },
        },
      },
    },
  };
});
