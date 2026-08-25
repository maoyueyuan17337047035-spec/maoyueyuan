const pages = [...document.querySelectorAll("[data-page]")];
const header = document.querySelector("[data-header]");
const contactModal = document.querySelector("[data-contact-modal]");
const filmModal = document.querySelector("[data-film-modal]");
const filmVideo = document.querySelector("[data-film-video]");
const filmTitle = document.querySelector("[data-film-title]");
const filmMeta = document.querySelector("[data-film-meta]");
const filmRole = document.querySelector("[data-film-role]");
const filmNote = document.querySelector("[data-film-note]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const menuTrigger = document.querySelector("[data-menu-trigger]");
const skipLink = document.querySelector(".skip-link");
const mainContent = document.querySelector("#main-content");
const overseasGrids = [...document.querySelectorAll("[data-overseas-grid], [data-home-overseas-grid]")];
const domesticGrids = [...document.querySelectorAll("[data-domestic-grid], [data-home-domestic-grid]")];
const portfolioConfig = window.PORTFOLIO_CONFIG || {};

function safeText(value, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 280) : fallback;
}

function safeMediaUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";

  try {
    const url = new URL(value, window.location.href);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeRemoteWork(work) {
  if (!work || typeof work !== "object") return null;

  const category = work.category === "domestic" ? "domestic" : work.category === "overseas" ? "overseas" : "";
  const title = safeText(work.title);
  const video = safeMediaUrl(work.video);
  const poster = safeMediaUrl(work.poster);
  if (!category || !title || !video || !poster) return null;

  return {
    id: safeText(work.id, `${category}-${title}`),
    category,
    title,
    englishTitle: safeText(work.englishTitle),
    video,
    poster,
    duration: safeText(work.duration, "—"),
    format: safeText(work.format, "竖屏"),
    role: safeText(work.role, category === "overseas" ? "海外漫剧项目" : "国内漫剧项目"),
    summary: safeText(work.summary, "完整剧情成片。"),
  };
}

function renderDramaWorks({ grid, works, category, typeLabel, projectClass = "" }) {
  if (!grid) return;

  const cards = works.map((work) => {
    const article = document.createElement("article");
    article.className = `overseas-project ${projectClass} reveal`.trim();

    const posterLink = document.createElement("a");
    posterLink.className = "archive-poster";
    posterLink.href = work.video;
    posterLink.dataset.playFilm = "";
    posterLink.dataset.video = work.video;
    posterLink.dataset.poster = work.poster;
    posterLink.dataset.title = work.title;
    posterLink.dataset.meta = `${category} · ${work.duration} · ${work.format}`;
    posterLink.dataset.role = work.role;
    posterLink.dataset.note = work.summary;

    const poster = document.createElement("img");
    poster.loading = "lazy";
    poster.decoding = "async";
    poster.src = work.poster;
    poster.alt = `${category}《${work.title}》封面`;

    const play = document.createElement("span");
    play.className = "play-pill";
    const playIcon = document.createElement("i");
    playIcon.setAttribute("aria-hidden", "true");
    playIcon.textContent = "▶";
    play.append(playIcon, " 播放成片");
    posterLink.append(poster, play);

    const copy = document.createElement("div");
    copy.className = "overseas-project-copy";
    const type = document.createElement("span");
    type.className = "overseas-project-type";
    type.textContent = grid.dataset.typeLabel || typeLabel;
    const title = document.createElement("h3");
    title.textContent = work.title;
    copy.append(type, title);

    if (work.englishTitle) {
      const englishTitle = document.createElement("p");
      englishTitle.className = "overseas-english-title";
      englishTitle.textContent = work.englishTitle;
      copy.append(englishTitle);
    }

    const meta = document.createElement("p");
    meta.className = "overseas-meta";
    meta.textContent = `${category} · ${work.duration} · ${work.format}`;
    const role = document.createElement("p");
    role.className = "work-role";
    role.textContent = work.role;
    const summary = document.createElement("p");
    summary.className = "work-summary";
    summary.textContent = work.summary;
    copy.append(meta, role, summary);

    article.append(posterLink, copy);
    return article;
  });

  grid.replaceChildren(...cards);
}

function mergeWorks(baseWorks, remoteWorks) {
  const merged = [...baseWorks];
  const existing = new Set(baseWorks.map((work) => safeText(work.id, work.title).toLowerCase()));

  remoteWorks.forEach((work) => {
    const key = safeText(work.id, work.title).toLowerCase();
    if (!existing.has(key)) {
      existing.add(key);
      merged.push(work);
    }
  });

  return merged;
}

function renderAllDramaWorks(remoteWorks = []) {
  const remoteOverseas = remoteWorks.filter((work) => work.category === "overseas");
  const remoteDomestic = remoteWorks.filter((work) => work.category === "domestic");
  const overseasWorks = mergeWorks(window.PORTFOLIO_OVERSEAS_WORKS || [], remoteOverseas);
  const domesticWorks = mergeWorks(window.PORTFOLIO_DOMESTIC_WORKS || [], remoteDomestic);

  overseasGrids.forEach((grid) => {
    renderDramaWorks({
      grid,
      works: overseasWorks,
      category: "海外漫剧",
      typeLabel: "COMPANY PROJECT",
    });
  });

  domesticGrids.forEach((grid) => {
    renderDramaWorks({
      grid,
      works: domesticWorks,
      category: "国内漫剧",
      typeLabel: "DOMESTIC PROJECT",
      projectClass: "domestic-project",
    });
  });
}

async function loadPublishedWorks() {
  if (!portfolioConfig.catalogUrl) return;

  try {
    const separator = portfolioConfig.catalogUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${portfolioConfig.catalogUrl}${separator}v=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
    const payload = await response.json();
    const remoteWorks = (Array.isArray(payload) ? payload : payload.works || [])
      .filter((work) => work?.published !== false)
      .map(normalizeRemoteWork)
      .filter(Boolean);
    renderAllDramaWorks(remoteWorks);
    refreshReveals();
  } catch (error) {
    console.info("Remote portfolio catalog is unavailable; using built-in works.", error);
  }
}

renderAllDramaWorks();
loadPublishedWorks();

const routes = {
  home: "home",
  works: "works",
  "work/yuelongmen": "yuelongmen",
};

const pageTitles = {
  home: "毛月园 MAO YUEYUAN — 生成式影像创作者",
  works: "作品集 — 毛月园 MAO YUEYUAN",
  yuelongmen: "鱼跃龙门 — 视觉开发案例 — 毛月园",
};

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path = "home", query = ""] = raw.split("?");
  return { page: routes[path] || "home", query: new URLSearchParams(query) };
}

