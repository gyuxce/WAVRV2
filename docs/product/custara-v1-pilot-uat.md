# Custara V1 — Checklist UAT Pilot

Dokumen ini dipakai untuk menguji alur inti Custara pada satu organisasi dan satu cabang sebelum data bisnis nyata digunakan.

## Konteks pilot sementara

- Organisasi: `Custara Pilot`
- Cabang: `Cabang Utama` (`MAIN`)
- Sumber data: CSV
- Saluran follow-up: WhatsApp manual atau tugas staf
- Scope cabang: satu cabang aktif (`MAIN`)
- Loyalty: nonaktif untuk pilot; modul tetap opsional
- Data sensitif: tidak menyimpan detail medis; hanya identitas, kunjungan, transaksi, dan layanan/kategori

## Keputusan pilot V1

- Semua customer, transaksi, item layanan, dan kunjungan pilot memakai branch code `MAIN`.
- Customer tetap satu profil per organisasi; aktivitasnya tercatat pada cabang `MAIN`.
- WhatsApp tidak dikirim otomatis. Custara hanya membuka link WhatsApp, mengekspor audience, dan menyimpan status follow-up manual.
- Loyalty tidak menjadi bagian dari acceptance pilot. Tidak ada poin, tier, reward, redeem, atau refund loyalty yang menjadi syarat lulus UAT.
- Jika pilot berikutnya membutuhkan loyalty, aturan awal yang disarankan adalah 1 poin per Rp10.000 transaksi selesai, tier Bronze 0–299, Silver 300–699, Gold 700+, tanpa expiry selama masa pilot, dan refund membalikkan poin.

## Persiapan

1. Pastikan API berjalan di `http://127.0.0.1:4000`.
2. Pastikan static server berjalan di `http://127.0.0.1:5500`.
3. Buka `mockup/custara-mockup.html` dan masuk memakai user Supabase yang sudah di-seed.
4. Pastikan status kanan atas menunjukkan `Data nyata terhubung`.
5. Gunakan satu cabang aktif `Cabang Utama · MAIN` selama pengujian.

## Skenario wajib

| ID | Skenario | Langkah ringkas | Hasil yang diharapkan |
| --- | --- | --- | --- |
| UAT-01 | Login dan tenant | Masuk, buka Ikhtisar, Pelanggan, Transaksi, dan Segmen | Status tetap terhubung; data berasal dari tenant aktif; tidak perlu refresh manual |
| UAT-02 | Import customer | Pelanggan → Impor CSV → pilih template customer → validasi dan commit | Jumlah customer bertambah sesuai baris valid; duplikat tidak membuat profil baru |
| UAT-03 | Import transaksi | Transaksi → Impor CSV → pilih transaksi dan item layanan | Transaksi terhubung ke customer yang tepat; layanan muncul di histori customer |
| UAT-04 | Opportunity | Segmen → Perbarui peluang → buka salah satu audiens | Jumlah audiens, cabang, alasan, dan persetujuan WhatsApp sesuai data |
| UAT-05 | Follow-up | Buka audiens → Buka di Pelanggan → gunakan WhatsApp atau Tandai dihubungi | Action tersimpan; status berubah; riwayat muncul di profil customer |
| UAT-06 | Customer kembali | Tambah transaksi baru untuk customer yang sama setelah opportunity dibuka → Catat hasil | Transaksi dapat dipilih; opportunity ditutup sebagai hasil; nilai tercatat |
| UAT-07 | Belum kembali | Pada opportunity pilih Tutup: belum kembali dan konfirmasi | Opportunity ditutup; alasan tersimpan; riwayat action tidak hilang |
| UAT-08 | Persetujuan WhatsApp | Pelanggan → filter persetujuan → buka profil | Link WhatsApp hanya tampil untuk customer yang menyetujui |
| UAT-09 | Duplicate safety | Impor file customer yang sama dua kali | Import kedua ditandai duplikat atau tidak menambah profil baru |
| UAT-10 | Recovery koneksi | Pindah menu beberapa kali, tunggu refresh sesi, lalu tekan Perbarui data | Status tetap stabil; data tidak menjadi kosong; jika sesi benar-benar habis, layar login muncul jelas |

## Kriteria lulus pilot

Pilot dianggap siap masuk ke data bisnis nyata jika:

- UAT-01 sampai UAT-10 dapat dijalankan tanpa SQL manual.
- Tidak ada customer lintas tenant atau lintas cabang yang terlihat oleh user.
- Import ulang tidak menggandakan customer atau transaksi.
- Setiap action follow-up memiliki customer dan opportunity yang jelas.
- Outcome hanya memakai transaksi customer yang sama dan terjadi setelah opportunity dibuka.
- Tidak ada data teknis mentah yang tampil di UI operasional.

## Batasan V1 saat ini

- Pengiriman WhatsApp otomatis belum aktif; V1 memakai link WhatsApp, ekspor audiens, dan tugas manual.
- Loyalty sengaja dinonaktifkan untuk pilot pertama karena aturan bisnis tiap klinik, gym, dan bisnis layanan dapat berbeda.
- Deploy production belum dilakukan; pengujian ini masih menggunakan API dan static server lokal.

## Catatan hasil

Isi kolom berikut saat UAT dilakukan dengan data bisnis nyata:

| Skenario | Status | Catatan / bukti |
| --- | --- | --- |
| UAT-01 sampai UAT-10 | Belum diuji |  |
