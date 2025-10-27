# SiYuan-Sync 架构文档

## 项目概述

SiYuan-Sync 是一个思源笔记的备份、恢复和多设备同步插件，通过 123 网盘作为存储后端。

**版本**: v2.0.0  
**最后更新**: 2025-10-27

---

## 核心功能

### 1. 快照备份与恢复
- 创建本地快照（支持 workspace、data、conf、repo）
- 上传快照到 123 网盘
- 从 123 网盘下载并恢复快照
- 自动清理过期快照

### 2. 多设备同步
- 基于时间戳的双向同步
- 四种冲突处理策略
- 同步历史跟踪
- 锁机制防止并发

### 3. 文件夹同步
- 加密文件夹同步
- 支持全量和增量模式

---

## 架构设计

### 总体架构

```
┌─────────────────────────────────────────────────────────┐
│                    SiYuan Note                           │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │           SiYuan-Sync Plugin                    │    │
│  │                                                  │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────┐│    │
│  │  │   Backup &   │  │  Multi-Device│  │Folder ││    │
│  │  │   Restore    │  │     Sync     │  │ Sync  ││    │
│  │  └──────────────┘  └──────────────┘  └───────┘│    │
│  │          │                  │              │    │    │
│  │          └──────────┬───────┴──────────────┘    │    │
│  │                     │                            │    │
│  │          ┌──────────▼────────────┐              │    │
│  │          │   Pan123Client         │              │    │
│  │          │  (123盘API封装)        │              │    │
│  │          └────────────────────────┘              │    │
│  └────────────────────────────────────────────────┘    │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  123 Pan    │
                    │  Cloud      │
                    └─────────────┘
```

---

## 目录结构

```
siyuan-sync/
├── src/
│   ├── index.ts              # 主入口，插件生命周期
│   ├── types.ts              # TypeScript 类型定义
│   ├── index.scss            # 样式文件
│   │
│   ├── services/             # 外部服务集成
│   │   ├── pan123.ts        # 123 网盘 API 客户端
│   │   └── folder-sync.ts   # 文件夹同步管理器
│   │
│   ├── sync/                 # 多设备同步核心
│   │   ├── sync-manager.ts  # 同步管理器（核心逻辑）
│   │   ├── remote.ts        # 远程连接抽象
│   │   ├── storage-item.ts  # 文件/目录抽象
│   │   ├── sync-history.ts  # 同步历史管理
│   │   ├── sync-utils.ts    # 同步工具函数
│   │   ├── sync-targets.ts  # 同步目标配置
│   │   ├── conflict-handler.ts # 冲突处理器
│   │   └── index.ts         # 模块导出
│   │
│   ├── utils/                # 工具函数
│   │   ├── md5.ts           # MD5 计算（SparkMD5）
│   │   ├── md5-stream.ts    # 流式 MD5 计算
│   │   ├── crypto.ts        # 加密工具
│   │   ├── base64.ts        # Base64 编解码
│   │   └── progress.ts      # 进度对话框
│   │
│   └── i18n/                 # 国际化
│       ├── zh_CN.json       # 中文翻译
│       └── en_US.json       # 英文翻译
│
├── scripts/                  # 测试脚本
│   ├── test-pan123-api.js   # 测试 123 网盘 API
│   ├── test-upload-*.js     # 测试上传流程
│   └── test-md5*.js         # 测试 MD5 计算
│
├── dist/                     # 编译输出
├── package/                  # 打包输出
├── tsconfig.json            # TypeScript 配置
├── webpack.config.js        # Webpack 配置
├── package.json             # 项目配置
├── plugin.json              # 插件元信息
└── README_zh_CN.md          # 使用文档
```

---

## 核心模块详解

### 1. index.ts - 主入口

**职责**:
- 插件生命周期管理（onload, beforeunload）
- UI 渲染（设置面板、按钮）
- 协调各个功能模块
- 设置管理

