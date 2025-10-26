/**
 * 文件夹同步管理模块
 * 负责扫描本地文件夹、加密文件、上传到云端
 */

import {FolderSyncConfig, FolderFileMetadata} from "../types";
import * as SparkMD5 from "spark-md5";
import {encryptFile, serializeEncryptionMetadata} from "../utils/crypto";
import {Pan123Client} from "./pan123";

/**
 * 同步进度回调
 */
export interface SyncProgress {
    phase: "scan" | "encrypt" | "upload" | "complete" | "error";
    message: string;
    current?: number;
    total?: number;
    percentage?: number;
}

/**
 * 文件扫描结果
 */
interface ScannedFile {
    relativePath: string;
    absolutePath: string;
    size: number;
    modifiedAt: number;
}

/**
 * 文件夹同步管理器
 */
export class FolderSyncManager {
    private cloudClient: Pan123Client;

    constructor(cloudClient: Pan123Client) {
        this.cloudClient = cloudClient;
    }

    /**
     * 执行文件夹同步
     */
    async syncFolder(
        config: FolderSyncConfig,
        remoteBaseFolderId: number,
        onProgress?: (progress: SyncProgress) => void
    ): Promise<FolderSyncConfig> {
        try {
            // 1. 扫描本地文件夹
            if (onProgress) {
                onProgress({
                    phase: "scan",
                    message: `正在扫描文件夹: ${config.localPath}`,
                });
            }

            const scannedFiles = await this.scanFolder(config.localPath);
            console.log(`[FolderSync] 扫描到 ${scannedFiles.length} 个文件`);

            // 2. 确定需要同步的文件
            const filesToSync = this.determineFilesToSync(scannedFiles, config);
            console.log(`[FolderSync] 需要同步 ${filesToSync.length} 个文件`);

            if (filesToSync.length === 0) {
                if (onProgress) {
                    onProgress({
                        phase: "complete",
                        message: "没有文件需要同步",
                        percentage: 100,
                    });
                }
                return config;
            }

            // 3. 确保远程文件夹存在
            const remoteFolderId = await this.ensureRemoteFolder(
                remoteBaseFolderId,
                config.remotePath
            );

            // 4. 加密并上传文件
            const newMetadata: Record<string, FolderFileMetadata> = config.fileMetadata || {};
            
            for (let i = 0; i < filesToSync.length; i++) {
                const file = filesToSync[i];
                
                if (onProgress) {
                    onProgress({
                        phase: "upload",
                        message: `正在上传: ${file.relativePath}`,
                        current: i + 1,
                        total: filesToSync.length,
                        percentage: ((i + 1) / filesToSync.length) * 100,
                    });
                }

                try {
                    const metadata = await this.syncFile(
                        file,
                        config.password,
                        remoteFolderId
                    );
                    newMetadata[file.relativePath] = metadata;
                } catch (error) {
                    console.error(`[FolderSync] 文件同步失败: ${file.relativePath}`, error);
                    throw error;
                }
            }

            // 5. 更新配置
            const updatedConfig: FolderSyncConfig = {
                ...config,
                lastSyncAt: new Date().toISOString(),
                fileMetadata: newMetadata,
            };

            if (onProgress) {
                onProgress({
                    phase: "complete",
                    message: `同步完成，共上传 ${filesToSync.length} 个文件`,
                    percentage: 100,
                });
            }

            return updatedConfig;
        } catch (error) {
            if (onProgress) {
                onProgress({
                    phase: "error",
                    message: `同步失败: ${(error as Error).message}`,
                });
            }
            throw error;
        }
    }

