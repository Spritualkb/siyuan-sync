/**
 * 同步目标配置
 * 定义需要同步的目录及其选项
 */

export interface SyncTarget {
    path: string;
    excludedItems?: string[]; // 排除的文件/文件夹名称
    options?: {
        deleteFoldersOnly?: boolean; // 只删除文件夹，不删除文件
        onlyIfMissing?: boolean; // 只在缺失时同步
        avoidDeletions?: boolean; // 避免删除操作
        trackConflicts?: boolean; // 跟踪冲突
        trackUpdatedFiles?: boolean; // 跟踪更新的文件
    };
}

/**
 * 获取默认的同步目标
 */
export function getDefaultSyncTargets(): SyncTarget[] {
    return [
        // 主数据目录 - 包含所有笔记本
        {
            path: "data",
            excludedItems: [".siyuan"], // 排除.siyuan目录，单独处理
            options: {
                trackConflicts: true,
                trackUpdatedFiles: true,
            },
        },

        // 配置目录
        {
            path: "data/.siyuan",
            options: {
                trackUpdatedFiles: true,
            },
        },

        // 插件目录
        {
            path: "data/plugins",
            options: {
                deleteFoldersOnly: true,
            },
        },

        // 模板目录
        {
            path: "data/templates",
            options: {
                deleteFoldersOnly: true,
            },
        },

        // 挂件目录
        {
            path: "data/widgets",
            options: {
                deleteFoldersOnly: true,
            },
        },

        // Emoji目录
        {
            path: "data/emojis",
            options: {
                deleteFoldersOnly: true,
            },
        },

        // 存储目录
        {
            path: "data/storage/av",
            options: {
                trackUpdatedFiles: true,
            },
        },
        {
            path: "data/storage/riff",
            options: {
                trackUpdatedFiles: true,
            },
        },

        // 外观配置
        {
            path: "conf/appearance/themes",
            excludedItems: ["daylight", "midnight"], // 排除内置主题
            options: {
                avoidDeletions: true,
            },
        },
        {
            path: "conf/appearance/icons",
            excludedItems: ["ant", "material", "index.html"], // 排除内置图标
            options: {
                avoidDeletions: true,
            },
        },

        // 代码片段（仅在缺失时同步）
        {
            path: "data/snippets",
            options: {
                onlyIfMissing: true,
                avoidDeletions: true,
            },
        },

        // Petal存储（仅在缺失时同步）
        {
            path: "data/storage/petal",
            options: {
                onlyIfMissing: true,
                avoidDeletions: true,
            },
        },
    ];
}

/**
 * 检查路径是否应该被排除
 */
export function shouldExcludePath(
    path: string,
    target: SyncTarget
): boolean {
    if (!target.excludedItems || target.excludedItems.length === 0) {
        return false;
    }

    const pathSegments = path.split("/");
    const lastSegment = pathSegments[pathSegments.length - 1];

    return target.excludedItems.includes(lastSegment);
}

/**
 * 检查是否应该避免删除
 */
export function shouldAvoidDeletion(
    path: string,
    target: SyncTarget,
    isDir: boolean
): boolean {
    if (target.options?.avoidDeletions) {
        return true;
    }

    if (target.options?.deleteFoldersOnly && !isDir) {
        return true;
    }

    return false;
}