**关键方法**:
```typescript
class SiyuanSyncPlugin extends Plugin {
    async onload()              // 插件加载
    beforeunload()              // 插件卸载前
    
    // 备份与恢复
    async runBackup()           // 执行备份
    async runRestore()          // 执行恢复
    async createLocalSnapshot() // 创建本地快照
    async restoreSnapshot()     // 恢复快照
    
    // 多设备同步
    async runDeviceSync()       // 执行多设备同步
    
    // 文件夹同步
    async runFolderSync()       // 执行文件夹同步
    
    // 设置管理
    async loadSettings()        // 加载设置
    async saveSettings()        // 保存设置
    initSettingUI()            // 初始化设置UI
}
```

---

### 2. services/pan123.ts - 123 网盘客户端

**职责**:

- 封装 123 网盘 Open API
- 处理认证和 Token 刷新
- 文件上传/下载/删除/列表
- 错误处理和重试

**关键方法**:
```typescript
class Pan123Client {
    // 认证
    async getAccessToken()      // 获取访问令牌
    
    // 文件操作
    async listFiles(parentId)   // 列出文件
    async uploadSingle(options) // 上传单个文件
    async uploadSlice(options)  // 分片上传（大文件）
    async deleteFiles(fileIds)  // 删除文件
    async getDownloadUrl(fileId)// 获取下载链接
    
    // 文件夹操作
    async createFolder(name, parentId) // 创建文件夹
}
```

---

### 3. sync/sync-manager.ts - 多设备同步管理器

**职责**:

- 协调本地和云端的文件同步
- 冲突检测和处理
- 同步历史管理
- 锁机制管理

**核心流程**:
```typescript
class SyncManager {
    async sync() {
        // 1. 初始化 remotes (本地和云端)
        const [localRemote, cloudRemote] = await this.initializeRemotes();
        
        // 2. 获取同步锁
        await this.acquireLock();
        
        try {
            // 3. 加载同步历史
            await this.loadSyncHistories(localRemote, cloudRemote);
            
            // 4. 同步所有目标目录
            for (const target of syncTargets) {
                await this.syncDirectory(target.path, ...);
            }
            
            // 5. 更新同步历史
            await SyncHistory.updateSyncHistories(...);
            
        } finally {
            // 6. 释放锁
            await this.releaseLock();
        }
    }
}
```

---

### 4. sync/remote.ts - 远程连接抽象

**职责**:

- 抽象本地和云端的概念
- 存储实例 ID 和同步历史

**数据结构**:

```typescript
class Remote {
    name: string;              // 名称（本地/云端）
    instanceId?: string;       // 设备唯一标识
    isCloud: boolean;          // 是否为云端
    syncHistory: Map<string, number>; // instanceId -> 时间戳
    
    static local(): Remote     // 创建本地 Remote
    static cloud(): Remote     // 创建云端 Remote
}
```

---

### 5. sync/storage-item.ts - 文件/目录抽象

**职责**:

- 统一表示文件和目录
- 递归存储子项
- 提供遍历和查询接口

**数据结构**:
```typescript
interface FileInfo {
    name: string;
    path: string;
    isDir: boolean;
    updated: number;           // 时间戳（秒）
    size?: number;
    md5?: string;
    fileId?: number;           // 123网盘文件ID
}

class StorageItem {
    path: string;
    item: FileInfo | null;
    files: StorageItem[];      // 子项
    
    addFile(item: FileInfo)
    getAllChildFiles(): StorageItem[]
    getFilesMap(): Map<string, StorageItem>
    
    static joinItems(item1, item2): StorageItem
}
```

---

### 6. sync/sync-history.ts - 同步历史管理

**职责**:

- 加载和保存同步历史
- 查询最后同步时间

**存储格式**:
```json
{
    "instance-id-1": 1698765432,
    "instance-id-2": 1698765433
}
```

