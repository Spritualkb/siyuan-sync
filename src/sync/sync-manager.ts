import {Pan123Client} from "../services/pan123";
import {Remote} from "./remote";
import {SyncHistory} from "./sync-history";
import {SyncUtils} from "./sync-utils";
import {StorageItem} from "./storage-item";
import {ConflictHandler} from "./conflict-handler";
import {getDefaultSyncTargets, SyncTarget, shouldAvoidDeletion} from "./sync-targets";
import {CloudIndexManager, CloudFileInfo} from "./cloud-index";
import {showMessage} from "siyuan";

export enum SyncResult {
    Success = "success",
    Skipped = "skipped",
    Conflict = "conflict",
    Error = "error",
}

/**
 * 同步错误记录
 */
export interface SyncError {
    path: string;
    operation: "upload" | "download" | "delete";
    error: string;
    timestamp: number;
}

/**
 * 同步管理器
 * 负责协调本地和云端之间的文件同步
 */
export class SyncManager {
    private client: Pan123Client;
    private remoteFolderId: number;
    private conflictDetected: boolean = false;
    private i18n: Record<string, string>;
    private conflictStrategy: "keepBoth" | "keepNewer" | "keepLocal" | "keepRemote";
    private cloudIndexManager: CloudIndexManager;
    private syncErrors: SyncError[] = [];

    constructor(
        client: Pan123Client,
        remoteFolderId: number,
        i18n: Record<string, string>,
        conflictStrategy: "keepBoth" | "keepNewer" | "keepLocal" | "keepRemote" = "keepNewer"
    ) {
        this.client = client;
        this.remoteFolderId = remoteFolderId;
        this.i18n = i18n;
        this.conflictStrategy = conflictStrategy;
        this.cloudIndexManager = new CloudIndexManager(client, remoteFolderId);
    }

    /**
     * 获取同步错误列表
     */
    getSyncErrors(): SyncError[] {
        return this.syncErrors;
    }

    /**
     * 清空同步错误列表
     */
    clearSyncErrors(): void {
        this.syncErrors = [];
    }

    /**
     * 执行同步
     */
    async sync(): Promise<void> {
        console.log("Starting sync...");
        this.conflictDetected = false;
        this.syncErrors = [];

        try {
            // 1. 初始化remotes
            const [localRemote, cloudRemote] = await this.initializeRemotes();

            // 1.5 加载云端索引并设置实例ID
            await this.cloudIndexManager.load();
            await this.cloudIndexManager.setInstanceId(cloudRemote.instanceId!);

            // 2. 获取同步锁
            await this.acquireLock();

            try {
                // 3. 加载同步历史
                await this.loadSyncHistories(localRemote, cloudRemote);

                console.log(
                    `Last sync times: Local=${localRemote.lastSyncTime}, Cloud=${cloudRemote.lastSyncTime}`
                );

                // 4. 同步所有目标目录
                const syncTargets = getDefaultSyncTargets();
                console.log(`Syncing ${syncTargets.length} targets...`);

                for (const target of syncTargets) {
                    try {
                        console.log(`Syncing target: ${target.path}`);
                        await this.syncDirectory(
                            target.path,
                            localRemote,
                            cloudRemote,
                            target.excludedItems || [],
                            target
                        );
                    } catch (error) {
                        console.error(`Failed to sync target ${target.path}:`, error);
                        this.syncErrors.push({
                            path: target.path,
                            operation: "upload",
                            error: (error as Error).message,
                            timestamp: Date.now(),
                        });
                        // 继续同步其他目标
                    }
                }

                // 5. 更新同步时间
                const timestamp = Math.floor(Date.now() / 1000);
                localRemote.syncHistory.set(cloudRemote.instanceId!, timestamp);
                cloudRemote.syncHistory.set(localRemote.instanceId!, timestamp);

                // 6. 保存同步历史
                await SyncHistory.updateSyncHistories(
                    this.client,
                    this.remoteFolderId,
                    localRemote,
                    cloudRemote
                );

                console.log("Sync completed successfully");

                // 显示结果消息
                if (this.syncErrors.length > 0) {
                    showMessage(
                        `${this.i18n.syncCompleted || "同步完成"}，但有 ${this.syncErrors.length} 个错误`,
                        6000,
                        "error"
                    );
                } else if (this.conflictDetected) {
                    showMessage(
                        this.i18n.syncCompletedWithConflicts || "同步完成，但检测到冲突",
                        6000,
                        "info"
                    );
                } else {
                    showMessage(
                        this.i18n.syncCompletedSuccessfully || "同步成功完成",
                        3000
                    );
                }
            } finally {
                // 7. 释放锁
                await this.releaseLock();
            }
        } catch (error) {
            console.error("Sync failed:", error);
            showMessage(
                `${this.i18n.syncFailed || "同步失败"}: ${(error as Error).message}`,
                7000,
                "error"
            );
            throw error;
        }
    }

