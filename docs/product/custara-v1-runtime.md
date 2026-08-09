# Custara V1 Runtime dan Supabase Setup

Dokumen ini menjelaskan cara menjalankan API runtime yang ada di `apps/api` menggunakan Supabase.

## Arsitektur

```text
Frontend Custara
      │  Supabase Auth access token
      ▼
Fastify API
      │  verifikasi JWT + lookup membership
      ▼
Prisma 7 → Supabase PostgreSQL
      │
      ├─ Customer / Import / Transaction / Opportunity
      ├─ audit log + outbox event
      └─ idempotency record

Supabase Storage ← file CSV import (server-side service key)
```

API tidak menerima `organization_id` dari payload bisnis. Organisasi ditentukan dari `sub` JWT Supabase melalui `users.auth_subject`, lalu dicocokkan ke `organization_users`. Jika satu user memiliki lebih dari satu organisasi, kirim `X-Organization-Id`. Untuk operasi cabang, kirim `X-Branch-Id`; API tetap memvalidasi scope user.

## Menyiapkan project Supabase

1. Buat satu project Supabase untuk development/pilot dan satu project terpisah untuk production.
2. Aktifkan Supabase Auth dan pilih provider login yang akan dipakai Custara.
3. Buat private Storage bucket bernama `custara-imports`.
4. Salin connection string dari menu Connect ke `.env`:
   - `DATABASE_URL`: koneksi runtime, biasanya Supavisor session/transaction pooler sesuai tempat API dijalankan.
   - `DIRECT_URL`: koneksi direct/session untuk `prisma migrate deploy`.
   - `SHADOW_DATABASE_URL`: database shadow lokal atau database development terpisah.
5. Isi `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY`. Service-role key hanya boleh berada di server API.
6. Jalankan migration:

```bash
pnpm install
pnpm prisma:migrate:deploy
pnpm build
pnpm start
```

Jangan menjalankan `prisma migrate dev` ke database production. Migration awal dan migration runtime foundation sudah tersimpan di `apps/api/prisma/migrations`.

## Provisioning user pertama

Supabase Auth hanya menerbitkan identitas. Akses organisasi Custara tetap harus diprovisioning di database. Setelah user dibuat di Supabase Auth, ambil UUID user tersebut lalu hubungkan ke record Custara:

```sql
-- Jalankan setelah organizations, roles, permissions, dan organization_users dibuat.
UPDATE users
SET auth_subject = '<SUPABASE_AUTH_USER_UUID>'
WHERE normalized_email = 'owner@example.com';
```

User juga harus memiliki `organization_users.status = 'ACTIVE'`, role aktif, serta branch scope jika role-nya bukan admin organisasi. API sengaja menolak user Auth yang belum memiliki membership agar login tidak otomatis memberi akses tenant.

## Alur modul V1

### Customer

`POST /v1/customers` melakukan normalisasi nama, email, dan nomor telepon; mengecek external reference/phone/email; lalu mengembalikan review duplicate jika perlu. Customer dibuat pada level organisasi, sedangkan home branch hanya atribut operasional.

### Import CSV

`POST /v1/imports` menerima multipart CSV, menyimpan file ke Storage, mem-parsing dan men-staging setiap row. Baris invalid/possible duplicate tidak langsung masuk ke data utama. Setelah keputusan duplicate disimpan, `POST /v1/imports/{id}/commit` memproses baris valid sesuai mode `STRICT` atau `VALID_ROWS_ONLY`.

### Transaction

`POST /v1/transactions` mencatat transaksi immutable, snapshot item, kunjungan turunan, metric customer, audit log, dan outbox event dalam satu alur transaksi. Retry dengan `Idempotency-Key` yang sama mengembalikan hasil sebelumnya.

### Opportunity

Queue opportunity dibuat dari tiga resep universal: Inactive, Frequency Decline, dan Cross-sell. Opportunity Near Tier tidak dibuat sebagai default karena hanya relevan jika organisasi mengaktifkan loyalty. Opportunity dijelaskan dengan `reason_text` dan `reason_data`, kemudian staff dapat mencatat action atau dismissal.

## Local development tanpa Supabase

Untuk unit test dan smoke test, gunakan `AUTH_MODE=mock` serta token `Authorization: Bearer mock:<auth-subject>:<email>`. Mode ini hanya untuk development/test; deployment production harus memakai `AUTH_MODE=supabase`.
