# Custara — Website, Product Demo & Strategy Resources

Repository ini berisi website marketing Custara, Demo Produk interaktif yang terhubung melalui navigasi website, dan dokumen strategi pemasaran Instagram sebagai referensi terpisah.

## Website Custara

Website utama tersedia pada [`index.html`](index.html). Ini adalah website statis tanpa proses build, berfungsi sebagai sales presentation pasca-pitch dengan fokus pada CTA **Growth Assessment**.

Untuk menjalankan secara lokal, buka `index.html` melalui browser atau jalankan static server dari root repository.

## Isi repository

- [Website Custara](index.html) - website marketing responsif dengan akses ke Demo Produk.
- [Demo Produk Custara](mockup/custara-mockup.html) - dashboard interaktif yang memakai design system Custara dan memiliki tautan kembali ke website.
- `demo-custara.css` - lapisan desain bersama untuk menyamakan demo produk dengan website.
- [Custara V1 Data and Growth Contract](docs/product/custara-v1-data-growth-contract.md) - kontrak CSV, model data, deduplikasi customer, dan opportunity engine.
- [Template impor CSV](docs/product/import-templates/) - contoh customer, transaksi, item transaksi, dan kunjungan.
- [ERD final Custara V1](docs/product/custara-v1-erd.md) - relasi database dan batas domain implementatif.
- [OpenAPI Custara V1](docs/product/openapi-v1.yaml) - kontrak Customer, Import, Transaction, dan Opportunity.
- [Fondasi API + Prisma](apps/api/) - schema PostgreSQL, migration awal, dan konfigurasi Prisma 7.
- [Runtime API + Supabase setup](docs/product/custara-v1-runtime.md) - arsitektur runtime, tenant context, Auth, Storage, dan deployment.
- [Playbook Instagram & Meta Ads (PDF)](docs/wavr-instagram-growth-meta-ads-playbook.pdf)
- [Playbook Instagram & Meta Ads (DOCX)](docs/wavr-instagram-growth-meta-ads-playbook.docx)

## Fitur mockup Custara V1

- Ikhtisar KPI dan kesehatan sistem.
- Data pelanggan dan profil pelanggan.
- Transaksi, kunjungan, serta impor data.
- Loyalitas dan tingkat pelanggan.
- Segmen berbasis aturan.
- Kampanye dengan atribusi dan status eksekusi.
- Pengaturan cabang, peran, dan integrasi.

Playbook Instagram di folder `docs/` adalah dokumen strategi untuk memasarkan Custara kepada owner klinik; Instagram bukan modul produk pada mockup ini.

## Cara menjalankan

Untuk menjalankan website dan demo yang terhubung ke API lokal:

1. Terminal pertama: masuk ke `apps/api`, lalu jalankan `pnpm dev`.
2. Terminal kedua dari root repository: jalankan `node tools/serve-static.cjs`.
3. Buka `http://127.0.0.1:5500/mockup/custara-mockup.html`.
4. Masuk memakai user Supabase Auth. Pilih **Lanjutkan dengan data demo** jika hanya ingin menjelajahi prototype.

Dashboard live mengambil konfigurasi publishable dari API, menggunakan Supabase Auth untuk sesi login, lalu mengirim access token ke endpoint runtime. Service-role key tetap berada di server API.

## Catatan

Strategi iklan dan komunikasi kesehatan di playbook perlu disesuaikan lagi dengan data bisnis, kebijakan Meta terbaru, dan proses persetujuan internal sebelum kampanye dijalankan.