**关键方法**:
```typescript
class SyncHistory {
    static async loadLocalSyncHistory(): Promise<Map<string, number>>
    static async loadCloudSyncHistory(...): Promise<Map<string, number>>
    static async saveLocalSyncHistory(...)
    static async saveCloudSyncHistory(...)
    
    static getLastSyncWithRemote(remote, instanceId): number
    static getMostRecentSyncTime(remote): number
}
```

---

### 7. sync/conflict-handler.ts - 冲突处理器

**职责**:
- 检测文件冲突
- 根据策略处理冲突

**冲突检测逻辑**:
```typescript
// 当两个文件都在上次同步后被修改时，视为冲突
localModified = localTimestamp > lastSyncTime
cloudModified = cloudTimestamp > lastSyncTime

if (localModified && cloudModified) {
    // 冲突！
}
```

**冲突策略**:
- `keepNewer`: 保留较新的版本
- `keepLocal`: 保留本地版本
- `keepRemote`: 保留云端版本
- `keepBoth`: 保留两个版本（创建冲突副本）

---

## 数据流

### 多设备同步数据流

```
┌─────────────┐
│  用户触发   │
│   同步      │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────┐
│ 1. 获取/生成实例ID           │
│    - 本地: /data/.siyuan/    │
│            sync/instance-id  │
│    - 云端: 123盘根目录/      │
│            instance-id       │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ 2. 获取同步锁                │
│    - 检查 sync.lock 文件     │
│    - 创建新锁（带时间戳）     │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ 3. 加载同步历史              │
│    - 本地: sync-history.json │
│    - 云端: sync-history.json │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ 4. 获取文件列表              │
│    - 本地: API /file/readDir │
│    - 云端: 从索引文件读取     │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ 5. 比较文件                  │
│    - 合并文件列表            │
│    - 比较时间戳              │
│    - 检测冲突                │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ 6. 同步文件                  │
│    - 上传新增/修改的文件      │
│    - 下载云端新增/修改的文件  │
│    - 删除已删除的文件         │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ 7. 更新同步历史              │
│    - 记录本次同步时间戳       │
│    - 保存到本地和云端         │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ 8. 释放锁                    │
│    - 删除 sync.lock          │
└─────────────────────────────┘
```

---

## 关键算法

### 1. 冲突检测算法

```typescript
function detectConflict(
    localTimestamp: number,
    cloudTimestamp: number,
    localRemote: Remote,
    cloudRemote: Remote
): boolean {
    // 获取上次同步时间
    const localLastSync = localRemote.syncHistory.get(cloudRemote.instanceId);
    const cloudLastSync = cloudRemote.syncHistory.get(localRemote.instanceId);
    
    // 如果两边都没有同步过，不算冲突
    if (!localLastSync && !cloudLastSync) {
        return false;
    }
    
    // 如果时间戳相同，不算冲突
    if (localTimestamp === cloudTimestamp) {
        return false;
    }
    
    // 检查是否两边都在上次同步后被修改
    const localModified = localTimestamp > localLastSync;
    const cloudModified = cloudTimestamp > cloudLastSync;
    
    return localModified && cloudModified;
}
```

### 2. 删除判断算法

```typescript
function shouldDelete(
    missingLocal: boolean,
    existingTimestamp: number,
    localRemote: Remote,
    cloudRemote: Remote
): boolean {
    // 获取共同同步时间
    const commonSync = missingLocal
        ? cloudRemote.syncHistory.get(localRemote.instanceId)
        : localRemote.syncHistory.get(cloudRemote.instanceId);
    
    // 获取最近同步时间
    const mostRecentSync = missingLocal
        ? Math.max(...cloudRemote.syncHistory.values())
        : Math.max(...localRemote.syncHistory.values());
    
    // 判断：共同同步时间 > 文件时间戳 且 >= 最近同步时间
    return commonSync > 0 &&
           commonSync > existingTimestamp &&
           commonSync >= mostRecentSync;
}
```

### 3. 文件路径编码