    /**
     * 初始化remotes
     */
    private async initializeRemotes(): Promise<[Remote, Remote]> {
        const localRemote = Remote.local();
        const cloudRemote = Remote.cloud();

        // 获取或生成实例ID
        localRemote.instanceId = await SyncUtils.getLocalInstanceId();
        cloudRemote.instanceId = await SyncUtils.getCloudInstanceId(
            this.client,
            this.remoteFolderId
        );

        console.log(
            `Initialized remotes: Local ID=${localRemote.instanceId}, Cloud ID=${cloudRemote.instanceId}`
        );

        return [localRemote, cloudRemote];
    }

    /**
     * 加载同步历史
     */
    private async loadSyncHistories(
        localRemote: Remote,
        cloudRemote: Remote
    ): Promise<void> {
        const [localHistory, cloudHistory] = await Promise.all([
            SyncHistory.loadLocalSyncHistory(),
            SyncHistory.loadCloudSyncHistory(this.client, this.remoteFolderId),
        ]);

        localRemote.syncHistory = localHistory;
        cloudRemote.syncHistory = cloudHistory;
    }

    /**
     * 获取同步锁
     */
    private async acquireLock(): Promise<void> {
        const lockFileName = "sync.lock";
        const files = await this.client.listFiles(this.remoteFolderId);
        const lockFile = files.find((f) => f.type === 0 && f.filename === lockFileName);

        if (lockFile) {
            const now = Date.now();
            const lockAge = now - (lockFile.createAt || 0);
            const fiveMinutesInMs = 5 * 60 * 1000;

            if (lockAge < fiveMinutesInMs) {
                throw new Error(
                    this.i18n.syncLockAlreadyExists || "同步锁已存在，请稍后再试"
                );
            }

            // 锁文件超过5分钟，视为过期，删除它
            console.log("Removing stale lock file");
            await this.client.deleteFiles([lockFile.fileId]);
        }

        // 创建新的锁文件
        const lockContent = JSON.stringify({
            timestamp: Date.now(),
            instanceId: await SyncUtils.getLocalInstanceId(),
        });
        const blob = new Blob([lockContent], {type: "application/json"});
        const file = new File([blob], lockFileName, {lastModified: Date.now()});

        await this.client.uploadSingle({
            parentId: this.remoteFolderId,
            file,
            filename: lockFileName,
            duplicateStrategy: 2,
        });

        console.log("Acquired sync lock");
    }

    /**
     * 释放同步锁
     */
    private async releaseLock(): Promise<void> {
        try {
            const lockFileName = "sync.lock";
            const files = await this.client.listFiles(this.remoteFolderId);
            const lockFile = files.find((f) => f.type === 0 && f.filename === lockFileName);

            if (lockFile) {
                await this.client.deleteFiles([lockFile.fileId]);
                console.log("Released sync lock");
            }
        } catch (error) {
            console.error("Failed to release sync lock:", error);
            // 不抛出错误，因为锁最终会过期
        }
    }

    /**
     * 同步目录
     */
    private async syncDirectory(
        path: string,
        localRemote: Remote,
        cloudRemote: Remote,
        excludedItems: string[] = [],
        target?: SyncTarget
    ): Promise<void> {
        console.log(`Syncing directory: ${path}`);

        // 获取本地文件列表
        const localItem = await SyncUtils.getLocalDirFilesRecursively(path, excludedItems);

        // 从云端索引获取云端文件
        const cloudFiles = await this.cloudIndexManager.getAllFiles();
        const cloudItem = this.buildCloudItemFromIndex(path, cloudFiles);

        // 合并文件列表
        const combinedItem = StorageItem.joinItems(localItem, cloudItem);

        // 同步所有文件
        const syncPromises: Promise<void>[] = [];

        for (const file of combinedItem.files) {
            if (file.isDir) {
                // 递归同步子目录
                syncPromises.push(
                    this.syncDirectory(file.path, localRemote, cloudRemote, excludedItems, target)
                );
            } else {
                // 同步文件
                syncPromises.push(
                    this.syncFile(
                        file.path,
                        localItem.getFilesMap().get(file.path)?.item || null,
                        cloudItem.getFilesMap().get(file.path)?.item || null,
                        localRemote,
                        cloudRemote,
                        target
                    )
                );
            }
        }

        // 等待所有同步完成
        const results = await Promise.allSettled(syncPromises);
        
        // 记录错误
        results.forEach((result, index) => {
            if (result.status === "rejected") {
                const file = combinedItem.files[index];
                this.syncErrors.push({
                    path: file.path,
                    operation: "upload",
                    error: result.reason?.message || String(result.reason),
                    timestamp: Date.now(),
                });
            }
        });
    }

