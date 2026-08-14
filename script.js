const CUSTARA_WHATSAPP_NUMBER = (document.body.dataset.whatsapp || "6288980414923").replace(/\D/g, "");
const CUSTARA_EMAIL = document.body.dataset.email || "partnership@ilusa.id";
const CUSTARA_WHATSAPP_TEXT = "Halo Custara, saya mau cerita dulu soal bisnis saya. Ingin lihat 1 peluang yang masuk akal.";

const demoSteps = [
  {
    kicker: "Datang",
    title: "Nadia datang sebagai customer baru.",
    text: "Profil dibuat sekali. Kunjungan berikutnya ketemu orang yang sama, bukan data yang tercerai.",
    metaOne: "Member baru",
    metaTwo: "Belum ada riwayat",
    preview: "arrive"
  },
  {
    kicker: "Kelihatan polanya",
    title: "Setelah beberapa kali datang, polanya kelihatan.",
    text: "Sering treatment, belanja cukup besar, lalu jeda 60 hari. Ini yang biasanya hilang di spreadsheet.",
    metaOne: "9 kunjungan",
    metaTwo: "Tidak datang >60 hari",
    preview: "pattern"
  },
  {
    kicker: "Dihubungi",
    title: "Tim tahu harus chat siapa, dan kenapa.",
    text: "Bukan blast ke semua. Yang dihitung bukan pesan terkirim. Kalau 28 orang kembali, itu yang dihitung.",
    metaOne: "WhatsApp",
    metaTwo: "Bukan sekadar terkirim",
    preview: "contact"
  }
];

const previewMarkup = {
  arrive: `
    <div class="preview-label">Profil customer</div>
    <div class="preview-person"><span>NP</span><div><strong>Nadia Prameswari</strong><small>Member baru</small></div></div>
    <div class="preview-line full"></div><div class="preview-line medium"></div><div class="preview-line short"></div>`,
  pattern: `
    <div class="preview-label">Yang terbaca dari datanya</div>
    <div class="preview-stat-grid"><div><span>Kunjungan</span><strong>9x</strong></div><div><span>Total belanja</span><strong>Rp12,45 jt</strong></div><div><span>Terakhir datang</span><strong>62 hari</strong></div></div>
    <div class="preview-tags"><span>Nilai tinggi</span><span>Sering datang</span><span>Perlu dihubungi</span></div>`,
  contact: `
    <div class="preview-label">Pesan yang dikirim</div>
    <div class="preview-message"><strong>Untuk Nadia</strong>Hai Nadia, kangen banget. Ada benefit khusus minggu ini, kalau mau datang lagi.</div>
    <div class="preview-send"><svg><use href="#send"></use></svg> Kirim via WhatsApp</div>
    <p class="preview-scenario">Contoh ukurannya: 152 pesan, 28 orang kembali. Yang dihitung yang kembali.</p>`
};

function whatsappUrl(text) {
  const encoded = encodeURIComponent(text || CUSTARA_WHATSAPP_TEXT);
  if (!CUSTARA_WHATSAPP_NUMBER) return `https://wa.me/?text=${encoded}`;
  return `https://wa.me/${CUSTARA_WHATSAPP_NUMBER}?text=${encoded}`;
}

function bindWhatsAppLinks() {
  document.querySelectorAll(".js-whatsapp").forEach((link) => {
    if (link.id === "formWhatsapp") return;
    link.href = whatsappUrl();
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
}

const demoKicker = document.getElementById("demoKicker");
const demoTitle = document.getElementById("demoTitle");
const demoText = document.getElementById("demoText");
const demoMetaOne = document.getElementById("demoMetaOne");
const demoMetaTwo = document.getElementById("demoMetaTwo");
const demoPreview = document.getElementById("demoPreview");
const demoTabs = [...document.querySelectorAll(".demo-tab")];
const demoNext = document.getElementById("demoNext");
let activeDemo = 0;

function renderDemo(index) {
  if (!demoTabs.length || !demoKicker) return;
  activeDemo = (index + demoSteps.length) % demoSteps.length;
  const step = demoSteps[activeDemo];
  demoKicker.textContent = step.kicker;
  demoTitle.textContent = step.title;
  demoText.textContent = step.text;
  demoMetaOne.textContent = step.metaOne;
  demoMetaTwo.textContent = step.metaTwo;
  demoPreview.innerHTML = previewMarkup[step.preview];
  demoTabs.forEach((tab, tabIndex) => {
    const selected = tabIndex === activeDemo;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
}

if (demoTabs.length) {
  demoTabs.forEach((tab, index) => tab.addEventListener("click", () => renderDemo(index)));
  demoNext?.addEventListener("click", () => renderDemo(activeDemo + 1));
}

const menuToggle = document.getElementById("menuToggle");
const siteNav = document.getElementById("site-nav");
if (menuToggle && siteNav) {
  menuToggle.addEventListener("click", () => {
    const open = siteNav.classList.toggle("open");
    menuToggle.classList.toggle("is-open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Tutup menu" : "Buka menu");
    document.body.classList.toggle("menu-open", open);
  });
  siteNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    siteNav.classList.remove("open");
    menuToggle.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Buka menu");
    document.body.classList.remove("menu-open");
  }));
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });
document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

const assessmentForm = document.getElementById("assessmentForm");
const formMessage = document.getElementById("formMessage");
const formWhatsapp = document.getElementById("formWhatsapp");

function formWhatsappMessage() {
  const data = new FormData(assessmentForm);
  const name = String(data.get("name") || "").trim();
  const business = String(data.get("business") || "").trim();
  if (name && business) {
    return `Halo Custara, saya ${name} dari ${business}. Mau cerita dulu soal kondisi bisnis saya dan lihat 1 peluang yang masuk akal.`;
  }
  if (name) {
    return `Halo Custara, saya ${name}. Mau cerita dulu soal bisnis saya dan lihat 1 peluang yang masuk akal.`;
  }
  return CUSTARA_WHATSAPP_TEXT;
}

formWhatsapp?.addEventListener("click", (event) => {
  event.preventDefault();
  window.open(whatsappUrl(formWhatsappMessage()), "_blank", "noopener,noreferrer");
});

assessmentForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(assessmentForm);
  const name = String(data.get("name") || "").trim() || "kamu";
  const business = String(data.get("business") || "").trim();
  const whatsapp = String(data.get("whatsapp") || "").trim();
  const email = String(data.get("email") || "").trim();
  const source = String(data.get("source") || "").trim();
  const body = [
    `Nama: ${name}`,
    `Bisnis: ${business}`,
    `WhatsApp: ${whatsapp}`,
    email ? `Email: ${email}` : "",
    `Data utama: ${source}`
  ].filter(Boolean).join("\n");
  const mailto = `mailto:${CUSTARA_EMAIL}?subject=${encodeURIComponent(`Ngobrol Custara${business ? ` — ${business}` : ""}`)}&body=${encodeURIComponent(body)}`;
  formMessage.textContent = `Makasih, ${name}. Kalau email tidak terbuka, chat saja ke WhatsApp kami.`;
  window.location.href = mailto;
});

bindWhatsAppLinks();
const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();
