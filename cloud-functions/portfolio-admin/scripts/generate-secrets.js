"use strict";

const crypto = require("crypto");

const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 14) {
  console.error("请先通过 ADMIN_PASSWORD 环境变量提供至少 14 位的管理密码。" );
  process.exit(1);
}

const salt = crypto.randomBytes(24).toString("hex");
const hash = crypto.scryptSync(password, salt, 64).toString("hex");
const sessionSecret = crypto.randomBytes(48).toString("hex");

console.log(`ADMIN_PASSWORD_SALT=${salt}`);
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log(`SESSION_SECRET=${sessionSecret}`);
