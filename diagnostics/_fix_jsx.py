from pathlib import Path
p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\client\src\components\LtxDirectorWorkspace.tsx")
text = p.read_text(encoding="utf-8")
old = '''          {referenceTab === "inputs" ? <section className="ltx-reference-group" aria-labelledby="ltx-temporal-heading">'''
new = '''          {referenceTab === "inputs" ? <>\n          <section className="ltx-reference-group" aria-labelledby="ltx-temporal-heading">'''
if old not in text:
    raise SystemExit("open missing")
text = text.replace(old, new, 1)
text = text.replace(
    '''          {referenceTab === "inputs" && queueMode === "segments" ? <section className="ltx-frame-plan" aria-labelledby="ltx-frame-plan-heading">''',
    '''          {queueMode === "segments" ? <section className="ltx-frame-plan" aria-labelledby="ltx-frame-plan-heading">''',
    1
)
old_close = '''          </section> : null}
          : null}
        </aside>'''
new_close = '''          </section> : null}
          </> : null}
        </aside>'''
if old_close not in text:
    raise SystemExit("close missing")
text = text.replace(old_close, new_close, 1)
p.write_text(text, encoding="utf-8")
print("fixed inputs fragment")
