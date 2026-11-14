const guestList = document.querySelector('#guests');
const feedback = document.querySelector('#feedback');
const summary = document.querySelector('#summary');
const add = document.querySelector('#add');
const importForm = document.querySelector('#import');
const refresh = document.querySelector('#refresh');

async function loadGuests() {
  refresh.disabled = true;
  try {
    const response = await fetch('/guests');
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) throw new Error();
    const guests = await response.json();
    summary.textContent = guests.length + ' tamu · ' + guests.filter(guest => guest.time).length + ' sudah check-in';
    guestList.replaceChildren(...guests.map(guest => {
      const row = document.createElement('li');
      const info = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = guest.name;
      const status = document.createElement('small');
      status.textContent = guest.time
        ? 'Sudah check-in · ' + new Date(guest.time).toLocaleString('id-ID')
        : 'Belum check-in';
      const code = document.createElement('small');
      code.className = 'guest-code';
      code.textContent = guest.code;
      const download = document.createElement('a');
      download.href = '/qr/' + encodeURIComponent(guest.code) + '.png';
      download.textContent = 'Unduh QR';
      download.setAttribute('aria-label', 'Unduh QR untuk ' + guest.name);
      info.append(name, status, code);
      for (const field of ['tempat', 'no_whatsapp', 'notes']) {
        if (!guest[field]) continue;
        const detail = document.createElement('small');
        detail.textContent = guest[field];
        info.append(detail);
      }
      row.append(info, download);
      return row;
    }));
  } catch {
    summary.textContent = 'Daftar tamu gagal dimuat. Coba muat ulang.';
  } finally {
    refresh.disabled = false;
  }
}

async function save(form, getPayload) {
  const buttons = [add, importForm].map(item => item.querySelector('button'));
  if (buttons.some(button => button.disabled)) return;
  buttons.forEach(button => { button.disabled = true; });
  feedback.hidden = false;
  feedback.textContent = 'Menyimpan daftar tamu…';
  try {
    const response = await fetch('/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await getPayload()),
    });
    if (response.status === 401) return location.assign('/login');
    const data = await response.json();
    feedback.textContent = response.ok ? data.count + ' tamu ditambahkan.' : data.error;
    if (response.ok) {
      form.reset();
      await loadGuests();
    }
  } catch {
    feedback.textContent = 'Daftar tamu gagal disimpan. Muat ulang daftar sebelum mencoba lagi.';
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

add.addEventListener('submit', event => {
  event.preventDefault();
  void save(add, () => ({ name: document.querySelector('#name').value }));
});
importForm.addEventListener('submit', event => {
  event.preventDefault();
  const file = document.querySelector('#csv').files[0];
  if (file.size > 250_000) {
    feedback.hidden = false;
    feedback.textContent = 'File melebihi batas 250 KB.';
    return;
  }
  void save(importForm, async () => {
    if (file.name.toLowerCase().endsWith('.xls')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
      return { xls: btoa(binary) };
    }
    return { csv: await file.text() };
  });
});
refresh.addEventListener('click', loadGuests);
void loadGuests();
