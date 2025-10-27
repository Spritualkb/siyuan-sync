import {Remote} from "./remote";
import {StorageItem, FileInfo} from "./storage-item";
import {Pan123Client} from "../services/pan123";
import {computeFileMd5Stream} from "../utils/md5-stream";

/**
 * 同步工具类
 */
export class SyncUtils {
    /**
     * 生成实例ID
     */
    static generateInstanceId(): string {
        return crypto.randomUUID();
    }

    /**
     * 获取本地实例ID
     */
    static async getLocalInstanceId(): Promise<string> {
        try {
            const response = await fetch("/api/file/getFile", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: "/data/.siyuan/sync/instance-id"}),
            });

            if (response.status === 200) {
                return await response.text();
            }

            // 文件不存在，生成新的实例ID
            const newInstanceId = SyncUtils.generateInstanceId();
            await SyncUtils.setLocalInstanceId(newInstanceId);
            return newInstanceId;
        } catch (error) {
            // 文件不存在，生成新的实例ID
            const newInstanceId = SyncUtils.generateInstanceId();
            await SyncUtils.setLocalInstanceId(newInstanceId);
            return newInstanceId;
        }
    }

    /**
     * 设置本地实例ID
     */
    static async setLocalInstanceId(instanceId: string): Promise<void> {
        const blob = new Blob([instanceId], {type: "text/plain"});
        const file = new File([blob], "instance-id", {lastModified: Date.now()});

        const formData = new FormData();
        formData.append("path", "/data/.siyuan/sync/instance-id");
        formData.append("file", file);
        formData.append("isDir", "false");
        formData.append("modTime", `${Math.floor(Date.now() / 1000)}`);

        await fetch("/api/file/putFile", {
            method: "POST",
            body: formData,
        });
    }

    /**
     * 获取云端实例ID
     */
    static async getCloudInstanceId(
        client: Pan123Client,
        remoteFolderId: number
    ): Promise<string> {
        try {
            const files = await client.listFiles(remoteFolderId);
            const instanceIdFile = files.find(
                (f) => f.type === 0 && f.filename === "instance-id"
            );

            if (!instanceIdFile) {
                // 文件不存在，创建新的实例ID
                const newInstanceId = SyncUtils.generateInstanceId();
                await SyncUtils.setCloudInstanceId(client, remoteFolderId, newInstanceId);
                return newInstanceId;
            }

            const downloadUrl = await client.getDownloadUrl(instanceIdFile.fileId);
            const response = await fetch(downloadUrl);
            return await response.text();
        } catch (error) {
            // 文件不存在，创建新的实例ID
            const newInstanceId = SyncUtils.generateInstanceId();
            await SyncUtils.setCloudInstanceId(client, remoteFolderId, newInstanceId);
            return newInstanceId;
        }
    }

    /**
     * 设置云端实例ID
     */
    static async setCloudInstanceId(
        client: Pan123Client,
        remoteFolderId: number,
        instanceId: string
    ): Promise<void> {
        // 删除旧的实例ID文件
        const files = await client.listFiles(remoteFolderId);
        const oldInstanceIdFile = files.find(
            (f) => f.type === 0 && f.filename === "instance-id"
        );
        if (oldInstanceIdFile) {
            await client.deleteFiles([oldInstanceIdFile.fileId]);
        }

        // 上传新的实例ID文件
        const blob = new Blob([instanceId], {type: "text/plain"});
        const file = new File([blob], "instance-id", {lastModified: Date.now()});

        await client.uploadSingle({
            parentId: remoteFolderId,
            file,
            filename: "instance-id",
            duplicateStrategy: 2,
        });
    }

    /**
     * 递归获取本地目录的文件
     */
    static async getLocalDirFilesRecursively(
        path: string,
        excludedItems: string[] = []
    ): Promise<StorageItem> {
        const storageItem = new StorageItem(path);

        try {
            const response = await fetch("/api/file/readDir", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path}),
            });

            if (response.status !== 0 && !response.ok) {
                return storageItem;
            }

            const result = await response.json();
            if (result.code !== 0 || !result.data) {
                return storageItem;
            }

            const files = result.data as Array<{
                name: string;
                isDir: boolean;
                isSymlink: boolean;
                updated: number;
            }>;

            const filteredFiles = files.filter(
                (f) => !f.isSymlink && !excludedItems.includes(f.name)
            );

            for (const fileData of filteredFiles) {
                const fileInfo: FileInfo = {
                    name: fileData.name,
                    path: `${path}/${fileData.name}`,
                    isDir: fileData.isDir,
                    updated: fileData.updated,
                };
                storageItem.addFile(fileInfo);
            }

            // 递归处理子目录
            const dirPromises = filteredFiles
                .filter((f) => f.isDir)
                .map(async (dir) => {
                    const childPath = `${path}/${dir.name}`;
                    const childItem = await SyncUtils.getLocalDirFilesRecursively(
                        childPath,
                        excludedItems
                    );
                    return childItem;
                });

            const childItems = await Promise.all(dirPromises);

            // 将子项添加到对应的目录
            childItems.forEach((childItem) => {
                const parentFile = storageItem.files.find(
                    (f) => f.path === childItem.path
                );
                if (parentFile) {
                    parentFile.files = childItem.files;
                }
            });

            return storageItem;
        } catch (error) {
            console.error(`Failed to get local dir files for ${path}:`, error);
            return storageItem;
        }
    }

    /**
     * 递归获取云端目录的文件索引
     * 从 123 Pan 上的索引文件中读取文件列表
     */
    static async getCloudDirFilesRecursively(
        client: Pan123Client,
        remoteFolderId: number,
        path: string
    ): Promise<StorageItem> {
        const storageItem = new StorageItem(path);

        try {
            // 查找索引文件
            const indexFileName = SyncUtils.getIndexFileName(path);
            const files = await client.listFiles(remoteFolderId);
            const indexFile = files.find(
                (f) => f.type === 0 && f.filename === indexFileName
            );

            if (!indexFile) {
                console.debug(`No cloud index found for ${path}`);
                return storageItem;
            }

            // 下载并解析索引文件
            const downloadUrl = await client.getDownloadUrl(indexFile.fileId);
            const response = await fetch(downloadUrl);
            
            if (!response.ok) {
                console.error(`Failed to download cloud index for ${path}: ${response.statusText}`);
                return storageItem;
            }
            
            const indexData = await response.json();

            // 从索引数据重建StorageItem
            const cloudItem = StorageItem.fromObject(indexData);
            console.debug(`Loaded ${cloudItem.files.length} files from cloud index for ${path}`);
            return cloudItem;
        } catch (error) {
            console.error(`Failed to get cloud dir files for ${path}:`, error);
            return storageItem;
        }
    }

    /**
     * 上传本地文件索引到云端
     */
    static async uploadLocalIndexToCloud(
        client: Pan123Client,
        remoteFolderId: number,
        storageItem: StorageItem
    ): Promise<void> {
        try {
            const indexFileName = SyncUtils.getIndexFileName(storageItem.path);
            
            // 删除旧的索引文件
            const files = await client.listFiles(remoteFolderId);
            const oldIndexFile = files.find(
                (f) => f.type === 0 && f.filename === indexFileName
            );
            if (oldIndexFile) {
                await client.deleteFiles([oldIndexFile.fileId]);
            }

            // 上传新的索引文件
            const indexData = JSON.stringify(storageItem, null, 2);
            const blob = new Blob([indexData], {type: "application/json"});
            const file = new File([blob], indexFileName, {lastModified: Date.now()});

            await client.uploadSingle({
                parentId: remoteFolderId,
                file,
                filename: indexFileName,
                duplicateStrategy: 2,
            });

            console.log(`Uploaded index for ${storageItem.path}`);
        } catch (error) {
            console.error(`Failed to upload index for ${storageItem.path}:`, error);
            throw error;
        }
    }

    /**
     * 获取索引文件名
     */
    static getIndexFileName(path: string): string {
        // 将路径转换为安全的文件名
        const safePath = path.replace(/\//g, "_").replace(/^_+/, "");
        return `index_${safePath}.json`;
    }

    /**
     * 检查Remotes是否有效
     */
    static checkRemotes(remotes: [Remote, Remote]): void {
        if (!remotes || !Array.isArray(remotes)) {
            throw new Error("remotes is not properly initialized");
        }
        if (remotes.length !== 2) {
            throw new Error(`Expected remotes to have exactly 2 entries, but found ${remotes.length}`);
        }
    }

    /**
     * 上传本地文件到云端
     * 文件名使用路径编码，以避免目录结构问题
     * @returns 包含 fileId, md5, size 的对象
     */
    static async uploadLocalFileToCloud(
        client: Pan123Client,
        remoteFolderId: number,
        localPath: string,
        fileName: string,
        onProgress?: (uploaded: number, total: number) => void
    ): Promise<{fileId: number; md5: string; size: number}> {
        console.log(`Uploading ${localPath} to cloud...`);
        
        // 获取本地文件
        const response = await fetch("/api/file/getFile", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({path: localPath}),
        });

        if (!response.ok) {
            throw new Error(`Failed to get local file: ${localPath}, status: ${response.status}`);
        }

        const blob = await response.blob();
        
        // 使用路径编码的文件名，确保唯一性
        const encodedFileName = SyncUtils.encodePathToFileName(localPath);
        const file = new File([blob], encodedFileName, {lastModified: Date.now()});

        // 计算MD5
        const md5 = await computeFileMd5Stream(file);

        // 先检查是否已存在同名文件，如果存在则删除
        const existingFiles = await client.listFiles(remoteFolderId);
        const existingFile = existingFiles.find(f => f.filename === encodedFileName && f.type === 0);
        if (existingFile) {
            console.log(`Deleting existing cloud file: ${encodedFileName}`);
            await client.deleteFiles([existingFile.fileId]);
        }

        // 上传文件
        const result = await client.uploadSingle({
            parentId: remoteFolderId,
            file,
            filename: encodedFileName,
            md5,
            size: file.size,
            duplicateStrategy: 2, // 覆盖
            onProgress: (uploaded, total) => {
                if (onProgress) {
                    onProgress(uploaded, total);
                }
            },
        });

        console.log(`Uploaded ${localPath} to cloud, fileId: ${result.fileId}, md5: ${md5}, size: ${file.size}`);
        return {
            fileId: result.fileId,
            md5: md5,
            size: file.size,
        };
    }
    
    /**
     * 将文件路径编码为安全的文件名
     * 例如：data/20210101120000-xxx/xxx.sy -> data_20210101120000-xxx_xxx.sy
     */
    static encodePathToFileName(path: string): string {
        // 移除前导斜杠，将路径分隔符替换为下划线
        return path.replace(/^\/+/, "").replace(/\//g, "_");
    }
    
    /**
     * 将文件名解码回文件路径
     * 例如：data_20210101120000-xxx_xxx.sy -> data/20210101120000-xxx/xxx.sy
     */
    static decodeFileNameToPath(fileName: string): string {
        // 这个函数用于调试，实际使用时文件路径来自索引
        return fileName.replace(/_/g, "/");
    }

    /**
     * 从云端下载文件到本地
     */
    static async downloadCloudFileToLocal(
        client: Pan123Client,
        fileId: number,
        localPath: string,
        timestamp: number
    ): Promise<void> {
        console.log(`Downloading cloud file ${fileId} to ${localPath}...`);
        
        // 获取下载URL
        const downloadUrl = await client.getDownloadUrl(fileId);

        // 下载文件
        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${fileId}, status: ${response.statusText}`);
        }

        const blob = await response.blob();
        const fileName = localPath.split("/").pop() || "file";
        const file = new File([blob], fileName, {lastModified: timestamp * 1000});

        // 确保父目录存在
        const parentPath = localPath.substring(0, localPath.lastIndexOf("/"));
        if (parentPath) {
            await SyncUtils.ensureLocalDir(parentPath);
        }

        // 保存到本地
        const formData = new FormData();
        formData.append("path", localPath);
        formData.append("file", file);
        formData.append("isDir", "false");
        formData.append("modTime", `${timestamp}`);

        const putResponse = await fetch("/api/file/putFile", {
            method: "POST",
            body: formData,
        });
        
        if (!putResponse.ok) {
            throw new Error(`Failed to save file to local: ${localPath}`);
        }
        
        console.log(`Downloaded ${localPath} from cloud`);
    }
    
    /**
     * 确保本地目录存在
     */
    private static async ensureLocalDir(path: string): Promise<void> {
        const segments = path.split("/").filter(Boolean);
        let current = "";
        
        for (const segment of segments) {
            current += `/${segment}`;
            try {
                const response = await fetch("/api/file/readDir", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({path: current}),
                });
                
                if (response.ok) {
                    continue; // 目录已存在
                }
            } catch (error) {
                // 目录不存在，需要创建
            }
            
            // 创建目录
            const formData = new FormData();
            formData.append("path", current);
            formData.append("isDir", "true");
            formData.append("modTime", `${Math.floor(Date.now() / 1000)}`);
            
            await fetch("/api/file/putFile", {
                method: "POST",
                body: formData,
            });
        }
    }

    /**
     * 删除本地文件
     */
    static async deleteLocalFile(path: string): Promise<void> {
        await fetch("/api/file/removeFile", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({path}),
        });
    }

    /**
     * 删除云端文件
     */
    static async deleteCloudFile(client: Pan123Client, fileId: number): Promise<void> {
        await client.deleteFiles([fileId]);
    }
}

