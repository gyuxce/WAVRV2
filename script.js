const demoSteps = [
  {
    kicker: "LANGKAH 01 · REGISTER",
    title: "Nadia masuk sebagai customer baru.",
    text: "Profil dibuat sekali lalu bisa dikenali pada setiap kunjungan berikutnya, tanpa membangun data yang terpisah-pisah.",
    metaOne: "Customer profile", metaTwo: "Belum ada riwayat", preview: "profile"
  },
  {
    kicker: "LANGKAH 02 · IDENTIFY",
    title: "Identitas Nadia konsisten di setiap titik layanan.",
    text: "Nomor telepon, QR, NFC, atau identitas lain dapat menjadi kunci yang menghubungkan pengalaman Nadia secara konsisten.",
    metaOne: "NFC-00291", metaTwo: "1 customer ID", preview: "identify"
  },
  {
    kicker: "LANGKAH 03 · RECORD",
    title: "Setiap visit dan transaksi menambah konteks.",
    text: "Riwayat layanan, nilai belanja, dan frekuensi kunjungan memberi tim cerita yang utuh—bukan tabel transaksi semata.",
    metaOne: "9 kunjungan", metaTwo: "Rp12,45 juta", preview: "record"
  },
  {
    kicker: "LANGKAH 04 · UNDERSTAND",
    title: "Custara membaca pola yang sulit terlihat manual.",
    text: "Nilai customer, kebiasaan berkunjung, dan interval kunjungan berubah menjadi sinyal yang bisa dipahami tim.",
    metaOne: "High value", metaTwo: "Frequent visitor", preview: "understand"
  },
  {
    kicker: "LANGKAH 05 · OPPORTUNITY",
    title: "Peluang yang relevan muncul lebih dulu.",
    text: "Custara memprioritaskan customer dengan potensi kembali tinggi sebelum mereka hilang dari radar operasional.",
    metaOne: "86 customer", metaTwo: "Inactive >60 hari", preview: "opportunity"
  },
  {
    kicker: "LANGKAH 06 · CAMPAIGN",
    title: "Action dijalankan dengan alasan yang jelas.",
    text: "Pilih audience, sesuaikan pesan, lalu ukur customer return dan revenue yang benar-benar dihasilkan dari action tersebut.",
    metaOne: "WhatsApp", metaTwo: "Hasil terukur", preview: "campaign"
  }
];

const previewMarkup = {
  profile: `
    <div class="preview-label">Customer profile</div>
    <div class="preview-person"><span>NP</span><div><strong>Nadia Prameswari</strong><small>Member baru</small></div></div>
    <div class="preview-line full"></div><div class="preview-line medium"></div><div class="preview-line short"></div>`,
  identify: `
    <div class="preview-label">Customer identity</div>
    <div class="preview-person"><span>NP</span><div><strong>Nadia Prameswari</strong><small>Identity matched</small></div></div>
    <div class="preview-card"><span>Primary ID</span><strong>NFC-00291</strong><small>Telepon · QR · NFC</small></div>`,
  record: `
    <div class="preview-label">Customer activity</div>
    <div class="preview-stat-grid"><div><span>Kunjungan</span><strong>9x</strong></div><div><span>Total belanja</span><strong>Rp12,45 jt</strong></div><div><span>Layanan</span><strong>3 jenis</strong></div></div>
    <div class="preview-list"><span>Laser Glow <b>09 Agu</b></span><span>Hydra Facial <b>21 Jul</b></span></div>`,
  understand: `
    <div class="preview-label">Customer intelligence</div>
    <div class="preview-card score-card"><span>Skor potensi kembali</span><strong>84</strong><small>Nilai tinggi · kunjungan konsisten</small></div>
    <div class="preview-tags"><span>High value</span><span>Near tier</span><span>Frequent</span></div>`,
  opportunity: `
    <div class="preview-label">Growth opportunity</div>
    <div class="preview-card opportunity-preview"><span>Inactive >60 days</span><strong>86 customer</strong><small>Rp42,8 juta potensi historis</small></div>
    <div class="preview-progress"><i></i><span>Prioritas action: tinggi</span></div>`,
  campaign: `
    <div class="preview-label">Campaign action</div>
    <div class="preview-message"><strong>Untuk Nadia</strong>Hai Nadia, kami rindu melihatmu. Nikmati benefit khusus minggu ini.</div>
    <div class="preview-send"><svg><use href="#send"></use></svg> Kirim via WhatsApp</div>`
};

let activeDemo = 0;
const demoKicker = document.getElementById("demoKicker");
const demoTitle = document.getElementById("demoTitle");
const demoText = document.getElementById("demoText");
const demoMetaOne = document.getElementById("demoMetaOne");
const demoMetaTwo = document.getElementById("demoMetaTwo");
const demoPreview = document.getElementById("demoPreview");
const demoTabs = [...document.querySelectorAll(".demo-tab")];

function renderDemo(index) {
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

demoTabs.forEach((tab, index) => tab.addEventListener("click", () => renderDemo(index)));
document.getElementById("demoNext").addEventListener("click", () => renderDemo(activeDemo + 1));

const menuToggle = document.getElementById("menuToggle");
const siteNav = document.getElementById("site-nav");
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
assessmentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = new FormData(assessmentForm).get("name")?.trim() || "Anda";
  formMessage.textContent = `Terima kasih, ${name}. Permintaan Growth Assessment Anda sudah tercatat.`;
  assessmentForm.reset();
});

document.getElementById("year").textContent = new Date().getFullYear();
