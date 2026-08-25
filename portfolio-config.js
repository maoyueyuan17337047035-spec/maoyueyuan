/*
 * 公开作品目录与私人上传服务的唯一配置入口。
 * apiBaseUrl 会在腾讯云函数创建后填写；不要在这里写 SecretId 或 SecretKey。
 */
window.PORTFOLIO_CONFIG = Object.freeze({
  bucket: "maoyueyuan-1474173929",
  region: "ap-guangzhou",
  publicBaseUrl: "https://maoyueyuan-1474173929.cos.ap-guangzhou.myqcloud.com",
  catalogUrl: "https://maoyueyuan-1474173929.cos.ap-guangzhou.myqcloud.com/portfolio/catalog/works.json",
  apiBaseUrl: "",
  publicWorksHash: "#/works",
});