    /**
     * 从云端索引构建StorageItem
     */
    private buildCloudItemFromIndex(
        basePath: string,
        cloudFiles: Map<string, CloudFileInfo>
    ): StorageItem {
        const storageItem = new StorageItem(basePath);

        // 过滤出属于当前路径的文件
        cloudFiles.forEach((fileInfo, filePath) => {
            // 检查文件是否在当前目录下
            if (filePath.startsWith(basePath + "/") || filePath === basePath) {
                const relativePath = filePath.substring(basePath.length + 1);
                const pathParts = relativePath.split("/");

                // 只添加直接子文件/文件夹
                if (pathParts.length === 1 && pathParts[0]) {
                    storageItem.addFile({
                        name: fileInfo.name,
                        path: fileInfo.path,
                        isDir: fileInfo.isDir,
                        updated: fileInfo.updated,
                        size: fileInfo.size,
                        md5: fileInfo.md5,
                        fileId: fileInfo.fileId,
                    });
                }
            }
        });

        return storageItem;
    }

    /**
     * 同步单个文件
     */
    private async syncFile(
        path: string,
        localFile: any,
        cloudFile: any,
        localRemote: Remote,
        cloudRemote: Remote,
        target?: SyncTarget
    ): Promise<void> {
        // 文件不存在于任一端
        if (!localFile && !cloudFile) {
            console.log(`File does not exist on either side: ${path}`);
            return;
        }

        // 如果设置了 onlyIfMissing，只在文件缺失时同步
        if (target?.options?.onlyIfMissing) {
            if (localFile && cloudFile) {
                console.log(`Skipping ${path} (onlyIfMissing is set and file exists on both sides)`);
                return;
            }
        }

        const localTimestamp = localFile?.updated || 0;
        const cloudTimestamp = cloudFile?.updated || 0;

        // 时间戳相同，跳过
        if (localFile && cloudFile && localTimestamp === cloudTimestamp) {
            console.log(`File unchanged: ${path}`);
            return;
        }

        // 检测冲突（如果目标启用了冲突跟踪）
        const shouldTrackConflicts = target?.options?.trackConflicts !== false;
        if (
            shouldTrackConflicts &&
            localFile &&
            cloudFile &&
            (await ConflictHandler.detectConflict(
                path,
                localTimestamp,
                cloudTimestamp,
                localRemote,
                cloudRemote
            ))
        ) {
            this.conflictDetected = true;
            
            // 根据冲突策略处理
            const shouldSync = await ConflictHandler.handleConflictWithStrategy(
                path,
                localTimestamp,
                cloudTimestamp,
                this.conflictStrategy,
                this.i18n.conflictDetected || "检测到冲突"
            );
            
            // 如果策略要求保留本地或远程，直接返回
            if (!shouldSync) {
                return;
            }
        }

        // 处理删除
        if (!localFile || !cloudFile) {
            await this.handleDeletion(
                path,
                localFile,
                cloudFile,
                localRemote,
                cloudRemote,
                target
            );
            return;
        }

        // 同步较新的文件
        if (localTimestamp > cloudTimestamp) {
            console.log(`Uploading ${path} to cloud (local newer)`);
            await this.uploadFileToCloud(path, localFile);
        } else if (cloudTimestamp > localTimestamp) {
            console.log(`Downloading ${path} from cloud (cloud newer)`);
            await this.downloadFileFromCloud(path, cloudFile);
        }
    }

