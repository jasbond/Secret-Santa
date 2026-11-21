// Album souvenir : galerie, carte souvenir téléchargeable (photo + mot), envoi de photo.
import { el, clear, linkify, frTypo, isBrandName, icon } from './common.js';

/** Réduit la photo (1600 px max), la convertit en JPEG et retire ses métadonnées (dont le GPS). */
export async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Choisis une image.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Cette image n'a pas pu être lue."));
      img.src = URL.createObjectURL(file);
    });
  }
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.75, 0.6]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 2.8 * 1024 * 1024) return blob;
  }
  throw new Error('Photo trop lourde, même réduite.');
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    // Seuls les espaces normaux coupent la ligne : l'espace insécable de « … » tient.
    for (let word of paragraph.split(/[ \t]+/)) {
      // Mot (ou adresse) plus large que la carte : coupé caractère par caractère.
      while (ctx.measureText(word).width > maxWidth && [...word].length > 1) {
        if (line) {
          lines.push(line);
          line = '';
        }
        const chars = [...word];
        let n = chars.length - 1;
        while (n > 1 && ctx.measureText(chars.slice(0, n).join('')).width > maxWidth) n -= 1;
        // Mots liés par une espace insécable (« … » par ex.) : couper à l'espace plutôt qu'au milieu.
        const sp = chars.slice(0, n + 1).findLastIndex((c) => /\s/.test(c));
        if (sp > 1) {
          lines.push(chars.slice(0, sp).join(''));
          word = chars.slice(sp + 1).join('');
          continue;
        }
        // Jamais « » » ni une ponctuation seule sur la ligne suivante : on emporte au moins un vrai caractère.
        while (n > 2 && /^[\s\p{P}\p{S}]*$/u.test(chars.slice(n).join(''))) n -= 1;
        lines.push(chars.slice(0, n).join(''));
        word = chars.slice(n).join('');
      }
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** Carte souvenir (photo entière + qui a offert à qui + petit mot), téléchargée en JPEG. */
export async function downloadCard(entry, photoUrl, groupName) {
  await document.fonts?.ready;
  const W = 1080;
  const pad = 64;
  const inner = W - pad * 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const title = `Cadeau de ${entry.giverName} pour ${entry.name}`;
  const fonts = {
    title: '600 52px Fraunces, Georgia, serif',
    group: '700 30px Nunito, system-ui, sans-serif',
    note: '400 40px Nunito, system-ui, sans-serif',
  };
  ctx.font = fonts.title;
  const titleLines = wrapLines(ctx, frTypo(title), inner);
  ctx.font = fonts.group;
  const groupLines = wrapLines(ctx, frTypo(isBrandName(groupName) ? 'Secret Santa' : `Secret Santa · ${groupName}`), inner);
  ctx.font = fonts.note;
  const noteLines = entry.note ? wrapLines(ctx, `«\u00a0${frTypo(entry.note)}\u00a0»`, inner) : [];
  const photo = entry.hasPhoto ? await loadImage(photoUrl).catch(() => null) : null;
  // La photo entière, sans recadrage (jusqu'au format portrait 9:16).
  const photoH = photo ? Math.min(Math.round(W * (photo.height / photo.width)), Math.round((W * 16) / 9)) : 0;
  const textH = pad + titleLines.length * 62 + 12 + groupLines.length * 40 + (noteLines.length ? 34 + noteLines.length * 54 : 0) + pad;
  canvas.width = W;
  canvas.height = photoH + textH;
  ctx.fillStyle = '#FBF7EF';
  ctx.fillRect(0, 0, W, canvas.height);
  if (photo) {
    ctx.fillStyle = '#F3ECDF';
    ctx.fillRect(0, 0, W, photoH);
    // « contain » : toute la photo est visible
    const ratio = Math.min(W / photo.width, photoH / photo.height);
    const dw = photo.width * ratio;
    const dh = photo.height * ratio;
    ctx.drawImage(photo, (W - dw) / 2, (photoH - dh) / 2, dw, dh);
  }
  ctx.fillStyle = '#C9A45C';
  ctx.fillRect(0, photoH, W, 6);
  let y = photoH + pad + 40;
  ctx.fillStyle = '#A3202F';
  ctx.font = fonts.title;
  for (const line of titleLines) {
    ctx.fillText(line, pad, y);
    y += 62;
  }
  y += 2;
  ctx.fillStyle = '#6B5F5A';
  ctx.font = fonts.group;
  for (const line of groupLines) {
    ctx.fillText(line, pad, y);
    y += 40;
  }
  if (noteLines.length) {
    y += 34;
    ctx.fillStyle = '#22191B';
    ctx.font = fonts.note;
    for (const line of noteLines) {
      ctx.fillText(line, pad, y);
      y += 54;
    }
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Carte souvenir - ${title}.jpg`.replace(/[\\/:*?"<>|]/g, '');
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Galerie de l'album : une carte par cadeau reçu. */
export function renderGallery(entries, { photoUrl, groupName, meId = null }) {
  const shown = entries.filter((e) => e.hasPhoto || e.note);
  if (!shown.length) {
    return el('div', { class: 'album-empty' },
      el('span', { class: 'album-empty-art', 'aria-hidden': 'true' }, icon('images', { size: 32 })),
      el('p', { class: 'muted' }, "L'album est encore vide. Les photos et les petits mots apparaîtront ici."));
  }
  return el('div', { class: 'gallery' }, shown.map((e) => el('figure', { class: 'polaroid' },
    e.hasPhoto
      // Un appui ouvre la photo entière (la galerie la recadre).
      ? el('a', { class: 'polaroid-photo', href: photoUrl(e), target: '_blank', rel: 'noopener', 'aria-label': `Voir en grand la photo du cadeau reçu par ${e.name}` },
        el('img', { src: photoUrl(e), alt: `Cadeau reçu par ${e.name}`, loading: 'lazy' }))
      : el('div', { class: 'polaroid-empty' }, icon('gift', { size: 24 }), el('span', {}, 'Pas encore de photo')),
    el('figcaption', {},
      el('strong', {}, `Cadeau de ${e.giverName} pour ${e.name}`, e.id === meId ? ' (toi)' : ''),
      e.note ? el('p', { class: 'polaroid-note' }, linkify(e.note)) : null,
      el('button', {
        class: 'btn btn-small', type: 'button',
        onclick: async (ev) => {
          const btn = ev.currentTarget;
          btn.disabled = true;
          try {
            await downloadCard(e, photoUrl(e), groupName);
          } finally {
            btn.disabled = false;
          }
        },
      }, icon('download', { size: 18 }), 'Télécharger la carte'),
    ),
  )));
}

export { clear };