```typescript
// 将文件路径编码为安全的文件名
// 例如：data/20210101120000-xxx/xxx.sy -> data_20210101120000-xxx_xxx.sy
function encodePathToFileName(path: string): string {
    return path.replace(/^\/+/, "").replace(/\//g, "_");
}
```

---

## 状态管理

### 插件设置 (PluginSettings)

```typescript
interface PluginSettings {
    // 123 网盘认证
    clientId: string;
    clientSecret: string;
    accessToken?: AccessTokenInfo;
    
    // 远程文件夹
    remoteFolderName: string;
    remoteFolderId?: number;
    
    // 备份设置
    selectedTargets: {
        workspace: boolean;
        data: boolean;
        conf: boolean;
        repo: boolean;
    };
    autoBackupEnabled: boolean;
    autoBackupOnClose: boolean;
    autoBackupDailyLimit: number;
    retentionDays: number;
    maxSnapshots: number;
    
    // 快照列表
    snapshots: SnapshotRemoteMeta[];
    
    // 多设备同步设置
    enableDeviceSync: boolean;
    syncOnOpen: boolean;
    syncOnClose: boolean;
    syncConflictStrategy: "keepBoth" | "keepNewer" | "keepLocal" | "keepRemote";
    lastSyncAt?: string;
    deviceName?: string;
    
    // 文件夹同步配置
    folderSyncConfigs: FolderSyncConfig[];
}
```

### 同步状态

- **实例 ID**: 唯一标识每个设备
  - 本地: `/data/.siyuan/sync/instance-id`
  - 云端: `123盘根目录/instance-id`

- **同步历史**: Map<instanceId, timestamp>
  - 本地: `/data/.siyuan/sync/sync-history.json`
  - 云端: `123盘根目录/sync-history.json`

- **同步锁**: 防止并发同步
  - 云端: `123盘根目录/sync.lock`
  - 包含: `{ timestamp, instanceId }`
  - 过期时间: 5分钟

---

## 错误处理策略

### 1. 网络错误
- **策略**: 捕获错误，显示用户友好提示
- **实现**: try-catch 包裹所有网络操作
- **未来**: 添加自动重试机制

### 2. 同步锁冲突
- **检测**: 检查 sync.lock 文件
- **处理**: 
  - 如果锁未过期（<5分钟），抛出错误
  - 如果锁已过期，删除旧锁并创建新锁

### 3. 文件冲突
- **检测**: 比较时间戳和同步历史
- **处理**: 根据用户选择的策略处理
  - keepNewer: 保留较新的
  - keepLocal: 保留本地的
  - keepRemote: 保留云端的
  - keepBoth: 两个都保留

### 4. 部分同步失败
- **策略**: 使用 Promise.allSettled
- **效果**: 某个文件/目录同步失败不影响其他

---

## 性能优化

### 1. 流式 MD5 计算
- 使用 `computeFileMd5Stream` 避免一次性读取大文件
- 分块计算，减少内存占用

### 2. 并发控制
- 使用 `Promise.allSettled` 并发同步多个文件
- 减少总体同步时间

### 3. 索引文件缓存
- 云端文件列表存储为 JSON 索引文件
- 避免每次都遍历 123 网盘文件列表
- 格式: `index_{path}.json`

### 4. 分片上传
- 大文件（>10MB）使用分片上传
- 提高上传成功率和断点续传能力

---

## 安全性考虑

### 1. 认证信息存储
- Client ID 和 Client Secret 存储在插件设置
- Access Token 自动刷新
- 所有设置通过思源的加密存储机制保护

### 2. 文件路径编码
- 使用路径编码避免目录遍历攻击
- 限制同步范围在特定目录

### 3. 文件夹加密同步
- 支持加密后上传
- 密码由用户设置
- 使用 AES 加密算法

---

## 扩展性设计

### 1. 存储后端抽象
当前实现直接使用 123 网盘，但架构上可以抽象为：
```typescript
interface CloudStorage {
    uploadFile(file: File): Promise<string>;
    downloadFile(fileId: string): Promise<Blob>;
    deleteFile(fileId: string): Promise<void>;
    listFiles(folderId: string): Promise<FileInfo[]>;
}
```

