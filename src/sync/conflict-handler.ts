import {Remote} from "./remote";
import {SyncHistory} from "./sync-history";
import {showMessage} from "siyuan";

/**
 * 冲突处理器
 */
export class ConflictHandler {
    /**
     * 格式化日期为 "YYYY-MM-DD HH:mm:ss"
     */
    static getFormattedDate(date: Date): string {
        const datePart = date.toLocaleDateString("sv-SE", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        const timePart = date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        return `${datePart} ${timePart}`;
    }

    /**
     * 检测冲突
     * 当两个文件都在上次同步后被修改时，视为冲突
     */
    static async detectConflict(
        path: string,
        localTimestamp: number,
        cloudTimestamp: number,
        localRemote: Remote,
        cloudRemote: Remote
    ): Promise<boolean> {
        const localLastSync = SyncHistory.getLastSyncWithRemote(
            localRemote,
            cloudRemote.instanceId || ""
        );
        const cloudLastSync = SyncHistory.getLastSyncWithRemote(
            cloudRemote,
            localRemote.instanceId || ""
        );

        // 如果两边都没有同步过，不算冲突
        if (localLastSync === 0 && cloudLastSync === 0) {
            return false;
        }

        // 如果两个文件时间戳相同，不算冲突
        if (localTimestamp === cloudTimestamp) {
            return false;
        }

        // 检查是否两边都在上次同步后被修改
        const localModified = localTimestamp > localLastSync;
        const cloudModified = cloudTimestamp > cloudLastSync;

        if (localModified && cloudModified) {
            console.warn(`Conflict detected for file: ${path}`);
            console.warn(
                `Local timestamp: ${localTimestamp}, Last sync: ${localLastSync}`
            );
            console.warn(
                `Cloud timestamp: ${cloudTimestamp}, Last sync: ${cloudLastSync}`
            );
            return true;
        }

        return false;
    }

    /**
     * 根据策略处理冲突
     * @returns true 如果应该继续同步，false 如果应该跳过
     */
    static async handleConflictWithStrategy(
        path: string,
        localTimestamp: number,
        cloudTimestamp: number,
        strategy: "keepBoth" | "keepNewer" | "keepLocal" | "keepRemote",
        message: string
    ): Promise<boolean> {
        console.warn(`Conflict detected for ${path}, strategy: ${strategy}`);
        
        switch (strategy) {
            case "keepNewer":
                // 保留较新的版本，继续同步
                showMessage(
                    `${message}: ${path} - 将保留较新版本`,
                    5000,
                    "warning"
                );
                return true;
            
            case "keepLocal":
                // 保留本地版本，跳过同步
                showMessage(
                    `${message}: ${path} - 保留本地版本`,
                    5000,
                    "warning"
                );
                return false;
            
            case "keepRemote":
                // 保留远程版本，跳过同步（但会在后续逻辑中下载远程版本）
                showMessage(
                    `${message}: ${path} - 保留云端版本`,
                    5000,
                    "warning"
                );
                // 返回true，让后续逻辑判断哪个更新
                return true;
            
            case "keepBoth":
                // 保留两个版本
                await ConflictHandler.handleConflict(
                    path,
                    localTimestamp,
                    cloudTimestamp,
                    message
                );
                return true;
            
            default:
                console.error(`Unknown conflict strategy: ${strategy}`);
                return true;
        }
    }

    /**
     * 处理冲突（保留两个版本）
     * 策略：创建冲突副本文件，文件名添加时间戳后缀
     */
    static async handleConflict(
        path: string,
        localTimestamp: number,
        cloudTimestamp: number,
        message: string
    ): Promise<void> {
        try {
            // 确定哪个版本较旧
            const olderTimestamp = Math.min(localTimestamp, cloudTimestamp);
            const isLocalOlder = localTimestamp < cloudTimestamp;
            const olderVersion = isLocalOlder ? "本地" : "云端";

            // 格式化时间戳
            const timestamp = olderTimestamp * 1000;
            const date = new Date(timestamp);
            const formattedDate = ConflictHandler.getFormattedDate(date).replace(/[:\s]/g, "-");

            // 生成冲突文件名
            const pathParts = path.split("/");
            const fileName = pathParts[pathParts.length - 1];
            const fileExt = fileName.includes(".") ? fileName.split(".").pop() : "";
            const fileBaseName = fileExt ? fileName.substring(0, fileName.lastIndexOf(".")) : fileName;
            const conflictFileName = `${fileBaseName} (冲突副本 ${formattedDate})${fileExt ? "." + fileExt : ""}`;
            
            // 构建冲突文件路径
            const dirPath = pathParts.slice(0, -1).join("/");
            const conflictPath = `${dirPath}/${conflictFileName}`;

            // 如果是本地较旧，读取本地文件内容并保存为冲突副本
            // 然后较新的云端版本会在后续同步中下载覆盖原文件
            if (isLocalOlder) {
                // 读取本地文件
                const response = await fetch("/api/file/getFile", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({path}),
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const file = new File([blob], conflictFileName, {
                        lastModified: timestamp,
                    });

                    // 保存为冲突副本
                    const formData = new FormData();
                    formData.append("path", conflictPath);
                    formData.append("file", file);
                    formData.append("isDir", "false");
                    formData.append("modTime", `${olderTimestamp}`);

                    await fetch("/api/file/putFile", {
                        method: "POST",
                        body: formData,
                    });

                    console.log(`Created conflict copy: ${conflictPath}`);
                }
            }

            const conflictMessage =
                `${message}: ${path}\n` +
                `${olderVersion}版本已保存为: ${conflictFileName}\n` +
                `较新版本将保留为原文件名。`;

            showMessage(conflictMessage, 10000, "info");
        } catch (error) {
            console.error(`Failed to handle conflict for ${path}:`, error);
            showMessage(
                `处理冲突失败: ${path} - ${(error as Error).message}`,
                10000,
                "error"
            );
        }
    }

    /**
     * 比较两个文件内容是否相同
     */
    static async compareFileContents(
        localPath: string,
        cloudFileId: number,
        getDownloadUrl: (fileId: number) => Promise<string>
    ): Promise<boolean> {
        try {
            // 获取本地文件内容
            const localResponse = await fetch("/api/file/getFile", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: localPath}),
            });

            if (!localResponse.ok) {
                return false;
            }

            const localText = await localResponse.text();

            // 获取云端文件内容
            const cloudDownloadUrl = await getDownloadUrl(cloudFileId);
            const cloudResponse = await fetch(cloudDownloadUrl);
            const cloudText = await cloudResponse.text();

            // 比较内容
            return localText === cloudText;
        } catch (error) {
            console.error("Failed to compare file contents:", error);
            return false;
        }
    }
}

