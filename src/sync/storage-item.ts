/**
 * 存储项 - 表示文件或目录
 */
export interface FileInfo {
    name: string;
    path: string;
    isDir: boolean;
    updated: number; // 时间戳（秒）
    size?: number;
    md5?: string;
    fileId?: number; // 123网盘文件ID（仅云端文件有）
}

export class StorageItem {
    path: string;
    parentPath: string | null = null;
    item: FileInfo | null = null;
    files: StorageItem[] = [];

    constructor(
        path: string,
        parentPath: string | null = null,
        item: FileInfo | null = null,
        files: StorageItem[] = []
    ) {
        if (!path) {
            throw new Error("StorageItem path cannot be null or undefined");
        }
        this.path = path;
        this.parentPath = parentPath;
        this.item = item;
        this.files = files;
    }

    get name(): string | undefined {
        return this.item?.name;
    }

    get timestamp(): number | undefined {
        return this.item?.updated;
    }

    get isDir(): boolean {
        return this.item?.isDir ?? false;
    }

    get size(): number | undefined {
        return this.item?.size;
    }

    /**
     * 添加文件
     */
    addFile(item: FileInfo): void {
        const filePath = `${this.path}/${item.name}`;
        const storageItem = new StorageItem(filePath, this.path, item);
        this.files.push(storageItem);
    }

    /**
     * 获取所有子文件（递归）
     */
    getAllChildFiles(): StorageItem[] {
        const result: StorageItem[] = [];
        for (const file of this.files) {
            if (file.isDir) {
                result.push(...file.getAllChildFiles());
            } else {
                result.push(file);
            }
        }
        return result;
    }

    /**
     * 获取所有子目录（递归）
     */
    getAllChildDirectories(): StorageItem[] {
        const result: StorageItem[] = [];
        for (const file of this.files) {
            if (file.isDir) {
                result.push(file);
                result.push(...file.getAllChildDirectories());
            }
        }
        return result;
    }

    /**
     * 获取文件映射表
     */
    getFilesMap(): Map<string, StorageItem> {
        const map = new Map<string, StorageItem>();
        for (const file of this.files) {
            map.set(file.path, file);
        }
        return map;
    }

    /**
     * 合并两个StorageItem
     */
    static joinItems(item1: StorageItem | null, item2: StorageItem | null): StorageItem {
        if (!item1 && !item2) {
            throw new Error("Cannot join two null items");
        }
        if (!item1) return item2!;
        if (!item2) return item1;
        
        if (item1.path !== item2.path) {
            throw new Error("Cannot join StorageItems with different paths");
        }

        const filesMap = new Map<string, StorageItem>();
        for (const file of [...item1.files, ...item2.files]) {
            filesMap.set(file.path, file);
        }

        return new StorageItem(
            item1.path,
            item1.parentPath,
            item1.item || item2.item,
            Array.from(filesMap.values())
        );
    }

    /**
     * 从对象创建
     */
    static fromObject(obj: any): StorageItem {
        if (!obj || !obj.path) {
            throw new Error("Invalid object: missing required 'path' property");
        }

        const childFiles = (obj.files || []).map((fileObj: any) =>
            StorageItem.fromObject(fileObj)
        );

        return new StorageItem(
            obj.path,
            obj.parentPath || null,
            obj.item || null,
            childFiles
        );
    }

    /**
     * 迭代所有StorageItem
     */
    *iterateStorageItem(): Generator<StorageItem> {
        yield this;
        for (const file of this.files) {
            yield* file.iterateStorageItem();
        }
    }
}

