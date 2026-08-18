import { readFileSync, writeFileSync } from "node:fs";
const file = "src/legacy/ZiisTecApp.jsx";
const ops = JSON.parse(readFileSync("scripts/phase4-patch.json", "utf8"));
const lines = readFileSync(file, "utf8").split("\n");
for (const op of [...ops].sort((a,b)=>b.start-a.start)) {
  const actual = lines.slice(op.start, op.start + op.delete);
  if (JSON.stringify(actual) !== JSON.stringify(op.expect)) throw new Error(`Phase 4 patch mismatch at line ${op.start + 1}`);
  lines.splice(op.start, op.delete, ...op.insert);
}
writeFileSync(file, lines.join("\n"), "utf8");
console.log(`Applied ZiisTec phase 4 subscription patch (${ops.length} changes)`);
