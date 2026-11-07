/** Client build; shared rules are bundled with the browser app. Server serves the resulting files. */
import { defineConfig } from 'vite';
export default defineConfig({ root:'client',base:'./',build:{ outDir:'../dist/client',emptyOutDir:true },server:{ fs:{ allow:['.'] } } });
