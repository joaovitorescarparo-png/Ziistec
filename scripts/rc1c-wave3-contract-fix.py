from pathlib import Path

path = Path('scripts/verify-round38.mjs')
src = path.read_text()
old_imports = "const migration=readFileSync('supabase/0072_field_sales_for_technicians.sql','utf8');\n"
new_imports = old_imports + "const workOrderRls=readFileSync('supabase/0028_optimize_rls_auth_initplans.sql','utf8');\nconst agendaMobile=readFileSync('src/lib/agendaMobile.js','utf8');\n"
if src.count(old_imports) != 1:
    raise SystemExit('round38 imports anchor changed')
src = src.replace(old_imports, new_imports, 1)
old_guard = "must(legacy.includes('tecnico: [\"inicio\", \"ordens\", \"registrarMateriais\", \"vendaCampo\"]'),'technician must not have Agenda permission');\n"
new_guard = "must(legacy.includes('tecnico: [\"inicio\", \"agenda\", \"ordens\", \"registrarMateriais\", \"vendaCampo\"]'),'technician Meu dia Agenda permission missing');\nmust(legacy.includes('const ordensEmp = doTenant(ordens).filter((o) => permitido(\"todasOS\") || o.responsavelId === usuarioAtual?.id);'),'technician Agenda/OS projection must remain assigned-only');\nmust(agendaMobile.includes('order?.responsavelId === userId'),'technician Agenda client defense must remain assigned-only');\nmust(workOrderRls.includes('assigned_to=(select auth.uid())'),'work_orders RLS must remain assigned-to authority');\n"
if src.count(old_guard) != 1:
    raise SystemExit('round38 old Agenda guard anchor changed')
src = src.replace(old_guard, new_guard, 1)
path.write_text(src)
print('RC1C_WAVE3_CONTRACT=PASS')
