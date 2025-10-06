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
}

export interface SnapshotRemoteMeta {
    id: string;
    createdAt: string;
    reason: SnapshotReason;
    folderId: number;
    components: SnapshotRemoteComponent[];
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
}
