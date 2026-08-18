import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const raiz = resolve(new URL("..", import.meta.url).pathname);

async function restaurar(dirPartes, prefixo, destino, hashEsperado) {
  const pasta = resolve(raiz, dirPartes);
  const nomes = (await readdir(pasta)).filter((n) => n.startsWith(prefixo) && n.endsWith(".txt")).sort();
  if (!nomes.length) throw new Error(`Partes ausentes para ${destino}`);
  const partes = await Promise.all(nomes.map((n) => readFile(resolve(pasta, n), "utf8")));
  const conteudo = partes.join("");
  const hash = createHash("sha256").update(conteudo).digest("hex");
  if (hash !== hashEsperado) throw new Error(`Falha de integridade em ${destino}: ${hash}`);
  const saida = resolve(raiz, destino);
  await mkdir(dirname(saida), { recursive: true });
  await writeFile(saida, conteudo, "utf8");
  console.log(`restaurado: ${destino}`);
}

await restaurar("src/legacy/.parts", "ZiisTecApp.", "src/legacy/ZiisTecApp.jsx", "6810efaac27ec494ca8436ade6d10a5f37e9a21ede25162b581c48f9d06faf31");
await restaurar("supabase/.parts", "0001.", "supabase/0001_ziistec_fundacao_FINAL.sql", "80b322ffc38a2d2d444ab418acce353d88f5ff921428b8ac3bf50c9989e1bacd");
