(function () {
  "use strict";

  const runtime = window.CUSTARA_RUNTIME || {};
  const apiBaseUrl = String(runtime.apiBaseUrl || "http://127.0.0.1:4000").replace(/\/$/, "");
  const clientMode = new URLSearchParams(window.location.search).get("mode") === "client";
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
    followUps: new Map(),
    customerTimelines: new Map(),
    customerFilters: { search: "", opportunity: "all", branch: "all", consent: "all" },
    profileRequest: null,
    connectionVersion: 0,
  };
  let importInFlight = false;
  let activationPromise = null;
  let dataLoadPromise = null;
  let sessionRefreshPromise = null;

  const liveRequestTimeoutMs = 8000;
  const liveAuthTimeoutMs = 12000;

  const opportunityLabels = {
    INACTIVE: "No return for 60+ days",
    FREQUENCY_DECLINE: "Visit frequency is declining",
    CROSS_SELL: "Next-service opportunity",
    NEAR_TIER: "Close to next tier",
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
    if (!value) return "No visit yet";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No visit yet";
    return new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function liveLabel(type) {
    return opportunityLabels[type] || uiLabel(type || "Growth opportunity");
  }

  function ensureLiveState() {
    appState.liveMode = state.live;
    appState.liveOpportunitySummary = state.opportunitySummary;
    appState.liveOpportunities = state.opportunities;
  }

  function mapCustomer(row) {
    const metrics = row.metrics || {};
    const opportunity = row.primary_opportunity;
    const homeBranch = row.home_branch || {};
    return {
      id: row.id,
      name: row.display_name || "Unnamed customer",
      phone: row.primary_phone || "No phone number",
      email: row.primary_email || "",
      initials: initials(row.display_name || "?") || "?",
      lastVisit: formatLiveDate(metrics.last_visit_at),
      visits: numeric(metrics.visit_count_90d || metrics.visit_count_30d),
      spend: numeric(metrics.lifetime_value?.amount),
      points: 0,
      tier: "Not configured",
      identifier: state.identifiers.get(row.id) || "Not linked",
      segment: opportunity ? liveLabel(opportunity.type) : "No active opportunity",
      consent: row.whatsapp_consent === true,
      branchId: homeBranch.id || "",
      branchName: homeBranch.name || homeBranch.code || "Not assigned",
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

  function fetchWithTimeout(url, options = {}, timeoutMs = liveRequestTimeoutMs) {
    const controller = new AbortController();
    const upstreamSignal = options.signal;
    const abortFromUpstream = () => controller.abort();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    if (upstreamSignal) {
      if (upstreamSignal.aborted) controller.abort();
      else upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
    return fetch(url, { ...options, signal: controller.signal }).finally(() => {
      window.clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    });
  }

  function withTimeout(promise, timeoutMs, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
  }

  async function loadPublicConfig() {
    let response;
    try {
      response = await fetchWithTimeout(`${apiBaseUrl}/public-config`, { headers: { Accept: "application/json" } });
    } catch (caught) {
      const error = new Error("API Custara belum merespons. Pastikan server runtime aktif lalu coba lagi.");
      error.cause = caught;
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.supabase_url || !payload.supabase_publishable_key) {
      throw new Error("Konfigurasi Supabase untuk browser belum tersedia di API.");
    }
    if (!window.supabase?.createClient) throw new Error("Library Supabase belum termuat. Periksa koneksi internet browser.");
    state.supabase = window.supabase.createClient(payload.supabase_url, payload.supabase_publishable_key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function refreshAuthSession() {
    if (!state.supabase) return null;
    if (sessionRefreshPromise) return sessionRefreshPromise;
    sessionRefreshPromise = state.supabase.auth.refreshSession().then((result) => {
      if (result.error) throw result.error;
      const session = result.data?.session || null;
      if (session) state.session = session;
      return session;
    }).finally(() => {
      sessionRefreshPromise = null;
    });
    return sessionRefreshPromise;
  }

  function clearLiveData() {
    state.me = null;
    state.branchId = null;
    state.opportunitySummary = [];
    state.opportunities = [];
    state.followUps.clear();
    state.customerTimelines.clear();
    appState.customers = [];
    appState.transactions = [];
    appState.visits = [];
    appState.campaigns = [];
    appState.campaignMetrics = { sent: 0, returned: 0, attributedRevenue: 0, conversion: 0 };
  }

  function handleSessionLost(message) {
    state.connectionVersion += 1;
    state.session = null;
    state.live = false;
    clearLiveData();
    setConnectionStatus("Login diperlukan", false);
    showOverlay(message || "Sesi Supabase sudah berakhir. Silakan masuk kembali.");
  }

  async function apiRequest(path, options = {}, allowSessionRefresh = true, attempt = 0) {
    if (!state.session?.access_token) throw new Error("Sesi login belum tersedia.");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${state.session.access_token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (state.branchId && !headers.has("X-Branch-Id")) headers.set("X-Branch-Id", state.branchId);
    const requestMethod = String(options.method || "GET").toUpperCase();
    let response;
    try {
      response = await fetchWithTimeout(`${apiBaseUrl}${path}`, { ...options, headers });
    } catch (caught) {
      const timedOut = caught?.name === "AbortError";
      if (!timedOut && attempt < 1 && !options.signal?.aborted && ["GET", "HEAD"].includes(requestMethod)) {
        await wait(300);
        return apiRequest(path, options, allowSessionRefresh, attempt + 1);
      }
      const error = new Error(timedOut
        ? "API Custara terlalu lama merespons. Coba perbarui halaman setelah server kembali siap."
        : "API Custara tidak dapat dijangkau. Periksa server runtime dan koneksi jaringan.");
      error.cause = caught;
      throw error;
    }
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { detail: text }; }
    if (!response.ok) {
      const error = new Error(payload.detail || payload.title || payload.message || `Permintaan gagal (${response.status}).`);
      error.payload = payload;
      error.status = response.status;
      if (response.status === 401 && allowSessionRefresh && state.supabase) {
        try {
          const refreshed = await refreshAuthSession();
          if (refreshed) {
            return apiRequest(path, options, false, attempt);
          }
        } catch {
          // Fall through to the session recovery screen below.
        }
        handleSessionLost("Sesi Supabase sudah kedaluwarsa. Silakan masuk kembali agar data dapat dimuat.");
      }
      if (response.status >= 500 && response.status < 600 && attempt < 1 && ["GET", "HEAD"].includes(requestMethod)) {
        await wait(300);
        return apiRequest(path, options, allowSessionRefresh, attempt + 1);
      }
      throw error;
    }
    return payload;
  }

  async function loadLiveData(force = false) {
    if (dataLoadPromise && !force) return dataLoadPromise;
    const version = state.connectionVersion;
    const task = (async () => {
      setConnectionStatus("Memuat data...", Boolean(state.session));
      try {
        const [meResponse, customerResponse, transactionResponse, summaryResponse, opportunityResponse] = await Promise.all([
          apiRequest("/v1/me"),
          apiRequest("/v1/customers?limit=100"),
          apiRequest("/v1/transactions?limit=100"),
          apiRequest("/v1/opportunities/summary"),
          apiRequest("/v1/opportunities?limit=100"),
        ]);
        if (version !== state.connectionVersion || !state.session) throw new Error("Sesi berubah saat data sedang dimuat. Silakan coba lagi.");
        state.me = meResponse.data;
        state.branchId = state.me.branches?.[0]?.id || null;
        state.opportunitySummary = summaryResponse.data || [];
        state.opportunities = opportunityResponse.data || [];
        state.opportunities.forEach((opportunity) => {
          if (opportunity.last_action) state.followUps.set(opportunity.id, opportunity.last_action);
        });
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
      } finally {
        if (state.live) setConnectionStatus("Data nyata terhubung", true);
      }
    })();
    dataLoadPromise = task;
    try {
      await task;
    } finally {
      if (dataLoadPromise === task) dataLoadPromise = null;
    }
  }

  function updateWorkspaceIdentity() {
    const user = state.me?.user;
    const branch = state.me?.branches?.[0];
    const userName = user?.name || user?.email || "Owner";
    const branchName = branch ? `${branch.name} · ${branch.code}` : "All branches";
    document.querySelectorAll(".wavr-user strong, .wavr-top-avatar strong").forEach((element) => { element.textContent = userName; });
    document.querySelectorAll(".wavr-user span, .wavr-top-avatar span").forEach((element) => { element.textContent = state.me?.role?.name || "Owner / Admin"; });
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
            <div class="custara-live-actions"><button class="wavr-button primary" type="submit" id="custaraLiveSubmit">Masuk ke workspace</button></div>
          </form>
          <p class="custara-live-note" id="custaraLiveNote">Data demo tetap tersedia jika kamu ingin menjelajahi UI tanpa login.</p>
        </section>
      </div>`);
    window.localizeCustaraUi?.(document.getElementById("custaraLiveOverlay"));
    document.getElementById("custaraLiveLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await signIn();
    });
  }

  function installConnectionControls() {
    const actions = document.querySelector(".wavr-topbar-actions");
    if (!actions || document.getElementById("custaraLiveStatus")) return;
    actions.insertAdjacentHTML("afterbegin", `<span class="custara-live-status" id="custaraLiveStatus">Connecting</span><button class="custara-live-logout" id="custaraLiveLogout" type="button" hidden>Sign out</button>`);
    document.getElementById("custaraLiveLogout").addEventListener("click", async () => {
      await state.supabase?.auth.signOut();
      window.location.reload();
    });
  }

  function setConnectionStatus(text, connected) {
    const element = document.getElementById("custaraLiveStatus");
    const logout = document.getElementById("custaraLiveLogout");
    const displayText = window.translateCustaraText ? window.translateCustaraText(text) : text;
    if (element) {
      element.textContent = displayText;
      element.classList.toggle("is-live", connected);
      element.classList.toggle("is-loading", /Loading|Refreshing|Saving|Processing|Connecting|Memuat|Memperbarui|Menyimpan|Memproses|Menghubungkan/.test(displayText));
      element.setAttribute("aria-busy", String(/Loading|Refreshing|Saving|Processing|Connecting|Memuat|Memperbarui|Menyimpan|Memproses|Menghubungkan/.test(displayText)));
    }
    if (logout) logout.hidden = !connected;
  }

  function setButtonBusy(button, label) {
    if (!button) return () => undefined;
    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="custara-live-spinner" aria-hidden="true"></span>${escapeHtml(label)}`;
    return () => {
      if (!button.isConnected) return;
      button.disabled = false;
      button.classList.remove("is-loading");
      button.removeAttribute("aria-busy");
      button.innerHTML = originalHtml;
      hydrateIcons();
    };
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
    if (!state.supabase?.auth) {
      error.textContent = "Custara API is not connected yet. Start the API, then reload this page.";
      error.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "Connecting...";
    error.hidden = true;
    try {
      const result = await withTimeout(
        state.supabase.auth.signInWithPassword({ email, password }),
        liveAuthTimeoutMs,
        "Supabase terlalu lama memproses login. Coba lagi setelah koneksi kembali stabil.",
      );
      if (result.error) throw result.error;
      await activateLive(result.data.session);
    } catch (caught) {
      error.textContent = caught.message || "Login gagal. Periksa email dan password Supabase Auth.";
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = "Sign in to workspace";
    }
  }

  async function activateLive(session) {
    if (!session?.access_token) return;
    const incomingUserId = session.user?.id || session.user?.email || "";
    const currentUserId = state.session?.user?.id || state.session?.user?.email || "";
    if (state.live && incomingUserId && incomingUserId === currentUserId) {
      state.session = session;
      return;
    }
    if (activationPromise) {
      await activationPromise;
      return;
    }
    const version = state.connectionVersion + 1;
    state.connectionVersion = version;
    activationPromise = (async () => {
      state.session = session;
      state.live = false;
      setConnectionStatus("Mengambil data...", true);
      try {
        await loadLiveData(true);
        if (version !== state.connectionVersion) return;
        state.live = true;
        ensureLiveState();
        hideOverlay();
        setConnectionStatus("Data nyata terhubung", true);
        navigate(appState.page || "overview");
        showToast("Workspace Custara terhubung ke Supabase");
      } catch (caught) {
        if (version !== state.connectionVersion) return;
        state.live = false;
        setConnectionStatus("Login belum terhubung", false);
        showOverlay(caught.message || "Data workspace belum dapat dimuat.");
      }
    })();
    try {
      await activationPromise;
    } finally {
      activationPromise = null;
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
      const opportunityType = escapeHtml(item.type);
      return `<article class="wavr-segment-card" data-action="live-browse-opportunity" data-opportunity-type="${opportunityType}" role="link" tabindex="0" aria-label="Lihat customer ${escapeHtml(liveLabel(item.type))}"><span class="wavr-segment-index">${String(index + 1).padStart(2, "0")}</span><div class="wavr-segment-icon" style="background:${colors[0]};color:${colors[1]}">${icon(opportunityIcons[item.type] || "spark", 17)}</div><h3>${escapeHtml(liveLabel(item.type))}</h3><p>Customer yang menunjukkan pola ini dan bisa segera ditindaklanjuti.</p><div class="wavr-segment-meta"><div><strong>${numeric(item.customer_count)}</strong><span> customer</span></div><span>${formatIDR(numeric(item.estimated_value?.amount))} potensi</span></div><button type="button" class="wavr-link-button wavr-segment-link" data-action="live-browse-opportunity" data-opportunity-type="${opportunityType}">Lihat customer ${icon("arrow", 12)}</button></article>`;
    }).join("") || `<div class="custara-live-empty">Belum ada customer yang masuk ke peluang. Tambahkan data customer dan transaksi, lalu klik perbarui.</div>`;
    const body = `<section class="wavr-panel"><div class="wavr-panel-head"><div><h2>Peluang berdasarkan perilaku</h2><p>Daftar customer yang sedang punya peluang untuk ditindaklanjuti.</p></div><span class="wavr-status success">Terhubung ke data</span></div><div class="wavr-segment-grid">${cards}</div></section>`;
    return renderShellPage("Peluang", "Temukan customer yang paling siap diajak kembali.", actions, body);
  }

  function liveOpportunityForCustomer(customer, type = "all") {
    return state.opportunities.find((opportunity) => opportunity.customer?.id === customer.id && (type === "all" || opportunity.type === type)) || null;
  }

  function liveActionForOpportunity(opportunity) {
    return opportunity ? (state.followUps.get(opportunity.id) || opportunity.last_action || null) : null;
  }

  function liveFollowUpStatus(opportunity) {
    const action = liveActionForOpportunity(opportunity);
    if (!action) return status("Belum dihubungi");
    if (action.type === "WHATSAPP_MARKED_CONTACTED" || action.status === "MARKED_CONTACTED") return status("Sudah dihubungi");
    if (action.type === "WHATSAPP_OPENED" || action.status === "OPENED") return status("WhatsApp dibuka");
    return status("Tindak lanjut tersimpan");
  }

  function liveWhatsappNumber(phone) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
    return digits;
  }

  function liveWhatsappUrl(customer) {
    const number = liveWhatsappNumber(customer.phone);
    if (!number || number.length < 8 || customer.phone === "Nomor belum tersedia") return "";
    const message = `Halo ${customer.name}, kami dari ${state.me?.organization?.name || "Custara"}. Ada kabar untuk kunjungan Anda berikutnya.`;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  }

  function filteredLiveCustomers(opportunityOverride = null) {
    const filters = { ...state.customerFilters };
    if (opportunityOverride) filters.opportunity = opportunityOverride;
    const query = String(filters.search || "").trim().toLowerCase();
    return appState.customers.filter((customer) => {
      const opportunity = liveOpportunityForCustomer(customer, filters.opportunity);
      const searchable = [customer.name, customer.phone, customer.identifier, customer.branchName, customer.segment, opportunity?.reason_text].join(" ").toLowerCase();
      const matchesSearch = !query || searchable.includes(query);
      const matchesOpportunity = filters.opportunity === "all" || Boolean(opportunity);
      const matchesBranch = filters.branch === "all" || customer.branchId === filters.branch;
      const matchesConsent = filters.consent === "all" || (filters.consent === "granted" ? customer.consent : !customer.consent);
      return matchesSearch && matchesOpportunity && matchesBranch && matchesConsent;
    });
  }

  function liveCustomerTableMarkup(customers) {
    const rows = customers.map((customer) => {
      const opportunity = liveOpportunityForCustomer(customer, state.customerFilters.opportunity);
      const whatsappUrl = opportunity && customer.consent ? liveWhatsappUrl(customer) : "";
      const followUp = liveActionForOpportunity(opportunity);
      const isContacted = followUp?.type === "WHATSAPP_MARKED_CONTACTED" || followUp?.status === "MARKED_CONTACTED";
      const actionButtons = [
        `<button type="button" class="wavr-button small" data-action="view-customer" data-customer="${escapeHtml(customer.id)}">Lihat detail ${icon("arrow", 12)}</button>`,
        whatsappUrl ? `<a class="wavr-button small custara-live-whatsapp" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noreferrer" data-action="live-open-whatsapp" data-opportunity-id="${escapeHtml(opportunity.id)}">WhatsApp</a>` : "",
        opportunity && !isContacted ? `<button type="button" class="wavr-button small" data-action="live-mark-contacted" data-opportunity-id="${escapeHtml(opportunity.id)}">Tandai dihubungi</button>` : "",
      ].filter(Boolean).join("");
      return `<tr><td><div class="wavr-table-person">${avatar(customer)}<div><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.phone)}</span></div></div></td><td>${opportunity ? `<strong>${escapeHtml(liveLabel(opportunity.type))}</strong><span class="wavr-text-muted" style="display:block;margin-top:3px">${escapeHtml(opportunity.reason_text || "Customer perlu ditindaklanjuti")}</span>` : `<span class="wavr-text-muted">Belum ada peluang</span>`}</td><td class="wavr-text-soft">${escapeHtml(customer.branchName)}</td><td>${customer.consent ? status("Boleh dihubungi") : status("Belum ada izin WhatsApp")}</td><td>${liveFollowUpStatus(opportunity)}</td><td><div class="custara-live-row-actions">${actionButtons}</div></td></tr>`;
    }).join("");
    return `<div class="wavr-table-wrap"><table class="wavr-data-table"><thead><tr><th>Pelanggan</th><th>Peluang utama</th><th>Cabang</th><th>Izin WhatsApp</th><th>Tindak lanjut</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="6"><div class="wavr-empty">${icon("search", 30)}<strong>Belum ada customer yang cocok</strong>Coba ubah kata pencarian atau filter.</div></td></tr>`}</tbody></table></div>`;
  }

  function updateLiveCustomerTable() {
    const tableRoot = document.getElementById("liveCustomerTable");
    if (!tableRoot) return;
    const customers = filteredLiveCustomers();
    tableRoot.innerHTML = liveCustomerTableMarkup(customers);
    const count = document.getElementById("liveCustomerCount");
    if (count) count.textContent = `${customers.length} customer`;
    const note = document.getElementById("liveCustomerResultNote");
    if (note) note.textContent = `${customers.length} dari ${appState.customers.length} customer sesuai filter saat ini.`;
    hydrateIcons();
    window.localizeCustaraUi?.(tableRoot);
  }

  function renderLiveCustomers() {
    const branches = state.me?.branches || [];
    const opportunityTypes = state.opportunitySummary.map((item) => item.type);
    if (state.customerFilters.opportunity !== "all" && !opportunityTypes.includes(state.customerFilters.opportunity)) opportunityTypes.push(state.customerFilters.opportunity);
    const opportunityOptions = [`<option value="all"${state.customerFilters.opportunity === "all" ? " selected" : ""}>Semua opportunity</option>`, ...opportunityTypes.map((type) => `<option value="${escapeHtml(type)}"${state.customerFilters.opportunity === type ? " selected" : ""}>${escapeHtml(liveLabel(type))}</option>`)].join("");
    const branchOptions = [`<option value="all"${state.customerFilters.branch === "all" ? " selected" : ""}>Semua cabang</option>`, ...branches.map((branch) => `<option value="${escapeHtml(branch.id)}"${state.customerFilters.branch === branch.id ? " selected" : ""}>${escapeHtml(branch.name || branch.code || "Cabang")}</option>`)].join("");
    const actions = `<button type="button" class="wavr-button" data-action="scan"><span data-icon-name="scan"></span>Pindai ID</button><button type="button" class="wavr-button" data-action="import-csv"><span data-icon-name="upload"></span>Impor data</button><button type="button" class="wavr-button primary" data-action="live-export-audience"><span data-icon-name="upload"></span>Unduh daftar</button>`;
    const filterControls = `<div class="custara-live-filter-grid"><div class="custara-live-filter-field custara-live-filter-search"><label for="liveCustomerSearch">Cari customer</label><div class="wavr-search-input">${icon("search", 16)}<input class="wavr-input" id="liveCustomerSearch" data-live-customer-filter="search" type="search" value="${escapeHtml(state.customerFilters.search)}" placeholder="Nama, nomor, atau ID pengenal" autocomplete="off" /></div></div><div class="custara-live-filter-field"><label for="liveCustomerOpportunity">Peluang</label><select class="wavr-select" id="liveCustomerOpportunity" data-live-customer-filter="opportunity" aria-label="Filter peluang">${opportunityOptions}</select></div><div class="custara-live-filter-field"><label for="liveCustomerBranch">Cabang</label><select class="wavr-select" id="liveCustomerBranch" data-live-customer-filter="branch" aria-label="Filter cabang">${branchOptions}</select></div><div class="custara-live-filter-field"><label for="liveCustomerConsent">Boleh dihubungi lewat WhatsApp</label><select class="wavr-select" id="liveCustomerConsent" data-live-customer-filter="consent" aria-label="Filter izin WhatsApp"><option value="all"${state.customerFilters.consent === "all" ? " selected" : ""}>Semua customer</option><option value="granted"${state.customerFilters.consent === "granted" ? " selected" : ""}>Boleh dihubungi</option><option value="not_granted"${state.customerFilters.consent === "not_granted" ? " selected" : ""}>Belum ada izin</option></select></div></div>`;
    const body = `<section class="wavr-panel"><div class="wavr-panel-head"><div><h2>Daftar customer <span class="wavr-text-muted" id="liveCustomerCount">${appState.customers.length} customer</span></h2><p>Pilih peluang dan cabang untuk menentukan siapa yang perlu ditindaklanjuti.</p></div><span class="wavr-status success">Terhubung ke data</span></div>${filterControls}<div class="custara-live-filter-summary"><span id="liveCustomerResultNote">${appState.customers.length} dari ${appState.customers.length} customer sesuai filter.</span><span>Link WhatsApp hanya muncul untuk customer yang memberi izin.</span></div><div id="liveCustomerTable">${liveCustomerTableMarkup(filteredLiveCustomers())}</div></section>`;
    return renderShellPage("Pelanggan", "Cari dan tindak lanjuti customer dari satu tempat.", actions, body);
  }

  function renderLiveTransactions() {
    const actions = `<button type="button" class="wavr-button" data-action="import-csv"><span data-icon-name="upload"></span>Impor CSV</button><button type="button" class="wavr-button primary" data-action="add-transaction"><span data-icon-name="plus"></span>Tambah transaksi</button>`;
    const rows = appState.transactions.map((transaction) => transactionRow(transaction)).join("") || `<tr><td colspan="5"><div class="custara-live-empty">Belum ada transaksi pada tenant ini.</div></td></tr>`;
    const body = `<section class="wavr-notice">${icon("shield", 16)}<span>Transaksi yang dibuat setelah opportunity dibuka dapat dipakai untuk mencatat customer kembali. Data tetap disimpan di Supabase dan otomatis membuat kunjungan turunan bila diperlukan.</span></section><section class="wavr-panel"><div class="wavr-panel-head"><div><h2>Log transaksi <span class="wavr-text-muted">Â· ${appState.transactions.length} data</span></h2><p>Setiap transaksi terhubung ke customer, cabang, dan layanan yang dibeli.</p></div><span class="wavr-status success">Data nyata</span></div><div class="wavr-table-wrap"><table class="wavr-data-table"><thead><tr><th>Pelanggan</th><th>Aktivitas</th><th>Sumber</th><th>Status</th><th class="wavr-text-right">Nilai</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    return renderShellPage("Transaksi", "Catat kunjungan dan pendapatan tanpa kehilangan sumber kebenaran.", actions, body);
  }

  function renderLiveCampaigns() {
    const audienceCount = state.opportunitySummary.reduce((sum, item) => sum + numeric(item.customer_count), 0);
    const consentCount = appState.customers.filter((customer) => customer.consent).length;
    const actionCount = [...state.followUps.values()].length;
    const actions = `<button type="button" class="wavr-button" data-action="refresh-live"><span data-icon-name="clock"></span>Perbarui data</button><button type="button" class="wavr-button primary" data-page-link="customers"><span data-icon-name="users"></span>Buka daftar customer</button>`;
    const rows = state.opportunitySummary.map((item) => `<tr><td><strong>${escapeHtml(liveLabel(item.type))}</strong><span class="wavr-text-muted" style="display:block;margin-top:3px">Audiens dari aturan customer yang sedang aktif</span></td><td>${numeric(item.customer_count)} customer</td><td><span class="wavr-chip neutral">WhatsApp / tugas</span></td><td>${status("Ready")}</td><td><div class="custara-live-row-actions"><button type="button" class="wavr-button small" data-action="open-live-opportunity" data-opportunity-type="${escapeHtml(item.type)}">Lihat audiens</button><button type="button" class="wavr-button small" data-action="live-export-audience" data-opportunity-type="${escapeHtml(item.type)}">Ekspor</button></div></td></tr>`).join("") || `<tr><td colspan="5"><div class="custara-live-empty">Belum ada opportunity aktif. Masukkan customer dan transaksi, lalu perbarui data.</div></td></tr>`;
    const body = `<section class="wavr-kpi-grid" aria-label="Ringkasan kampanye live"><article class="wavr-kpi"><div class="wavr-kpi-top"><span>Audiens siap ditindaklanjuti</span><span class="wavr-kpi-icon blue">${icon("users", 16)}</span></div><div class="wavr-kpi-value">${audienceCount}</div><div class="wavr-kpi-foot"><span>Dari opportunity aktif</span></div></article><article class="wavr-kpi"><div class="wavr-kpi-top"><span>Persetujuan WhatsApp</span><span class="wavr-kpi-icon teal">${icon("message", 16)}</span></div><div class="wavr-kpi-value">${consentCount}</div><div class="wavr-kpi-foot"><span>Customer yang dapat dibuka di WhatsApp</span></div></article><article class="wavr-kpi"><div class="wavr-kpi-top"><span>Aksi tersimpan</span><span class="wavr-kpi-icon purple">${icon("check-circle", 16)}</span></div><div class="wavr-kpi-value">${actionCount}</div><div class="wavr-kpi-foot"><span>Riwayat follow-up di tenant</span></div></article><article class="wavr-kpi"><div class="wavr-kpi-top"><span>Mode pengiriman</span><span class="wavr-kpi-icon orange">${icon("shield", 16)}</span></div><div class="wavr-kpi-value" style="font-size:18px">Manual / tugas</div><div class="wavr-kpi-foot"><span>Pengiriman otomatis belum diaktifkan</span></div></article></section><section class="wavr-panel"><div class="wavr-notice">${icon("message", 16)}<span>Kampanye live V1 menyiapkan audiens yang bisa ditinjau, diekspor, atau ditindaklanjuti lewat WhatsApp. Semua action dan hasil customer tetap tercatat di Custara.</span></div><div class="wavr-panel-head"><div><h2>Audiens kampanye</h2><p>Gunakan opportunity sebagai dasar daftar follow-up yang jelas dan dapat diukur.</p></div><span class="wavr-status success">Data nyata</span></div><div class="wavr-table-wrap"><table class="wavr-data-table"><thead><tr><th>Opportunity</th><th>Audiens</th><th>Saluran</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    return renderShellPage("Kampanye", "Siapkan audiens dan tindak lanjut dari data customer yang terhubung.", actions, body);
  }

  function renderLivePlaceholder(page) {
    const content = {
      loyalty: ["Loyalitas", "Atur poin dan benefit agar customer punya alasan untuk kembali.", "Fitur loyalitas belum diaktifkan untuk workspace ini."],
      campaigns: ["Kampanye", "Gunakan daftar customer dari peluang untuk membuat tugas follow-up yang jelas.", "Belum ada kampanye tersimpan."],
      settings: ["Pengaturan", "Atur workspace, cabang, dan akses tim dari sini.", "Pengaturan lanjutan akan tersedia setelah kebutuhan pilot ditetapkan."],
    }[page] || ["Custara", "Fitur ini belum tersedia pada koneksi data saat ini.", "Belum ada data untuk ditampilkan."];
    const body = `<section class="wavr-panel"><div class="wavr-panel-head"><div><h2>${content[0]}</h2><p>${content[1]}</p></div><span class="wavr-status neutral">Tahap berikutnya</span></div><div class="custara-live-empty">${content[2]}<br /><button type="button" class="wavr-link-button" data-page-link="overview">Kembali ke ikhtisar ${icon("arrow", 13)}</button></div></section>`;
    return renderShellPage(content[0], content[1], "", body);
  }

  function syncLiveNavigation(page) {
    const labels = { overview: "Overview", customers: "Customers", transactions: "Transactions", loyalty: "Loyalty", segments: "Opportunities", campaigns: "Campaigns", settings: "Settings" };
    const pageRoot = document.getElementById("pageRoot");
    if (pageRoot) pageRoot.dataset.page = page;
    const breadcrumb = document.getElementById("breadcrumbCurrent");
    if (breadcrumb) breadcrumb.textContent = labels[page] || page;
    document.querySelectorAll("#mainNav button[data-page]").forEach((button) => button.classList.toggle("is-active", button.dataset.page === page));
  }

  function navigate(page) {
    if (!state.live) { renderPage(page); return; }
    const pageRoot = document.getElementById("pageRoot");
    if (!pageRoot) return;
    appState.page = page;
    if (page === "overview") pageRoot.innerHTML = renderLiveOverview();
    else if (page === "customers") pageRoot.innerHTML = renderLiveCustomers();
    else if (page === "transactions") pageRoot.innerHTML = renderLiveTransactions();
    else if (page === "segments") pageRoot.innerHTML = renderLiveSegments();
    else if (page === "campaigns") pageRoot.innerHTML = renderLiveCampaigns();
    else if (["loyalty", "settings"].includes(page)) pageRoot.innerHTML = renderLivePlaceholder(page);
    else { renderPage(page); return; }
    syncLiveNavigation(page);
    hydrateIcons();
    window.localizeCustaraUi?.(pageRoot);
    if (page === "customers") bindLiveCustomerFilters();
  }

  function handleLiveCustomerFilter(event) {
    const control = event.currentTarget;
    if (!control?.dataset.liveCustomerFilter) return;
    state.customerFilters[control.dataset.liveCustomerFilter] = control.value;
    updateLiveCustomerTable();
  }

  function bindLiveCustomerFilters() {
    document.querySelectorAll("#pageRoot [data-live-customer-filter]").forEach((control) => {
      control.addEventListener("input", handleLiveCustomerFilter);
      control.addEventListener("change", handleLiveCustomerFilter);
    });
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

  function liveTimelineEventLabel(event) {
    const labels = {
      WHATSAPP_OPENED: "Link WhatsApp dibuka",
      WHATSAPP_MARKED_CONTACTED: "Customer ditandai sudah dihubungi",
      STAFF_FOLLOW_UP: "Follow-up manual dicatat",
      PHONE_CALL: "Panggilan telepon dicatat",
      OFFER_RECORDED: "Penawaran dicatat",
      CAMPAIGN_TOUCH: "Kontak kampanye dicatat",
      RETURN_AFTER_ACTION: "Customer kembali setelah ditindaklanjuti",
      ORGANIC_RETURN: "Customer kembali secara organik",
    };
    return labels[event.title] || labels[event.type] || "Aktivitas customer tercatat";
  }

  function liveTimelineMarkup(timeline) {
    if (timeline === null) return `<div class="custara-live-empty">Memuat riwayat follow-up...</div>`;
    const events = (Array.isArray(timeline) ? timeline : []).filter((event) => ["ACTION", "OUTCOME"].includes(event.type)).slice(0, 8);
    if (!events.length) return `<div class="custara-live-empty">Belum ada aktivitas yang tersimpan.</div>`;
    return `<div class="wavr-health-list">${events.map((event) => `<div class="wavr-health-row">${icon(event.type === "OUTCOME" ? "check-circle" : "message", 17)}<div><strong>${escapeHtml(liveTimelineEventLabel(event))}</strong><span>${escapeHtml(formatLiveDate(event.occurred_at))}${event.description ? ` · ${escapeHtml(uiLabel(event.description))}` : ""}</span></div>${status(event.type === "OUTCOME" ? "Hasil tercatat" : "Tersimpan")}</div>`).join("")}</div>`;
  }

  function mountLiveTimeline(timeline) {
    const body = document.getElementById("modalBody");
    if (!body) return;
    const section = body.querySelector("[data-live-timeline]");
    const markup = `<h4>Riwayat follow-up</h4>${liveTimelineMarkup(timeline)}`;
    if (section) section.innerHTML = markup;
    else body.insertAdjacentHTML("beforeend", `<div class="wavr-profile-section" data-live-timeline>${markup}</div>`);
    hydrateIcons();
    window.localizeCustaraUi?.(body);
  }

  function liveCustomerProfileMarkup(customer, detail = null, timeline = null) {
    const identifier = detail?.identifiers?.[0]?.display_code || customer.identifier || "Belum ditautkan";
    const consentGranted = detail ? detail.consent?.some((item) => item.purpose === "MARKETING" && item.channel === "WHATSAPP" && item.status === "GRANTED") : customer.consent;
    const opportunity = liveOpportunityForCustomer(customer);
    const whatsappUrl = consentGranted ? liveWhatsappUrl(customer) : "";
    const followUp = liveActionForOpportunity(opportunity);
    const serviceRows = appState.transactions.filter((tx) => tx.customerId === customer.id).slice(0, 5).map((tx) => `<tr><td>${escapeHtml(tx.service)}</td><td class="wavr-text-muted">${escapeHtml(tx.date)}</td><td class="wavr-text-right">${formatIDR(tx.amount)}</td></tr>`).join("") || `<tr><td colspan="3" class="wavr-text-muted">Belum ada transaksi tercatat.</td></tr>`;
    const actionRows = followUp ? `<div class="wavr-health-row">${icon("check-circle", 17)}<div><strong>${followUp.type === "WHATSAPP_MARKED_CONTACTED" ? "Customer sudah dihubungi" : "WhatsApp sudah dibuka"}</strong><span>${escapeHtml(followUp.performed_at || followUp.created_at || "Tersimpan")}</span></div>${status("Tersimpan")}</div>` : `<div class="wavr-health-row">${icon("clock", 17)}<div><strong>Belum ada tindak lanjut</strong><span>Buka WhatsApp atau tandai setelah selesai menghubungi.</span></div>${status("Belum dimulai")}</div>`;
    const opportunityActions = opportunity ? `<div class="wavr-profile-section"><h4>Langkah berikutnya</h4><div class="wavr-health-list">${actionRows}</div><div class="custara-live-profile-actions">${whatsappUrl ? `<a class="wavr-button small custara-live-whatsapp" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noreferrer" data-action="live-open-whatsapp" data-opportunity-id="${escapeHtml(opportunity.id)}">Buka WhatsApp</a>` : `<span class="wavr-text-muted">Customer belum memberi izin untuk dihubungi lewat WhatsApp.</span>`}${!followUp || followUp.type !== "WHATSAPP_MARKED_CONTACTED" ? `<button type="button" class="wavr-button small" data-action="live-mark-contacted" data-opportunity-id="${escapeHtml(opportunity.id)}">Tandai sudah dihubungi</button>` : ""}<button type="button" class="wavr-button small" data-action="live-record-outcome" data-opportunity-id="${escapeHtml(opportunity.id)}">Catat hasil kunjungan</button><button type="button" class="wavr-button small" data-action="live-dismiss-opportunity" data-opportunity-id="${escapeHtml(opportunity.id)}">Tutup peluang</button></div></div>` : "";
    return `<div class="wavr-profile-hero">${avatar(customer)}<div><h3>${escapeHtml(customer.name)}</h3><p>${escapeHtml(customer.phone)} · ${consentGranted ? "Boleh dihubungi lewat WhatsApp" : "Belum ada izin WhatsApp"}</p></div><span class="wavr-profile-status">${consentGranted ? status("Boleh dihubungi") : status("Belum ada izin")}</span></div><div class="wavr-profile-stats"><div class="wavr-profile-stat"><strong>${customer.visits}</strong><span>Kunjungan 90 hari</span></div><div class="wavr-profile-stat"><strong>${formatIDR(customer.spend)}</strong><span>Total belanja</span></div><div class="wavr-profile-stat"><strong>${escapeHtml(customer.tier)}</strong><span>Level loyalitas</span></div><div class="wavr-profile-stat"><strong>${escapeHtml(customer.segment)}</strong><span>Peluang utama</span></div></div><div class="wavr-profile-section"><h4>Identitas dan cabang</h4><div class="wavr-chip-row"><span class="wavr-chip">${escapeHtml(identifier)}</span><span class="wavr-chip neutral">${escapeHtml(customer.branchName)}</span></div></div>${opportunityActions}<div class="wavr-profile-section"><h4>Layanan terakhir</h4><div class="wavr-table-wrap"><table class="wavr-data-table"><tbody>${serviceRows}</tbody></table></div></div>`;
  }

  async function openLiveCustomer(customerId) {
    const cachedCustomer = customerById(customerId);
    if (!cachedCustomer) return;
    const requestToken = `${customerId}-${Date.now()}`;
    state.profileRequest = requestToken;
    const timelinePromise = state.customerTimelines.has(customerId)
      ? Promise.resolve(state.customerTimelines.get(customerId))
      : apiRequest(`/v1/customers/${customerId}/timeline?limit=25`).then((timelineResult) => {
        const events = Array.isArray(timelineResult.data) ? timelineResult.data : [];
        state.customerTimelines.set(customerId, events);
        return events;
      }).catch((timelineError) => {
        console.warn("Riwayat customer belum termuat:", timelineError);
        return [];
      });
    openModal(cachedCustomer.name, `${cachedCustomer.identifier} · Profil customer`, liveCustomerProfileMarkup(cachedCustomer), `<button type="button" class="wavr-button" data-action="close-modal">Tutup</button>`);
    try {
      mountLiveTimeline(null);
      const result = await apiRequest(`/v1/customers/${customerId}`);
      if (state.profileRequest !== requestToken || document.getElementById("modalBackdrop")?.hidden) return;
      const detail = result.data;
      const timeline = await timelinePromise;
      if (state.profileRequest !== requestToken || document.getElementById("modalBackdrop")?.hidden) return;
      const customer = mapCustomer(detail);
      customer.identifier = detail.identifiers?.[0]?.display_code || "Belum ditautkan";
      state.identifiers.set(customer.id, customer.identifier);
      document.getElementById("modalTitle").textContent = customer.name;
      document.getElementById("modalSubtitle").textContent = `${customer.identifier} · Profil customer`;
      document.getElementById("modalBody").innerHTML = liveCustomerProfileMarkup(customer, detail, timeline);
      window.localizeCustaraUi?.(document.getElementById("modalBackdrop"));
      mountLiveTimeline(timeline);
    } catch (caught) {
      if (state.profileRequest === requestToken) console.warn("Detail profil customer belum termuat:", caught);
    }
  }

  function liveOpportunityCustomer(item) {
    return customerById(item.customer?.id) || mapCustomer(item.customer || {});
  }

  function openLiveOpportunity(type) {
    const rows = state.opportunities.filter((item) => item.type === type);
    const tableRows = rows.map((item) => {
      const customer = liveOpportunityCustomer(item);
      const whatsappUrl = customer.consent ? liveWhatsappUrl(customer) : "";
      const followUp = liveActionForOpportunity(item);
      const isContacted = followUp?.type === "WHATSAPP_MARKED_CONTACTED" || followUp?.status === "MARKED_CONTACTED";
      const hasTransactions = liveOutcomeTransactions(item).length > 0;
      const actions = [
        whatsappUrl ? `<a class="wavr-button small custara-live-whatsapp" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noreferrer" data-action="live-open-whatsapp" data-opportunity-id="${escapeHtml(item.id)}">WhatsApp</a>` : "",
        !isContacted ? `<button type="button" class="wavr-button small" data-action="live-mark-contacted" data-opportunity-id="${escapeHtml(item.id)}">Tandai dihubungi</button>` : "",
        hasTransactions ? `<button type="button" class="wavr-button small" data-action="live-record-outcome" data-opportunity-id="${escapeHtml(item.id)}">Catat hasil</button>` : "",
        `<button type="button" class="wavr-button small" data-action="live-dismiss-opportunity" data-opportunity-id="${escapeHtml(item.id)}">Tutup: belum kembali</button>`,
      ].filter(Boolean).join("") || `<span class="wavr-text-muted">Tidak ada aksi</span>`;
      return `<tr><td><div class="wavr-table-person">${avatar(customer)}<div><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.phone)}</span></div></div></td><td>${escapeHtml(customer.branchName)}</td><td>${customer.consent ? status("Boleh dihubungi") : status("Belum ada izin WhatsApp")}</td><td>${liveFollowUpStatus(item)}</td><td><div class="custara-live-row-actions">${actions}</div></td></tr>`;
    }).join("");
    const body = `<div class="custara-live-opportunity-toolbar"><div><strong>${rows.length} customer</strong><span>Customer yang memenuhi kriteria ${escapeHtml(liveLabel(type))}.</span></div><div class="custara-live-profile-actions"><button type="button" class="wavr-button small" data-action="live-browse-opportunity" data-opportunity-type="${escapeHtml(type)}">Buka daftar customer</button><button type="button" class="wavr-button small" data-action="live-export-audience" data-opportunity-type="${escapeHtml(type)}">Unduh daftar</button></div></div>${rows.length ? `<div class="wavr-table-wrap"><table class="wavr-data-table"><thead><tr><th>Pelanggan</th><th>Cabang</th><th>Izin WhatsApp</th><th>Tindak lanjut</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div>` : `<div class="custara-live-empty">Belum ada customer yang masuk ke peluang ini.</div>`}`;
    openModal(`Daftar customer · ${liveLabel(type)}`, "Customer yang sedang punya peluang ini.", body, `<button type="button" class="wavr-button" data-action="close-modal">Tutup</button>`);
  }

  function liveOutcomeTransactions(opportunity) {
    const customer = liveOpportunityCustomer(opportunity);
    const opportunityOpenedAt = opportunity.opened_at ? new Date(opportunity.opened_at).getTime() : 0;
    return appState.transactions.filter((transaction) => {
      const occurredAt = new Date(transaction.raw?.occurred_at || "").getTime();
      return transaction.customerId === customer.id && numeric(transaction.amount) > 0 && transaction.raw?.status === "COMPLETED" && transaction.raw?.type === "SALE" && (!opportunityOpenedAt || occurredAt >= opportunityOpenedAt);
    });
  }

  function openLiveOutcomeModal(opportunityId) {
    const opportunity = state.opportunities.find((item) => item.id === opportunityId);
    if (!opportunity) { showToast("Opportunity tidak ditemukan"); return; }
    const customer = liveOpportunityCustomer(opportunity);
    const transactions = liveOutcomeTransactions(opportunity);
    const followUp = liveActionForOpportunity(opportunity);
    const defaultClassification = followUp ? "RETURN_AFTER_ACTION" : "ORGANIC_RETURN";
    const transactionOptions = transactions.length
      ? transactions.map((transaction) => `<option value="${escapeHtml(transaction.id)}">${escapeHtml(transaction.date)} Â· ${escapeHtml(transaction.service)} Â· ${formatIDR(transaction.amount)}</option>`).join("")
      : `<option value="">Belum ada transaksi baru</option>`;
    const body = `<form id="liveOutcomeForm"><div class="custara-live-field"><label for="liveOutcomeTransaction">Transaksi yang menandakan customer sudah kembali</label><select class="wavr-select" id="liveOutcomeTransaction" ${transactions.length ? "required" : "disabled"}>${transactionOptions}</select><small>Transaksi harus milik customer yang sama, sudah selesai, dan terjadi setelah peluang ini dibuka.</small></div><div class="custara-live-field"><label for="liveOutcomeClassification">Bagaimana customer kembali?</label><select class="wavr-select" id="liveOutcomeClassification"><option value="RETURN_AFTER_ACTION" ${defaultClassification === "RETURN_AFTER_ACTION" ? "selected" : ""}>Kembali setelah dihubungi</option><option value="ORGANIC_RETURN" ${defaultClassification === "ORGANIC_RETURN" ? "selected" : ""}>Kembali dengan sendirinya</option></select></div>${transactions.length ? `<div class="wavr-notice">${icon("check-circle", 16)}<span>Transaksi ini akan menutup peluang dan mencatat nilai kunjungan sebagai hasil.</span></div>` : `<div class="wavr-notice">${icon("clock", 16)}<span>Belum ada transaksi baru. Tambahkan transaksi setelah peluang ini dibuka, atau pilih <strong>Tutup peluang</strong> jika customer belum kembali.</span></div>`}</form>`;
    const foot = `<button type="button" class="wavr-button" data-action="close-modal">Batal</button><button type="button" class="wavr-button" data-action="live-dismiss-opportunity" data-opportunity-id="${escapeHtml(opportunityId)}">Tutup peluang</button><button type="button" class="wavr-button primary" data-action="live-submit-outcome" data-opportunity-id="${escapeHtml(opportunityId)}" ${transactions.length ? "" : `aria-disabled="true" title="Tambahkan transaksi baru terlebih dahulu"`}>${transactions.length ? "Simpan: customer kembali" : "Menunggu transaksi baru"}</button>`;
    openModal("Catat hasil opportunity", `${escapeHtml(customer.name)} Â· ${escapeHtml(liveLabel(opportunity.type))}`, body, foot);
  }

  function openDismissLiveOpportunityModal(opportunityId) {
    const opportunity = state.opportunities.find((item) => item.id === opportunityId);
    if (!opportunity) { showToast("Opportunity tidak ditemukan"); return; }
    const customer = liveOpportunityCustomer(opportunity);
    const body = `<div class="wavr-notice">${icon("clock", 16)}<span>Peluang untuk <strong>${escapeHtml(customer.name)}</strong> akan ditutup karena customer belum kembali. Riwayat tindak lanjut tetap tersimpan dan customer bisa muncul lagi jika nanti memenuhi kriteria.</span></div>`;
    const foot = `<button type="button" class="wavr-button" data-action="close-modal">Batal</button><button type="button" class="wavr-button primary" data-action="live-confirm-dismiss-opportunity" data-opportunity-id="${escapeHtml(opportunityId)}">Simpan sebagai belum kembali</button>`;
    openModal("Tutup peluang", "Pilih ini setelah customer selesai ditindaklanjuti tetapi belum kembali.", body, foot);
  }

  async function submitLiveOutcome(opportunityId) {
    const form = document.getElementById("liveOutcomeForm");
    if (!form?.reportValidity()) return;
    const transactionId = document.getElementById("liveOutcomeTransaction")?.value;
    const classification = document.getElementById("liveOutcomeClassification")?.value;
    if (!transactionId) {
      showToast("Belum ada transaksi baru. Catat transaksi setelah opportunity dibuka terlebih dahulu.");
      return;
    }
    const restoreButton = setButtonBusy(document.querySelector('[data-action="live-submit-outcome"]'), "Menyimpan...");
    showToast("Menyimpan hasil opportunity...", true);
    try {
      await apiRequest(`/v1/opportunities/${opportunityId}/outcomes`, { method: "POST", headers: { "Idempotency-Key": `ui-outcome-${Date.now()}-${opportunityId}` }, body: JSON.stringify({ transaction_id: transactionId, classification }) });
      const opportunity = state.opportunities.find((item) => item.id === opportunityId);
      const customerId = opportunity?.customer?.id;
      if (customerId) state.customerTimelines.delete(customerId);
      const currentPage = appState.page;
      closeModal();
      await loadLiveData();
      navigate(currentPage);
      showToast("Hasil kembalinya customer berhasil disimpan");
    } catch (caught) {
      showToast(caught.message || "Hasil opportunity gagal disimpan");
    } finally {
      restoreButton();
    }
  }

  async function dismissLiveOpportunity(opportunityId, sourceButton = null) {
    const restoreButton = setButtonBusy(sourceButton || document.querySelector('[data-action="live-confirm-dismiss-opportunity"]'), "Menyimpan...");
    showToast("Menyimpan hasil follow-up...", true);
    try {
      await apiRequest(`/v1/opportunities/${opportunityId}/dismiss`, { method: "POST", headers: { "Idempotency-Key": `ui-dismiss-${Date.now()}-${opportunityId}` }, body: JSON.stringify({ reason: "Customer belum kembali setelah ditindaklanjuti" }) });
      const opportunity = state.opportunities.find((item) => item.id === opportunityId);
      const customerId = opportunity?.customer?.id;
      if (customerId) state.customerTimelines.delete(customerId);
      const currentPage = appState.page;
      closeModal();
      await loadLiveData();
      navigate(currentPage);
      showToast("Opportunity ditutup sebagai belum kembali");
    } catch (caught) {
      showToast(caught.message || "Opportunity gagal ditutup");
    } finally {
      restoreButton();
    }
  }

  async function recordLiveAction(opportunityId, type, messagePreview) {
    const result = await apiRequest(`/v1/opportunities/${opportunityId}/actions`, { method: "POST", headers: { "Idempotency-Key": `ui-${type.toLowerCase()}-${Date.now()}-${opportunityId}` }, body: JSON.stringify({ type, channel: "WHATSAPP", message_preview: messagePreview }) });
    if (result.data) state.followUps.set(opportunityId, result.data);
    const opportunity = state.opportunities.find((item) => item.id === opportunityId);
    if (opportunity?.customer?.id) state.customerTimelines.delete(opportunity.customer.id);
    return result.data;
  }

  async function openLiveWhatsApp(target) {
    const url = target.href;
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    try {
      await recordLiveAction(target.dataset.opportunityId, "WHATSAPP_OPENED", "Link WhatsApp dibuka dari workspace Custara");
      updateLiveCustomerTable();
      if (popup) showToast("Link WhatsApp dibuka dan riwayat tersimpan");
    } catch (caught) {
      showToast(caught.message || "Riwayat WhatsApp belum tersimpan");
    }
  }

  async function markOpportunityContacted(opportunityId, sourceButton = null) {
    const restoreButton = setButtonBusy(sourceButton, "Menyimpan...");
    showToast("Menyimpan status follow-up...", true);
    try {
      await recordLiveAction(opportunityId, "WHATSAPP_MARKED_CONTACTED", "Customer ditandai sudah dihubungi dari workspace Custara");
      const currentPage = appState.page;
      closeModal();
      navigate(currentPage);
      showToast("Status follow-up dan riwayat tindakan tersimpan");
      void loadLiveData().then(() => { if (appState.page === currentPage) navigate(currentPage); }).catch(() => undefined);
    } catch (caught) {
      showToast(caught.message || "Aksi gagal disimpan");
    } finally {
      restoreButton();
    }
  }

  function exportLiveAudience(opportunityType = null) {
    const customers = filteredLiveCustomers(opportunityType);
    if (!customers.length) { showToast("Tidak ada customer yang cocok untuk diekspor"); return; }
    const headers = ["customer_id", "nama", "nomor_telepon", "cabang", "opportunity", "alasan", "persetujuan_whatsapp", "status_follow_up", "link_whatsapp"];
    const rows = customers.map((customer) => {
      const opportunity = liveOpportunityForCustomer(customer, opportunityType || state.customerFilters.opportunity);
      const action = liveActionForOpportunity(opportunity);
      const followUp = action?.type === "WHATSAPP_MARKED_CONTACTED" || action?.status === "MARKED_CONTACTED" ? "Sudah dihubungi" : action?.type === "WHATSAPP_OPENED" || action?.status === "OPENED" ? "WhatsApp dibuka" : "Belum dihubungi";
      return [customer.id, customer.name, customer.phone, customer.branchName, opportunity ? liveLabel(opportunity.type) : "", opportunity?.reason_text || "", customer.consent ? "true" : "false", followUp, customer.consent ? liveWhatsappUrl(customer) : ""];
    });
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `custara-audiens${opportunityType ? `-${opportunityType.toLowerCase()}` : ""}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`${customers.length} customer berhasil diekspor`);
  }

  function browseLiveOpportunity(type) {
    state.customerFilters.opportunity = type || "all";
    closeModal();
    navigate("customers");
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
    const restoreButton = setButtonBusy(document.querySelector('[data-action="save-customer"]'), "Menyimpan...");
    showToast("Menyimpan customer...", true);
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
    } catch (caught) {
      showToast(caught.message || "Customer gagal disimpan");
    } finally {
      restoreButton();
    }
  }

  async function saveLiveTransaction() {
    const form = document.getElementById("newTransactionForm");
    if (!form?.reportValidity()) return;
    const customerId = document.getElementById("txCustomer")?.value;
    const service = document.getElementById("txService")?.value || "Layanan";
    const amount = numeric(String(document.getElementById("txAmount")?.value || "").replace(/[^0-9]/g, ""));
    if (!customerId || amount <= 0 || !state.branchId) { showToast("Customer, cabang, dan nilai transaksi wajib tersedia"); return; }
    const restoreButton = setButtonBusy(document.querySelector('[data-action="save-transaction"]'), "Menyimpan...");
    showToast("Menyimpan transaksi...", true);
    try {
      await apiRequest("/v1/transactions", { method: "POST", headers: { "Idempotency-Key": `ui-transaction-${Date.now()}` }, body: JSON.stringify({ customer_id: customerId, source_system: "MANUAL", external_transaction_id: `UI-${Date.now()}`, occurred_at: new Date().toISOString(), currency: "IDR", gross_amount: amount.toFixed(2), discount_amount: "0.00", net_amount: amount.toFixed(2), create_visit_if_needed: true, items: [{ line_number: 1, service_name: service, service_category: "Layanan", quantity: "1", unit_amount: amount.toFixed(2), line_amount: amount.toFixed(2) }] }) });
      await loadLiveData();
      closeModal();
      navigate("transactions");
      showToast(`${formatIDR(amount)} berhasil tercatat di Supabase`);
    } catch (caught) {
      showToast(caught.message || "Transaksi gagal disimpan");
    } finally {
      restoreButton();
    }
  }

  const importTemplates = {
    CUSTOMERS: {
      filename: "custara-customers-template.csv",
      headers: ["source_system", "external_customer_id", "full_name", "phone", "email", "birth_date", "joined_at", "home_branch_code", "whatsapp_consent", "consent_recorded_at", "membership_number"],
      sample: ["CSV", "CUSTOMER-001", "Nama Customer", "+6281200000000", "", "", "2026-08-10", "MAIN", "true", "2026-08-10T09:00:00Z", "MEM-001"],
    },
    TRANSACTIONS: {
      filename: "custara-transactions-template.csv",
      headers: ["source_system", "external_transaction_id", "external_customer_id", "customer_phone", "branch_code", "transaction_type", "occurred_at", "currency", "gross_amount", "discount_amount", "net_amount", "refund_of_external_transaction_id"],
      sample: ["CSV", "TX-001", "CUSTOMER-001", "+6281200000000", "MAIN", "sale", "2026-08-10T09:00:00Z", "IDR", "100000", "0", "100000", ""],
    },
    TRANSACTION_ITEMS: {
      filename: "custara-transaction-items-template.csv",
      headers: ["source_system", "external_transaction_id", "line_number", "service_code", "service_name", "service_category", "quantity", "unit_amount", "line_amount"],
      sample: ["CSV", "TX-001", "1", "SVC-001", "Nama layanan", "Kategori layanan", "1", "100000", "100000"],
    },
    VISITS: {
      filename: "custara-visits-template.csv",
      headers: ["source_system", "external_visit_id", "external_customer_id", "customer_phone", "branch_code", "visit_type", "started_at", "ended_at", "status"],
      sample: ["CSV", "VISIT-001", "CUSTOMER-001", "+6281200000000", "MAIN", "APPOINTMENT", "2026-08-10T09:00:00Z", "2026-08-10T10:00:00Z", "COMPLETED"],
    },
  };

  function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

  function downloadImportTemplate() {
    const type = document.getElementById("liveImportType")?.value || "CUSTOMERS";
    const template = importTemplates[type] || importTemplates.CUSTOMERS;
    const csv = [template.headers, template.sample].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = template.filename;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`Template ${type.toLowerCase().replaceAll("_", " ")} diunduh`);
  }

  function openLiveImportModal() {
    openModal("Impor CSV ke Custara", "Upload file CSV UTF-8 untuk divalidasi sebelum masuk ke data utama.", `<form id="liveImportForm"><div class="custara-live-field"><label for="liveImportFile">File CSV</label><input id="liveImportFile" type="file" accept=".csv,text/csv" required /></div><div class="custara-live-field"><label for="liveImportType">Jenis data</label><select class="wavr-select" id="liveImportType"><option value="CUSTOMERS">Pelanggan</option><option value="TRANSACTIONS">Transaksi</option><option value="TRANSACTION_ITEMS">Detail layanan / item transaksi</option><option value="VISITS">Kunjungan</option></select></div><div class="custara-live-field"><label for="liveImportMode">Mode validasi</label><select class="wavr-select" id="liveImportMode"><option value="VALID_ROWS_ONLY">Import baris valid saja</option><option value="STRICT">Tahan jika ada error</option></select></div><div class="custara-live-import-help"><div><strong>Belum punya format?</strong><span>Unduh template sesuai jenis data, lalu isi dan simpan sebagai CSV UTF-8.</span></div><button type="button" class="wavr-button small" data-action="download-import-template"><span data-icon-name="file"></span>Unduh template</button></div><div class="wavr-notice">${icon("shield", 16)}<span>Custara akan memeriksa kolom wajib, kode cabang, customer yang cocok, dan duplikat sebelum commit. Format tiap brand boleh berbeda; untuk V1 file perlu dipetakan ke kolom template terlebih dahulu.</span></div></form>`, `<button type="button" class="wavr-button" data-action="close-modal">Batal</button><button type="button" class="wavr-button primary" data-action="live-submit-import"><span data-icon-name="upload"></span>Validasi dan impor</button>`);
  }

  async function submitLiveImport() {
    if (importInFlight) return;
    const file = document.getElementById("liveImportFile")?.files?.[0];
    if (!file) { showToast("Pilih file CSV terlebih dahulu"); return; }
    const body = new FormData();
    body.append("file", file);
    body.append("type", document.getElementById("liveImportType").value);
    body.append("mode", document.getElementById("liveImportMode").value);
    const submitButton = document.querySelector('[data-action="live-submit-import"]');
    importInFlight = true;
    const restoreButton = setButtonBusy(submitButton, "Memproses...");
    showToast("Import sedang diproses...", true);
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
    finally {
      importInFlight = false;
      restoreButton();
    }
  }

  async function refreshLive() {
    if (!state.live) return;
    const button = document.querySelector('[data-action="refresh-live"]');
    if (button?.disabled) return;
    const restoreButton = setButtonBusy(button, "Memperbarui...");
    setConnectionStatus("Memperbarui data...", true);
    try { await loadLiveData(); navigate(appState.page); showToast("Opportunity dan ringkasan berhasil diperbarui"); }
    catch (caught) { showToast(caught.message || "Data gagal diperbarui"); }
    finally {
      restoreButton();
      if (state.live) setConnectionStatus("Data nyata terhubung", true);
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest?.("#pageRoot input, #pageRoot select, #pageRoot textarea")) return;
    const target = event.target.closest?.("[data-action], [data-page], [data-page-link]");
    if (!target || !state.live) return;
    const action = target.dataset.action;
    const page = target.dataset.page || target.dataset.pageLink;
    if (page) { event.preventDefault(); event.stopImmediatePropagation(); navigate(page); return; }
    if (["start-demo", "scan", "save-customer", "save-transaction", "add-transaction", "import-csv", "download-import-template", "view-customer", "focus-search", "open-segment", "open-live-opportunity", "live-mark-contacted", "live-open-whatsapp", "live-browse-opportunity", "live-export-audience", "live-record-outcome", "live-submit-outcome", "live-dismiss-opportunity", "live-confirm-dismiss-opportunity", "live-resolve-identifier", "live-submit-import", "refresh-live"].includes(action)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (action === "start-demo") showToast("Keluar dari data nyata melalui tombol Keluar di kanan atas.");
    if (action === "scan") openLiveScanModal();
    if (action === "save-customer") void saveLiveCustomer();
    if (action === "save-transaction") void saveLiveTransaction();
    if (action === "add-transaction") openTransactionModal();
    if (action === "import-csv") openLiveImportModal();
    if (action === "download-import-template") downloadImportTemplate();
    if (action === "view-customer") void openLiveCustomer(target.dataset.customer);
    if (action === "focus-search") { navigate("customers"); window.setTimeout(() => document.getElementById("liveCustomerSearch")?.focus(), 0); }
    if (action === "open-segment") openLiveOpportunity(target.dataset.segment);
    if (action === "open-live-opportunity") openLiveOpportunity(target.dataset.opportunityType);
    if (action === "live-mark-contacted") void markOpportunityContacted(target.dataset.opportunityId, target);
    if (action === "live-open-whatsapp") void openLiveWhatsApp(target);
    if (action === "live-browse-opportunity") browseLiveOpportunity(target.dataset.opportunityType);
    if (action === "live-export-audience") exportLiveAudience(target.dataset.opportunityType || null);
    if (action === "live-record-outcome") openLiveOutcomeModal(target.dataset.opportunityId);
    if (action === "live-submit-outcome") void submitLiveOutcome(target.dataset.opportunityId);
    if (action === "live-dismiss-opportunity") openDismissLiveOpportunityModal(target.dataset.opportunityId);
    if (action === "live-confirm-dismiss-opportunity") void dismissLiveOpportunity(target.dataset.opportunityId, target);
    if (action === "live-resolve-identifier") void resolveLiveIdentifier();
    if (action === "live-submit-import") void submitLiveImport();
    if (action === "refresh-live") void refreshLive();
  }, true);

  async function boot() {
    if (!clientMode) return;
    document.querySelector('[data-action="start-demo"]')?.setAttribute("hidden", "true");
    installOverlay();
    installConnectionControls();
    try {
      await loadPublicConfig();
      state.supabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
          window.setTimeout(() => void activateLive(session), 0);
        } else if (state.live || state.session) {
          handleSessionLost("Sesi Supabase sudah keluar. Silakan masuk kembali untuk membuka workspace.");
        }
      });
      const result = await withTimeout(state.supabase.auth.getSession(), liveAuthTimeoutMs, "Supabase terlalu lama merespons. Coba muat ulang halaman.");
      if (result.data.session) await activateLive(result.data.session);
      else showOverlay();
    } catch (caught) {
      state.configError = caught;
      setConnectionStatus("API unavailable", false);
      const note = document.getElementById("custaraLiveNote");
      if (note) note.textContent = `${caught.message} Start the API, then reload this page to connect live data.`;
      showOverlay();
    }
  }

  window.CustaraLive = { refresh: refreshLive, signIn, navigate, clientMode };
  void boot();
})();
