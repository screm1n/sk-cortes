import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: { outDir: "../../dist", emptyOutDir: true },
  server: {
    port: 5190,
    strictPort: true,
    // Abre no celular pela rede local: da pra baixar o video pronto direto no telefone.
    host: true,
    proxy: { "/api": "http://localhost:5191", "/midia": "http://localhost:5191" },
  },
});
