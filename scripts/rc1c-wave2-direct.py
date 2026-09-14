from pathlib import Path

ROOT = Path('.')
legacy_path = ROOT / 'src/legacy/ZiisTecApp.jsx'
legacy = legacy_path.read_text()

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    return text.replace(old, new, 1)

legacy = replace_once(
    legacy,
    'import useSpeechInput from "../hooks/useSpeechInput";\n',
    'import useSpeechInput from "../hooks/useSpeechInput";\nimport { beginEdgeSwipe, classifyHorizontalSwipe, isKeyboardViewportOpen } from "../lib/mobileNavigation";\n',
    'mobile navigation import',
)
legacy = replace_once(
    legacy,
    '  const [drawer, setDrawer] = useState(false);\n  const [menuExpandido, setMenuExpandido] = useState(false);\n  const menuTouchX = useRef(null);\n  const [busca, setBusca] = useState(false);\n',
    '  const [drawer, setDrawer] = useState(false);\n  const [menuExpandido, setMenuExpandido] = useState(false);\n  const menuTouchX = useRef(null);\n  const mobileEdgeSwipe = useRef(null);\n  const drawerSwipe = useRef(null);\n  const [keyboardOpen, setKeyboardOpen] = useState(false);\n  const [busca, setBusca] = useState(false);\n',
    'mobile navigation state',
)
legacy = replace_once(
    legacy,
    '  const permitido = (chave) => pode(papel, chave);\n\n',
    '''  const permitido = (chave) => pode(papel, chave);\n\n  useEffect(() => {\n    if (!drawer) return undefined;\n    const fecharComEsc = (event) => { if (event.key === "Escape") setDrawer(false); };\n    window.addEventListener("keydown", fecharComEsc);\n    return () => window.removeEventListener("keydown", fecharComEsc);\n  }, [drawer]);\n\n  useEffect(() => {\n    const viewport = window.visualViewport;\n    if (!viewport) { setKeyboardOpen(false); return undefined; }\n    const atualizarTeclado = () => setKeyboardOpen(isKeyboardViewportOpen({ layoutHeight: window.innerHeight, visualHeight: viewport.height }));\n    atualizarTeclado();\n    viewport.addEventListener("resize", atualizarTeclado);\n    viewport.addEventListener("scroll", atualizarTeclado);\n    window.addEventListener("orientationchange", atualizarTeclado);\n    return () => {\n      viewport.removeEventListener("resize", atualizarTeclado);\n      viewport.removeEventListener("scroll", atualizarTeclado);\n      window.removeEventListener("orientationchange", atualizarTeclado);\n    };\n  }, []);\n\n  const alvoBloqueiaSwipe = (target) => Boolean(target?.closest?.("input, textarea, select, button, a, [role='slider'], [data-no-edge-swipe]"));\n  const iniciarEdgeSwipe = (event) => {\n    if (window.innerWidth >= 768 || drawer || alvoBloqueiaSwipe(event.target)) return;\n    const touch = event.touches?.[0];\n    mobileEdgeSwipe.current = touch ? beginEdgeSwipe({ x: touch.clientX, y: touch.clientY, viewportWidth: window.innerWidth }) : null;\n  };\n  const finalizarEdgeSwipe = (event) => {\n    const start = mobileEdgeSwipe.current;\n    mobileEdgeSwipe.current = null;\n    if (!start || window.innerWidth >= 768) return;\n    const touch = event.changedTouches?.[0];\n    if (touch && classifyHorizontalSwipe(start, { x: touch.clientX, y: touch.clientY }, "open") === "open") setDrawer(true);\n  };\n  const iniciarDrawerSwipe = (event) => {\n    if (window.innerWidth >= 768 || alvoBloqueiaSwipe(event.target)) return;\n    const touch = event.touches?.[0];\n    drawerSwipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null;\n  };\n  const finalizarDrawerSwipe = (event) => {\n    const start = drawerSwipe.current;\n    drawerSwipe.current = null;\n    if (!start || window.innerWidth >= 768) return;\n    const touch = event.changedTouches?.[0];\n    if (touch && classifyHorizontalSwipe(start, { x: touch.clientX, y: touch.clientY }, "close") === "close") setDrawer(false);\n  };\n\n''',
    'mobile navigation effects and handlers',
)
legacy = replace_once(
    legacy,
    '  const NAV_MOBILE = ["inicio", "agenda", "orcamentos", "ordens", "vendaCampo"];',
    '  const NAV_MOBILE = ["inicio", "agenda", "orcamentos", "ordens"];',
    'mobile bottom destinations',
)
legacy = replace_once(
    legacy,
    '  return (\n    <div className="min-h-[100dvh] overflow-x-hidden bg-slate-50 text-slate-800 font-sans antialiased">\n',
    '  return (\n    <div className="min-h-[100dvh] overflow-x-hidden bg-slate-50 text-slate-800 font-sans antialiased" onTouchStart={iniciarEdgeSwipe} onTouchEnd={finalizarEdgeSwipe}>\n',
    'mobile edge gesture surface',
)
legacy = replace_once(
    legacy,
    '      <header className="zt-nao-imprime md:hidden sticky top-0 z-30 bg-slate-900 flex items-center justify-between px-4 h-14">\n',
    '      <header className="zt-nao-imprime md:hidden sticky top-0 z-30 bg-slate-900 flex items-center justify-between px-4 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]">\n',
    'mobile safe area header',
)
legacy = replace_once(
    legacy,
    '          <div className="absolute inset-y-0 left-0 w-72 bg-slate-900 flex flex-col">\n',
    '          <div className="absolute inset-y-0 left-0 w-[min(18rem,calc(100vw-3rem))] bg-slate-900 flex flex-col pt-[env(safe-area-inset-top)]" onTouchStart={iniciarDrawerSwipe} onTouchEnd={finalizarDrawerSwipe} style={{ touchAction: "pan-y" }}>\n',
    'mobile drawer gesture surface',
)
legacy = replace_once(
    legacy,
    '        <div className="max-w-[1180px] mx-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-7 pb-28 md:pb-16">\n',
    '        <div className={cx("max-w-[1180px] mx-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-7 md:pb-16", keyboardOpen ? "pb-8" : "pb-28")}>\n',
    'keyboard-safe main padding',
)
legacy = replace_once(
    legacy,
    '      <nav className="zt-nao-imprime md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex pb-[env(safe-area-inset-bottom)]" aria-label="Navegação rápida">\n',
    '      <nav className={cx("zt-nao-imprime md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]", keyboardOpen ? "hidden" : "flex")} aria-label="Navegação rápida">\n',
    'keyboard-safe bottom navigation',
)
legacy_path.write_text(legacy)

