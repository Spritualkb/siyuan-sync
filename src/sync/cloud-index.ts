import {Pan123Client} from "../services/pan123";

/**
 * 云端索引文件的数据结构 (V2)
 * 作为云端文件信息的权威来源
 */
export interface CloudFileInfo {
    name: string;
    path: string;
    encodedFileName: string; // 在123网盘上的文件名
    fileId: number; // 123网盘文件ID
    updated: number; // 时间戳（秒）
    size: number;
    md5?: string;
    isDir: boolean;
}

export interface CloudIndexV2 {
    version: 2;
    lastUpdated: number; // 索引最后更新时间（毫秒）
    instanceId: string; // 创建此索引的设备ID
    files: {
        [path: string]: CloudFileInfo;
    };
}

/**
 * 云端索引管理器
 * 负责加载、保存和更新云端索引文件
 */
export class CloudIndexManager {
    private client: Pan123Client;
    private remoteFolderId: number;
    private currentIndex: CloudIndexV2 | null = null;
    private indexFileName = "cloud-index-v2.json";

    constructor(client: Pan123Client, remoteFolderId: number) {
        this.client = client;
        this.remoteFolderId = remoteFolderId;
    }

    /**
     * 加载云端索引
     */
    async load(): Promise<CloudIndexV2> {
        if (this.currentIndex) {
            return this.currentIndex;
        }

        try {
            const files = await this.client.listFiles(this.remoteFolderId);
            const indexFile = files.find(
                (f) => f.type === 0 && f.filename === this.indexFileName
            );

            if (!indexFile) {
                console.log("No cloud index found, creating new one");
                this.currentIndex = this.createEmptyIndex();
                return this.currentIndex;
            }

            // 下载并解析索引文件
            const downloadUrl = await this.client.getDownloadUrl(indexFile.fileId);
            const response = await fetch(downloadUrl);

            if (!response.ok) {
                console.error(`Failed to download cloud index: ${response.statusText}`);
                this.currentIndex = this.createEmptyIndex();
                return this.currentIndex;
            }

            const indexData = await response.json();

            // 验证版本
            if (indexData.version !== 2) {
                console.warn(`Cloud index version mismatch: ${indexData.version}, creating new one`);
                this.currentIndex = this.createEmptyIndex();
                return this.currentIndex;
            }

            this.currentIndex = indexData as CloudIndexV2;
            console.log(`Loaded cloud index with ${Object.keys(this.currentIndex.files).length} files`);
            return this.currentIndex;
        } catch (error) {
            console.error("Failed to load cloud index:", error);
            this.currentIndex = this.createEmptyIndex();
            return this.currentIndex;
        }
    }

    /**
     * 保存云端索引
     */
    async save(index?: CloudIndexV2): Promise<void> {
        const indexToSave = index || this.currentIndex;
        if (!indexToSave) {
            throw new Error("No index to save");
        }

        try {
            // 更新时间戳
            indexToSave.lastUpdated = Date.now();

            // 删除旧的索引文件
            const files = await this.client.listFiles(this.remoteFolderId);
            const oldIndexFile = files.find(
                (f) => f.type === 0 && f.filename === this.indexFileName
            );
            if (oldIndexFile) {
                await this.client.deleteFiles([oldIndexFile.fileId]);
            }

            // 上传新的索引文件
            const jsonContent = JSON.stringify(indexToSave, null, 2);
            const blob = new Blob([jsonContent], {type: "application/json"});
            const file = new File([blob], this.indexFileName, {lastModified: Date.now()});

            await this.client.uploadSingle({
                parentId: this.remoteFolderId,
                file,
                filename: this.indexFileName,
                duplicateStrategy: 2, // 覆盖
            });

            this.currentIndex = indexToSave;
            console.log(`Saved cloud index with ${Object.keys(indexToSave.files).length} files`);
        } catch (error) {
            console.error("Failed to save cloud index:", error);
            throw error;
        }
    }

    /**
     * 更新单个文件信息
     */
    async updateFile(path: string, fileInfo: CloudFileInfo): Promise<void> {
        const index = await this.load();
        index.files[path] = fileInfo;
        await this.save(index);
        console.log(`Updated file in cloud index: ${path}`);
    }

    /**
     * 批量更新文件信息
     */
    async updateFiles(files: Map<string, CloudFileInfo>): Promise<void> {
        const index = await this.load();
        files.forEach((fileInfo, path) => {
            index.files[path] = fileInfo;
        });
        await this.save(index);
        console.log(`Updated ${files.size} files in cloud index`);
    }

    /**
     * 删除文件信息
     */
    async removeFile(path: string): Promise<void> {
        const index = await this.load();
        if (index.files[path]) {
            delete index.files[path];
            await this.save(index);
            console.log(`Removed file from cloud index: ${path}`);
        }
    }

    /**
     * 批量删除文件信息
     */
    async removeFiles(paths: string[]): Promise<void> {
        const index = await this.load();
        let removed = 0;
        paths.forEach((path) => {
            if (index.files[path]) {
                delete index.files[path];
                removed++;
            }
        });
        if (removed > 0) {
            await this.save(index);
            console.log(`Removed ${removed} files from cloud index`);
        }
    }

    /**
     * 获取文件信息
     */
    async getFile(path: string): Promise<CloudFileInfo | null> {
        const index = await this.load();
        return index.files[path] || null;
    }

    /**
     * 获取所有文件
     */
    async getAllFiles(): Promise<Map<string, CloudFileInfo>> {
        const index = await this.load();
        return new Map(Object.entries(index.files));
    }

    /**
     * 检查文件是否存在
     */
    async hasFile(path: string): Promise<boolean> {
        const index = await this.load();
        return path in index.files;
    }

    /**
     * 清空索引
     */
    async clear(): Promise<void> {
        const index = await this.load();
        index.files = {};
        await this.save(index);
        console.log("Cleared cloud index");
    }

    /**
     * 设置实例ID
     */
    async setInstanceId(instanceId: string): Promise<void> {
        const index = await this.load();
        index.instanceId = instanceId;
        await this.save(index);
    }

    /**
     * 创建空索引
     */
    private createEmptyIndex(): CloudIndexV2 {
        return {
            version: 2,
            lastUpdated: Date.now(),
            instanceId: "",
            files: {},
        };
    }

    /**
     * 重置缓存（强制重新加载）
     */
    resetCache(): void {
        this.currentIndex = null;
    }

    /**
     * 获取索引统计信息
     */
    async getStats(): Promise<{
        totalFiles: number;
        totalSize: number;
        lastUpdated: number;
        instanceId: string;
    }> {
        const index = await this.load();
        const files = Object.values(index.files);
        const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

        return {
            totalFiles: files.length,
            totalSize,
            lastUpdated: index.lastUpdated,
            instanceId: index.instanceId,
        };
    }
}

