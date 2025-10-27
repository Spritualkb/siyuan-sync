# 更新日志 / Changelog

## [1.0.3] - 2025-10-27

### 修复 / Fixed
- 🐛 **[关键修复]** 彻底修复同步失败问题："The Etag field is required; The Etag value is invalid; 文件大小size不能为空"
  - **深层根因**：多处 `uploadSingle` 调用未传递 `md5` 和 `size` 参数
  - **影响范围**：
    - ❌ instance-id 文件上传
    - ❌ 同步锁文件上传
    - ❌ 云端索引文件上传
    - ❌ 同步历史文件上传
    - ✅ 主数据文件上传（已有 md5/size）
  - **解决方案**：
    - 修改 `UploadSingleOptions` 接口，`md5` 和 `size` 改为可选参数
    - 在 `uploadSingle` 方法内部自动计算缺失的 MD5 和 size
    - 新增 `computeFileMd5` 方法，支持大文件流式计算

### 改进 / Improved
- 🔧 上传流程更加健壮，自动处理缺失的文件元数据
- 🔧 统一 MD5 计算逻辑，确保所有文件上传都有正确的哈希值
- 🔧 提升代码容错性，减少因参数缺失导致的错误

### 技术细节 / Technical Details
```typescript
// 修复前：必填参数，很多调用缺失
interface UploadSingleOptions {
    md5: string;  // ❌ 必填，但很多地方没传
    size: number; // ❌ 必填，但很多地方没传
}

// 修复后：可选参数，自动计算
interface UploadSingleOptions {
    md5?: string;  // ✅ 可选，未提供时自动计算
    size?: number; // ✅ 可选，未提供时从 file 获取
}
```

---

## [1.0.2] - 2025-10-27

### 修复 / Fixed
- 🐛 **[关键修复]** 修复同步失败问题："The Etag field is required; The Etag value is invalid; 文件大小size不能为空"
  - **根因**：`/api/file/readDir` API 不返回文件的 `md5` 和 `size` 字段
  - **解决方案**：修改 `uploadLocalFileToCloud` 方法，返回上传时计算的真实 MD5 和 size
  - **影响范围**：云端索引现在正确存储文件元数据，确保后续同步操作的准确性

### 改进 / Improved
- 🔧 优化上传日志，显示实际的 MD5 和文件大小
- 🔧 改进本地文件元数据更新机制，确保 fileId、md5、size 同步更新

### 技术细节 / Technical Details
- 修改 `SyncUtils.uploadLocalFileToCloud` 返回类型：`Promise<number>` → `Promise<{fileId: number; md5: string; size: number}>`
- 修改 `SyncManager.uploadFileToCloud` 使用上传返回的完整元数据更新索引
- 确保云端索引 (CloudIndexV2) 的 `md5` 和 `size` 字段始终有效

---

## [1.0.1] - 2025-10-27

### 新增 / Added
- ✨ 多设备同步功能
  - 支持通过123网盘在多个设备间同步思源笔记数据
  - 四种冲突处理策略：保留两者、保留较新、保留本地、保留远程
  - 同步历史跟踪和锁机制防止并发冲突
  
- ✨ 云端索引管理系统 (CloudIndexV2)
  - 文件元数据永久存储，包含 fileId、MD5、大小等
  - 增量索引更新，提升同步效率
  - 支持索引完整性验证

- ✨ 123网盘API增强
  - 新增 `recoverFiles()` - 从回收站恢复文件
  - 新增 `permanentDeleteFiles()` - 彻底删除文件
  - 新增 `searchFiles()` - 全局文件搜索

### 改进 / Improved
- 🔧 文件列表自动过滤回收站文件
- 🔧 添加文件名/文件夹名合法性验证
- 🔧 批量操作添加100个文件限制检查
- 🔧 改进下载错误处理（流量限制、文件不存在等）
- 🔧 完善同步错误记录和报告机制
- 🔧 冲突处理支持创建冲突副本文件

### 修复 / Fixed
- 🐛 修复索引文件更新时机不当导致 fileId 丢失
- 🐛 修复并发同步可能导致的数据竞争
- 🐛 修复删除操作未更新索引的问题
- 🐛 修复 `showMessage` 类型错误
- 🐛 修复 JSZip 导入和类型断言问题
- 🐛 修复 Uint8Array 类型兼容性问题

### 技术改进 / Technical
- 📝 新增完整架构文档 (ARCHITECTURE.md)
- 📝 新增深度逻辑分析报告
- 📝 新增文件操作分析报告
- 🧪 添加详细的测试计划
- 🏗️ 重构同步管理器，使用云端索引作为权威数据源
- 🏗️ 优化数据流，确保索引实时更新

### 同步范围 / Sync Scope
- 📁 主数据目录 (data/)
- 📁 配置目录 (data/.siyuan)
- 📁 插件目录 (data/plugins)
- 📁 模板目录 (data/templates)
- 📁 挂件目录 (data/widgets)
- 📁 Emoji目录 (data/emojis)
- 📁 存储目录 (data/storage/av, data/storage/riff)
- 📁 外观配置 (conf/appearance/themes, conf/appearance/icons)
- 📁 代码片段 (data/snippets)
- 📁 Petal存储 (data/storage/petal)

---

## [1.0.0] - 初始版本

### 功能 / Features
- ✨ 快照备份与恢复
  - 支持 workspace、data、conf、repo 四种备份目标
  - 自动备份和定时备份
  - 快照管理和清理
  
- ✨ 123网盘集成
  - OAuth认证和Token自动刷新
  - 小文件单步上传
  - 大文件分片上传（支持断点续传）
  - 秒传功能
  
- ✨ 文件夹同步
  - 支持加密文件夹同步
  - 全量和增量模式

---

## 版本规范 / Version Convention

- **主版本号 (Major)**: 不兼容的 API 修改
- **次版本号 (Minor)**: 向下兼容的功能性新增
- **修订号 (Patch)**: 向下兼容的问题修正

---

**项目地址**: https://github.com/Spritualkb/siyuan-sync  
**许可证**: AGPL-3.0

