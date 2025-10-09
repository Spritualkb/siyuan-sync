## 🚀 v1.1.0 压缩 repo 备份

本次更新专注于提升加密仓库（repo）备份的稳定性与性能：

- ♻️ *全新* repo 备份格式：自动打包为 ZIP，避免 JSON 体积过大导致的 `Invalid string length` 错误
- ⬇️ 压缩二进制内容，显著降低上传体积与耗时
- 🔄 恢复流程支持直接解压 ZIP，还原目录结构

> 建议所有启用 repo 备份的用户升级至 v1.1.0，以获得更可靠的上传体验。

---

## ✨ v1.0.0 正式发布回顾

思源同步助手首个稳定版聚焦于本地快照与 123 网盘云备份的一体化体验。

### 🎯 核心亮点
- ✅ 自动/手动快照与云端同步，覆盖工作空间、数据与配置目录
- ✅ 123 网盘集成，支持一键上传、下载与历史版本恢复
- ✅ 智能保留策略，按数量与天数自动清理冗余快照
- ✅ 新增备份/恢复实时进度提示，关键节点反馈更清晰

### 📦 安装方式
1. 下载 `package.zip`
2. 解压到 `{工作空间}/data/plugins/siyuan-sync`
3. 重启思源笔记，并在插件设置中完成 123 网盘授权

### 🔗 相关链接
- [使用文档（中文）](https://github.com/Spritualkb/siyuan-sync/blob/main/README_zh_CN.md)
- [English Documentation](https://github.com/Spritualkb/siyuan-sync/blob/main/README.md)
- [123 网盘开放平台](https://www.123pan.com/openapi)

---

**Full Changelog**: https://github.com/Spritualkb/siyuan-sync/commits/v1.1.0