mobile_lib = '''export const MOBILE_EDGE_SWIPE_PX = 28;\nexport const MOBILE_SWIPE_DISTANCE_PX = 52;\nexport const MOBILE_SWIPE_AXIS_RATIO = 1.25;\nexport const MOBILE_KEYBOARD_MIN_DELTA_PX = 140;\n\nexport function beginEdgeSwipe({ x, y, viewportWidth, edgePx = MOBILE_EDGE_SWIPE_PX }) {\n  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(viewportWidth)) return null;\n  if (viewportWidth <= 0 || x < 0 || x > Math.min(edgePx, viewportWidth * 0.12)) return null;\n  return { x, y };\n}\n\nexport function classifyHorizontalSwipe(start, end, direction, {\n  distancePx = MOBILE_SWIPE_DISTANCE_PX,\n  axisRatio = MOBILE_SWIPE_AXIS_RATIO,\n} = {}) {\n  if (!start || !end) return null;\n  const dx = Number(end.x) - Number(start.x);\n  const dy = Number(end.y) - Number(start.y);\n  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;\n  const horizontal = Math.abs(dx) >= distancePx && Math.abs(dx) >= Math.abs(dy) * axisRatio;\n  if (!horizontal) return null;\n  if (direction === "open" && dx > 0) return "open";\n  if (direction === "close" && dx < 0) return "close";\n  return null;\n}\n\nexport function isKeyboardViewportOpen({ layoutHeight, visualHeight, minDeltaPx = MOBILE_KEYBOARD_MIN_DELTA_PX }) {\n  const layout = Number(layoutHeight);\n  const visual = Number(visualHeight);\n  if (!Number.isFinite(layout) || !Number.isFinite(visual) || layout <= 0 || visual <= 0) return false;\n  const delta = layout - visual;\n  return delta >= minDeltaPx && visual / layout <= 0.82;\n}\n'''
(ROOT / 'src/lib/mobileNavigation.js').write_text(mobile_lib)