### 2. 同步策略插件化
冲突处理策略可以扩展为插件系统：
```typescript
interface ConflictStrategy {
    name: string;
    handle(local: FileInfo, remote: FileInfo): Promise<Resolution>;
}
```

### 3. 事件系统
可以添加事件发布/订阅机制：
```typescript
eventBus.on('sync:started', () => { ... });
eventBus.on('sync:progress', (progress) => { ... });
eventBus.on('sync:completed', (stats) => { ... });
```

---

## 依赖关系

```
index.ts
  ├── services/pan123.ts
  ├── services/folder-sync.ts
  ├── sync/sync-manager.ts
  │     ├── sync/remote.ts
  │     ├── sync/storage-item.ts
  │     ├── sync/sync-history.ts
  │     ├── sync/sync-utils.ts
  │     ├── sync/sync-targets.ts
  │     └── sync/conflict-handler.ts
  ├── utils/progress.ts
  ├── utils/md5-stream.ts
  └── utils/crypto.ts
```

---

## API 接口

### 思源笔记 Kernel API
```typescript
// 文件操作
POST /api/file/readDir       // 读取目录
POST /api/file/getFile        // 读取文件
POST /api/file/putFile        // 写入文件
POST /api/file/removeFile     // 删除文件

// 导入导出
POST /api/export/exportData   // 导出数据
POST /api/import/importData   // 导入数据

// 配置
POST /api/system/getConf      // 获取配置
POST /api/system/exportConf   // 导出配置
POST /api/system/importConf   // 导入配置
```

### 123 网盘 Open API
```typescript
// 认证
POST /api/v1/access_token     // 获取访问令牌

// 文件操作
GET  /api/v1/file/list        // 列出文件
POST /api/v1/file/upload      // 上传文件
POST /api/v1/upload/create    // 创建上传任务
POST /api/v1/upload/list_upload_parts // 列出分片
POST /api/v1/upload/upload_part // 上传分片
POST /api/v1/upload/complete  // 完成上传
POST /api/v1/file/trash       // 删除文件
GET  /api/v1/file/download_info // 获取下载信息

// 文件夹
POST /api/v1/file/mkdir       // 创建文件夹
```

---

## 测试策略

### 单元测试（建议添加）
- sync-manager.ts: 同步逻辑
- conflict-handler.ts: 冲突检测
- sync-utils.ts: 工具函数
- storage-item.ts: 数据结构

### 集成测试（建议添加）
- 完整的同步流程
- 冲突处理流程
- 错误恢复流程

### 手动测试
- scripts/ 目录下的测试脚本
- 真实设备多设备同步测试

---

## 版本历史

### v2.0.0 (2025-10-27)
- ⭐ 新增多设备同步功能
- 四种冲突处理策略
- 同步历史跟踪
- 锁机制防止并发
- 完善的 TypeScript 类型系统

### v1.x
- 快照备份与恢复
- 123 网盘集成
- 文件夹同步
- 自动备份

---

## 未来规划

### v2.1.0
- 添加测试框架
- 实现重试机制
- 优化同步进度显示
- 添加同步统计

### v2.2.0
- 批量上传/下载优化
- 索引缓存优化
- 性能监控
- 错误分类和处理

### v3.0.0
- 插件化架构
- 支持其他云存储后端
- WebSocket 实时同步
- 高级冲突解决

---

## 参考文档

- [思源笔记 API 文档](https://github.com/siyuan-note/siyuan/blob/master/API.md)
- [123 网盘开放平台文档](https://www.123pan.com/open)
- [TypeScript 官方文档](https://www.typescriptlang.org/)
- [Webpack 配置指南](https://webpack.js.org/)

---

**文档维护**: 请在重大架构变更时更新本文档  
**最后更新**: 2025-10-27  
**维护者**: @lkb

