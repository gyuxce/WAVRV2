const demoSteps = [
  {
    kicker: "Langkah 01 · Daftar",
    title: "Nadia masuk sebagai customer baru.",
    text: "Profil dibuat sekali, lalu dikenali setiap kali dia datang lagi. Tidak perlu data yang terpisah-pisah.",
    metaOne: "Profil customer",
    metaTwo: "Belum ada riwayat",
    preview: "profile"
  },
  {
    kicker: "Langkah 02 · Kenali",
    title: "Nadia dikenali di mana pun dia dilayani.",
    text: "Nomor HP, QR, NFC, atau identitas lain bisa jadi kunci yang nyambungin kunjungannya jadi satu cerita.",
    metaOne: "NFC-00291",
    metaTwo: "1 identitas customer",
    preview: "identify"
  },
  {
    kicker: "Langkah 03 · Catat",
    title: "Setiap kunjungan nambah konteks, bukan cuma baris di tabel.",
    text: "Layanan, nilai belanja, dan seberapa sering dia datang—jadi cerita yang bisa dibaca tim.",
    metaOne: "9 kunjungan",
    metaTwo: "Rp12,45 juta",
    preview: "record"
  },
  {
    kicker: "Langkah 04 · Baca",
    title: "Pola yang susah dilihat manual, jadi kelihatan.",
    text: "Nilai customer, kebiasaan datang, dan jeda antar kunjungan berubah jadi sinyal yang masuk akal.",
    metaOne: "Nilai tinggi",
    metaTwo: "Sering datang",
    preview: "understand"
  },
  {
    kicker: "Langkah 05 · Peluang",
    title: "Yang paling mungkin kembali, muncul lebih dulu.",
    text: "Custara urutkan orang yang perlu dihubungi sebelum mereka hilang dari radar.",
    metaOne: "86 customer",
    metaTwo: "Tidak datang >60 hari",
    preview: "opportunity"
  },
  {
    kicker: "Langkah 06 · Hubungi",
    title: "Kirim pesan dengan alasan yang jelas.",
    text: "Pilih orangnya, sesuaikan pesannya, lalu ukur siapa yang benar-benar datang lagi.",
    metaOne: "WhatsApp",
    metaTwo: "Hasilnya bisa dicek",
    preview: "campaign"
  }
];

const previewMarkup = {
  profile: `
    <div class="preview-label">Profil customer</div>
    <div class="preview-person"><span>NP</span><div><strong>Nadia Prameswari</strong><small>Member baru</small></div></div>
    <div class="preview-line full"></div><div class="preview-line medium"></div><div class="preview-line short"></div>`,
  identify: `
    <div class="preview-label">Identitas customer</div>
    <div class="preview-person"><span>NP</span><div><strong>Nadia Prameswari</strong><small>Identitas cocok</small></div></div>
    <div class="preview-card"><span>ID utama</span><strong>NFC-00291</strong><small>Telepon · QR · NFC</small></div>`,
  record: `
    <div class="preview-label">Aktivitas customer</div>
    <div class="preview-stat-grid"><div><span>Kunjungan</span><strong>9x</strong></div><div><span>Total belanja</span><strong>Rp12,45 jt</strong></div><div><span>Layanan</span><strong>3 jenis</strong></div></div>
    <div class="preview-list"><span>Laser Glow <b>09 Agu</b></span><span>Hydra Facial <b>21 Jul</b></span></div>`,
  understand: `
    <div class="preview-label">Yang terbaca dari datanya</div>
    <div class="preview-card score-card"><span>Skor potensi kembali</span><strong>84</strong><small>Nilai tinggi · sering datang</small></div>
    <div class="preview-tags"><span>Nilai tinggi</span><span>Hampir naik tier</span><span>Sering datang</span></div>`,
  opportunity: `
    <div class="preview-label">Peluang hari ini</div>
    <div class="preview-card opportunity-preview"><span>Tidak datang >60 hari</span><strong>86 customer</strong><small>Rp42,8 juta pernah belanja</small></div>
    <div class="preview-progress"><i></i><span>Prioritas: dihubungi dulu</span></div>`,
  campaign: `
    <div class="preview-label">Pesan yang dikirim</div>
    <div class="preview-message"><strong>Untuk Nadia</strong>Hai Nadia, kangen banget. Ada benefit khusus minggu ini, kalau mau datang lagi.</div>
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
  const name = new FormData(assessmentForm).get("name")?.trim() || "kamu";
  formMessage.textContent = `Makasih, ${name}. Kami akan menghubungi lewat email yang kamu tulis.`;
  assessmentForm.reset();
});

document.getElementById("year").textContent = new Date().getFullYear();