function updateHeaderState() {
  if (!header) return;
  const { page } = parseRoute();
  const isScrolled = window.scrollY > 24;
  header.classList.toggle("is-scrolled", isScrolled);
  header.classList.toggle("is-on-light", page === "works" && !isScrolled);
}

function activatePage() {
  const route = parseRoute();
  pages.forEach((page) => page.classList.toggle("is-active", page.dataset.page === route.page));
  document.title = pageTitles[route.page] || pageTitles.home;

  document.querySelectorAll(".desktop-nav a, .mobile-menu a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const isCurrent =
      (route.page === "home" && href === "#/home") ||
      (route.page !== "home" && href === "#/works");
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  document.querySelectorAll(".case-page video").forEach((video) => {
    if (!video.closest(".is-active")) video.pause();
  });

  if (filmModal?.open) closeFilm();

  closeMobileMenu();
  window.scrollTo({ top: 0, behavior: "instant" });
  updateHeaderState();
  window.setTimeout(() => {
    refreshReveals();
    const requestedSection = route.query.get("section");
    if (requestedSection) {
      document.querySelector(`[data-section="${requestedSection}"]`)?.scrollIntoView({ behavior: "smooth" });
    }
  }, 60);
}

function closeMobileMenu() {
  mobileMenu?.setAttribute("aria-hidden", "true");
  menuTrigger?.setAttribute("aria-expanded", "false");
  menuTrigger?.setAttribute("aria-label", "打开菜单");
  document.body.classList.remove("menu-open");
}

function toggleMobileMenu() {
  if (!mobileMenu || !menuTrigger) return;
  const willOpen = mobileMenu.getAttribute("aria-hidden") === "true";
  mobileMenu.setAttribute("aria-hidden", String(!willOpen));
  menuTrigger.setAttribute("aria-expanded", String(willOpen));
  menuTrigger.setAttribute("aria-label", willOpen ? "关闭菜单" : "打开菜单");
  document.body.classList.toggle("menu-open", willOpen);
}

let revealObserver;
function refreshReveals() {
  revealObserver?.disconnect();
  const activeReveals = [...document.querySelectorAll(".page.is-active .reveal")];
  activeReveals.forEach((element) => element.classList.remove("in-view"));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    activeReveals.forEach((element) => element.classList.add("in-view"));
    return;
  }

  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8%", threshold: 0.08 },
  );

  activeReveals.forEach((element) => revealObserver.observe(element));
}

