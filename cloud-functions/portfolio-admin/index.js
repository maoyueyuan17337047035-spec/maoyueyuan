"use strict";

const crypto = require("crypto");
const COS = require("cos-nodejs-sdk-v5");

const BUCKET = process.env.COS_BUCKET || "maoyueyuan-1474173929";
const REGION = process.env.COS_REGION || "ap-guangzhou";
const PUBLIC_BASE_URL = (process.env.COS_PUBLIC_BASE_URL || `https://${BUCKET}.cos.${REGION}.myqcloud.com`).replace(/\/$/, "");
const CATALOG_KEY = process.env.COS_CATALOG_KEY || "portfolio/catalog/works.json";
const SESSION_TTL_SECONDS = Math.min(Number(process.env.SESSION_TTL_SECONDS) || 7200, 12 * 60 * 60);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://maoyueyuan17337047035-spec.github.io")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const credentials = {
  SecretId: process.env.TENCENT_SECRET_ID || process.env.TENCENTCLOUD_SECRETID,
  SecretKey: process.env.TENCENT_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY,
  SecurityToken: process.env.TENCENT_SESSION_TOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN,
};

const cos = new COS(credentials);

const MIME_RULES = {
  video: {
    "video/mp4": { extension: "mp4", maxBytes: 1024 * 1024 * 1024 },
    "video/webm": { extension: "webm", maxBytes: 1024 * 1024 * 1024 },
  },
  poster: {
    "image/jpeg": { extension: "jpg", maxBytes: 20 * 1024 * 1024 },
    "image/png": { extension: "png", maxBytes: 20 * 1024 * 1024 },
    "image/webp": { extension: "webp", maxBytes: 20 * 1024 * 1024 },
  },
};

function requestMethod(event) {
  return event?.requestContext?.http?.method || event?.httpMethod || event?.requestContext?.httpMethod || "GET";
}

function requestPath(event) {
  const rawPath = event?.rawPath || event?.path || "/";
  return rawPath.replace(/\/$/, "") || "/";
}

function requestOrigin(event) {
  return event?.headers?.origin || event?.headers?.Origin || "";
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return process.env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
}

function corsOrigin(event) {
  const origin = requestOrigin(event);
  return isAllowedOrigin(origin) && origin ? origin : ALLOWED_ORIGINS[0];
}

function response(event, statusCode, body) {
  return {
    statusCode,
    isBase64Encoded: false,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": corsOrigin(event),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event?.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function cleanText(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function sessionSignature(payload) {
  const secret = process.env.SESSION_SECRET || "";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSessionToken() {
  const payload = base64Url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, scope: "portfolio:write" }));
  return `${payload}.${sessionSignature(payload)}`;
}

