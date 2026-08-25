"use strict";

const assert = require("assert");
const crypto = require("crypto");
const COS = require("cos-nodejs-sdk-v5");

const password = "test-password-strong";
const salt = "test-salt";
process.env.COS_BUCKET = "test-bucket-1250000000";
process.env.COS_REGION = "ap-guangzhou";
process.env.TENCENT_SECRET_ID = "test-secret-id";
process.env.TENCENT_SECRET_KEY = "test-secret-key";
process.env.ADMIN_PASSWORD_SALT = salt;
process.env.ADMIN_PASSWORD_HASH = crypto.scryptSync(password, salt, 64).toString("hex");
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
process.env.ALLOWED_ORIGINS = "https://maoyueyuan17337047035-spec.github.io";
process.env.NODE_ENV = "production";

let savedCatalog = null;

COS.prototype.getObjectUrl = function getObjectUrl(params, callback) {
  callback(null, { Url: `https://signed.example.test/${params.Key}` });
};

COS.prototype.headObject = function headObject(params, callback) {
  callback(null, { ETag: "test" });
};

COS.prototype.getObject = function getObject(params, callback) {
  if (!savedCatalog) return callback({ code: "NoSuchKey", statusCode: 404 });
  callback(null, { Body: Buffer.from(savedCatalog) });
};

COS.prototype.putObject = function putObject(params, callback) {
  savedCatalog = String(params.Body);
  callback(null, { ETag: "catalog" });
};

const { main_handler } = require("../index.js");

function event(path, method, body, token = "") {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: {
      origin: "https://maoyueyuan17337047035-spec.github.io",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : "",
    isBase64Encoded: false,
  };
}

async function run() {
  const health = await main_handler(event("/health", "GET"));
  assert.equal(health.statusCode, 200);
  assert.equal(JSON.parse(health.body).configured, true);

  const badLogin = await main_handler(event("/session", "POST", { password: "wrong-password" }));
  assert.equal(badLogin.statusCode, 401);

  const login = await main_handler(event("/session", "POST", { password }));
  assert.equal(login.statusCode, 200);
  const token = JSON.parse(login.body).token;
  assert.ok(token.includes("."));

  const ticket = await main_handler(
    event(
      "/upload-ticket",
      "POST",
      {
        category: "overseas",
        title: "测试海外漫剧",
        files: [
          { kind: "video", type: "video/mp4", size: 5_000_000 },
          { kind: "poster", type: "image/jpeg", size: 500_000 },
        ],
      },
      token,
    ),
  );
  assert.equal(ticket.statusCode, 200);
  const uploads = JSON.parse(ticket.body).uploads;
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every((upload) => upload.key.startsWith("portfolio/works/overseas/")));

  const publish = await main_handler(
    event(
      "/works",
      "POST",
      {
        category: "overseas",
        title: "测试海外漫剧",
        duration: "15.1s",
        format: "竖屏",
        role: "公司项目 · 参与制作",
        summary: "测试自动发布。",
        published: true,
        videoKey: uploads.find((upload) => upload.kind === "video").key,
        posterKey: uploads.find((upload) => upload.kind === "poster").key,
      },
      token,
    ),
  );
  assert.equal(publish.statusCode, 201);
  const work = JSON.parse(publish.body).work;
  assert.equal(work.category, "overseas");
  assert.ok(work.video.startsWith("https://test-bucket-1250000000.cos.ap-guangzhou.myqcloud.com/portfolio/works/"));
  assert.equal(JSON.parse(savedCatalog).works.length, 1);

  const noToken = await main_handler(event("/works", "POST", {}));
  assert.equal(noToken.statusCode, 401);

  const blockedOrigin = await main_handler({ ...event("/health", "GET"), headers: { origin: "https://evil.example" } });
  assert.equal(blockedOrigin.statusCode, 403);

  console.log(JSON.stringify({ ok: true, routes: ["health", "session", "upload-ticket", "works"] }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
