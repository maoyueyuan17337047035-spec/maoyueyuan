/*
 * 公开作品目录与私人上传服务的唯一配置入口。
 * SecretId 和 SecretKey 只在管理页会话内输入，绝不能写进此文件。
 */
window.PORTFOLIO_CONFIG = Object.freeze({
  bucket: "maouyueyuan-1474173929",
  region: "ap-guangzhou",
  publicBaseUrl: "https://maouyueyuan-1474173929.cos.ap-guangzhou.myqcloud.com",
  catalogUrl: "https://maouyueyuan-1474173929.cos.ap-guangzhou.myqcloud.com/portfolio/catalog/works.json",
  catalogKey: "portfolio/catalog/works.json",
  uploadPrefix: "portfolio/v1/uploads",
  uploadMode: "direct-cos",
  publicWorksHash: "#/works",
});
