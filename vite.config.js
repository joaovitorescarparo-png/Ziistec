import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { metaCspDoAmbiente, politicaCspDoAmbiente } from "./scripts/csp-environment.mjs";
import { htaccessDoAmbiente } from "./scripts/static-hosting.mjs";

/* CSP por ambiente: o cabeçalho do vercel.json é estático e vale para todo
   deploy, então cita os dois projetos Supabase. Esta política injetada no HTML
   cita só o projeto DESTE deploy, e o navegador aplica a interseção das duas.
   Build sem VERCEL_ENV é o site estático de Production (Hostinger): recebe a
   política de Production inteira na <meta> e um .htaccess com o fallback da SPA
   e os cabeçalhos. Só o servidor de desenvolvimento fica sem política. */
const contextoDoAmbiente = (servidorDev) => ({
  vercelEnv: process.env.VERCEL_ENV,
  branch: process.env.VERCEL_GIT_COMMIT_REF,
  servidorDev,
});

const cspDoAmbiente = () => {
  let comando = "serve";
  return {
    name: "zt-csp-ambiente",
    configResolved(config) {
      comando = config.command;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const contexto = contextoDoAmbiente(Boolean(ctx?.server));
        const meta = metaCspDoAmbiente(contexto);
        if (!meta) return html;
        const r = politicaCspDoAmbiente(contexto);
        // eslint-disable-next-line no-console
        console.log(`CSP do ambiente: ${r.ambiente}${r.url ? ` -> ${r.url}` : " -> nenhum projeto Supabase"}`);
        return html.replace("</head>", `  ${meta}\n  </head>`);
      },
    },
    generateBundle() {
      if (comando !== "build") return;
      const htaccess = htaccessDoAmbiente(contextoDoAmbiente(false));
      if (htaccess) this.emitFile({ type: "asset", fileName: ".htaccess", source: htaccess });
    },
  };
};

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
