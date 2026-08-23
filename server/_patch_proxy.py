from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/index.js')
t = p.read_text(encoding='utf-8')
if 'queueHellFromPremiere' in t:
    print('already patched')
else:
    start = t.find('async function proxyDirectorApi(req, res) {')
    if start < 0: raise SystemExit('proxyDirectorApi not found')
    suf = t.find('const suffix = String(req.params[0]', start)
    if suf < 0: raise SystemExit('suffix line not found')
    nl = t.find('\n', suf)
    inject = '''
    if (req.method === "POST" && (suffix === "queue" || suffix === "push-to-comfyui")) {
      try {
        const { queueHellFromPremiere } = await import("./hell-comfy-push.js");
        const result = await queueHellFromPremiere(req.body || {});
        for (const item of result.accepted || []) {
          if (item?.promptId) integratedDirectorPromptIds.add(String(item.promptId));
        }
        return res.status(202).json({
          ok: true,
          accepted: (result.accepted || []).map((item) => ({
            promptId: item.promptId,
            number: item.number,
            segmentId: item.segmentId || null
          }))
        });
      } catch (error) {
        return res.status(400).json({ error: String(error.message || error) });
      }
    }
'''
    t = t[:nl+1] + inject + t[nl+1:]
    p.write_text(t, encoding='utf-8')
    print('patched proxy')
print('has', 'queueHellFromPremiere' in t)
