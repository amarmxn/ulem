# Pintu Acara

Aplikasi daftar tamu, unduhan QR, dan verifikasi check-in.

Untuk menjalankan secara lokal, gunakan Node.js 24, jalankan npm ci, atur
ADMIN_PASSWORD, lalu jalankan npm start. Buka http://localhost:3000/login
dan masuk sebagai admin.

Untuk Railway, tambahkan volume pada layanan ulem dengan mount path /data
dan set ADMIN_PASSWORD di Variables. SQLite menggunakan volume tersebut.
Gunakan satu replika. Setelah deployment aktif, buat domain HTTPS layanan.
