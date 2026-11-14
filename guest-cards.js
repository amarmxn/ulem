const QRCode = require('qrcode');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function guestCards(guests, css) {
  const cards = await Promise.all(guests.map(async guest => {
    const qr = await QRCode.toDataURL(guest.code, { margin: 4, scale: 8 });
    return `<article class="card"><div><h2>${escapeHtml(guest.name)}</h2>
      <p>${escapeHtml(guest.tempat)}</p></div><div class="card-qr"><img src="${qr}" alt="QR undangan"><span>${escapeHtml(guest.manual_code)}</span></div></article>`;
  }));

  const sheets = [];
  for (let index = 0; index < cards.length; index += 8) {
    sheets.push(`<section class="sheet">${cards.slice(index, index + 8).join('')}</section>`);
  }

  return `<!doctype html>
<html lang="id">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kartu tamu · Pintu Acara</title>
<style>${css}</style>
<body>
  <header><div><h1>Kartu tamu</h1><p>90 × 55 mm · 8 kartu per A4 · ${cards.length} tamu</p></div>
  <button type="button" onclick="window.print()">Cetak / Simpan PDF</button></header>
  <main class="preview">${sheets.join('') || '<p>Belum ada tamu untuk dicetak.</p>'}</main>
</body>
</html>`;
}

module.exports = { guestCards };
