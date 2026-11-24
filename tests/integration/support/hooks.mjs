// Redireciona o import de src/lib/supabase.js para o stub de integração.
import { registerHooks } from 'node:module';

const stub = new URL('./supabase-stub.mjs', import.meta.url).href;
const lib = new URL('../../../src/lib/', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    if (parent.startsWith(lib) && (specifier === './supabase' || specifier === './supabase.js')) {
      return { url: stub, shortCircuit: true };
    }
    if (/\/src\/(screens|components|legacy)\//.test(parent) && /\/lib\/supabase(\.js)?$/.test(specifier)) {
      return { url: stub, shortCircuit: true };
    }
    // Imports sem extensão do código do app (o Vite resolve, o Node não).
    if (parent.startsWith(lib) && specifier.startsWith('./') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    return nextResolve(specifier, context);
  },
});
