import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {hash, PACKAGE_ROOT, readJson, safeFile} from './util.js';
import {EditPlanSchema, QualityReportSchema} from './schema.js';
import {assertCurrentRender} from './render-identity.js';

/** A saved pass only applies to its exact plan, current render inputs and MP4 bytes. */
export async function previewQuality(runDir: string, inputPlan: unknown, render: {file: string; cacheKey?: string}, saved: unknown, packageRoot = PACKAGE_ROOT) {
  try {
    const plan = EditPlanSchema.parse(inputPlan);
    const report = QualityReportSchema.parse(saved);
    if (!report.artifactSha256 || !report.planSha256) throw new Error('The saved report has no artifact and plan binding.');
    if (report.planSha256 !== hash(plan)) throw new Error('The saved report belongs to a different edit plan.');
    const file = await safeFile(runDir, path.relative(runDir, render.file));
    if (report.artifactSha256 !== hash(await readFile(file))) throw new Error('The saved report belongs to a different MP4.');
    await assertCurrentRender(runDir, plan, render, packageRoot);
    return {current: true, report};
  } catch (error) {
    return {current: false, report: QualityReportSchema.parse({
      schemaVersion: 1, runId: path.basename(runDir), status: 'not-tested', deliveryStatus: 'review-candidate',
      checks: [{name: 'quality-report-current-artifact', status: 'not-tested', method: 'Saved QA and approval are unavailable or out of date', evidence: error instanceof Error ? error.message : String(error)}],
      limitations: ['Render if inputs changed, then run inspect and review the current export. Previous approval does not apply.'],
    })};
  }
}

export async function previewRun(runDir: string, port = 0, profile?: string) {
  let planFile = path.join(runDir, profile ? `edit-plan-${profile}.json` : 'edit-plan.json');
  let plan = await readJson(planFile);
  try {await readJson(path.join(runDir, `renders/render-${plan.profile.name}.json`));}
  catch {planFile = path.join(runDir, 'edit-plan-web-60.json'); plan = await readJson(planFile);}
  const renderFile = path.join(runDir, `renders/render-${plan.profile.name}.json`);
  const qualityFile = path.join(runDir, `review/quality-report-${plan.profile.name}.json`);
  const render = await readJson(renderFile);
  const story = await readJson(path.join(runDir, 'storyboard.json'));
  const narration = await readJson(path.join(runDir, 'narration/narration-manifest.json'));
  const files = new Map<string, string>([['video', path.relative(runDir, render.file)]]);
  const audioByScene = new Map<string,string>();
  narration.segments.forEach((segment: any, index: number) => {const key='audio'+index;files.set(key,segment.path);audioByScene.set(segment.sceneId,key);});
  if(narration.fullTrack)files.set('full-audio',narration.fullTrack.path);
  const esc = (value: any) => String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
  // Refresh binding on each request: a preview may remain open while another export replaces the MP4.
  const currentQuality = async () => {
    const currentPlan = await readJson(planFile);
    let saved: unknown;
    try {saved = await readJson(qualityFile);}
    catch (error: any) {if (error.code !== 'ENOENT') throw error;}
    const currentRender = await readJson(renderFile);
    // The media route must serve the artifact being validated, even if the checkpoint path changed.
    files.set('video', path.relative(runDir, currentRender.file));
    return previewQuality(runDir, currentPlan, currentRender, saved);
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/' || url.pathname === '/media/report' || url.pathname === '/media/contact') {
        const quality = await currentQuality();
        if (url.pathname === '/media/report') {
          res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
          res.end(JSON.stringify(quality.report, null, 2)); return;
        }
        if (url.pathname === '/media/contact') {
          if (!quality.current) {res.writeHead(404); res.end(); return;}
          files.set('contact', `review/contact-sheet-${plan.profile.name}.png`);
        } else {
          const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Product Demo Review</title><style>body{max-width:1100px;margin:44px auto;background:#111827;color:#f3f4f6;font:18px Arial}video,img{width:100%;border-radius:16px}article{padding:20px;background:#1f2937;border-radius:16px;margin:18px 0}small{color:#aab6c9}</style><h1>${esc(story.title)}</h1><p>Приёмка: ${esc(quality.report.deliveryStatus ?? 'review-candidate')} · Техника: ${esc(quality.report.status)} · ${plan.profile.width}×${plan.profile.height} · render ${plan.profile.fps} fps · hybrid</p><video controls preload="metadata" src="/media/video"></video><p><small>${esc(narration.disclosure ?? 'Происхождение озвучки указано в отчёте.')} Native capture 144 fps не подтверждён. Исходники и результат: ${esc(runDir)}</small></p>${story.scenes.map((scene: any, index: number) => `<article><h2>${esc(scene.displayText)}</h2><p>${esc(scene.spokenText)}</p>${audioByScene.has(scene.sceneId) ? `<audio controls src="/media/${audioByScene.get(scene.sceneId)}"></audio>` : ""}</article>`).join('')}<h2>Проверка качества</h2>${quality.report.checks.map(check => `<p>${esc(check.status)} — ${esc(check.name)}</p>`).join('')}${quality.current ? '<img src="/media/contact">' : ''}<p><a href="/media/report">Quality report JSON</a></p>`;
          res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'"});
          res.end(html); return;
        }
      }
      const key = url.pathname.slice('/media/'.length);
      if (!url.pathname.startsWith('/media/') || !files.has(key)) {res.writeHead(404); res.end(); return;}
      const file = await safeFile(runDir, files.get(key)!);
      const {size} = await stat(file), ext = path.extname(file);
      const mime = ext === '.mp4' ? 'video/mp4' : ext === '.wav' ? 'audio/wav' : ext === '.mp3' ? 'audio/mpeg' : ext === '.png' ? 'image/png' : 'application/json';
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]), end = Math.min(size - 1, range[2] ? Number(range[2]) : size - 1);
        if (start > end || start >= size) {res.writeHead(416); res.end(); return;}
        res.writeHead(206, {'Content-Type': mime, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes'});
        createReadStream(file, {start, end}).pipe(res);
      } else {
        res.writeHead(200, {'Content-Type': mime, 'Content-Length': size, 'Accept-Ranges': 'bytes'});
        createReadStream(file).pipe(res);
      }
    } catch {res.writeHead(404); res.end();}
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  return {url: `http://127.0.0.1:${address.port}`, server};
}
