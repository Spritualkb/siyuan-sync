# 更新日志 / Changelog

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