navigation_test = '''import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport { beginEdgeSwipe, classifyHorizontalSwipe, isKeyboardViewportOpen } from '../../src/lib/mobileNavigation.js';\n\nconst legacy = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');\n\ntest('mobile edge swipe starts only near the left edge', () => {\n  assert.deepEqual(beginEdgeSwipe({ x: 8, y: 120, viewportWidth: 390 }), { x: 8, y: 120 });\n  assert.equal(beginEdgeSwipe({ x: 80, y: 120, viewportWidth: 390 }), null);\n});\n\ntest('predominantly vertical movement never opens the drawer', () => {\n  const start = { x: 8, y: 100 };\n  assert.equal(classifyHorizontalSwipe(start, { x: 70, y: 190 }, 'open'), null);\n  assert.equal(classifyHorizontalSwipe(start, { x: 24, y: 220 }, 'open'), null);\n});\n\ntest('horizontal swipes open and close in the intended direction only', () => {\n  assert.equal(classifyHorizontalSwipe({ x: 8, y: 100 }, { x: 88, y: 110 }, 'open'), 'open');\n  assert.equal(classifyHorizontalSwipe({ x: 220, y: 100 }, { x: 130, y: 105 }, 'close'), 'close');\n  assert.equal(classifyHorizontalSwipe({ x: 220, y: 100 }, { x: 310, y: 105 }, 'close'), null);\n});\n\ntest('visualViewport keyboard detection ignores browser chrome changes', () => {\n  assert.equal(isKeyboardViewportOpen({ layoutHeight: 844, visualHeight: 520 }), true);\n  assert.equal(isKeyboardViewportOpen({ layoutHeight: 844, visualHeight: 770 }), false);\n  assert.equal(isKeyboardViewportOpen({ layoutHeight: 844, visualHeight: 844 }), false);\n});\n\ntest('legacy shell mounts mobile gesture on a real mobile container and keeps explicit close paths', () => {\n  assert.match(legacy, /onTouchStart=\\{iniciarEdgeSwipe\\} onTouchEnd=\\{finalizarEdgeSwipe\\}/);\n  assert.match(legacy, /onClick=\\{\\(\\) => setDrawer\\(true\\)\\} aria-label="Abrir menu"/);\n  assert.match(legacy, /absolute inset-0 bg-slate-900\\/50" onClick=\\{\\(\\) => setDrawer\\(false\\)\\}/);\n  assert.match(legacy, /event\\.key === "Escape"/);\n  assert.match(legacy, /onTouchStart=\\{iniciarDrawerSwipe\\} onTouchEnd=\\{finalizarDrawerSwipe\\}/);\n});\n\ntest('bottom navigation uses the requested four primary destinations plus Mais and hides for the keyboard', () => {\n  assert.match(legacy, /const NAV_MOBILE = \\["inicio", "agenda", "orcamentos", "ordens"\\]/);\n  assert.match(legacy, /<span className="text-\\[10px\\] font-medium">Mais<\\/span>/);\n  assert.match(legacy, /keyboardOpen \\? "hidden" : "flex"/);\n  assert.match(legacy, /pb-\\[env\\(safe-area-inset-bottom\\)\\]/);\n});\n'''
(ROOT / 'tests/blockers/rc1c_mobile_navigation.test.mjs').write_text(navigation_test)

package_path = ROOT / 'package.json'
package = package_path.read_text()
needle = 'tests/blockers/rc1b_upload_security_contract.test.mjs tests/blockers/rc1c_voice_state_machine.test.mjs'
replacement = needle + ' tests/blockers/rc1c_mobile_navigation.test.mjs'
package = replace_once(package, needle, replacement, 'verify:v2 navigation test registration')
package_path.write_text(package)

checks = {
    'mobile navigation import': 'beginEdgeSwipe, classifyHorizontalSwipe, isKeyboardViewportOpen',
    'edge surface': 'onTouchStart={iniciarEdgeSwipe} onTouchEnd={finalizarEdgeSwipe}',
    'drawer close swipe': 'onTouchStart={iniciarDrawerSwipe} onTouchEnd={finalizarDrawerSwipe}',
    'keyboard nav hide': 'keyboardOpen ? "hidden" : "flex"',
}
final = legacy_path.read_text()
for label, marker in checks.items():
    if marker not in final:
        raise SystemExit(f'postcondition failed: {label}')
print('RC1C_WAVE2_DIRECT=PASS')
