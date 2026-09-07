import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readdir, copyFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, 'screenshots/wave4-native');
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const report = { ok:false, executablePath:exe, screenshots:[], generated:[], ledger:null, runtimeSnapshots:[], consoleErrors:[], pageErrors:[], network:[], runtimeStdout:'', runtimeStderr:'', assertions:{}, error:null };
function sha(b){ return createHash('sha256').update(b).digest('hex'); }
function powershellJson(script){
  try { const text=execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',timeout:120000,windowsHide:true}).replace(/^\uFEFF/,'').trim(); return text?JSON.parse(text):null; }
  catch(error){ return {error:error instanceof Error?error.message:String(error)}; }
}
function runtimeSnapshot(label,mainPid){
  const processes=powershellJson(`$all=Get-CimInstance Win32_Process; $ids=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$ids.Add(${mainPid}); do{$before=$ids.Count; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}}while($ids.Count -gt $before); $all|Where-Object{$ids.Contains([int]$_.ProcessId)}|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine|ConvertTo-Json -Depth 4`);
  const ids=(Array.isArray(processes)?processes:processes?[processes]:[]).map(item=>Number(item.ProcessId)).filter(Number.isFinite);
  const connections=ids.length?powershellJson(`$ids=@(${ids.join(',')}); Get-NetTCPConnection -ErrorAction SilentlyContinue|Where-Object{$ids -contains [int]$_.OwningProcess}|Select-Object OwningProcess,State,LocalAddress,LocalPort,RemoteAddress,RemotePort|ConvertTo-Json -Depth 3`):[];
  const gpu=execFileSync('nvidia-smi',['--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:30000,windowsHide:true}).trim();
  const snapshot={label,at:new Date().toISOString(),mainPid,processes,connections,gpu}; report.runtimeSnapshots.push(snapshot); return snapshot;
}
function workersIn(snapshot){ return (Array.isArray(snapshot.processes)?snapshot.processes:snapshot.processes?[snapshot.processes]:[]).filter(item=>/python\.exe/i.test(String(item.Name))&&/flux1_jsonl_worker\.py/i.test(String(item.CommandLine))); }
function connectionsIn(snapshot){ return Array.isArray(snapshot.connections)?snapshot.connections:snapshot.connections?[snapshot.connections]:[]; }
function attachRuntime(application){ const process=application.process(); const appendBounded=(key,chunk)=>{report[key]=(report[key]+chunk.toString()).slice(-200000)}; process.stdout?.on('data',chunk=>appendBounded('runtimeStdout',chunk)); process.stderr?.on('data',chunk=>appendBounded('runtimeStderr',chunk)); return process; }
function watchPage(page){ page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text())}); page.on('pageerror',error=>report.pageErrors.push(error.message)); page.on('request',request=>report.network.push({method:request.method(),url:request.url()})); }
async function confirmElectronWindow(app, trigger, buttonName, name, timeout = 120000){
  console.log(`[wave4-uat] waiting for main-owned confirmation: ${buttonName}`);
  const winPromise = app.waitForEvent('window', { timeout });
  // Register a rejection observer immediately so a failed/disabled trigger plus
  // application cleanup cannot turn the pending window wait into an unhandled
  // rejection. The original promise is still awaited on the successful path.
  void winPromise.catch(() => {});
  await trigger();
  const win = await winPromise;
  await win.getByRole('button', { name: buttonName }).waitFor({ timeout });
  const shot = join(artifacts, 'captures', `${name}.png`);
  await win.screenshot({ path: shot, fullPage: true });
  report.screenshots.push(shot);
  const button = win.getByRole('button', { name: buttonName });
  const closed = win.waitForEvent('close', { timeout });
  try {
    await button.click({ timeout });
  } catch (error) {
    // The main process intentionally destroys the one-use modal as soon as its
    // click reaches the nonce-bound IPC handler. Playwright can observe that
    // destruction before its click acknowledgement; only tolerate that exact
    // close race, then require the native window's close event below.
    if (!(error instanceof Error) || !/Target page, context or browser has been closed/i.test(error.message)) throw error;
  }
  await closed;
  console.log(`[wave4-uat] confirmed and closed: ${buttonName}`);
}
async function capture(app, name){
  const b64 = await app.evaluate(async ({BrowserWindow}) => { const win = BrowserWindow.getAllWindows().find(w=>w.isVisible()) ?? BrowserWindow.getAllWindows()[0]; return (await win.webContents.capturePage()).toPNG().toString('base64'); });
  const p = join(artifacts, 'captures', `${name}.png`); await writeFile(p, Buffer.from(b64,'base64')); report.screenshots.push(p); return p;
}
async function inspectNightImages(app, profile){
  const dir=join(profile,'media','stills');
  const paths=(await readdir(dir)).filter(name=>name.endsWith('.png')&&!name.endsWith('.pending.png')&&!name.endsWith('.tmp.png')).sort().map(name=>join(dir,name));
  assert.equal(paths.length,2,'night-image inspection requires exactly two finalized PNGs');
  return app.evaluate(({nativeImage}, inputPaths) => inputPaths.map((path) => {
    const image=nativeImage.createFromPath(path).resize({width:64,height:64,quality:'best'});
    if(image.isEmpty()) return {path,empty:true,meanIntensity:255,darkPixelRatio:0};
    const bitmap=image.toBitmap(); let intensity=0; let dark=0; let pixels=0;
    for(let index=0;index+3<bitmap.length;index+=4){ const mean=(bitmap[index]+bitmap[index+1]+bitmap[index+2])/3; intensity+=mean; if(mean<90)dark+=1; pixels+=1; }
    return {path,empty:false,meanIntensity:Number((intensity/pixels).toFixed(2)),darkPixelRatio:Number((dark/pixels).toFixed(4))};
  }), paths);
}
async function selectStage(page, label, id){ const nav=page.getByRole('navigation',{name:'Pipeline'}); const b=nav.getByRole('button',{name:label, exact:true}); if(await b.isVisible().catch(()=>false)) await b.click(); else await nav.getByRole('combobox',{name:'Pipeline stage'}).selectOption(id); await page.waitForFunction(stage=>document.querySelector('[data-studio-shell="true"]')?.getAttribute('data-stage')===stage, id); }
async function openLastReel(page){ const back=page.getByRole('button',{name:'Back to pictures'}); if(await back.isVisible().catch(()=>false)) await back.click(); await page.getByRole('heading',{name:'Pictures'}).waitFor(); await page.getByRole('button',{name:/The Last Reel/}).click(); await page.locator('[data-studio-shell="true"]').waitFor(); }
async function collectGenerated(profile){
  const dir=join(profile,'media','stills'); if(!existsSync(dir)) return [];
  const allPng=(await readdir(dir)).filter(f=>f.endsWith('.png')).sort();
  const pending=allPng.filter(f=>f.endsWith('.pending.png')||f.endsWith('.tmp.png'));
  report.assertions.pendingFiles=pending;
  const files=allPng.filter(f=>!f.endsWith('.pending.png')&&!f.endsWith('.tmp.png'));
  const out=[]; for(const f of files){ const p=join(dir,f); const bytes=await readFile(p); const s=await stat(p); const side=join(dir, f.replace(/\.png$/,'.provenance.json')); const sideBytes=existsSync(side)?await readFile(side):Buffer.alloc(0); const provenance=sideBytes.length?JSON.parse(sideBytes.toString('utf8')):null; out.push({file:p, bytes:s.size, sha256:sha(bytes), sidecar:side, sidecarSha256:sideBytes.length?sha(sideBytes):null, pngHeader:bytes.subarray(0,24).toString('hex'), provenance}); await copyFile(p, join(artifacts,'generated',f)); if(existsSync(side)) await copyFile(side, join(artifacts,'generated',f.replace(/\.png$/,'.provenance.json'))); } return out;
}
async function collectLedger(profile){
  const dir=join(profile,'media','stills'); const ledgerPath=join(dir,'security-ledger.v1.jsonl'); const tailPath=`${ledgerPath}.tail.json`;
  assert.equal(existsSync(ledgerPath),true,'signed security ledger is missing'); assert.equal(existsSync(tailPath),true,'signed ledger tail checkpoint is missing');
  const text=await readFile(ledgerPath,'utf8'); const entries=text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)); const tail=JSON.parse(await readFile(tailPath,'utf8'));
  await copyFile(ledgerPath,join(artifacts,'generated','security-ledger.v1.jsonl')); await copyFile(tailPath,join(artifacts,'generated','security-ledger.v1.jsonl.tail.json'));
  const log=join(profile,'native','flux1-worker.log'); if(existsSync(log)) await copyFile(log,join(artifacts,'generated','flux1-worker.log'));
  const kinds=Object.fromEntries([...new Set(entries.map(entry=>entry.kind))].map(kind=>[kind,entries.filter(entry=>entry.kind===kind).length]));
  return {entryCount:entries.length,kinds,ids:entries.map(entry=>entry.id),sequenceValid:entries.every((entry,index)=>entry.seq===index+1&&(index===0?entry.prevMac===null:entry.prevMac===entries[index-1].mac)),uniqueIds:new Set(entries.map(entry=>entry.id)).size===entries.length,tail,entries};
}
await mkdir(join(artifacts,'captures'),{recursive:true}); await rm(join(artifacts,'generated'),{recursive:true,force:true}); await mkdir(join(artifacts,'generated'),{recursive:true}); await rm(join(artifacts,'reference.png'),{force:true});
const real=(process.env.APPDATA?join(process.env.APPDATA,'Premiere316'):'').toLowerCase(); const userDataDir=await mkdtemp(join(tmpdir(),'premiere316-wave4-native-')); report.userDataDir=userDataDir; assert(!userDataDir.toLowerCase().includes('appdata\\roaming\\premiere316') && userDataDir.toLowerCase()!==real);
let app;
try{
 app=await electron.launch({executablePath:exe,args:[`--user-data-dir=${userDataDir}`],env:{...process.env,ELECTRON_USER_DATA_DIR:userDataDir}}); let appProcess=attachRuntime(app); let page=await app.firstWindow(); watchPage(page); await page.waitForLoadState('domcontentloaded'); await page.waitForFunction(()=>document.body.innerText.length>40); report.launchedUserData=await app.evaluate(async ({app})=>app.getPath('userData')); assert.notEqual(report.launchedUserData.toLowerCase(), real);
 await openLastReel(page); await capture(app,'01-open-last-reel');
 await selectStage(page,'02 Research','research'); const approveResearch=page.getByRole('button',{name:'Approve research'}); if(await approveResearch.isVisible().catch(()=>false)) await approveResearch.click(); await page.getByText('Research approved',{exact:true}).first().waitFor();
 await selectStage(page,'04 Inventory','inventory'); const runBreakdown=page.getByRole('button',{name:'Run production breakdown'}); if(await runBreakdown.isVisible().catch(()=>false)) await runBreakdown.click(); await page.getByText('Breakdown preflight',{exact:true}).waitFor(); await capture(app,'02-breakdown');
 const firstAsset=page.getByRole('button',{name:/Coastal Archive|Elías Voss|Rain Effect|Boat|reel|archive/i}).first(); await firstAsset.click(); await page.getByRole('dialog').filter({hasText:'Asset inspector'}).waitFor(); const nameBox=page.getByLabel('Asset name'); const oldName=await nameBox.inputValue(); await nameBox.fill(`${oldName} Wave4`); await page.getByLabel('Stable identity').fill('Weathered concrete coastal film archive after midnight'); await page.getByLabel('Visual / production description').fill('Exterior night photograph after midnight: a weathered brutalist concrete film archive beside a black ocean, visible dark night sky, rain-wet pier, deep shadows, dim amber entrance lamps, and a clearly marked 35mm film-canister return hatch. Cinematic low-key exposure.'); await page.getByLabel('Continuity locks · comma separated').fill('visible exterior night sky'); await page.getByLabel('Negative requirements · comma separated').fill('daylight, sunrise, sunset, bright blue sky'); await page.getByRole('button',{name:'Save changes'}).click(); await page.getByRole('button',{name:/Approve specification/}).click(); const close=page.getByRole('button',{name:'Close inspector'}); if(await close.isVisible().catch(()=>false)) await close.click();
 await selectStage(page,'05 Visual Dev','visual-development'); for (const b of (await page.getByRole('button',{name:'Approve board'}).all()).slice(0,3)) await b.click(); for (const b of (await page.getByRole('button',{name:'Approve identity bible'}).all()).slice(0,3)) await b.click(); await capture(app,'03-visual-approved');
 await selectStage(page,'06 Cinematography','cinematography'); const qa=page.getByRole('button',{name:'Run deterministic QA'}); if(await qa.isVisible().catch(()=>false)) await qa.click(); let n=0; for (const b of await page.getByRole('button',{name:'Approve shot plan'}).all()) { if(n>=3) break; if(await b.isEnabled().catch(()=>false)){ await b.click(); n++; } } await capture(app,'04-cine-approved');
 await selectStage(page,'04 Inventory','inventory'); const prepareQueue=page.getByRole('button',{name:/Prepare queue|Refresh preparation/}); if(await prepareQueue.isVisible().catch(()=>false)) await prepareQueue.click(); await page.getByRole('button',{name:'Evaluate prepared assets'}).click(); await page.getByText('Prepared assets gate',{exact:true}).waitFor(); await capture(app,'05-evaluated');
 const sealWinPromise=app.waitForEvent('window'); await page.getByRole('button',{name:'Seal production authority'}).click(); const modal=await sealWinPromise; await modal.getByText(/canonicalProjection|sealedFields|productionAuthority/i).first().waitFor({timeout:30000}); const authorityReview=await modal.locator('#review').innerText(); report.assertions.authorityReviewChars=authorityReview.length; report.assertions.authorityHasNoReferenceFixture=!/reference\.png|data:image|base64/i.test(authorityReview); assert.equal(report.assertions.authorityHasNoReferenceFixture,true,'authority review must not contain an imported/generated reference fixture'); assert.match(authorityReview,/visible exterior night sky/i,'authority review must disclose the exact visible continuity lock'); await capture(app,'06-authority-review-main-owned'); await modal.getByRole('button',{name:'Seal exactly reviewed authority'}).click(); await page.getByText(/exact current authority verified/i).waitFor({timeout:30000}); await capture(app,'07-authority-sealed');
 await confirmElectronWindow(app, () => page.getByRole('button',{name:'Approve prepared'}).first().click(), 'Cancel', '08a-prepared-cancel');
 await page.getByText(/canceled|cancelled|Prepared approval was canceled/i).first().waitFor({timeout:60000}).catch(()=>{});
 await confirmElectronWindow(app, () => page.getByRole('button',{name:'Approve prepared'}).first().click(), 'Confirm Prepared Approval', '08b-prepared-confirm');
 await page.getByText(/APPROVED PREPARED|Display-only local root/i).first().waitFor({timeout:60000}); await capture(app,'08-prepared-approved');
 await selectStage(page,'10 Generate','generate'); await page.getByRole('heading',{name:/flux2-dev|flux1-dev/}).waitFor({timeout:60000}); await page.getByRole('button',{name:'Authorize + generate'}).first().waitFor({state:'visible',timeout:60000}); assert.equal(await page.getByRole('button',{name:'Authorize + generate'}).first().isEnabled(), true, 'exact FLUX.1 manifest or backend prepared root is not ready'); await capture(app,'09-generate-ready-before');
 for(let i=1;i<=2;i++){
   await page.locator('[data-sonner-toast][data-type="error"]').first().waitFor({state:'hidden',timeout:15000}).catch(()=>{});
   await confirmElectronWindow(app, () => page.getByRole('button',{name:'Authorize + generate'}).first().click(), 'Confirm Generate', `10a-generate-confirm-${i}`);
   const outcomeHandle=await page.waitForFunction(expected=>{
     const visible=(node)=>node instanceof HTMLElement && node.offsetParent!==null;
     const errorToast=[...document.querySelectorAll('[data-sonner-toast][data-type="error"]')].find(visible);
     if(errorToast) return {status:'error',text:(errorToast.textContent||'').trim()};
     const stage=document.querySelector('[data-studio-shell="true"]')?.getAttribute('data-stage');
     const generated=[...document.querySelectorAll('img[alt^="Generated iteration for"]')].filter(visible).length;
     if(stage==='review' && generated>=expected) return {status:'success',generated};
     return null;
   },i,{timeout:31*60_000});
   const outcome=await outcomeHandle.jsonValue();
   if(outcome.status!=='success') throw new Error(`Visible packaged generation ${i} failed: ${outcome.text||'unknown error'}`);
   await capture(app,`10-generated-${i}`);
   const snapshot=runtimeSnapshot(i===1?'after-first-generation-worker-resident':'after-second-generation-same-worker-resident',appProcess.pid); const workers=workersIn(snapshot); assert.equal(workers.length,1,`exactly one app-owned FLUX worker must be resident after generation ${i}`); assert.equal(connectionsIn(snapshot).filter(connection=>Number(connection.OwningProcess)===Number(workers[0].ProcessId)).length,0,'the app-owned FLUX worker must have no network sockets'); report.assertions[`workerPid${i}`]=workers[0].ProcessId; if(i===2) assert.equal(report.assertions.workerPid2,report.assertions.workerPid1,'both generations must use the same resident worker process');
   if(i===1) await selectStage(page,'10 Generate','generate');
 }
 await selectStage(page,'11 Review','review'); await page.getByRole('img',{name:/Generated iteration/}).first().waitFor({timeout:60000}); const reviewCards=page.locator('article').filter({has:page.getByLabel('Reviewer reason')}); assert.equal(await reviewCards.count(),2,'expected two review cards'); const nightMetrics=await inspectNightImages(app,report.launchedUserData); report.assertions.visibleNightMetrics=nightMetrics; for(const metric of nightMetrics){ assert.equal(metric.empty,false,'generated image is empty'); assert.ok(metric.meanIntensity<100&&metric.darkPixelRatio>0.55,`generated image does not pass conservative night-exposure precheck: ${JSON.stringify(metric)}`); } await capture(app,'12-review-two-iterations');
 const reasons=await page.getByLabel('Reviewer reason').all(); assert.equal(reasons.length,2,'expected exactly two generated iterations for review'); await reasons[0].fill('Rejecting first Wave4 candidate: this is a valid distinct local night image, but its visible setting is the comparatively weaker match for the approved exterior coastal archive and exterior-night-sky continuity.'); await reasons[1].fill('Approving second Wave4 candidate: it visibly presents an exterior dark night sky, rain-wet architecture, and practical lighting, making it the more defensible of the two visible interpretations of the required exterior-night continuity.'); const canonicalChecklist=reviewCards.nth(1).locator('fieldset'); assert.match(await canonicalChecklist.innerText(),/visible exterior night sky/i,'canonical checklist must show the exact exterior-night continuity lock'); for(const cb of await canonicalChecklist.locator('input[type="checkbox"]').all()) if(await cb.isVisible().catch(()=>false)) await cb.check();
 await confirmElectronWindow(app, () => reviewCards.nth(0).getByRole('button',{name:'Reject',exact:true}).click(), 'Confirm Canonical Rejection', '13a-rejection-confirm'); await page.getByText('Image iteration rejected.',{exact:true}).waitFor({timeout:60000}); await page.getByText(/scoped decisions 1/i).waitFor({timeout:60000}); await capture(app,'13-rejected-one');
 await confirmElectronWindow(app, () => reviewCards.nth(1).getByRole('button',{name:'Approve canonical',exact:true}).click(), 'Confirm Canonical Approval', '14a-canonical-confirm'); await page.getByText(/scoped decisions 2/i).waitFor({timeout:60000}); await page.getByText('canonical',{exact:true}).waitFor({timeout:60000}); await capture(app,'14-approved-one');
 await selectStage(page,'10 Generate','generate'); await page.getByRole('heading',{name:/flux2-dev|flux1-dev/}).waitFor({timeout:120000}); await page.getByRole('button',{name:'Release local image model'}).click(); await page.getByText('Local image model released.',{exact:true}).waitFor({timeout:30000}); await sleep(2000); await capture(app,'15-released-model');
 const afterRelease=runtimeSnapshot('after-one-visible-final-release',appProcess.pid); assert.equal(workersIn(afterRelease).length,0,'app-owned FLUX worker must exit after visible release');
 report.generated=await collectGenerated(report.launchedUserData); report.assertions.generatedCount=report.generated.length; report.assertions.coldWarmTelemetry=report.generated.map(item=>item.provenance?.telemetry??null);
 const ledger=await collectLedger(report.launchedUserData); const {entries,...ledgerSummary}=ledger; report.ledger=ledgerSummary; assert.equal(ledger.sequenceValid,true,'ledger sequence/previous-MAC chain is invalid'); assert.equal(ledger.uniqueIds,true,'ledger IDs are not duplicate-safe'); assert.deepEqual(ledger.kinds,{productionAuthority:1,preparedApproval:1,preparedSeal:2,generationReceipt:2,rejectionDecision:1,canonicalDecision:1});
 const receipts=entries.filter(entry=>entry.kind==='generationReceipt').map(entry=>entry.payload); assert.equal(new Set(receipts.map(item=>item.workerIdentityDigest)).size,1,'worker identity changed between jobs'); assert.equal(new Set(receipts.map(item=>item.componentDigest)).size,1,'component identity changed between jobs'); assert.equal(new Set(receipts.map(item=>item.sealId)).size,2,'each generation requires a distinct sealed authorization'); assert.equal(new Set(receipts.map(item=>item.tokenDigest)).size,2,'each generation requires a distinct one-use token'); assert.deepEqual(new Set(receipts.map(item=>item.output.mediaSha256)),new Set(report.generated.map(item=>item.sha256)),'ledger receipt hashes must exactly match preserved PNGs');
 const chronological=[...report.generated].sort((a,b)=>String(a.provenance.generatedAt).localeCompare(String(b.provenance.generatedAt))); assert.equal(chronological[0].provenance.telemetry.residentBeforeJob,false,'first job must be cold'); assert.ok(chronological[0].provenance.telemetry.modelLoadMs>0,'first job must include real model load time'); assert.equal(chronological[1].provenance.telemetry.residentBeforeJob,true,'second job must be warm'); assert.equal(chronological[1].provenance.telemetry.modelLoadMs,0,'warm job must not reload model'); assert.notEqual(chronological[0].provenance.seed,chronological[1].provenance.seed,'iterations require distinct seeds'); assert.notEqual(chronological[0].sha256,chronological[1].sha256,'iterations require distinct image bytes'); assert.ok(chronological.every(item=>Array.isArray(item.provenance.references)&&item.provenance.references.length===0),'accepted runtime provenance must contain no imported reference inputs'); assert.ok(chronological.every(item=>/visible exterior night sky/i.test(item.provenance.prompt)),'accepted runtime prompts must retain the exact exterior-night continuity lock');
 await app.close(); app=undefined; await sleep(2000);
 app=await electron.launch({executablePath:exe,args:[`--user-data-dir=${userDataDir}`],env:{...process.env,ELECTRON_USER_DATA_DIR:userDataDir}}); appProcess=attachRuntime(app); page=await app.firstWindow(); watchPage(page); await page.waitForLoadState('domcontentloaded'); await page.waitForFunction(()=>document.body.innerText.length>40); await openLastReel(page); await selectStage(page,'11 Review','review'); await page.getByText(/scoped decisions 2/i).waitFor({timeout:120000}); await page.getByText('canonical',{exact:true}).waitFor({timeout:60000}); await page.getByText('rejected',{exact:true}).waitFor({timeout:60000}); assert.equal(await page.getByRole('img',{name:/Generated iteration/}).count(),2,'restart must recover exactly two iterations'); await capture(app,'16-restart-ledger-verified'); const afterRestart=runtimeSnapshot('after-restart-ledger-verified-no-auto-load',appProcess.pid); assert.equal(workersIn(afterRestart).length,0,'restart must not auto-load the FLUX worker'); report.assertions.restartLedgerVerified=true;
 report.ok=report.generated.length===2 && report.assertions.pendingFiles.length===0 && report.consoleErrors.length===0 && report.pageErrors.length===0;
} catch(e){ report.error=e instanceof Error ? `${e.name}: ${e.message}\n${e.stack??''}` : String(e); }
finally { if(app) await app.close().catch(()=>{}); await writeFile(join(artifacts,'report.json'), JSON.stringify(report,null,2)+'\n'); if(report.ok) await rm(userDataDir,{recursive:true,force:true}).catch(()=>{}); }
console.log(JSON.stringify(report,null,2)); if(!report.ok) process.exitCode=1;
