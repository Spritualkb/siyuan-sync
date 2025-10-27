/**
 * 远程连接信息
 * 代表一个同步端点（本地或123网盘）
 */
export class Remote {
    url: string = ""; // 对于本地为空，对于云端存储同步索引位置
    name: string;
    instanceId?: string; // 设备唯一标识
    syncHistory: Map<string, number> = new Map(); // instanceId -> 最后同步时间戳(秒)
    isCloud: boolean; // 是否为云端

    constructor(name: string, isCloud: boolean = false, instanceId?: string) {
        this.name = name;
        this.isCloud = isCloud;
        this.instanceId = instanceId;
    }

    /**
     * 创建本地Remote实例
     */
    static local(): Remote {
        return new Remote("本地", false);
    }

    /**
     * 创建云端Remote实例
     */
    static cloud(): Remote {
        return new Remote("云端", true);
    }

    /**
     * 克隆Remote对象
     */
    clone(): Remote {
        const cloned = new Remote(this.name, this.isCloud, this.instanceId);
        cloned.url = this.url;
        cloned.syncHistory = new Map(this.syncHistory);
        return cloned;
    }

    /**
     * 获取最后同步时间
     */
    get lastSyncTime(): number {
        if (!this.syncHistory || this.syncHistory.size === 0) {
            return 0;
        }
        // 返回最近的同步时间
        return Math.max(...Array.from(this.syncHistory.values()));
    }
}

