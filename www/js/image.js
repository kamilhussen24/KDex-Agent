// Picture preparation shared by the attach button and the agent's view_image tool.
import * as D from './diag.js';
import { fs } from './native.js';

// Read a File as base64 (no canvas involved).
function fileB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(new Error('Could not read ' + file.name));
    r.readAsDataURL(file);
  });
}
export const SEND_AS_IS = /^image\/(png|jpe?g|webp|gif)$/;
// Small images are sent exactly as they are. Large ones are scaled down on a white canvas; if the result
// looks blank (some phone WebViews return a black canvas), the original goes instead of a black picture.
export async function prepareImage(file) {
  const mime = SEND_AS_IS.test(file.type) ? file.type.replace('image/jpg', 'image/jpeg') : 'image/jpeg';
  if (SEND_AS_IS.test(file.type) && file.size <= 1.5 * 1048576) return { mime, data: await fileB64(file) };
  let out = null;
  try {
    const bmp = window.createImageBitmap ? await createImageBitmap(file) : await new Promise((res, rej) => {
      const url = URL.createObjectURL(file); const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
      im.src = url;
    });
    const w = bmp.width || bmp.naturalWidth; const h = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, 1568 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    // blank check on a 24x24 sample
    const t = document.createElement('canvas'); t.width = 24; t.height = 24; const tg = t.getContext('2d'); tg.drawImage(c, 0, 0, 24, 24);
    const px = tg.getImageData(0, 0, 24, 24).data; let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 12 || px[i + 1] > 12 || px[i + 2] > 12) lit++;
    const url = c.toDataURL('image/jpeg', 0.85);
    if (lit > 6 && url.length > 2000) out = { mime: 'image/jpeg', data: url.split(',')[1] };
    else D.log('image', 'Resized picture looked blank (' + file.type + ', ' + file.size + ' bytes); using the original file.');
  } catch (e) { D.log('image', 'Could not resize picture: ' + e.message); }
  if (out) return out;
  if (SEND_AS_IS.test(file.type) && file.size <= 5 * 1048576) return { mime, data: await fileB64(file) };
  throw new Error('Could not prepare ' + file.name + '. Try a smaller picture or a screenshot instead.');
}

const EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export const VIEW_TOOL = {
  name: 'view_image',
  description: 'Look at a picture file (png, jpg, webp, gif) inside the project folder. The picture is shown to you in the next message so you can describe it, read text in it or check a design. Only use it when you need to see the picture; it costs tokens. Other binary files (pdf, zip, etc.) cannot be viewed this way.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path of the image file' } }, required: ['path'] },
};

/** Reads an image from the project folder and returns { mime, data, note } ready to attach to a tool result. */
export async function loadFolderImage(folder, path) {
  const rel = String(path || '').replace(/^\/+/, '');
  const ext = (rel.split('.').pop() || '').toLowerCase();
  if (!EXT_MIME[ext]) throw new Error('view_image supports png, jpg, webp and gif files only.');
  const st = await fs.stat(folder.uri, rel);
  if (!st.exists || st.isDir) throw new Error('Not found: ' + rel);
  if (st.size > 12 * 1048576) throw new Error('This picture is larger than 12 MB. Resize it first, for example with a terminal command.');
  const bytes = await fs.readBytes(folder.uri, rel);
  const file = new File([bytes], rel.split('/').pop(), { type: EXT_MIME[ext] });
  const im = await prepareImage(file);
  return { mime: im.mime, data: im.data, note: 'Picture ' + rel + ' (' + Math.round(file.size / 1024) + ' KB) is attached below.' };
}
