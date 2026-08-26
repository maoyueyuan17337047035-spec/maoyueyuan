const config = window.PORTFOLIO_CONFIG || {};
const authPanel = document.querySelector("[data-auth-panel]");
const workspace = document.querySelector("[data-admin-workspace]");
const loginForm = document.querySelector("[data-login-form]");
const ingestForm = document.querySelector("[data-ingest-form]");
const loginMessage = document.querySelector("[data-login-message]");
const publishMessage = document.querySelector("[data-publish-message]");
const publishButton = document.querySelector("[data-publish-button]");
const progressBar = document.querySelector("[data-progress]");
const progressLabel = document.querySelector("[data-progress-label]");
const progressValue = document.querySelector("[data-progress-value]");
const resultPanel = document.querySelector("[data-publish-result]");
const resultTitle = document.querySelector("[data-result-title]");
const videoInput = ingestForm?.elements.video;
const posterInput = ingestForm?.elements.poster;
const posterPreview = document.querySelector("[data-poster-preview]");
const posterPreviewImage = posterPreview?.querySelector("img");
const posterPlaceholder = posterPreview?.querySelector("div");
const videoName = document.querySelector("[data-video-name]");
const videoMeta = document.querySelector("[data-video-meta]");
const posterName = document.querySelector("[data-poster-name]");
const libraryList = document.querySelector("[data-library-list]");
const libraryMessage = document.querySelector("[data-library-message]");
const refreshLibraryButton = document.querySelector("[data-refresh-library]");
const cosConfigStorageKey = "maoyueyuan_portfolio_cos_admin_config";

let cosClient = null;
let detectedVideo = null;
let generatedPoster = null;
let posterObjectUrl = "";

function loadSavedCosConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(cosConfigStorageKey) || "null");
    return saved?.secretId && saved?.secretKey ? saved : null;
  } catch {
    return null;
  }
}

function saveCosConfig(secretId, secretKey) {
  localStorage.setItem(cosConfigStorageKey, JSON.stringify({ secretId, secretKey }));
}

function clearSavedCosConfig() {
  localStorage.removeItem(cosConfigStorageKey);
}

function createCosClient(secretId, secretKey) {
  return new window.COS({ SecretId: secretId, SecretKey: secretKey });
}

function setMessage(element, message, type = "") {
  if (!element) return;
  element.textContent = message;
  element.className = `form-message${type ? ` is-${type}` : ""}`;
}

function setProgress(value, label) {
  const amount = Math.max(0, Math.min(100, Math.round(value)));
  if (progressBar) progressBar.value = amount;
  if (progressValue) progressValue.textContent = `${amount}%`;
  if (progressLabel && label) progressLabel.textContent = label;
}

function setStep(activeStep) {
  const order = ["prepare", "authorize", "upload", "publish"];
  const activeIndex = order.indexOf(activeStep);
  document.querySelectorAll("[data-step]").forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle("is-active", index === activeIndex);
    item.classList.toggle("is-complete", index < activeIndex);
  });
}

function showWorkspace() {
  authPanel.hidden = true;
  workspace.hidden = false;
  setStep("prepare");
  void loadCloudWorks();
}

function disconnectCos(message = "", forgetAuthorization = false) {
  cosClient = null;
  if (forgetAuthorization) clearSavedCosConfig();
  loginForm?.reset();
  authPanel.hidden = false;
  workspace.hidden = true;
  if (message) setMessage(loginMessage, message, "error");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  return `${seconds.toFixed(1)}s`;
}

function normalizedWorkTitle(value) {
  return String(value || "")
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s《》〈〉「」『』【】\[\]()（）·:：,，.。!！?？'"“”‘’_\-—]/g, "");
}

function formatCosError(error, fallback = "腾讯云请求失败，请检查密钥权限与跨域设置。") {
  if (!error) return fallback;
  const code = typeof error.code === "string" ? error.code : typeof error.Code === "string" ? error.Code : "";
  const message =
    typeof error.message === "string"
      ? error.message
      : typeof error.Message === "string"
        ? error.Message
        : typeof error.error === "string"
          ? error.error
          : "";
  if (/cors|network|failed to fetch|load failed/i.test(message)) {
    return "腾讯云连接被本机网络代理拦截。请暂时关闭 Clash Verge 的系统代理，或将 myqcloud.com 与 tencentcos.cn 设为 DIRECT 后重试。";
  }
  return [code, message].filter(Boolean).join("：") || fallback;
}

function loadVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const metadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取视频信息，请确认文件可以正常播放。"));
    };
    video.src = url;
  });
}

