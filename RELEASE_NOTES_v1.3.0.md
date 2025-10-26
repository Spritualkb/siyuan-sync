# Release Notes v1.3.0

## 新功能 🎉

### 1. 文件夹加密同步功能

添加了指定本地文件夹加密同步到123网盘的功能，支持以下特性：

- ✅ **加密上传**：使用 AES-256-GCM 加密算法保护文件安全
- ✅ **增量同步**：支持全量和增量两种同步模式
- ✅ **多配置管理**：可以配置多个文件夹同步任务
- ✅ **可视化管理**：直观的UI界面管理同步配置
- ✅ **同步进度显示**：实时显示扫描、加密、上传进度

**使用方法**：

1. 在插件设置中找到"文件夹同步"部分
2. 点击"添加文件夹"按钮
3. 填写配置信息：
   - 配置名称：便于识别的名称
   - 本地路径：要同步的文件夹路径
   - 远程路径：在123网盘中的存储路径
   - 加密密码：用于文件加密的密码
   - 同步模式：选择全量或增量同步
4. 点击"立即同步"开始同步

### 2. 完善的123网盘API支持

新增和完善了多个123网盘API接口：

- ✅ `getFileDetail(fileId)` - 获取单个文件/文件夹详情
- ✅ `renameFile(fileId, newName)` - 重命名文件/文件夹
- ✅ `moveFiles(fileIds[], toParentFileId)` - 移动文件/文件夹
- ✅ `searchFiles(keyword, searchMode)` - 全局搜索文件
- ✅ 修复 `createFolder` 方法的参数顺序和返回值
- ✅ 优化文件列表查询，支持分页和过滤

### 3. 加密工具模块

创建了独立的加密工具模块 `src/utils/crypto.ts`：

- ✅ 使用 Web Crypto API 实现标准加密
- ✅ 支持 AES-256-GCM 加密算法
- ✅ PBKDF2 密钥派生（100,000 次迭代）
- ✅ 随机生成 IV 和 Salt
- ✅ 支持文件加密/解密
- ✅ 提供元数据序列化/反序列化

## 重要修复 🐛

### 1. 修复 "parentID不存在" 错误

**问题**：在创建文件夹或上传文件时，可能会遇到"parentID不存在"的错误。

**解决方案**：
- 改进 `ensureRemoteRootFolder` 方法，添加文件夹有效性验证
- 在使用缓存的 folderId 之前，验证其是否仍然存在
- 如果文件夹被删除或失效，自动重新查找或创建
- 添加详细的日志输出，便于调试

**代码改进**：
```typescript
// 验证缓存的文件夹ID是否仍然有效
const detail = await this.cloudClient.getFileDetail(this.settings.remoteFolderId);
if (detail.type === 1 && detail.trashed === 0 && detail.filename === name) {
    return this.settings.remoteFolderId;
} else {
    // 文件夹失效，重新查找
    this.settings.remoteFolderId = undefined;
}
```

### 2. 修复 "Array buffer allocation failed" 错误

**问题**：在备份大文件（如repo仓库）时，会出现内存分配失败的错误。

**解决方案**：
- 创建 `fetchFileAsBlob` 方法，使用 Blob 代替 ArrayBuffer
- 使用流式MD5计算（`computeFileMd5Stream`），避免一次性读取整个文件
- 优化 `createDataComponent` 和 `createRepoComponent` 方法
- 分块读取和处理大文件，减少内存占用

**性能改进**：
- 支持处理任意大小的文件（测试过 4GB+ 文件）
- MD5计算采用分块处理，默认 2MB 块大小
- 显著降低内存占用，提高稳定性

**代码示例**：
```typescript
// 旧代码（会导致内存问题）
const buffer = await this.fetchBinaryFile(relativeZipPath);
const md5Hash = md5(buffer);
const file = new File([buffer], fileName);

// 新代码（优化后）
const file = await this.fetchFileAsBlob(relativeZipPath, fileName);
const md5Hash = await computeFileMd5Stream(file);
```

## 技术改进 🔧

### 1. 文件夹扫描和同步管理

创建了 `FolderSyncManager` 类（`src/services/folder-sync.ts`）：

- 递归扫描本地文件夹
- 智能增量同步（基于文件修改时间和MD5）
- 自动创建远程文件夹结构
- 上传加密文件和元数据
- 进度回调支持

### 2. 流式MD5计算

实现了 `computeFileMd5Stream` 函数（`src/utils/md5-stream.ts`）：

- 分块读取文件（默认 2MB）
- 支持进度回调
- 完全符合MD5标准
- 内存占用恒定，不受文件大小影响

### 3. UI/UX 改进

- 新增文件夹同步配置界面
- 卡片式配置列表，清晰直观
- 实时显示同步状态和上次同步时间
- 支持启用/禁用配置
- 支持编辑和删除配置
- 添加详细的操作提示和错误信息

## 测试工具 🧪

创建了123网盘API测试脚本 `scripts/test-pan123-api.js`：

- 测试所有API接口（增删改查）
- 测试文件上传流程
- 测试文件夹操作
- 测试搜索功能
- 自动清理测试数据

**运行测试**：
```bash
# 设置环境变量
export PAN123_CLIENT_ID="your_client_id"
export PAN123_CLIENT_SECRET="your_client_secret"

# 运行测试
node scripts/test-pan123-api.js
```

## 国际化 🌍

更新了多语言支持：

**中文翻译**：
- 文件夹同步相关提示
- 加密和上传进度提示
- 错误信息和验证提示

**英文翻译**：
- 完整的英文界面支持
- 对应的错误和提示信息

## 升级说明 📝

从 v1.2.x 升级到 v1.3.0：

1. **自动升级**：直接覆盖安装即可，配置会自动保留
2. **新功能**：升级后会看到新的"文件夹同步"设置项
3. **兼容性**：完全兼容旧版本的所有功能
4. **性能提升**：大文件备份性能显著提升

## 已知问题 ⚠️

1. **文件夹恢复功能**：暂未实现，计划在后续版本中添加
2. **大量小文件**：同步大量小文件时可能较慢（每个文件都需要单独上传）
3. **网络中断**：网络中断后需要手动重新开始同步

## 未来计划 🚀

- [ ] 实现文件夹恢复/下载功能
- [ ] 支持文件夹自动同步（监听文件变化）
- [ ] 优化小文件批量上传
- [ ] 添加同步冲突解决策略
- [ ] 支持断点续传
- [ ] 添加同步历史记录
- [ ] 支持文件过滤规则（.gitignore 风格）

## 贡献者 👥

感谢所有为这个版本做出贡献的开发者！

---

**完整更新日志**：请查看 [CHANGELOG.md](./CHANGELOG.md)

**问题反馈**：[GitHub Issues](https://github.com/Spritualkb/siyuan-sync/issues)

**使用文档**：[README.md](./README.md)

