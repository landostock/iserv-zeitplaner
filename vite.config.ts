import { defineConfig } from 'vite';
import {resolve} from 'node:path';
export default defineConfig({ root: 'web', build: { outDir: '../dist', emptyOutDir: true,rollupOptions:{input:{app:resolve('web/index.html'),setup:resolve('web/einrichten.html'),install:resolve('web/installieren.html')}} } });
