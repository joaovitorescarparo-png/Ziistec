import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          if (id.includes("@supabase") || id.includes("ws")) return "vendor-supabase";
          if (id.includes("lucide-react")) return "vendor-icons";
          return "vendor";
        },
      },
    },
  },
});
