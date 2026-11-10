import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  // Hover/focus prefetch is explicitly opt-in on safe public-document links.
  // Keep native browser navigation for authentication, account and checkout.
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