    /**
     * 扫描本地文件夹
     */
    private async scanFolder(folderPath: string): Promise<ScannedFile[]> {
        const files: ScannedFile[] = [];
        
        try {
            // 使用思源API读取目录
            const response = await fetch("/api/file/readDir", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: folderPath}),
            });

            const result = await response.json();
            if (result.code !== 0) {
                throw new Error(`读取目录失败: ${result.msg}`);
            }

            // 递归扫描所有文件
            await this.scanFolderRecursive(folderPath, "", files);
        } catch (error) {
            console.error("[FolderSync] 扫描文件夹失败", error);
            throw new Error(`扫描文件夹失败: ${(error as Error).message}`);
        }

        return files;
    }

    /**
     * 递归扫描文件夹
     */
    private async scanFolderRecursive(
        basePath: string,
        relativePath: string,
        files: ScannedFile[]
    ): Promise<void> {
        const currentPath = relativePath ? `${basePath}/${relativePath}` : basePath;
        
        try {
            const response = await fetch("/api/file/readDir", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: currentPath}),
            });

            const result = await response.json();
            if (result.code !== 0) {
                throw new Error(`读取目录失败: ${result.msg}`);
            }

            for (const item of result.data) {
                const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;
                const itemAbsolutePath = `${basePath}/${itemRelativePath}`;

                if (item.isDir) {
                    // 递归扫描子目录
                    await this.scanFolderRecursive(basePath, itemRelativePath, files);
                } else {
                    // 添加文件
                    files.push({
                        relativePath: itemRelativePath,
                        absolutePath: itemAbsolutePath,
                        size: 0, // 需要通过getFile获取
                        modifiedAt: item.updated || Date.now(),
                    });
                }
            }
        } catch (error) {
            console.error(`[FolderSync] 扫描子目录失败: ${currentPath}`, error);
            throw error;
        }
    }

    /**
     * 确定需要同步的文件（增量同步）
     */
    private determineFilesToSync(
        scannedFiles: ScannedFile[],
        config: FolderSyncConfig
    ): ScannedFile[] {
        if (config.syncMode === "full") {
            // 全量同步：所有文件
            return scannedFiles;
        }

        // 增量同步：只同步新增或修改的文件
        const existingMetadata = config.fileMetadata || {};
        return scannedFiles.filter((file) => {
            const existing = existingMetadata[file.relativePath];
            if (!existing) {
                // 新文件
                return true;
            }
            // 检查文件是否被修改
            return file.modifiedAt > new Date(existing.modifiedAt).getTime();
        });
    }

    /**
     * 确保远程文件夹存在
     */
    private async ensureRemoteFolder(baseFolderId: number, remotePath: string): Promise<number> {
        if (!remotePath) {
            return baseFolderId;
        }

        const parts = remotePath.split("/").filter((p) => p);
        let currentFolderId = baseFolderId;

        for (const part of parts) {
            // 检查文件夹是否存在
            const files = await this.cloudClient.listFiles(currentFolderId, 100);
            const existing = files.find((f) => f.filename === part && f.type === 1);

            if (existing) {
                currentFolderId = existing.fileId;
            } else {
                // 创建文件夹
                const folder = await this.cloudClient.createFolder(currentFolderId, part);
                currentFolderId = folder.fileId;
            }
        }

        return currentFolderId;
    }

    /**
     * 同步单个文件
     */
    private async syncFile(
        file: ScannedFile,
        password: string,
        remoteFolderId: number
    ): Promise<FolderFileMetadata> {
        try {
            // 1. 读取文件
            const response = await fetch("/api/file/getFile", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: file.absolutePath}),
            });

            if (!response.ok) {
                throw new Error(`读取文件失败: ${file.absolutePath}`);
            }

            const blob = await response.blob();
            const fileObj = new File([blob], file.relativePath.split("/").pop() || "file");

            // 2. 计算原始文件MD5（用于元数据）
            const buffer = await fileObj.arrayBuffer();
            const spark1 = new SparkMD5.ArrayBuffer();
            spark1.append(buffer);
            const fileMd5 = spark1.end().toLowerCase();

            // 3. 加密文件
            const encrypted = await encryptFile(fileObj, password);
            const encryptedFile = new File(
                [encrypted.blob],
                fileObj.name + ".encrypted",
                {type: "application/octet-stream"}
            );

            // 4. 计算加密后文件的MD5（用于上传）
            const encryptedBuffer = await encryptedFile.arrayBuffer();
            const spark2 = new SparkMD5.ArrayBuffer();
            spark2.append(encryptedBuffer);
            const encryptedMd5 = spark2.end().toLowerCase();

            // 5. 上传到云端
            const uploadResult = await this.cloudClient.uploadSingle({
                parentId: remoteFolderId,
                file: encryptedFile,
                filename: fileObj.name + ".enc",
                md5: encryptedMd5,
                size: encryptedFile.size,
                duplicateStrategy: 2,
                onProgress: () => {
                    // 进度回调可以在这里处理
                },
            });

            // 6. 保存加密元数据（作为额外的元数据文件）
            const metadataContent = serializeEncryptionMetadata(encrypted.iv, encrypted.salt);
            const metadataBlob = new Blob([metadataContent], {type: "application/json"});
            const metadataFile = new File([metadataBlob], fileObj.name + ".meta");
            const metadataBuffer = await metadataFile.arrayBuffer();
            const spark3 = new SparkMD5.ArrayBuffer();
            spark3.append(metadataBuffer);
            const metadataMd5 = spark3.end().toLowerCase();
            
            await this.cloudClient.uploadSingle({
                parentId: remoteFolderId,
                file: metadataFile,
                filename: fileObj.name + ".meta",
                md5: metadataMd5,
                size: metadataFile.size,
                duplicateStrategy: 2,
            });

            // 6. 返回文件元数据
            return {
                path: file.relativePath,
                size: file.size,
                modifiedAt: file.modifiedAt,
                md5: fileMd5,
                encrypted: true,
                remoteFileId: uploadResult.fileId,
            };
        } catch (error) {
            console.error(`[FolderSync] 文件同步失败: ${file.relativePath}`, error);
            throw error;
        }
    }

    /**
     * 下载并解密文件
     */
    async downloadAndDecryptFile(
        remoteFileId: number,
        metadataFileId: number,
        password: string,
        targetPath: string
    ): Promise<void> {
        // 实现下载和解密逻辑
        // 这个功能留待后续实现
        throw new Error("Not implemented yet");
    }
}

