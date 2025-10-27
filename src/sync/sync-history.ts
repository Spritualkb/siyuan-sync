import {Remote} from "./remote";
import {Pan123Client} from "../services/pan123";

/**
 * 同步历史管理
 * 负责加载和保存同步历史记录
 */
export class SyncHistory {
    /**
     * 从本地加载同步历史
     */
    static async loadLocalSyncHistory(): Promise<Map<string, number>> {
        try {
            const response = await fetch("/api/file/getFile", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: "/data/.siyuan/sync/sync-history.json"}),
            });

            if (response.status === 200) {
                const text = await response.text();
                const data = JSON.parse(text);
                return new Map(Object.entries(data));
            }

            return new Map();
        } catch (error) {
            console.debug("No local sync history found:", error);
            return new Map();
        }
    }

    /**
     * 从云端加载同步历史
     */
    static async loadCloudSyncHistory(
        client: Pan123Client,
        remoteFolderId: number
    ): Promise<Map<string, number>> {
        try {
            const files = await client.listFiles(remoteFolderId);
            const historyFile = files.find(
                (f) => f.type === 0 && f.filename === "sync-history.json"
            );

            if (!historyFile) {
                return new Map();
            }

            const downloadUrl = await client.getDownloadUrl(historyFile.fileId);
            const response = await fetch(downloadUrl);
            const text = await response.text();
            const data = JSON.parse(text);
            return new Map(Object.entries(data));
        } catch (error) {
            console.debug("No cloud sync history found:", error);
            return new Map();
        }
    }

    /**
     * 保存本地同步历史
     */
    static async saveLocalSyncHistory(syncHistory: Map<string, number>): Promise<void> {
        try {
            const historyObj: Record<string, number> = {};
            syncHistory.forEach((timestamp, instanceId) => {
                historyObj[instanceId] = timestamp;
            });

            const jsonContent = JSON.stringify(historyObj, null, 2);
            const blob = new Blob([jsonContent], {type: "application/json"});
            const file = new File([blob], "sync-history.json", {lastModified: Date.now()});

            const formData = new FormData();
            formData.append("path", "/data/.siyuan/sync/sync-history.json");
            formData.append("file", file);
            formData.append("isDir", "false");
            formData.append("modTime", `${Math.floor(Date.now() / 1000)}`);

            // 确保目录存在
            await SyncHistory.ensureDir("/data/.siyuan/sync");
            
            await fetch("/api/file/putFile", {
                method: "POST",
                body: formData,
            });

            console.log("Local sync history saved");
        } catch (error) {
            console.error("Failed to save local sync history:", error);
            throw error;
        }
    }

    /**
     * 保存云端同步历史
     */
    static async saveCloudSyncHistory(
        client: Pan123Client,
        remoteFolderId: number,
        syncHistory: Map<string, number>
    ): Promise<void> {
        try {
            const historyObj: Record<string, number> = {};
            syncHistory.forEach((timestamp, instanceId) => {
                historyObj[instanceId] = timestamp;
            });

            const jsonContent = JSON.stringify(historyObj, null, 2);
            const blob = new Blob([jsonContent], {type: "application/json"});
            const file = new File([blob], "sync-history.json", {lastModified: Date.now()});

            // 删除旧的历史文件
            const files = await client.listFiles(remoteFolderId);
            const oldHistoryFile = files.find(
                (f) => f.type === 0 && f.filename === "sync-history.json"
            );
            if (oldHistoryFile) {
                await client.deleteFiles([oldHistoryFile.fileId]);
            }

            // 上传新的历史文件
            await client.uploadSingle({
                parentId: remoteFolderId,
                file,
                filename: "sync-history.json",
                duplicateStrategy: 2,
            });

            console.log("Cloud sync history saved");
        } catch (error) {
            console.error("Failed to save cloud sync history:", error);
            throw error;
        }
    }

    /**
     * 更新两端的同步历史
     */
    static async updateSyncHistories(
        client: Pan123Client,
        remoteFolderId: number,
        localRemote: Remote,
        cloudRemote: Remote
    ): Promise<void> {
        await Promise.allSettled([
            SyncHistory.saveLocalSyncHistory(localRemote.syncHistory),
            SyncHistory.saveCloudSyncHistory(client, remoteFolderId, cloudRemote.syncHistory),
        ]);
    }

    /**
     * 获取与特定远程的最后同步时间
     */
    static getLastSyncWithRemote(remote: Remote, instanceId: string): number {
        if (!remote.syncHistory) {
            return 0;
        }
        return remote.syncHistory.get(instanceId) || 0;
    }

    /**
     * 获取最近的同步时间
     */
    static getMostRecentSyncTime(remote: Remote): number {
        if (!remote.syncHistory || remote.syncHistory.size === 0) {
            return 0;
        }
        return Math.max(...Array.from(remote.syncHistory.values()));
    }

    /**
     * 确保目录存在
     */
    private static async ensureDir(path: string): Promise<void> {
        const segments = path.split("/").filter(Boolean);
        let current = "";
        
        for (const segment of segments) {
            current += `/${segment}`;
            try {
                await fetch("/api/file/readDir", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({path: current}),
                });
            } catch (error) {
                // 目录不存在，创建它
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
    }
}