function captureVideoPoster(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => URL.revokeObjectURL(url);
    video.onerror = () => {
      cleanup();
      reject(new Error("自动截取封面失败，请手动选择一张封面。"));
    };
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(Math.max(video.duration * 0.12, 0.2), 2);
    };
    video.onseeked = () => {
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (!blob) return reject(new Error("自动截取封面失败，请手动选择一张封面。"));
          resolve(new File([blob], "auto-poster.jpg", { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.9,
      );
    };
    video.src = url;
  });
}

function showPoster(file) {
  if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl);
  posterObjectUrl = URL.createObjectURL(file);
  posterPreviewImage.src = posterObjectUrl;
  posterPreviewImage.hidden = false;
  posterPlaceholder.hidden = true;
}

function safeExtension(file, fallback) {
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return extension && extension.length <= 5 ? extension : fallback;
}

function makeWorkId() {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) || Math.random().toString(36).slice(2, 14);
  return `${Date.now()}-${random}`;
}

function publicUrlForKey(key) {
  const base = String(config.publicBaseUrl || "").replace(/\/$/, "");
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function uploadCosObject({ key, body, contentType, cacheControl = "", onProgress }) {
  return new Promise((resolve, reject) => {
    if (!cosClient) return reject(new Error("腾讯云连接已经断开，请重新连接。"));
    cosClient.putObject(
      {
        Bucket: config.bucket,
        Region: config.region,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentDisposition: "inline",
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
        onProgress: (progress) => {
          const fraction = Number.isFinite(progress?.percent)
            ? progress.percent
            : progress?.totalSize
              ? progress.loadedSize / progress.totalSize
              : 0;
          onProgress?.(Math.max(0, Math.min(1, fraction || 0)));
        },
      },
      (error, data) => {
        if (error) reject(new Error(formatCosError(error, "文件上传失败。")));
        else resolve(data);
      },
    );
  });
}

function deleteCosObject(key) {
  return new Promise((resolve, reject) => {
    if (!cosClient) return reject(new Error("腾讯云连接已经断开，请重新连接。"));
    cosClient.deleteObject(
      {
        Bucket: config.bucket,
        Region: config.region,
        Key: key,
      },
      (error, data) => {
        if (error) reject(new Error(formatCosError(error, "云端文件删除失败。")));
        else resolve(data);
      },
    );
  });
}

function keyFromPublicUrl(value) {
  try {
    const url = new URL(value);
    const base = new URL(config.publicBaseUrl);
    if (url.origin !== base.origin) return "";
    const basePath = base.pathname.replace(/\/$/, "");
    const pathname = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname;
    return pathname.replace(/^\//, "").split("/").map(decodeURIComponent).join("/");
  } catch {
    return "";
  }
}

async function readCatalog() {
  const emptyCatalog = { version: 1, updatedAt: null, works: [] };
  if (!config.catalogUrl) return emptyCatalog;

  try {
    const separator = config.catalogUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${config.catalogUrl}${separator}v=${Date.now()}`, { cache: "no-store" });
    if (response.status === 404) return emptyCatalog;
    if (!response.ok) throw new Error(`目录读取失败（${response.status}）`);
    const payload = await response.json();
    return {
      version: Number(payload?.version) || 1,
      updatedAt: payload?.updatedAt || null,
      works: Array.isArray(payload?.works) ? payload.works : [],
    };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("无法读取作品目录。请暂时关闭 Clash Verge 的系统代理，或将腾讯云 COS 域名设为 DIRECT。");
    }
    throw error;
  }
}

async function writeCatalog(catalog) {
  const body = new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json;charset=utf-8" });
  await uploadCosObject({
    key: config.catalogKey || "portfolio/catalog/works.json",
    body,
    contentType: "application/json;charset=utf-8",
    cacheControl: "no-cache, max-age=0, must-revalidate",
  });
}

function renderCloudWorks(works) {
  if (!libraryList) return;
  if (!works.length) {
    const empty = document.createElement("p");
    empty.className = "library-empty";
    empty.textContent = "云端目录中还没有作品。完成第一次上传后，作品会出现在这里。";
    libraryList.replaceChildren(empty);
    return;
  }

  const items = [...works]
    .sort((left, right) => String(right?.createdAt || "").localeCompare(String(left?.createdAt || "")))
    .map((work) => {
      const item = document.createElement("article");
      item.className = `library-item${work.published === false ? " is-unpublished" : ""}`;
      item.dataset.libraryItem = "";
      item.dataset.workId = String(work.id || "");

      const poster = document.createElement("img");
      poster.src = String(work.poster || "");
      poster.alt = `《${String(work.title || "未命名作品")}》封面`;
      poster.loading = "lazy";

      const copy = document.createElement("div");
      copy.className = "library-item-copy";
      const state = document.createElement("span");
      state.textContent = `${work.category === "domestic" ? "国内漫剧" : "海外漫剧"} · ${work.published === false ? "已下架" : "公开中"}`;
      const title = document.createElement("h4");
      title.textContent = String(work.title || "未命名作品");
      const meta = document.createElement("p");
      meta.textContent = `${String(work.duration || "—")} · ${String(work.format || "—")}`;
      copy.append(state, title, meta);

      const actions = document.createElement("div");
      actions.className = "library-actions";
      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.dataset.toggleWork = String(work.id || "");
      visibility.textContent = work.published === false ? "重新上架" : "下架";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger-button";
      remove.dataset.deleteWork = String(work.id || "");
      remove.textContent = "彻底删除";
      actions.append(visibility, remove);

      item.append(poster, copy, actions);
      return item;
    });

  libraryList.replaceChildren(...items);
}

async function loadCloudWorks() {
  if (!cosClient) return;
  setMessage(libraryMessage, "正在读取腾讯云作品目录…");
  try {
    const catalog = await readCatalog();
    renderCloudWorks(catalog.works);
    setMessage(libraryMessage, catalog.works.length ? `已读取 ${catalog.works.length} 部云端作品。` : "");
  } catch (error) {
    setMessage(libraryMessage, formatCosError(error, error.message), "error");
  }
}

async function toggleCloudWork(workId, button) {
  button.disabled = true;
  setMessage(libraryMessage, "正在更新作品状态…");
  try {
    const catalog = await readCatalog();
    const work = catalog.works.find((item) => String(item?.id) === workId);
    if (!work) throw new Error("作品已不在云端目录中，请刷新列表。 ");
    work.published = work.published === false;
    work.updatedAt = new Date().toISOString();
    catalog.updatedAt = work.updatedAt;
    await writeCatalog(catalog);
    await loadCloudWorks();
    setMessage(libraryMessage, `《${String(work.title || "未命名作品")}》已${work.published ? "重新上架" : "下架"}。`, "success");
  } catch (error) {
    setMessage(libraryMessage, formatCosError(error, error.message), "error");
  } finally {
    button.disabled = false;
  }
}

async function deleteCloudWork(workId, button) {
  const item = button.closest("[data-library-item]");
  const title = item?.querySelector("h4")?.textContent || "这部作品";
  const confirmed = window.confirm(`确定彻底删除《${title}》吗？\n\n网站记录、视频和封面都会从腾讯云中删除，此操作无法撤销。`);
  if (!confirmed) return;

  item?.querySelectorAll("button").forEach((control) => {
    control.disabled = true;
  });
  setMessage(libraryMessage, `正在删除《${title}》…`);

  try {
    const catalog = await readCatalog();
    const work = catalog.works.find((entry) => String(entry?.id) === workId);
    if (!work) throw new Error("作品已不在云端目录中，请刷新列表。 ");

    const now = new Date().toISOString();
    catalog.updatedAt = now;
    catalog.works = catalog.works.filter((entry) => String(entry?.id) !== workId);
    await writeCatalog(catalog);

    const keys = [work.videoKey || keyFromPublicUrl(work.video), work.posterKey || keyFromPublicUrl(work.poster)].filter(Boolean);
    const deletions = await Promise.allSettled([...new Set(keys)].map((key) => deleteCosObject(key)));
    const failed = deletions.filter((result) => result.status === "rejected").length;
    await loadCloudWorks();
    if (failed) {
      setMessage(libraryMessage, `《${title}》已从网站删除，但有 ${failed} 个云端素材未能移除。`, "error");
    } else {
      setMessage(libraryMessage, `《${title}》及其云端素材已彻底删除。`, "success");
    }
  } catch (error) {
    setMessage(libraryMessage, formatCosError(error, error.message), "error");
    item?.querySelectorAll("button").forEach((control) => {
      control.disabled = false;
    });
  }
}

loginForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  setMessage(loginMessage, "");

  const secretId = loginForm.elements.secretId.value.trim();
  const secretKey = loginForm.elements.secretKey.value.trim();
  if (!/^AKID[A-Za-z0-9_-]{12,}$/.test(secretId)) {
    return setMessage(loginMessage, "SecretId 格式不正确，请重新复制。", "error");
  }
  if (secretKey.length < 20) {
    return setMessage(loginMessage, "SecretKey 格式不正确，请重新复制。", "error");
  }
  if (typeof window.COS !== "function") {
    return setMessage(loginMessage, "腾讯云上传组件加载失败，请刷新页面后重试。", "error");
  }

  cosClient = createCosClient(secretId, secretKey);
  saveCosConfig(secretId, secretKey);
  loginForm.reset();
  showWorkspace();
});

videoInput?.addEventListener("change", async () => {
  const file = videoInput.files[0];
  detectedVideo = null;
  generatedPoster = null;
  if (!file) return;

  videoName.textContent = file.name;
  videoMeta.textContent = `${formatBytes(file.size)} · 正在读取视频信息…`;
  try {
    detectedVideo = await loadVideoMetadata(file);
    const orientation = detectedVideo.width > detectedVideo.height ? "横屏" : detectedVideo.width < detectedVideo.height ? "竖屏" : "方形";
    videoMeta.textContent = `${formatBytes(file.size)} · ${formatDuration(detectedVideo.duration)} · ${detectedVideo.width}×${detectedVideo.height} · ${orientation}`;
    if (ingestForm.elements.format.value === "auto") ingestForm.elements.format.dataset.detected = orientation;
  } catch (error) {
    videoMeta.textContent = error.message;
  }
});

posterInput?.addEventListener("change", () => {
  const file = posterInput.files[0];
  generatedPoster = null;
  if (!file) return;
  posterName.textContent = file.name;
  showPoster(file);
});

document.querySelectorAll(".drop-field").forEach((field) => {
  ["dragenter", "dragover"].forEach((name) => field.addEventListener(name, () => field.classList.add("is-dragging")));
  ["dragleave", "drop"].forEach((name) => field.addEventListener(name, () => field.classList.remove("is-dragging")));
});

ingestForm?.elements.category.addEventListener("change", () => {
  const isOverseas = ingestForm.elements.category.value === "overseas";
  if (["公司项目 · 参与制作", "国内漫剧项目"].includes(ingestForm.elements.role.value)) {
    ingestForm.elements.role.value = isOverseas ? "公司项目 · 参与制作" : "国内漫剧项目";
  }
  if (["完整剧情成片，呈现海外漫剧内容形态。", "完整剧情成片，呈现国内漫剧的角色与世界观表达。"].includes(ingestForm.elements.summary.value)) {
    ingestForm.elements.summary.value = isOverseas
      ? "完整剧情成片，呈现海外漫剧内容形态。"
      : "完整剧情成片，呈现国内漫剧的角色与世界观表达。";
  }
});

ingestForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultPanel.hidden = true;
  setMessage(publishMessage, "");

  if (!cosClient) return disconnectCos("腾讯云连接已经断开，请重新输入密钥。");
  const video = videoInput.files[0];
  if (!video) return setMessage(publishMessage, "请先选择成片视频。", "error");
  if (video.size > 1024 * 1024 * 1024) return setMessage(publishMessage, "视频超过 1GB，请先压缩后再上传。", "error");

  publishButton.disabled = true;

  try {
    let poster = posterInput.files[0] || generatedPoster;
    if (!poster) {
      setProgress(4, "正在从视频自动截取封面");
      poster = await captureVideoPoster(video);
      generatedPoster = poster;
      posterName.textContent = "已从视频自动生成封面";
      showPoster(poster);
    }

    setStep("authorize");
    setProgress(8, "正在生成腾讯云存储路径");
    const category = ingestForm.elements.category.value;
    const title = ingestForm.elements.title.value.trim();
    const catalog = await readCatalog();
    const titleKey = normalizedWorkTitle(title);
    const replacedWorks = catalog.works.filter(
      (item) => item?.category === category && normalizedWorkTitle(item?.title) === titleKey,
    );
    const workId = makeWorkId();
    const baseKey = `${config.uploadPrefix || "portfolio/v1/uploads"}/${category}/${workId}`;
    const videoKey = `${baseKey}/video.${safeExtension(video, "mp4")}`;
    const posterKey = `${baseKey}/poster.${safeExtension(poster, "jpg")}`;

    setStep("upload");
    await uploadCosObject({
      key: videoKey,
      body: video,
      contentType: video.type || "video/mp4",
      cacheControl: "public, max-age=31536000, immutable",
      onProgress: (fraction) => setProgress(10 + fraction * 70, "正在上传成片到腾讯云 COS"),
    });
    await uploadCosObject({
      key: posterKey,
      body: poster,
      contentType: poster.type || "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
      onProgress: (fraction) => setProgress(80 + fraction * 12, "正在上传作品封面"),
    });

    setStep("publish");
    setProgress(94, "正在更新公开作品目录");
    const formatChoice = ingestForm.elements.format.value;
    const format = formatChoice === "auto" ? ingestForm.elements.format.dataset.detected || "竖屏" : formatChoice;
    const now = new Date().toISOString();
    const work = {
      id: workId,
      category,
      title,
      englishTitle: ingestForm.elements.englishTitle.value.trim(),
      duration: formatDuration(detectedVideo?.duration),
      format,
      role: ingestForm.elements.role.value.trim(),
      summary: ingestForm.elements.summary.value.trim(),
      published: ingestForm.elements.published.checked,
      video: publicUrlForKey(videoKey),
      poster: publicUrlForKey(posterKey),
      videoKey,
      posterKey,
      createdAt: now,
      updatedAt: now,
    };
    catalog.updatedAt = now;
    catalog.works = [
      ...catalog.works.filter(
        (item) => item?.id !== work.id && !(item?.category === category && normalizedWorkTitle(item?.title) === titleKey),
      ),
      work,
    ];
    await writeCatalog(catalog);

    const replacedKeys = replacedWorks
      .flatMap((item) => [item.videoKey || keyFromPublicUrl(item.video), item.posterKey || keyFromPublicUrl(item.poster)])
      .filter(Boolean);
    const cleanup = await Promise.allSettled([...new Set(replacedKeys)].map((key) => deleteCosObject(key)));
    const cleanupFailures = cleanup.filter((result) => result.status === "rejected").length;

    setProgress(100, work.published ? "作品已经公开" : "作品已经存入云端草稿");
    document.querySelectorAll("[data-step]").forEach((item) => item.classList.add("is-complete"));
    resultTitle.textContent = `《${work.title}》${work.published ? "已发布" : "已入库"}`;
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    const replacementNote = replacedWorks.length ? ` 已自动替换 ${replacedWorks.length} 个同名旧版本，前台不会重复显示。` : "";
    const cleanupNote = cleanupFailures ? ` 其中 ${cleanupFailures} 个旧素材未能清理，但不影响前台去重。` : "";
    setMessage(publishMessage, `视频、封面和作品资料均已保存到腾讯云 COS。${replacementNote}${cleanupNote}`, cleanupFailures ? "error" : "success");
    await loadCloudWorks();
  } catch (error) {
    setMessage(publishMessage, formatCosError(error, error.message || "上传未完成，请重试。"), "error");
    setProgress(progressBar.value, "上传没有完成，请按提示检查后重试");
  } finally {
    publishButton.disabled = false;
  }
});

document.querySelector("[data-logout]")?.addEventListener("click", () => disconnectCos("授权已从当前浏览器清除。", true));

refreshLibraryButton?.addEventListener("click", () => void loadCloudWorks());

libraryList?.addEventListener("click", (event) => {
  const toggleButton = event.target.closest("[data-toggle-work]");
  if (toggleButton) {
    void toggleCloudWork(toggleButton.dataset.toggleWork, toggleButton);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-work]");
  if (deleteButton) void deleteCloudWork(deleteButton.dataset.deleteWork, deleteButton);
});

document.querySelector("[data-add-another]")?.addEventListener("click", () => {
  ingestForm.reset();
  ingestForm.elements.role.value = "公司项目 · 参与制作";
  ingestForm.elements.summary.value = "完整剧情成片，呈现海外漫剧内容形态。";
  detectedVideo = null;
  generatedPoster = null;
  videoName.textContent = "选择 MP4 或 WebM 视频";
  videoMeta.textContent = "建议使用 H.264 MP4，单个文件不超过 1GB";
  posterName.textContent = "选择海报或封面";
  posterPreviewImage.hidden = true;
  posterPreviewImage.removeAttribute("src");
  posterPlaceholder.hidden = false;
  resultPanel.hidden = true;
  setProgress(0, "等待填写作品信息");
  setStep("prepare");
  setMessage(publishMessage, "");
  workspace.scrollIntoView({ behavior: "smooth", block: "start" });
});

const savedCosConfig = loadSavedCosConfig();
if (savedCosConfig && typeof window.COS === "function") {
  cosClient = createCosClient(savedCosConfig.secretId, savedCosConfig.secretKey);
  showWorkspace();
}

window.addEventListener("pagehide", () => {
  cosClient = null;
  if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl);
});

disconnectCos();