function openContact() {
  if (!contactModal) return;
  closeMobileMenu();
  contactModal.showModal();
  document.body.classList.add("modal-open");
}

function closeContact() {
  contactModal?.close();
  document.body.classList.remove("modal-open");
}

async function openFilm(trigger) {
  if (!filmModal || !filmVideo) return;
  closeMobileMenu();
  if (contactModal?.open) closeContact();

  filmVideo.src = trigger.dataset.video;
  filmVideo.poster = trigger.dataset.poster || "";
  if (filmTitle) filmTitle.textContent = trigger.dataset.title || "作品播放";
  if (filmMeta) filmMeta.textContent = trigger.dataset.meta || "";
  if (filmRole) filmRole.textContent = trigger.dataset.role || "";
  if (filmNote) filmNote.textContent = trigger.dataset.note || "";

  filmModal.showModal();
  document.body.classList.add("modal-open");

  try {
    await filmVideo.play();
  } catch {
    // Browsers may still require the user to press the native play control.
  }
}

function closeFilm() {
  if (!filmModal || !filmVideo) return;
  filmVideo.pause();
  filmVideo.removeAttribute("src");
  filmVideo.removeAttribute("poster");
  filmVideo.load();
  if (filmModal.open) filmModal.close();
  document.body.classList.remove("modal-open");
}

document.querySelectorAll("[data-open-contact]").forEach((button) => {
  button.addEventListener("click", openContact);
});

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-play-film]");
  if (!trigger) return;
  event.preventDefault();
  openFilm(trigger);
});

document.querySelector("[data-close-contact]")?.addEventListener("click", closeContact);
document.querySelector("[data-close-film]")?.addEventListener("click", closeFilm);

contactModal?.addEventListener("click", (event) => {
  const rect = contactModal.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (outside) closeContact();
});

contactModal?.addEventListener("close", () => document.body.classList.remove("modal-open"));

filmModal?.addEventListener("click", (event) => {
  if (event.target === filmModal) closeFilm();
});

filmModal?.addEventListener("close", () => {
  filmVideo?.pause();
  document.body.classList.remove("modal-open");
});

menuTrigger?.addEventListener("click", toggleMobileMenu);

skipLink?.addEventListener("click", (event) => {
  event.preventDefault();
  mainContent?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "auto" });
});

window.addEventListener("hashchange", activatePage);
window.addEventListener("scroll", updateHeaderState, { passive: true });

document.querySelector("[data-scroll-next]")?.addEventListener("click", () => {
  document.querySelector("[data-section='industry']")?.scrollIntoView({ behavior: "smooth" });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (filmModal?.open) closeFilm();
    if (contactModal?.open) closeContact();
    closeMobileMenu();
  }
});

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

activatePage();
