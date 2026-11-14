const camera = document.querySelector('#camera');
const cameraStatus = document.querySelector('#camera-status');
const video = document.querySelector('video');
const form = document.querySelector('#verify-form');
const input = document.querySelector('#code');
const result = document.querySelector('#result');
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });
let stream;
let frame;

function show(state, title, detail) {
  const heading = document.createElement('strong');
  heading.textContent = title;
  const message = document.createElement('p');
  message.textContent = detail;
  result.dataset.state = state;
  result.replaceChildren(heading, message);
  result.hidden = false;
}

async function verify(code) {
  if (!code.trim()) return;
  camera.disabled = true;
  form.querySelector('button').disabled = true;
  result.hidden = true;
  try {
    const response = await fetch('/verify', { method: 'POST', body: code });
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) throw new Error('Verifikasi gagal');
    const { state, name, time } = await response.json();
    if (state === 'approved') show(state, 'Boleh masuk', name);
    else if (state === 'duplicate') {
      show(state, 'Sudah check-in', name + ' · ' + new Date(time).toLocaleString('id-ID'));
    } else show(state, 'Undangan tidak valid', 'Kode ini tidak ditemukan di daftar tamu.');
  } catch {
    show('invalid', 'Verifikasi gagal', 'Periksa koneksi dan coba lagi.');
  } finally {
    camera.disabled = false;
    form.querySelector('button').disabled = false;
  }
}

function stopCamera() {
  cancelAnimationFrame(frame);
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  video.srcObject = null;
  video.hidden = true;
  camera.textContent = 'Buka kamera';
  cameraStatus.textContent = '';
}

function scan() {
  if (video.readyState >= 2 && video.videoWidth) {
    canvas.width = Math.min(video.videoWidth, 960);
    canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const qr = jsQR(pixels.data, pixels.width, pixels.height);
    if (qr?.data.trim()) {
      stopCamera();
      void verify(qr.data);
      return;
    }
  }
  frame = requestAnimationFrame(scan);
}

camera.addEventListener('click', async () => {
  if (stream) return stopCamera();
  if (!navigator.mediaDevices?.getUserMedia || !window.jsQR) {
    cameraStatus.textContent = 'Pemindai tidak tersedia. Buka lewat HTTPS atau localhost dan pastikan dependensi terpasang.';
    return;
  }
  camera.disabled = true;
  result.hidden = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = stream;
    video.hidden = false;
    await video.play();
    camera.textContent = 'Tutup kamera';
    cameraStatus.textContent = 'Arahkan kamera ke QR pada kartu.';
    frame = requestAnimationFrame(scan);
  } catch {
    stopCamera();
    cameraStatus.textContent = 'Kamera tidak dapat dibuka. Periksa izin kamera atau masukkan kode secara manual.';
  } finally {
    camera.disabled = false;
  }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  if (camera.disabled) return;
  stopCamera();
  void verify(input.value);
});
window.addEventListener('pagehide', stopCamera);