function verifySessionToken(event) {
  const authorization = event?.headers?.authorization || event?.headers?.Authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !process.env.SESSION_SECRET) return false;

  const expected = sessionSignature(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return decoded.scope === "portfolio:write" && decoded.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function verifyPassword(password) {
  const salt = process.env.ADMIN_PASSWORD_SALT || "";
  const expectedHash = process.env.ADMIN_PASSWORD_HASH || "";
  if (!salt || !expectedHash || typeof password !== "string" || password.length > 256) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const actualBuffer = Buffer.from(actualHash, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function configurationReady() {
  return Boolean(
    BUCKET &&
      REGION &&
      credentials.SecretId &&
      credentials.SecretKey &&
      process.env.ADMIN_PASSWORD_SALT &&
      process.env.ADMIN_PASSWORD_HASH &&
      process.env.SESSION_SECRET,
  );
}

function publicObjectUrl(key) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${PUBLIC_BASE_URL}/${encodedKey}`;
}

function cosCall(method, parameters) {
  return new Promise((resolve, reject) => {
    cos[method](parameters, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

function signedPutUrl({ key, contentType }) {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": "inline",
  };

  return new Promise((resolve, reject) => {
    cos.getObjectUrl(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        Method: "PUT",
        Sign: true,
        Expires: 15 * 60,
        Headers: headers,
      },
      (error, data) => (error ? reject(error) : resolve({ url: data.Url, headers })),
    );
  });
}

function validateUploadFiles(files) {
  if (!Array.isArray(files) || files.length !== 2) throw new Error("需要同时提交成片和封面。" );
  const kinds = new Set();

  return files.map((file) => {
    const kind = file?.kind;
    const type = cleanText(file?.type, 80).toLowerCase();
    const size = Number(file?.size);
    const rule = MIME_RULES[kind]?.[type];
    if (!rule || !Number.isFinite(size) || size <= 0 || size > rule.maxBytes || kinds.has(kind)) {
      throw new Error(kind === "video" ? "视频必须是 1GB 以内的 MP4 或 WebM。" : "封面必须是 20MB 以内的 JPG、PNG 或 WebP。" );
    }
    kinds.add(kind);
    return { kind, type, size, extension: rule.extension };
  });
}

async function createUploadTicket(body) {
  const category = body.category === "domestic" ? "domestic" : body.category === "overseas" ? "overseas" : "";
  const title = cleanText(body.title, 80);
  if (!category || !title) throw new Error("作品分类或片名无效。" );

  const files = validateUploadFiles(body.files);
  const date = new Date().toISOString().slice(0, 10);
  const uploadId = crypto.randomUUID();
  const uploads = await Promise.all(
    files.map(async (file) => {
      const key = `portfolio/works/${category}/${date}/${uploadId}-${file.kind}.${file.extension}`;
      const signed = await signedPutUrl({ key, contentType: file.type });
      return { kind: file.kind, key, publicUrl: publicObjectUrl(key), ...signed };
    }),
  );

  return { uploadId, expiresIn: 15 * 60, uploads };
}

async function readCatalog() {
  try {
    const data = await cosCall("getObject", { Bucket: BUCKET, Region: REGION, Key: CATALOG_KEY });
    const parsed = JSON.parse(Buffer.isBuffer(data.Body) ? data.Body.toString("utf8") : String(data.Body || "{}"));
    return { version: 1, updatedAt: parsed.updatedAt || null, works: Array.isArray(parsed.works) ? parsed.works : [] };
  } catch (error) {
    if (["NoSuchKey", "NoSuchObject", "NotFound"].includes(error.code) || error.statusCode === 404) {
      return { version: 1, updatedAt: null, works: [] };
    }
    throw error;
  }
}

async function assertUploadedObject(key) {
  if (!key.startsWith("portfolio/works/")) throw new Error("素材路径无效。" );
  await cosCall("headObject", { Bucket: BUCKET, Region: REGION, Key: key });
}

async function publishWork(body) {
  const category = body.category === "domestic" ? "domestic" : body.category === "overseas" ? "overseas" : "";
  const title = cleanText(body.title, 80);
  const videoKey = cleanText(body.videoKey, 500);
  const posterKey = cleanText(body.posterKey, 500);
  if (!category || !title || !videoKey || !posterKey) throw new Error("作品资料不完整。" );
  if (!videoKey.includes(`/works/${category}/`) || !posterKey.includes(`/works/${category}/`)) throw new Error("作品分类与素材路径不一致。" );

  await Promise.all([assertUploadedObject(videoKey), assertUploadedObject(posterKey)]);
  const now = new Date().toISOString();
  const work = {
    id: crypto.randomUUID(),
    category,
    title,
    englishTitle: cleanText(body.englishTitle, 100),
    duration: cleanText(body.duration, 24) || "—",
    format: ["竖屏", "横屏", "方形"].includes(body.format) ? body.format : "竖屏",
    role: cleanText(body.role, 100) || (category === "overseas" ? "海外漫剧项目" : "国内漫剧项目"),
    summary: cleanText(body.summary, 280) || "完整剧情成片。",
    video: publicObjectUrl(videoKey),
    poster: publicObjectUrl(posterKey),
    videoKey,
    posterKey,
    published: body.published !== false,
    createdAt: now,
    updatedAt: now,
  };

  const catalog = await readCatalog();
  const nextCatalog = { version: 1, updatedAt: now, works: [...catalog.works, work] };
  await cosCall("putObject", {
    Bucket: BUCKET,
    Region: REGION,
    Key: CATALOG_KEY,
    Body: JSON.stringify(nextCatalog, null, 2),
    ContentType: "application/json; charset=utf-8",
    CacheControl: "no-cache, max-age=0, must-revalidate",
  });

  return work;
}

async function handler(event) {
  if (!isAllowedOrigin(requestOrigin(event))) return response(event, 403, { message: "当前来源不允许访问管理服务。" });
  const method = requestMethod(event).toUpperCase();
  const path = requestPath(event);

  if (method === "OPTIONS") return response(event, 204, {});
  if (method === "GET" && (path === "/" || path.endsWith("/health"))) {
    return response(event, 200, { ok: true, configured: configurationReady(), bucket: BUCKET, region: REGION });
  }
  if (!configurationReady()) return response(event, 503, { message: "上传服务尚未完成环境配置。" });

  if (method === "POST" && path.endsWith("/session")) {
    const body = parseBody(event);
    if (!verifyPassword(body.password)) return response(event, 401, { message: "管理密码不正确。" });
    return response(event, 200, { token: createSessionToken(), expiresIn: SESSION_TTL_SECONDS });
  }

  if (!["/upload-ticket", "/works"].some((route) => path.endsWith(route))) {
    return response(event, 404, { message: "接口不存在。" });
  }
  if (!verifySessionToken(event)) return response(event, 401, { message: "登录已过期，请重新验证。" });

  const body = parseBody(event);
  if (method === "POST" && path.endsWith("/upload-ticket")) {
    return response(event, 200, await createUploadTicket(body));
  }
  if (method === "POST" && path.endsWith("/works")) {
    const work = await publishWork(body);
    return response(event, 201, { work });
  }
  return response(event, 405, { message: "不支持该请求方式。" });
}

exports.main_handler = async (event) => {
  try {
    return await handler(event);
  } catch (error) {
    console.error("portfolio-admin", error);
    if (error instanceof SyntaxError) return response(event, 400, { message: "提交的数据格式不正确。" });
    if (error.message && !error.code) return response(event, 400, { message: error.message });
    return response(event, 500, { message: "云端处理失败，请稍后重试。" });
  }
};
