(function () {
  "use strict";

  const runtime = window.CUSTARA_RUNTIME || {};
  const apiBaseUrl = String(runtime.apiBaseUrl || "http://127.0.0.1:4000").replace(/\/$/, "");
  const state = {
    apiBaseUrl,
    supabase: null,
    session: null,
    me: null,
    branchId: null,
    live: false,
    configError: null,
    opportunitySummary: [],
    opportunities: [],
    identifiers: new Map(),
  };

  const opportunityLabels = {
    INACTIVE: "Tidak aktif lebih dari 60 hari",
    FREQUENCY_DECLINE: "Frekuensi kunjungan menurun",
    CROSS_SELL: "Peluang lintas layanan",
    NEAR_TIER: "Hampir naik tingkat",
  };

  const opportunityIcons = {
    INACTIVE: "clock",
    FREQUENCY_DECLINE: "trend",
    CROSS_SELL: "spark",
    NEAR_TIER: "gift",
  };

  const opportunityColors = {
    INACTIVE: ["#ffebef", "var(--wavr-red)"],
    FREQUENCY_DECLINE: ["#e8f0ff", "var(--wavr-blue)"],
    CROSS_SELL: ["#f0ebff", "var(--wavr-purple)"],
    NEAR_TIER: ["#fff2d8", "var(--wavr-orange)"],
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function formatLiveDate(value) {
    if (!value) return "Belum ada kunjungan";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Belum ada kunjungan";
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function liveLabel(type) {
    return opportunityLabels[type] || uiLabel(type || "Peluang pertumbuhan");
  }

  function ensureLiveState() {
    appState.liveMode = state.live;
    appState.liveOpportunitySummary = state.opportunitySummary;
    appState.liveOpportunities = state.opportunities;
  }

  function mapCustomer(row) {
    const metrics = row.metrics || {};
    const opportunity = row.primary_opportunity;
    return {
      id: row.id,
      name: row.display_name || "Tanpa nama",
      phone: row.primary_phone || "Nomor belum tersedia",
      email: row.primary_email || "",
      initials: initials(row.display_name || "?") || "?",
      lastVisit: formatLiveDate(metrics.last_visit_at),
      visits: numeric(metrics.visit_count_90d || metrics.visit_count_30d),
      spend: numeric(metrics.lifetime_value?.amount),
      points: 0,
      tier: "Belum diatur",
      identifier: state.identifiers.get(row.id) || "Belum ditautkan",
      segment: opportunity ? liveLabel(opportunity.type) : "Belum ada peluang",
      consent: false,
      raw: row,
    };
  }

  function mapTransaction(row) {
    const firstItem = row.items?.[0];
    const type = row.type === "REFUND" ? "Refund" : row.status === "COMPLETED" ? "Tercatat" : row.status;
    return {
      id: row.id,
      customerId: row.customer_id,
      service: firstItem?.service_name || "Transaksi",
      date: formatLiveDate(row.occurred_at),
      amount: numeric(row.net?.amount),
      status: type || "Tercatat",
      source: row.source_system || "API",
      raw: row,
    };
  }

  async function loadPublicConfig() {
    const response = await fetch(`${apiBaseUrl}/public-config`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.supabase_url || !payload.supabase_publishable_key) {
      throw new Error("Konfigurasi Supabase untuk browser belum tersedia di API.");
    }
    if (!window.supabase?.createClient) throw new Error("Library Supabase belum termuat. Periksa koneksi internet browser.");
    state.supabase = window.supabase.createClient(payload.supabase_url, payload.supabase_publishable_key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  async function apiRequest(path, options = {}) {
    if (!state.session?.access_token) throw new Error("Sesi login belum tersedia.");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${state.session.access_token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (state.branchId && !headers.has("X-Branch-Id")) headers.set("X-Branch-Id", state.branchId);
    const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { detail: text }; }
    if (!response.ok) {
      const error = new Error(payload.detail || payload.title || payload.message || `Permintaan gagal (${response.status}).`);
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadLiveData() {
    const [meResponse, customerResponse, transactionResponse, summaryResponse, opportunityResponse] = await Promise.all([
      apiRequest("/v1/me"),
      apiRequest("/v1/customers?limit=100"),
      apiRequest("/v1/transactions?limit=100"),
      apiRequest("/v1/opportunities/summary"),
      apiRequest("/v1/opportunities?limit=100"),
    ]);
    state.me = meResponse.data;
    state.branchId = state.me.branches?.[0]?.id || null;
    state.opportunitySummary = summaryResponse.data || [];
    state.opportunities = opportunityResponse.data || [];
    appState.customers = (customerResponse.data || []).map(mapCustomer);
    appState.transactions = (transactionResponse.data || []).map(mapTransaction);
    appState.visits = [];
    appState.campaigns = state.opportunitySummary.map((item) => ({
      id: item.definition_id,
      name: liveLabel(item.type),
      segment: liveLabel(item.type),
      audience: item.customer_count,
      channel: "Task",
      status: "Ready",
      lastRun: "Belum ada aksi",
    }));
    appState.campaignMetrics = { sent: 0, returned: 0, attributedRevenue: 0, conversion: 0 };
    ensureLiveState();
    updateWorkspaceIdentity();
  }

  function updateWorkspaceIdentity() {
    const user = state.me?.user;
    const branch = state.me?.branches?.[0];
    const userName = user?.name || user?.email || "Owner";
    const branchName = branch ? `${branch.name} · ${branch.code}` : "Semua cabang";
    document.querySelectorAll(".wavr-user strong, .wavr-top-avatar strong").forEach((element) => { element.textContent = userName; });
    document.querySelectorAll(".wavr-user span, .wavr-top-avatar span").forEach((element) => { element.textContent = state.me?.role?.name || "Pemilik / Admin"; });
    const branchElement = document.querySelector(".wavr-branch-card strong");
    if (branchElement) branchElement.textContent = branchName;
  }

  function installOverlay() {
    if (document.getElementById("custaraLiveOverlay")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <div class="custara-live-overlay" id="custaraLiveOverlay" hidden>
        <section class="custara-live-card" role="dialog" aria-modal="true" aria-labelledby="custaraLiveTitle">
          <div class="custara-live-brand"><img src="../assets/custara-mark.svg" alt="" /> <span>Custara · Workspace</span></div>
          <h2 id="custaraLiveTitle">Hubungkan data Custara</h2>
          <p>Masuk untuk melihat customer, transaksi, dan peluang pertumbuhan dari Supabase.</p>
          <form id="custaraLiveLoginForm">
            <div class="custara-live-field"><label for="custaraLiveEmail">Email</label><input id="custaraLiveEmail" type="email" autocomplete="email" placeholder="email owner" required /></div>
            <div class="custara-live-field"><label for="custaraLivePassword">Password</label><input id="custaraLivePassword" type="password" autocomplete="current-password" placeholder="Password Supabase Auth" required /></div>
            <div class="custara-live-error" id="custaraLiveError" hidden></div>
            <div class="custara-live-actions"><button class="wavr-button primary" type="submit" id="custaraLiveSubmit">Masuk ke workspace</button><button class="custara-live-secondary" type="button" id="custaraLiveDemo">Lanjutkan dengan data demo</button></div>
          </form>
          <p class="custara-live-note" id="custaraLiveNote">Data demo tetap tersedia jika kamu ingin menjelajahi UI tanpa login.</p>
        </section>
      </div>`);
    document.getElementById("custaraLiveLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await signIn();
    });
    document.getElementById("custaraLiveDemo").addEventListener("click", () => {
      hideOverlay();
      setConnectionStatus("Mode demo", false);
    });
  }

  function installConnectionControls() {
    const actions = document.querySelector(".wavr-topbar-actions");
    if (!actions || document.getElementById("custaraLiveStatus")) return;
    actions.insertAdjacentHTML("afterbegin", `<span class="custara-live-status" id="custaraLiveStatus">Mode demo</span><button class="custara-live-logout" id="custaraLiveLogout" type="button" hidden>Keluar</button>`);
    document.getElementById("custaraLiveLogout").addEventListener("click", async () => {
      await state.supabase?.auth.signOut();
      window.location.reload();
    });
  }

  function setConnectionStatus(text, connected) {
    const element = document.getElementById("custaraLiveStatus");
    const logout = document.getElementById("custaraLiveLogout");
    if (element) { element.textContent = text; element.classList.toggle("is-live", connected); }
    if (logout) logout.hidden = !connected;
  }

  function showOverlay(message) {
    const overlay = document.getElementById("custaraLiveOverlay");
    const error = document.getElementById("custaraLiveError");
    if (message) { error.textContent = message; error.hidden = false; }
    overlay.hidden = false;
    document.getElementById("custaraLiveEmail")?.focus();
  }

  function hideOverlay() {
    document.getElementById("custaraLiveOverlay").hidden = true;
  }

  async function signIn() {
    const email = document.getElementById("custaraLiveEmail").value.trim();
    const password = document.getElementById("custaraLivePassword").value;
    const button = document.getElementById("custaraLiveSubmit");
    const error = document.getElementById("custaraLiveError");
    button.disabled = true;
    button.textContent = "Menghubungkan...";
    error.hidden = true;
    try {
      const result = await state.supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      await activateLive(result.data.session);
    } catch (caught) {
      error.textContent = caught.message || "Login gagal. Periksa email dan password Supabase Auth.";
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = "Masuk ke workspace";
    }
  }

  async function activateLive(session) {
    state.session = session;
    setConnectionStatus("Mengambil data...", true);
    try {
      await loadLiveData();
      state.live = true;
      ensureLiveState();
      hideOverlay();
      setConnectionStatus("Data nyata terhubung", true);
      navigate(appState.page || "overview");
      showToast("Workspace Custara terhubung ke Supabase");
    } catch (caught) {
      state.live = false;
      setConnectionStatus("Login belum terhubung", false);
      showOverlay(caught.message || "Data workspace belum dapat dimuat.");
    }
  }

  function renderLiveOverview() {
    const customerCount = appState.customers.length;
    const transactionCount = appState.transactions.length;
    const opportunityCount = state.opportunitySummary.reduce((sum, item) => sum + numeric(item.customer_count), 0);
    const revenue = appState.transactions.reduce((sum, item) => sum + numeric(item.amount), 0);
    const branch = state.me?.branches?.[0];
    const userName = state.me?.user?.name || "Owner";
    const opportunityCards = state.opportunitySummary.length
      ? state.opportunitySummary.slice(0, 3).map((item) => `<div class="wavr-opportunity"><div class="wavr-opportunity-icon">${icon(opportunityIcons[item.type] || "spark", 17)}</div><div class="wavr-opportunity-main"><strong>${escapeHtml(liveLabel(item.type))}</strong><span>Prioritas berdasarkan data customer yang tersimpan.</span></div><div class="wavr-opportunity-value"><strong>${numeric(item.customer_count)} pelanggan</strong><span>${formatIDR(numeric(item.estimated_value?.amount))} nilai estimasi</span></div><button type="button" class="wavr-button small" data-action="open-live-opportunity" data-opportunity-type="${escapeHtml(item.type)}">Tinjau</button></div>`).join("")
      : `<div class="custara-live-empty">Belum ada peluang aktif. Import customer dan transaksi terlebih dahulu agar Custara dapat membaca pola pertumbuhan.</div>`;
    const activityRows = appState.transactions.slice(0, 5).map((transaction) => {
      const customer = customerById(transaction.customerId) || { name: "Pelanggan", initials: "?" };
      return `<tr><td><div class="wavr-table-person">${avatar(customer)}<div><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(transaction.date)}</span></div></div></td><td><strong>${escapeHtml(transaction.service)}</strong></td><td>${status(transaction.status)}</td><td class="wavr-text-right"><strong>${formatIDR(transaction.amount)}</strong></td></tr>`;
    }).join("") || `<tr><td colspan="4" class="wavr-text-muted">Belum ada transaksi tercatat.</td></tr>`;
    const actions = `<button type="button" class="wavr-button" data-action="scan"><span data-icon-name="scan"></span>Pindai ID pengenal</button><button type="button" class="wavr-button primary" data-action="add-customer"><span data-icon-name="plus"></span>Tambah pelanggan</button>`;
    const body = `<section class="wavr-kpi-grid" aria-label="Ringkasan data nyata"><article class="wavr-kpi"><div class="wavr-kpi-top"><span>Pelanggan aktif</span><span class="wavr-kpi-icon blue">${icon("users", 16)}</span></div><div class="wavr-kpi-value">${customerCount}</div><div class="wavr-kpi-foot"><span>Data tenant saat ini</span></div></article><article class="wavr-kpi"><div class="wavr-kpi-top"><span>Transaksi tercatat</span><span class="wavr-kpi-icon teal">${icon("receipt", 16)}</span></div><div class="wavr-kpi-value">${transactionCount}</div><div class="wavr-kpi-foot"><span>Riwayat yang sudah masuk</span></div></article><article class="wavr-kpi"><div class="wavr-kpi-top"><span>Peluang terbuka</span><span class="wavr-kpi-icon purple">${icon("spark", 16)}</span></div><div class="wavr-kpi-value">${opportunityCount}</div><div class="wavr-kpi-foot"><span>Siap ditindaklanjuti</span></div></article><article class="wavr-kpi"><div class="wavr-kpi-top"><span>Nilai transaksi</span><span class="wavr-kpi-icon orange">${icon("dollar", 16)}</span></div><div class="wavr-kpi-value">${formatIDR(revenue)}</div><div class="wavr-kpi-foot"><span>Total data yang termuat</span></div></article></section><div class="wavr-grid-2"><section class="wavr-panel"><div class="wavr-panel-head"><div><h2>Peluang pertumbuhan</h2><p>Diambil dari aturan Custara dan data tenant nyata.</p></div><button type="button" class="wavr-link-button" data-page-link="segments">Lihat semua segmen ${icon("arrow", 13)}</button></div><div class="wavr-opportunity-list">${opportunityCards}</div></section><section class="wavr-panel"><div class="wavr-panel-head"><div><h2>Konteks workspace</h2><p>Tenant dan cabang dari sesi login saat ini.</p></div><span class="wavr-status success">Terhubung</span></div><div class="wavr-health-list"><div class="wavr-health-row">${icon("shield", 17)}<div><strong>${escapeHtml(state.me?.organization?.name || "Organisasi")}</strong><span>${escapeHtml(branch?.name || "Semua cabang")}</span></div>${status("Active")}</div><div class="wavr-health-row">${icon("users", 17)}<div><strong>${escapeHtml(userName)}</strong><span>${escapeHtml(state.me?.role?.name || "Pemilik / Admin")}</span></div>${status("Connected")}</div><div class="wavr-health-row">${icon("database", 17)}<div><strong>Supabase PostgreSQL</strong><span>API runtime dan tenant context aktif</span></div>${status("Synced")}</div></div></section></div><section class="wavr-panel"><div class="wavr-panel-head"><div><h2>Aktivitas terbaru</h2><p>Transaksi yang baru tercatat di workspace ini.</p></div><button type="button" class="wavr-link-button" data-page-link="transactions">Lihat transaksi ${icon("arrow", 13)}</button></div><div class="wavr-table-wrap"><table class="wavr-activity-table"><thead><tr><th>Pelanggan</th><th>Layanan</th><th>Status</th><th class="wavr-text-right">Nilai</th></tr></thead><tbody>${activityRows}</tbody></table></div></section>`;
    return renderShellPage(`Selamat datang, ${escapeHtml(userName)}`, `${escapeHtml(state.me?.organization?.name || "Custara")} · ${escapeHtml(branch?.name || "Semua cabang")}`, actions, body);
  }

  function renderLiveSegments() {
    const actions = `<button type="button" class="wavr-button" data-action="refresh-live"><span data-icon-name="clock"></span>Perbarui peluang</button>`;
    const cards = state.opportunitySummary.map((item, index) => {
      const colors = opportunityColors[item.type] || ["#e6fbf7", "var(--wavr-teal)"];
      return `<article class="wavr-segment-card"><span class="wavr-segment-index">${String(index + 1).padStart(2, "0")}</span><div class="wavr-segment-icon" style="background:${colors[0]};color:${colors[1]}">${icon(opportunityIcons[item.type] || "spark", 17)}</div><h3>${escapeHtml(liveLabel(item.type))}</h3><p>Peluang yang dibentuk dari aturan dan aktivitas customer tenant.</p><div class="wavr-segment-meta"><div><strong>${numeric(item.customer_count)}</strong><span> pelanggan</span></div><span>${formatIDR(numeric(item.estimated_value?.amount))} potensi</span></div><button type="button" class="wavr-link-button wavr-segment-link" data-action="open-live-opportunity" data-opportunity-type="${escapeHtml(item.type)}">Lihat audiens ${icon("arrow", 12)}</button></article>`;
    }).join("") || `<div class="custara-live-empty">Belum ada customer opportunity. Setelah customer dan transaksi tersedia, gunakan tombol perbarui untuk menjalankan evaluasi.</div>`;
    const body = `<section class="wavr-panel"><div class="wavr-panel-head"><div><h2>Segmen berbasis aturan</h2><p>Daftar ini berasal dari evaluasi opportunity API, bukan data demo.</p></div><span class="wavr-status success">Data nyata</span></div><div class="wavr-segment-grid">${cards}</div></section>`;
    return renderShellPage("Segmen", "Ubah perilaku customer menjadi audiens yang dapat ditindaklanjuti.", actions, body);
  }

  function renderLivePlaceholder(page) {
    const content = {
      loyalty: ["Loyalitas", "Modul loyalty siap dihubungkan setelah aturan poin, tier, dan reward pilot ditetapkan.", "Data loyalty belum diaktifkan untuk tenant ini."],
      campaigns: ["Kampanye", "Opportunity sudah tersedia untuk ditindaklanjuti. Modul kampanye outbound akan dihubungkan pada tahap integrasi channel.", "Belum ada campaign runtime yang tersimpan."],
      settings: ["Pengaturan", "Konteks tenant dan cabang sudah berasal dari sesi Supabase yang sedang aktif.", "Pengaturan operasional lanjutan akan dibuat setelah kebutuhan pilot dikunci."],
    }[page] || ["Custara", "Modul ini belum tersedia pada koneksi live saat ini.", "Belum ada data live untuk ditampilkan."];
    const body = `<section class="wavr-panel"><div class="wavr-panel-head"><div><h2>${content[0]}</h2><p>${content[1]}</p></div><span class="wavr-status neutral">Tahap berikutnya</span></div><div class="custara-live-empty">${content[2]}<br /><button type="button" class="wavr-link-button" data-page-link="overview">Kembali ke ikhtisar ${icon("arrow", 13)}</button></div></section>`;
    return renderShellPage(content[0], content[1], "", body);
  }

  function navigate(page) {
    renderPage(page);
    if (!state.live) return;
    if (page === "overview") document.getElementById("pageRoot").innerHTML = renderLiveOverview();
    if (page === "segments") document.getElementById("pageRoot").innerHTML = renderLiveSegments();
    if (["loyalty", "campaigns", "settings"].includes(page)) document.getElementById("pageRoot").innerHTML = renderLivePlaceholder(page);
    hydrateIcons();
  }

  function openLiveScanModal() {
    openModal("Pindai ID pengenal", "Cari customer berdasarkan QR, NFC, RFID, atau kode membership yang sudah tersimpan.", `<form id="liveScanForm"><div class="wavr-form-field"><label for="liveScanIdentifier">Nilai ID pengenal</label><input class="wavr-input" id="liveScanIdentifier" placeholder="Contoh: RFID-0001" required /></div><div class="wavr-inline-error" id="liveScanError" hidden>${icon("x", 15)}<span></span></div></form>`, `<button type="button" class="wavr-button" data-action="close-modal">Batal</button><button type="button" class="wavr-button primary" data-action="live-resolve-identifier"><span data-icon-name="scan"></span>Cari customer</button>`);
  }

  async function resolveLiveIdentifier() {
    const input = document.getElementById("liveScanIdentifier");
    const error = document.getElementById("liveScanError");
    const value = input?.value.trim();
    if (!value) return;
    try {
      const result = await apiRequest(`/v1/customers?search=${encodeURIComponent(value)}&limit=5`);
      const row = result.data?.[0];
      if (!row) throw new Error("ID pengenal belum terhubung ke customer.");
      closeModal();
      await openLiveCustomer(row.id);
    } catch (caught) {
      if (error) { error.querySelector("span").textContent = caught.message; error.hidden = false; }
    }
  }

  async function openLiveCustomer(customerId) {
    try {
      const result = await apiRequest(`/v1/customers/${customerId}`);
      const detail = result.data;
      const customer = mapCustomer(detail);
      customer.identifier = detail.identifiers?.[0]?.display_code || "Belum ditautkan";
      state.identifiers.set(customer.id, customer.identifier);
      const serviceRows = appState.transactions.filter((tx) => tx.customerId === customer.id).slice(0, 5).map((tx) => `<tr><td>${escapeHtml(tx.service)}</td><td class="wavr-text-muted">${escapeHtml(tx.date)}</td><td class="wavr-text-right">${formatIDR(tx.amount)}</td></tr>`).join("") || `<tr><td colspan="3" class="wavr-text-muted">Belum ada transaksi tercatat.</td></tr>`;
      openModal(customer.name, `${customer.identifier} · Profil customer`, `<div class="wavr-profile-hero">${avatar(customer)}<div><h3>${escapeHtml(customer.name)}</h3><p>${escapeHtml(customer.phone)} · ${detail.consent?.length ? "Persetujuan tercatat" : "Persetujuan belum tercatat"}</p></div><span class="wavr-profile-status">${status("Connected")}</span></div><div class="wavr-profile-stats"><div class="wavr-profile-stat"><strong>${customer.visits}</strong><span>Kunjungan 90 hari</span></div><div class="wavr-profile-stat"><strong>${formatIDR(customer.spend)}</strong><span>Nilai seumur hidup</span></div><div class="wavr-profile-stat"><strong>${escapeHtml(customer.tier)}</strong><span>Tingkat loyalty</span></div><div class="wavr-profile-stat"><strong>${escapeHtml(customer.segment)}</strong><span>Peluang utama</span></div></div><div class="wavr-profile-section"><h4>Layanan terakhir</h4><div class="wavr-table-wrap"><table class="wavr-data-table"><tbody>${serviceRows}</tbody></table></div></div>`, `<button type="button" class="wavr-button" data-action="close-modal">Tutup</button>`);
    } catch (caught) { showToast(caught.message || "Profil customer gagal dimuat"); }
  }

  function openLiveOpportunity(type) {
    const rows = state.opportunities.filter((item) => item.type === type);
    const body = rows.length ? `<div class="wavr-table-wrap"><table class="wavr-data-table"><thead><tr><th>Customer</th><th>Alasan</th><th>Nilai estimasi</th><th></th></tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${escapeHtml(item.customer?.display_name || "Customer")}</strong><span class="wavr-text-muted" style="display:block;font-size:10px">${escapeHtml(item.customer?.primary_phone || "Nomor belum tersedia")}</span></td><td>${escapeHtml(item.reason_text || "Peluang pertumbuhan")}</td><td>${formatIDR(numeric(item.estimated_value?.amount))}</td><td><button type="button" class="wavr-button small" data-action="live-mark-contacted" data-opportunity-id="${escapeHtml(item.id)}">Tandai ditindaklanjuti</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="custara-live-empty">Belum ada customer yang masuk ke peluang ini.</div>`;
    openModal(`Audiens · ${liveLabel(type)}`, "Customer yang memenuhi aturan dari API Custara.", body, `<button type="button" class="wavr-button" data-action="close-modal">Tutup</button>`);
  }

  async function markOpportunityContacted(opportunityId) {
    try {
      await apiRequest(`/v1/opportunities/${opportunityId}/actions`, { method: "POST", headers: { "Idempotency-Key": `ui-${Date.now()}-${opportunityId}` }, body: JSON.stringify({ type: "STAFF_FOLLOW_UP", channel: "OTHER", message_preview: "Ditindaklanjuti dari workspace Custara" }) });
      await loadLiveData();
      closeModal();
      navigate("segments");
      showToast("Peluang ditandai sudah ditindaklanjuti");
    } catch (caught) { showToast(caught.message || "Aksi gagal disimpan"); }
  }

  function identifierType(value) {
    const normalized = value.toUpperCase();
    if (normalized.startsWith("NFC")) return "NFC";
    if (normalized.startsWith("RFID")) return "RFID";
    if (normalized.startsWith("QR")) return "QR";
    return "MEMBERSHIP_NUMBER";
  }

  async function saveLiveCustomer() {
    const form = document.getElementById("newCustomerForm");
    if (!form?.reportValidity()) return;
    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const identifier = String(formData.get("identifier") || "").trim().toUpperCase();
    const consentGranted = formData.get("consent") === "on";
    try {
      const created = await apiRequest("/v1/customers", { method: "POST", headers: { "Idempotency-Key": `ui-customer-${Date.now()}` }, body: JSON.stringify({ display_name: name, phone, home_branch_id: state.branchId, consent: [{ purpose: "MARKETING", channel: "WHATSAPP", status: consentGranted ? "GRANTED" : "DENIED", source: "FRONT_DESK", recorded_at: new Date().toISOString() }] }) });
      if (created.review) throw new Error("Customer mirip sudah ditemukan. Periksa duplicate review sebelum membuat profil baru.");
      const customerId = created.data.id;
      if (identifier) {
        await apiRequest(`/v1/customers/${customerId}/identifiers`, { method: "POST", headers: { "Idempotency-Key": `ui-identifier-${Date.now()}` }, body: JSON.stringify({ type: identifierType(identifier), display_code: identifier }) });
        state.identifiers.set(customerId, identifier);
      }
      await loadLiveData();
      closeModal();
      navigate("customers");
      showToast(`${name} berhasil tersimpan di Supabase`);
    } catch (caught) { showToast(caught.message || "Customer gagal disimpan"); }
  }

  async function saveLiveTransaction() {
    const form = document.getElementById("newTransactionForm");
    if (!form?.reportValidity()) return;
    const customerId = document.getElementById("txCustomer")?.value;
    const service = document.getElementById("txService")?.value || "Layanan";
    const amount = numeric(String(document.getElementById("txAmount")?.value || "").replace(/[^0-9]/g, ""));
    if (!customerId || amount <= 0 || !state.branchId) { showToast("Customer, cabang, dan nilai transaksi wajib tersedia"); return; }
    try {
      await apiRequest("/v1/transactions", { method: "POST", headers: { "Idempotency-Key": `ui-transaction-${Date.now()}` }, body: JSON.stringify({ customer_id: customerId, source_system: "MANUAL", external_transaction_id: `UI-${Date.now()}`, occurred_at: new Date().toISOString(), currency: "IDR", gross_amount: amount.toFixed(2), discount_amount: "0.00", net_amount: amount.toFixed(2), create_visit_if_needed: true, items: [{ line_number: 1, service_name: service, service_category: "Layanan", quantity: "1", unit_amount: amount.toFixed(2), line_amount: amount.toFixed(2) }] }) });
      await loadLiveData();
      closeModal();
      navigate("transactions");
      showToast(`${formatIDR(amount)} berhasil tercatat di Supabase`);
    } catch (caught) { showToast(caught.message || "Transaksi gagal disimpan"); }
  }

  function openLiveImportModal() {
    openModal("Impor CSV ke Custara", "Upload file untuk divalidasi API sebelum masuk ke data utama.", `<form id="liveImportForm"><div class="custara-live-field"><label for="liveImportFile">File CSV</label><input id="liveImportFile" type="file" accept=".csv,text/csv" required /></div><div class="custara-live-field"><label for="liveImportType">Jenis data</label><select class="wavr-select" id="liveImportType"><option value="CUSTOMERS">Pelanggan</option><option value="TRANSACTIONS">Transaksi</option><option value="VISITS">Kunjungan</option></select></div><div class="custara-live-field"><label for="liveImportMode">Mode validasi</label><select class="wavr-select" id="liveImportMode"><option value="VALID_ROWS_ONLY">Import baris valid saja</option><option value="STRICT">Tahan jika ada error</option></select></div><div class="wavr-notice">${icon("shield", 16)}<span>Baris duplikat atau invalid akan ditahan untuk review sebelum commit.</span></div></form>`, `<button type="button" class="wavr-button" data-action="close-modal">Batal</button><button type="button" class="wavr-button primary" data-action="live-submit-import"><span data-icon-name="upload"></span>Validasi dan impor</button>`);
  }

  async function submitLiveImport() {
    const file = document.getElementById("liveImportFile")?.files?.[0];
    if (!file) { showToast("Pilih file CSV terlebih dahulu"); return; }
    const body = new FormData();
    body.append("file", file);
    body.append("type", document.getElementById("liveImportType").value);
    body.append("mode", document.getElementById("liveImportMode").value);
    try {
      const result = await apiRequest("/v1/imports", { method: "POST", headers: { "Idempotency-Key": `ui-import-${Date.now()}` }, body });
      const job = result.data;
      if (job.totals.invalid || job.totals.duplicate || job.totals.conflict) {
        closeModal();
        openModal("Impor perlu ditinjau", "API sudah memvalidasi file, tetapi sebagian baris belum aman untuk commit.", `<div class="wavr-health-list"><div class="wavr-health-row">${icon("file", 17)}<div><strong>${escapeHtml(job.filename)}</strong><span>${job.totals.valid} valid · ${job.totals.invalid} invalid · ${job.totals.duplicate} duplikat</span></div>${status("Ready")}</div></div>`, `<button type="button" class="wavr-button primary" data-action="close-modal">Tutup</button>`);
        return;
      }
      await apiRequest(`/v1/imports/${job.id}/commit`, { method: "POST", headers: { "Idempotency-Key": `ui-import-commit-${job.id}` }, body: JSON.stringify({}) });
      await loadLiveData();
      closeModal();
      navigate("transactions");
      showToast(`Impor ${job.filename} berhasil diproses`);
    } catch (caught) { showToast(caught.message || "Import CSV gagal"); }
  }

  async function refreshLive() {
    if (!state.live) return;
    try { await loadLiveData(); navigate(appState.page); showToast("Opportunity dan ringkasan berhasil diperbarui"); } catch (caught) { showToast(caught.message || "Data gagal diperbarui"); }
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-action], [data-page], [data-page-link]");
    if (!target || !state.live) return;
    const action = target.dataset.action;
    const page = target.dataset.page || target.dataset.pageLink;
    if (page) { event.preventDefault(); event.stopImmediatePropagation(); navigate(page); return; }
    if (["start-demo", "scan", "save-customer", "save-transaction", "import-csv", "view-customer", "open-segment", "open-live-opportunity", "live-mark-contacted", "live-resolve-identifier", "live-submit-import", "refresh-live"].includes(action)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (action === "start-demo") showToast("Keluar dari data nyata melalui tombol Keluar di kanan atas.");
    if (action === "scan") openLiveScanModal();
    if (action === "save-customer") void saveLiveCustomer();
    if (action === "save-transaction") void saveLiveTransaction();
    if (action === "import-csv") openLiveImportModal();
    if (action === "view-customer") void openLiveCustomer(target.dataset.customer);
    if (action === "open-segment") openLiveOpportunity(target.dataset.segment);
    if (action === "open-live-opportunity") openLiveOpportunity(target.dataset.opportunityType);
    if (action === "live-mark-contacted") void markOpportunityContacted(target.dataset.opportunityId);
    if (action === "live-resolve-identifier") void resolveLiveIdentifier();
    if (action === "live-submit-import") void submitLiveImport();
    if (action === "refresh-live") void refreshLive();
  }, true);

  async function boot() {
    installOverlay();
    installConnectionControls();
    try {
      await loadPublicConfig();
      const result = await state.supabase.auth.getSession();
      if (result.data.session) await activateLive(result.data.session);
      else showOverlay();
      state.supabase.auth.onAuthStateChange((_event, session) => {
        if (session && !state.live) window.setTimeout(() => void activateLive(session), 0);
      });
    } catch (caught) {
      state.configError = caught;
      setConnectionStatus("Mode demo · API belum siap", false);
      const note = document.getElementById("custaraLiveNote");
      if (note) note.textContent = `${caught.message} Jalankan API lalu refresh halaman untuk menghubungkan data nyata.`;
      showOverlay();
    }
  }

  window.CustaraLive = { refresh: refreshLive, signIn };
  void boot();
})();