    /**
     * 处理文件删除
     */
    private async handleDeletion(
        path: string,
        localFile: any,
        cloudFile: any,
        localRemote: Remote,
        cloudRemote: Remote,
        target?: SyncTarget
    ): Promise<void> {
        const missingLocal = !localFile;
        const existingTimestamp = localFile?.updated || cloudFile?.updated || 0;

        const commonSync = missingLocal
            ? SyncHistory.getLastSyncWithRemote(cloudRemote, localRemote.instanceId!)
            : SyncHistory.getLastSyncWithRemote(localRemote, cloudRemote.instanceId!);

        const mostRecentSync = missingLocal
            ? SyncHistory.getMostRecentSyncTime(cloudRemote)
            : SyncHistory.getMostRecentSyncTime(localRemote);

        // 判断是否应该删除
        const shouldDelete =
            commonSync > 0 &&
            commonSync > existingTimestamp &&
            commonSync >= mostRecentSync;

        console.log(
            `Deletion check for ${path}: shouldDelete=${shouldDelete}, ` +
                `commonSync=${commonSync}, existingTimestamp=${existingTimestamp}, ` +
                `mostRecentSync=${mostRecentSync}`
        );

        // 检查是否应该避免删除
        const isDir = localFile?.isDir || cloudFile?.isDir || false;
        const avoidDeletion = target && shouldAvoidDeletion(path, target, isDir);

        if (shouldDelete && !avoidDeletion) {
            if (missingLocal && cloudFile) {
                console.log(`Deleting ${path} from cloud (deleted locally)`);
                try {
                    await SyncUtils.deleteCloudFile(this.client, cloudFile.fileId);
                    // 从云端索引中删除
                    await this.cloudIndexManager.removeFile(path);
                    console.log(`Removed file from cloud index: ${path}`);
                } catch (error) {
                    console.error(`Failed to delete cloud file ${path}:`, error);
                    this.syncErrors.push({
                        path,
                        operation: "delete",
                        error: (error as Error).message,
                        timestamp: Date.now(),
                    });
                    throw error;
                }
            } else if (!missingLocal && localFile) {
                console.log(`Deleting ${path} from local (deleted on cloud)`);
                try {
                    await SyncUtils.deleteLocalFile(path);
                } catch (error) {
                    console.error(`Failed to delete local file ${path}:`, error);
                    this.syncErrors.push({
                        path,
                        operation: "delete",
                        error: (error as Error).message,
                        timestamp: Date.now(),
                    });
                    throw error;
                }
            }
        } else {
            // 同步缺失的文件
            if (missingLocal && cloudFile) {
                console.log(`Downloading ${path} from cloud (missing locally)`);
                await this.downloadFileFromCloud(path, cloudFile);
            } else if (!missingLocal && localFile) {
                console.log(`Uploading ${path} to cloud (missing on cloud)`);
                await this.uploadFileToCloud(path, localFile);
            }
        }
    }

    /**
     * 上传文件到云端，并立即更新索引
     */
    private async uploadFileToCloud(path: string, localFile: any): Promise<void> {
        try {
            const fileName = path.split("/").pop() || "file";
            const encodedFileName = SyncUtils.encodePathToFileName(path);
            
            // 上传文件并获取完整的元数据（fileId, md5, size）
            const uploadResult = await SyncUtils.uploadLocalFileToCloud(
                this.client,
                this.remoteFolderId,
                path,
                fileName
            );
            
            // 立即更新云端索引，使用上传时计算的真实 md5 和 size
            const cloudFileInfo: CloudFileInfo = {
                name: localFile.name,
                path: path,
                encodedFileName: encodedFileName,
                fileId: uploadResult.fileId,
                updated: localFile.updated || Date.now(),
                size: uploadResult.size,  // ✅ 使用上传时的真实大小
                md5: uploadResult.md5,    // ✅ 使用上传时计算的真实MD5
                isDir: false,
            };
            
            await this.cloudIndexManager.updateFile(path, cloudFileInfo);
            console.log(`Updated cloud index for uploaded file: ${path} (size: ${uploadResult.size}, md5: ${uploadResult.md5})`);
            
            // 更新本地文件信息，记录完整元数据
            if (localFile) {
                localFile.fileId = uploadResult.fileId;
                localFile.size = uploadResult.size;
                localFile.md5 = uploadResult.md5;
            }
        } catch (error) {
            console.error(`Failed to upload file ${path}:`, error);
            this.syncErrors.push({
                path,
                operation: "upload",
                error: (error as Error).message,
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    /**
     * 从云端下载文件
     */
    private async downloadFileFromCloud(path: string, cloudFile: any): Promise<void> {
        try {
            await SyncUtils.downloadCloudFileToLocal(
                this.client,
                cloudFile.fileId,
                path,
                cloudFile.updated
            );
        } catch (error) {
            console.error(`Failed to download file ${path}:`, error);
            this.syncErrors.push({
                path,
                operation: "download",
                error: (error as Error).message,
                timestamp: Date.now(),
            });
            throw error;
        }
    }
}

