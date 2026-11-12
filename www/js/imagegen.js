// generate_image: makes a picture with the user's own image-model key and saves it in the project folder.
// Works with any OpenAI-compatible images endpoint (OpenAI gpt-image-1 / dall-e-3, Gemini Imagen through its OpenAI mode, and others).
import { httpRaw, secure, fs } from './native.js';
import { cleanRel } from './util.js';
import { isSecretPath, protectionOn } from './secrets.js';
import { isGitInternal } from './tools.js';
import { prepareImage } from './image.js';

export const IMAGE_TOOL = {
  name: 'generate_image',
  description: 'Create a new picture from a text description and save it in the project folder (for example a thumbnail, banner, background or illustration). The user is asked before each one because it uses their image-model credits. Write a detailed prompt in English: subject, style, colours, mood, composition. Tell the model to leave empty space when text will be added later; AI pictures spell words badly, so add real text afterwards with HTML/CSS, Pillow or ImageMagick instead of asking the model to draw it. Not for editing an existing picture.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed description of the picture, in English' },
      path: { type: 'string', description: 'Where to save it, for example images/thumbnail.png. Default images/generated-<time>.png' },
      shape: { type: 'string', enum: ['square', 'landscape', 'portrait'], description: 'landscape is 16:9-like (YouTube thumbnail), portrait is for stories. Default square.' },
    },
    required: ['prompt'],
  },
};

const trimBase = (u) => String(u || '').replace(/\/+$/, '');

export async function imageSetup(settings, providers) {
  const p = providers.find((x) => x.id === settings.imageProvider);
  const model = String(settings.imageModel || '').trim();
  if (!p || !model) throw new Error('Image generation is not set up. Tell the user to open Settings > Images, pick the provider that has an image model (OpenAI, or Gemini for Imagen) and type the image model name, for example gpt-image-1.');
  if (p.type === 'anthropic') throw new Error('The chosen provider (Anthropic) cannot make pictures. Choose an OpenAI-compatible provider in Settings > Images.');
  const key = await secure.get('apikey:' + p.id);
  if (!key) throw new Error('No API key is saved for ' + p.name + '. Add it in Settings.');
  return { provider: p, model, key };
}

function sizeFor(model, shape) {
  const dalle3 = /dall-e-3/i.test(model); const dalle2 = /dall-e-2/i.test(model);
  if (/imagen|gemini/i.test(model)) return null;
  if (dalle2) return '1024x1024';
  if (shape === 'landscape') return dalle3 ? '1792x1024' : '1536x1024';
  if (shape === 'portrait') return dalle3 ? '1024x1792' : '1024x1536';
  return '1024x1024';
}

function sniff(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  return null;
}
const b64ToBytes = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
async function readAll(r, cap) {
  const parts = []; let size = 0;
  for await (const c of r.chunks) { parts.push(c); size += c.length; if (size > cap) throw new Error('The picture is larger than ' + Math.round(cap / 1048576) + ' MB.'); }
  const buf = new Uint8Array(size); let o = 0; for (const c of parts) { buf.set(c, o); o += c.length; } return buf;
}

/** Calls the images endpoint and returns { bytes, ext }. Nothing is written yet. */
export async function requestImage(args, setup, signal) {
  const prompt = String(args.prompt || '').trim();
  if (!prompt) throw new Error('"prompt" is empty.');
  if (prompt.length > 4000) throw new Error('The prompt is longer than 4000 characters. Shorten it.');
  const body = { model: setup.model, prompt, n: 1 };
  const size = sizeFor(setup.model, args.shape); if (size) body.size = size;
  if (/dall-e/i.test(setup.model)) body.response_format = 'b64_json';
  const r = await httpRaw({ url: trimBase(setup.provider.baseUrl) + '/images/generations', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + setup.key }, body: JSON.stringify(body), signal });
  const raw = new TextDecoder('utf-8').decode(await readAll(r, 40 * 1048576));
  if (r.status >= 400) {
    let msg = ''; try { const j = JSON.parse(raw); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (e) { /* not JSON */ }
    msg = String(msg).slice(0, 300);
    if (r.status === 401 || r.status === 403) throw new Error('The image provider rejected the key (' + r.status + ')' + (msg ? ': ' + msg : '') + '. Check the key and that it may use image models.');
    if (r.status === 404) throw new Error('The image endpoint or model was not found (404). Check the image model name in Settings > Images.' + (msg ? ' Provider said: ' + msg : ''));
    if (r.status === 429) throw new Error('The image provider says too many requests or no credit left (429)' + (msg ? ': ' + msg : '') + '.');
    throw new Error('The image provider returned error ' + r.status + (msg ? ': ' + msg : '') + '.');
  }
  let j; try { j = JSON.parse(raw); } catch (e) { throw new Error('The image provider sent an unreadable answer.'); }
  const d = j.data && j.data[0];
  if (!d) throw new Error('The provider returned no picture.');
  let bytes;
  if (d.b64_json) bytes = b64ToBytes(d.b64_json);
  else if (d.url) {
    const u = new URL(d.url); if (u.protocol !== 'https:') throw new Error('The provider returned a link that is not https.');
    const r2 = await httpRaw({ url: u.href, method: 'GET', headers: {}, noRedirect: false, signal });
    if (r2.status >= 400) throw new Error('The picture could not be downloaded (' + r2.status + ').');
    bytes = await readAll(r2, 25 * 1048576);
  } else throw new Error('The provider returned no picture data.');
  const ext = sniff(bytes);
  if (!ext) throw new Error('The provider returned something that is not a picture.');
  return { bytes, ext };
}

/** Picks the final path inside the folder: safe, with the true extension, never overwriting an existing file. */
export async function targetPath(args, folder, ext) {
  let rel = cleanRel(args.path || '');
  if (!rel) rel = 'images/generated-' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.' + ext;
  if (isGitInternal(rel)) throw new Error('The .git folder cannot be used.');
  if (isSecretPath(rel) && await protectionOn()) throw new Error('That is a protected secret file name.');
  rel = rel.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.' + ext;
  let out = rel; let n = 2;
  for (;;) {
    const st = await fs.stat(folder.uri, out);
    if (!st || !st.exists) break;
    out = rel.replace(/\.[A-Za-z0-9]+$/, '') + '-' + n + '.' + ext; n++;
    if (n > 50) throw new Error('Too many files with that name.');
  }
  return out;
}

export async function previewOf(bytes, ext) {
  try {
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    return await prepareImage(new File([bytes], 'preview.' + ext, { type: mime }));
  } catch (e) { return null; }
}
