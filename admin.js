const config = window.PORTFOLIO_CONFIG || {};
const apiBaseUrl = new URLSearchParams(window.location.search).get("api") || config.apiBaseUrl || "";
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
const SESSION_KEY = "maoyueyuan-portfolio-admin-session";

let sessionToken = sessionStorage.getItem(SESSION_KEY) || "";
let detectedVideo = null;
let generatedPoster = null;
let posterObjectUrl = "";

function endpoint(path) {
  return `${apiBaseUrl.replace(/\/$/, "")}${path}`;
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
}

function showLogin(message = "") {
  sessionToken = "";
  sessionStorage.removeItem(SESSION_KEY);
  authPanel.hidden = false;
  workspace.hidden = true;
  if (message) setMessage(loginMessage, message, "error");
}

async function apiRequest(path, options = {}) {
  if (!apiBaseUrl) throw new Error("上传服务尚未完成腾讯云配置。");

  const response = await fetch(endpoint(path), {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return payload;
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

function uploadFile(upload, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", upload.url);
    Object.entries(upload.headers || {}).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`云端上传失败（${request.status}）`));
    };
    request.onerror = () => reject(new Error("无法连接腾讯云 COS，请检查网络和跨域设置。"));
    request.send(file);
  });
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(loginMessage, "正在验证…");
  const button = loginForm.querySelector("button");
  button.disabled = true;

  try {
    const { token } = await apiRequest("/session", {
      method: "POST",
      body: { password: loginForm.elements.password.value },
    });
    sessionToken = token;
    sessionStorage.setItem(SESSION_KEY, token);
    loginForm.reset();
    showWorkspace();
  } catch (error) {
    setMessage(loginMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
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
    setProgress(8, "正在申请本次上传的短时授权");
    const ticket = await apiRequest("/upload-ticket", {
      method: "POST",
      token: sessionToken,
      body: {
        category: ingestForm.elements.category.value,
        title: ingestForm.elements.title.value,
        files: [
          { kind: "video", name: video.name, type: video.type || "video/mp4", size: video.size },
          { kind: "poster", name: poster.name, type: poster.type || "image/jpeg", size: poster.size },
        ],
      },
    });

    const videoUpload = ticket.uploads.find((item) => item.kind === "video");
    const posterUpload = ticket.uploads.find((item) => item.kind === "poster");
    if (!videoUpload || !posterUpload) throw new Error("腾讯云没有返回完整的上传授权。");

    setStep("upload");
    await uploadFile(videoUpload, video, (fraction) => setProgress(10 + fraction * 72, "正在上传成片到腾讯云 COS"));
    await uploadFile(posterUpload, poster, (fraction) => setProgress(82 + fraction * 10, "正在上传作品封面"));

    setStep("publish");
    setProgress(94, "正在登记作品并更新公开目录");
    const formatChoice = ingestForm.elements.format.value;
    const format = formatChoice === "auto" ? ingestForm.elements.format.dataset.detected || "竖屏" : formatChoice;
    const result = await apiRequest("/works", {
      method: "POST",
      token: sessionToken,
      body: {
        category: ingestForm.elements.category.value,
        title: ingestForm.elements.title.value,
        englishTitle: ingestForm.elements.englishTitle.value,
        duration: formatDuration(detectedVideo?.duration),
        format,
        role: ingestForm.elements.role.value,
        summary: ingestForm.elements.summary.value,
        published: ingestForm.elements.published.checked,
        videoKey: videoUpload.key,
        posterKey: posterUpload.key,
      },
    });

    setProgress(100, result.work.published ? "作品已经公开" : "作品已经存入云端草稿");
    document.querySelectorAll("[data-step]").forEach((item) => item.classList.add("is-complete"));
    resultTitle.textContent = `《${result.work.title}》${result.work.published ? "已发布" : "已入库"}`;
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    setMessage(publishMessage, "视频、封面和作品资料均已保存。", "success");
  } catch (error) {
    if (error.status === 401) {
      showLogin("登录已过期，请重新验证。");
    } else {
      setMessage(publishMessage, error.message, "error");
      setProgress(progressBar.value, "上传没有完成，请按提示检查后重试");
    }
  } finally {
    publishButton.disabled = false;
  }
});

document.querySelector("[data-logout]")?.addEventListener("click", () => showLogin());

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

if (!apiBaseUrl) {
  showLogin("管理页面已经完成；腾讯云上传服务尚待一次性绑定。");
} else if (sessionToken) {
  showWorkspace();
} else {
  showLogin();
}
