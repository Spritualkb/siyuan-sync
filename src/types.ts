export type BackupTarget = "workspace" | "data" | "conf" | "repo";
export type BackupComponentType = "data" | "conf" | "repo";
export type SnapshotReason = "manual" | "auto";

export interface KernelPaths {
    workspaceDir: string;
    dataDir: string;
    confDir: string;
    repoDir: string;
}

export interface KernelInfo {
    system: {
        kernelVersion: string;
        os: string;
        container: string;
    };
    paths: KernelPaths;
    existence: Record<BackupTarget, boolean>;
    fetchedAt: string;
}

export interface AccessTokenInfo {
    token: string;
    expiredAt: string;
}

export interface BackupRecord {
    category: BackupTarget;
    component: BackupComponentType;
    md5: string;
    size: number;
    timestamp: string;
    remoteFileId?: number;
    remoteFileName?: string;
    remoteEtag?: string;
}

export interface SnapshotComponent {
    category: BackupTarget;
    component: BackupComponentType;
    file: File;
    md5: string;
    size: number;
    createdAt: string;
    sourcePath?: string;
    tempFilePath?: string; // 临时文件路径,上传完成后需要清理
    meta?: Record<string, unknown>;
}

export interface LocalSnapshot {
    id: string;
    createdAt: string;
    reason: SnapshotReason;
    components: SnapshotComponent[];
}

export interface SnapshotRemoteComponent {
    category: BackupTarget;
    component: BackupComponentType;
    fileId: number;
    fileName: string;
    md5: string;
    size: number;
    uploadedAt: string;
    meta?: Record<string, unknown>;
}

export interface SnapshotRemoteMeta {
    id: string;
    createdAt: string;
    reason: SnapshotReason;
    folderId: number;
    components: SnapshotRemoteComponent[];
}

// 文件夹同步配置
export interface FolderSyncConfig {
    id: string; // 唯一标识
    name: string; // 配置名称
    localPath: string; // 本地文件夹路径
    remotePath: string; // 远程文件夹路径（相对于remoteFolderName）
    password: string; // 加密密码
    enabled: boolean; // 是否启用
    syncMode: "full" | "incremental"; // 同步模式：全量/增量
    lastSyncAt?: string; // 上次同步时间
    fileMetadata?: Record<string, FolderFileMetadata>; // 文件元数据（用于增量同步）
}

// 文件元数据
export interface FolderFileMetadata {
    path: string; // 相对路径
    size: number;
    modifiedAt: number; // 修改时间戳
    md5: string;
    encrypted: boolean;
    remoteFileId?: number;
}

export interface PluginSettings {
    clientId: string;
    clientSecret: string;
    accessToken?: AccessTokenInfo;
    remoteFolderName: string;
    remoteFolderId?: number;
    selectedTargets: Record<BackupTarget, boolean>;
    autoBackupEnabled: boolean;
    autoBackupOnClose: boolean;
    autoBackupDailyLimit: number;
    retentionDays: number;
    maxSnapshots: number;
    backupHistory: BackupRecord[];
    autoBackupTracker: Record<string, number>;
    lastManualBackupAt?: string;
    lastAutoBackupAt?: string;
    lastKnownPaths?: KernelPaths;
    lastKnownExistence?: Record<BackupTarget, boolean>;
    snapshots?: SnapshotRemoteMeta[];
    folderSyncConfigs?: FolderSyncConfig[]; // 文件夹同步配置列表
    
    // 多设备同步设置
    enableDeviceSync?: boolean; // 是否启用多设备同步
    syncOnOpen?: boolean; // 打开时自动同步
    syncOnClose?: boolean; // 关闭时自动同步
    syncConflictStrategy?: "keepBoth" | "keepNewer" | "keepLocal" | "keepRemote"; // 冲突策略
    lastSyncAt?: string; // 最后同步时间
    deviceName?: string; // 设备名称
}
