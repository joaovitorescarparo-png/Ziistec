import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { metaCspDoAmbiente, politicaCspDoAmbiente } from "./scripts/csp-environment.mjs";

/* CSP por ambiente: o cabeçalho do vercel.json é estático e vale para todo
   deploy, então cita os três projetos Supabase. Esta política injetada no HTML
   cita só o projeto DESTE deploy, e o navegador aplica a interseção das duas. */
const cspDoAmbiente = () => ({
  name: "zt-csp-ambiente",
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      const contexto = {
        vercelEnv: process.env.VERCEL_ENV,
        branch: process.env.VERCEL_GIT_COMMIT_REF,
      };
      const meta = metaCspDoAmbiente(contexto);
      if (!meta) return html;
      const r = politicaCspDoAmbiente(contexto);
      // eslint-disable-next-line no-console
      console.log(`CSP do ambiente: ${r.ambiente}${r.url ? ` -> ${r.url}` : " -> nenhum projeto Supabase"}`);
      return html.replace("</head>", `  ${meta}\n  </head>`);
    },
  },
});

export default defineConfig({
  plugins: [react(), cspDoAmbiente()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          if (id.includes("@supabase") || id.includes("ws")) return "vendor-supabase";
          return "vendor";
        },
      },
    },
  },
});
