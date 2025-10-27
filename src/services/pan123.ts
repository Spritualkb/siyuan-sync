import {AccessTokenInfo} from "../types";
import * as SparkMD5 from "spark-md5";

const API_BASE = "https://open-api.123pan.com";
const PLATFORM_HEADER = {Platform: "open_platform"};
const DEFAULT_SLICE_SIZE = 16 * 1024 * 1024; // 16MB fallback
const UPLOAD_TIMEOUT = 120000; // 120秒超时
const MAX_SLICE_RETRIES = 3; // 每个分片最多重试3次
const RETRY_DELAY = 1000; // 重试延迟1秒

export interface CloudFile {
    fileId: number;
    filename: string;
    parentFileId: number;
    type: number; // 0-文件 1-文件夹
    etag: string;
    size: number;
    createAt: string;
    updateAt: string;
    trashed?: number; // 0-正常 1-回收站
    category?: number; // 文件分类：0-未知 1-音频 2-视频 3-图片
    status?: number;
}

export interface FileDetail {
    fileID: number;
    filename: string;
    type: number; // 0-文件 1-文件夹
    size: number;
    etag: string;
    status: number;
    parentFileID: number;
    createAt: string;
    trashed: number;
}

export interface UploadSingleOptions {
    parentId: number;
    file: File;
    md5?: string; // 可选，如果未提供则自动计算
    size?: number; // 可选，如果未提供则自动从 file 获取
    filename: string;
    duplicateStrategy?: number; // 1 keep both, 2 override
    onProgress?: (uploadedBytes: number, totalBytes: number, currentSlice?: number, totalSlices?: number) => void;
}

export interface UploadResult {
    fileId: number;
    completed: boolean;
}

interface UploadSession {
    fileId?: number;
    reuse?: boolean;
    preuploadId?: string;
    sliceSize?: number;
    servers?: string[];
}

interface SliceUploadResult {
    success: boolean;
    error?: Error;
}

export class Pan123Client {
    private accessToken: string | null = null;
    private cachedUploadDomain: {domain: string; fetchedAt: number} | null = null;

    public setAccessToken(token: string | null): void {
        this.accessToken = token;
    }

    public async requestAccessToken(clientId: string, clientSecret: string): Promise<AccessTokenInfo> {
        const response = await fetch(`${API_BASE}/api/v1/access_token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...PLATFORM_HEADER,
            },
            body: JSON.stringify({
                clientID: clientId,
                clientSecret,
            }),
        });
        await this.ensureOk(response, "获取 access_token 失败");
        const payload = await response.json();
        if (payload?.code !== 0) {
            throw new Error(payload?.message || "获取 access_token 失败");
        }
        const data = payload.data;
        if (!data?.accessToken) {
            throw new Error("access_token 响应缺少凭证");
        }
        this.accessToken = data.accessToken;
        return {
            token: data.accessToken,
            expiredAt: data.expiredAt,
        };
    }

    /**
     * 获取文件列表
     * @param parentFileId 父目录ID，根目录为0
     * @param limit 每页数量，最大100
     * @param includeTrash 是否包含回收站文件，默认false
     */
    public async listFiles(parentFileId: number, limit = 100, includeTrash = false): Promise<CloudFile[]> {
        const results: CloudFile[] = [];
        let lastFileId = 0;
        do {
            const url = new URL(`${API_BASE}/api/v2/file/list`);
            url.searchParams.set("parentFileId", `${parentFileId}`);
            url.searchParams.set("limit", `${limit}`);
            if (lastFileId > 0) {
                url.searchParams.set("lastFileId", `${lastFileId}`);
            }
            const response = await fetch(url.toString(), {
                method: "GET",
                headers: this.authHeaders({"Content-Type": "application/json"}),
            });
            await this.ensureOk(response, "获取文件列表失败");
            const payload = await response.json();
            if (payload.code !== 0) {
                throw new Error(payload.message || "获取文件列表失败");
            }
            const data = payload.data ?? {};
            const fileList: CloudFile[] = data.fileList ?? [];
            
            // 过滤回收站文件
            const filteredFiles = includeTrash 
                ? fileList 
                : fileList.filter(f => f.trashed !== 1);
            
            results.push(...filteredFiles);
            lastFileId = data.lastFileId ?? -1;
        } while (lastFileId && lastFileId > 0);
        
        console.log(`[Pan123] 获取文件列表完成: 共 ${results.length} 个文件${includeTrash ? '' : '（已过滤回收站）'}`);
        return results;
    }

    /**
     * 验证文件/文件夹名称
     */
    private validateFileName(name: string, isFolder = false): void {
        const type = isFolder ? "文件夹" : "文件";
        
        if (!name || name.trim().length === 0) {
            throw new Error(`${type}名不能为空`);
        }
        
        if (/^\s+$/.test(name)) {
            throw new Error(`${type}名不能全部是空格`);
        }
        
        if (name.length > 255) {
            throw new Error(`${type}名长度不能超过255个字符`);
        }
        
        const invalidChars = /["\\/:*?|><]/;
        if (invalidChars.test(name)) {
            throw new Error(`${type}名不能包含以下字符: " \\ / : * ? | > <`);
        }
    }

    public async createFolder(parentId: number, name: string): Promise<{fileId: number; name: string}> {
        // 验证文件夹名
        this.validateFileName(name, true);
        
        const response = await fetch(`${API_BASE}/upload/v1/file/mkdir`, {
            method: "POST",
            headers: this.authHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify({
                name,
                parentID: parentId,
            }),
        });
        await this.ensureOk(response, "创建目录失败");
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.message || "创建目录失败");
        }
        const dirId = payload?.data?.dirID;
        if (!dirId) {
            throw new Error("创建目录响应缺少 dirID");
        }
        return {fileId: dirId, name};
    }

    /**
     * 获取单个文件/文件夹详情
     */
    public async getFileDetail(fileId: number): Promise<FileDetail> {
        const url = new URL(`${API_BASE}/api/v1/file/detail`);
        url.searchParams.set("fileID", `${fileId}`);
        
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: this.authHeaders({"Content-Type": "application/json"}),
        });
        
        await this.ensureOk(response, "获取文件详情失败");
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.message || "获取文件详情失败");
        }
        
        if (!payload.data) {
            throw new Error("文件详情为空");
        }
        
        return payload.data;
    }

    /**
     * 重命名文件/文件夹
     */
    public async renameFile(fileId: number, newName: string): Promise<void> {
        // 验证文件名
        this.validateFileName(newName, false);
        
        const response = await fetch(`${API_BASE}/api/v1/file/name`, {
            method: "PUT",
            headers: this.authHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify({
                fileId,
                fileName: newName,
            }),
        });
        
        await this.ensureOk(response, "重命名文件失败");
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.message || "重命名文件失败");
        }
    }

    /**
     * 移动文件/文件夹
     * @param fileIds 文件ID数组，单次最多100个
     * @param toParentFileId 目标文件夹ID
     */
    public async moveFiles(fileIds: number[], toParentFileId: number): Promise<void> {
        if (!fileIds.length) {
            return;
        }
        
        if (fileIds.length > 100) {
            throw new Error("单次最多移动100个文件");
        }
        
        const response = await fetch(`${API_BASE}/api/v1/file/move`, {
            method: "POST",
            headers: this.authHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify({
                fileIDs: fileIds,
                toParentFileID: toParentFileId,
            }),
        });
        
        await this.ensureOk(response, "移动文件失败");
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.message || "移动文件失败");
        }
    }

    /**
     * 搜索文件（全局搜索）
     */
    public async searchFiles(keyword: string, searchMode: 0 | 1 = 0, limit = 100): Promise<CloudFile[]> {
        const results: CloudFile[] = [];
        let lastFileId = 0;
        
        do {
            const url = new URL(`${API_BASE}/api/v2/file/list`);
            url.searchParams.set("parentFileId", "0"); // 搜索时parentFileId无意义
            url.searchParams.set("limit", `${limit}`);
            url.searchParams.set("searchData", keyword);
            url.searchParams.set("searchMode", `${searchMode}`);
            if (lastFileId > 0) {
                url.searchParams.set("lastFileId", `${lastFileId}`);
            }
            
            const response = await fetch(url.toString(), {
                method: "GET",
                headers: this.authHeaders({"Content-Type": "application/json"}),
            });
            
            await this.ensureOk(response, "搜索文件失败");
            const payload = await response.json();
            if (payload.code !== 0) {
                throw new Error(payload.message || "搜索文件失败");
            }
            
            const data = payload.data ?? {};
            const fileList: CloudFile[] = data.fileList ?? [];
            results.push(...fileList);
            lastFileId = data.lastFileId ?? -1;
        } while (lastFileId && lastFileId > 0);
        
        return results;
    }

    /**
     * 删除文件到回收站
     * @param fileIds 文件ID数组，单次最多100个
     */
    public async deleteFiles(fileIds: number[]): Promise<void> {
        if (!fileIds.length) {
            return;
        }
        
        if (fileIds.length > 100) {
            throw new Error("单次最多删除100个文件");
        }
        
        const response = await fetch(`${API_BASE}/api/v1/file/trash`, {
            method: "POST",
            headers: this.authHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify({fileIDs: fileIds}),
        });
        await this.ensureOk(response, "删除文件失败");
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.message || "删除文件失败");
        }
    }

    /**
     * 从回收站恢复文件
     * @param fileIds 文件ID数组，单次最多100个
     */
    public async recoverFiles(fileIds: number[]): Promise<void> {
        if (!fileIds.length) {
            return;
        }
        
        if (fileIds.length > 100) {
            throw new Error("单次最多恢复100个文件");
        }
        
        console.log(`[Pan123] 恢复 ${fileIds.length} 个文件`);
        
        const response = await fetch(`${API_BASE}/api/v1/file/recover`, {
            method: "POST",
            headers: this.authHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify({fileIDs: fileIds}),
        });
        
        await this.ensureOk(response, "恢复文件失败");
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.message || "恢复文件失败");
        }
    }

    /**
     * 彻底删除文件（不可恢复）
     * @param fileIds 文件ID数组，单次最多100个
     */
    public async permanentDeleteFiles(fileIds: number[]): Promise<void> {
        if (!fileIds.length) {
            return;
        }
        
        if (fileIds.length > 100) {
            throw new Error("单次最多删除100个文件");
        }
        
        console.log(`[Pan123] 彻底删除 ${fileIds.length} 个文件`);
        
        const response = await fetch(`${API_BASE}/api/v1/file/clean`, {
            method: "DELETE",
            headers: this.authHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify({fileIDs: fileIds}),
        });
        
        await this.ensureOk(response, "彻底删除文件失败");
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.message || "彻底删除文件失败");
        }
    }

    /**
     * 获取下载链接
     * @param fileId 文件ID
     */
    public async getDownloadUrl(fileId: number): Promise<string> {
        const url = new URL(`${API_BASE}/api/v1/file/download_info`);
        url.searchParams.set("fileId", `${fileId}`);
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: this.authHeaders({"Content-Type": "application/json"}),
        });
        await this.ensureOk(response, "获取下载链接失败");
        const payload = await response.json();
        
        // 处理特定错误码
        if (payload.code === 5113) {
            throw new Error("今日下载流量已超出限制（1GB/天），请升级VIP或明日再试");
        }
        if (payload.code === 5066) {
            throw new Error("文件不存在或已被删除");
        }
        if (payload.code !== 0) {
            throw new Error(payload.message || "获取下载链接失败");
        }
        
        const downloadUrl = payload?.data?.downloadUrl;
        if (!downloadUrl) {
            throw new Error("下载链接为空");
        }
        return downloadUrl;
    }

    public async uploadSingle(options: UploadSingleOptions): Promise<UploadResult> {
        // 自动计算缺失的 md5 和 size
        const normalizedOptions: Required<UploadSingleOptions> = {
            ...options,
            md5: options.md5 || await this.computeFileMd5(options.file),
            size: options.size ?? options.file.size,
            duplicateStrategy: options.duplicateStrategy ?? 0,
            onProgress: options.onProgress ?? (() => {}),
        };
        
        const session = await this.createUploadSession(normalizedOptions);
        if (session.reuse && session.fileId) {
            normalizedOptions.onProgress(normalizedOptions.size, normalizedOptions.size);
            return {fileId: session.fileId, completed: true};
        }

        if (!session.preuploadId) {
            throw new Error("创建上传任务失败：缺少 preuploadID");
        }

        const server = await this.resolveUploadServer(session.servers);
        await this.uploadSlices(server, session, normalizedOptions);
        const result = await this.completeUpload(session.preuploadId);
        if (!result.fileId && session.fileId) {
            // fallback when complete doesn't echo fileId but create did
            result.fileId = session.fileId;
        }
        return result;
    }

    /**
     * 计算文件的 MD5 哈希值
     */
    private async computeFileMd5(file: File): Promise<string> {
        const chunkSize = 2 * 1024 * 1024; // 2MB
        const spark = new SparkMD5.ArrayBuffer();
        let offset = 0;

        while (offset < file.size) {
            const end = Math.min(offset + chunkSize, file.size);
            const chunk = file.slice(offset, end);
            const buffer = await chunk.arrayBuffer();
            spark.append(buffer);
            offset = end;
        }

        return spark.end().toLowerCase();
    }

    private async createUploadSession(options: UploadSingleOptions): Promise<UploadSession> {
        console.log(`[Pan123] 创建上传任务: ${options.filename}, 大小: ${options.size}, MD5: ${options.md5}`);
        
        const payload: Record<string, unknown> = {
            parentFileID: options.parentId,
            filename: options.filename,
            etag: options.md5,
            size: options.size,
        };
        if (options.duplicateStrategy) {
            payload.duplicate = options.duplicateStrategy;
        }

        const response = await fetch(`${API_BASE}/upload/v2/file/create`, {
            method: "POST",
            headers: this.authHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify(payload),
        });
        await this.ensureOk(response, "创建上传任务失败");
        const payloadJson = await response.json();
        if (payloadJson.code !== 0) {
            console.error(`[Pan123] 创建上传任务失败: ${payloadJson.message}, payload:`, payload);
            throw new Error(payloadJson.message || "创建上传任务失败");
        }
        const data = payloadJson.data ?? {};
        const servers: string[] | undefined = Array.isArray(data.servers)
            ? data.servers
            : (typeof data.server === "string" ? [data.server] : undefined);
        return {
            fileId: data.fileID ?? data.fileId ?? 0,
            reuse: data.reuse ?? false,
            preuploadId: data.preuploadID ?? data.preUploadID ?? data.preuploadId,
            sliceSize: data.sliceSize ?? data.slice_size ?? data.slice_size_bytes,
            servers,
        };
    }

    private async resolveUploadServer(servers?: string[]): Promise<string> {
        if (servers && servers.length > 0) {
            return servers[0];
        }
        return await this.getUploadDomain();
    }

    private normalizeServer(server: string): string {
        if (!server.startsWith("http")) {
            return `https://${server.replace(/^\/+/, "")}`.replace(/\/+$/, "");
        }
        return server.replace(/\/+$/, "");
    }

    private async uploadSlices(server: string, session: UploadSession, options: UploadSingleOptions): Promise<void> {
        const normalizedServer = this.normalizeServer(server);
        // 验证服务器地址有效性
        if (!normalizedServer || normalizedServer === "https:" || normalizedServer === "https://") {
            throw new Error("无效的上传服务器地址");
        }
        const chunkSize = session.sliceSize && session.sliceSize > 0 ? session.sliceSize : DEFAULT_SLICE_SIZE;
        const totalSize = options.size;
        const preuploadId = session.preuploadId as string;
        
        // 计算总分片数
        const totalSlices = totalSize > 0 ? Math.ceil(totalSize / chunkSize) : 0;
        
        let offset = 0;
        let sliceNo = 1;
        let uploadedBytes = 0;

        console.log(`[Pan123] 开始上传文件: ${options.filename}, 大小: ${totalSize} bytes, 分片大小: ${chunkSize} bytes, 总分片数: ${totalSlices}`);

        while (offset < totalSize) {
            const end = Math.min(offset + chunkSize, totalSize);
            const sliceSize = end - offset;
            
            // 使用重试机制上传分片
            const result = await this.uploadSliceWithRetry(
                normalizedServer,
                preuploadId,
                options.file,
                offset,
                end,
                sliceNo,
                options.filename
            );
            
            if (!result.success) {
                throw result.error || new Error(`分片 ${sliceNo} 上传失败`);
            }

            uploadedBytes += sliceSize;
            options.onProgress?.(uploadedBytes, totalSize, sliceNo, totalSlices);
            
            console.log(`[Pan123] 分片 ${sliceNo}/${totalSlices} 上传成功 (${((uploadedBytes / totalSize) * 100).toFixed(2)}%)`);
            
            offset = end;
            sliceNo += 1;
        }

        if (totalSize === 0) {
            options.onProgress?.(0, 0, 0, 0);
        }
        
        console.log(`[Pan123] 所有分片上传完成, 总计 ${totalSlices} 个分片`);
    }

    private async uploadSliceWithRetry(
        server: string,
        preuploadId: string,
        file: File,
        offset: number,
        end: number,
        sliceNo: number,
        filename: string
    ): Promise<SliceUploadResult> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= MAX_SLICE_RETRIES; attempt++) {
            try {
                // 获取分片数据
                const blob = file.slice(offset, end);
                const buffer = await blob.arrayBuffer();
                
                // 使用spark-md5计算分片MD5
                const spark = new SparkMD5.ArrayBuffer();
                spark.append(buffer);
                const chunkMd5 = spark.end().toLowerCase();
                
                const chunkBlob = new Blob([buffer], {type: "application/octet-stream"});
                const partName = `${filename}.part${sliceNo}`;

                console.log(`[Pan123] 分片 ${sliceNo}: offset=${offset}, end=${end}, size=${buffer.byteLength}, MD5=${chunkMd5}`);

                // 构建表单数据
                const form = new FormData();
                form.append("preuploadID", preuploadId);
                form.append("sliceNo", `${sliceNo}`);
                form.append("sliceMD5", chunkMd5);
                form.append("slice", chunkBlob, partName);

                // 发起上传请求,带超时控制
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT);

                try {
                    const response = await fetch(`${server}/upload/v2/file/slice`, {
                        method: "POST",
                        headers: this.authHeaders(),
                        body: form,
                        signal: controller.signal,
                    });

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const reply = await response.json();
                    console.log(`[Pan123] 分片 ${sliceNo} 上传响应:`, JSON.stringify(reply));
                    
                    if (reply.code !== 0) {
                        throw new Error(`分片 ${sliceNo} 上传失败: ${reply.message || '未知错误'}`);
                    }

                    // 验证MD5
                    const serverMd5 = reply?.data?.md5 ?? reply?.data?.sliceMD5;
                    if (typeof serverMd5 === "string" && serverMd5.toLowerCase() !== chunkMd5) {
                        console.error(`[Pan123] 分片 ${sliceNo} MD5不匹配: 本地=${chunkMd5}, 服务器=${serverMd5.toLowerCase()}`);
                        throw new Error(`分片 ${sliceNo} MD5校验失败 (本地: ${chunkMd5}, 服务器: ${serverMd5})`);
                    }

                    console.log(`[Pan123] 分片 ${sliceNo} 上传成功并验证通过`);
                    return {success: true};
                } catch (fetchError: unknown) {
                    clearTimeout(timeoutId);
                    
                    // 处理中止错误
                    if (fetchError instanceof Error && fetchError.name === "AbortError") {
                        throw new Error(`分片 ${sliceNo} 上传超时 (${UPLOAD_TIMEOUT / 1000}秒)`);
                    }
                    throw fetchError;
                }
            } catch (error: unknown) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.warn(`[Pan123] 分片 ${sliceNo} 上传失败 (尝试 ${attempt}/${MAX_SLICE_RETRIES}):`, lastError.message);

                // 如果不是最后一次尝试,等待后重试
                if (attempt < MAX_SLICE_RETRIES) {
                    const delay = RETRY_DELAY * attempt; // 递增延迟
                    console.log(`[Pan123] 将在 ${delay}ms 后重试分片 ${sliceNo}`);
                    await this.sleep(delay);
                } else {
                    console.error(`[Pan123] 分片 ${sliceNo} 上传失败,已达到最大重试次数`);
                }
            }
        }

        return {
            success: false,
            error: lastError || new Error(`分片 ${sliceNo} 上传失败`),
        };
    }

    private async completeUpload(preuploadId: string): Promise<UploadResult> {
        console.log(`[Pan123] 开始合并分片，preuploadID: ${preuploadId}`);
        const maxAttempts = 30;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const response = await fetch(`${API_BASE}/upload/v2/file/upload_complete`, {
                method: "POST",
                headers: this.authHeaders({"Content-Type": "application/json"}),
                body: JSON.stringify({preuploadID: preuploadId}),
            });
            await this.ensureOk(response, "合并分片失败");
            const payload = await response.json();
            console.log(`[Pan123] 合并分片响应 (尝试 ${attempt}/${maxAttempts}):`, JSON.stringify(payload));
            
            if (payload.code !== 0) {
                const message: string = payload.message || "";
                const code = payload.code;
                // 检查是否是"校验中"状态（需要重试），参考测试脚本的成功实现
                // 只匹配"校验中"，避免误判"校验失败"等最终错误
                const isStillVerifying = /校验中/.test(message) || code === 20005 || code === 40005;

                if (isStillVerifying) {
                    console.warn(`[Pan123] 云端正在校验分片，第${attempt}/${maxAttempts}次尝试，错误码：${code}，消息：${message}`);
                    // 使用固定1秒等待时间，与 test-upload.js:143 保持一致
                    await this.sleep(1000);
                    continue;
                }
                // 其他错误（包括"校验失败"）直接抛出，不再重试
                console.error(`[Pan123] 合并分片失败: 错误码=${code}, 消息=${message}, 完整响应:`, payload);
                throw new Error(`${message}（错误码：${code}）` || "合并分片失败");
            }
            const data = payload.data ?? {};
            if (data.completed || data.fileID) {
                const fileId = data.fileID ?? data.fileId ?? 0;
                const completed = data.completed ?? (fileId ? true : false);
                console.log(`[Pan123] 文件合并成功，fileId: ${fileId}`);
                return {
                    fileId,
                    completed: Boolean(completed),
                };
            }
            await this.sleep(1000);
        }
        throw new Error(`等待云端合并分片超时（已重试${maxAttempts}次），preuploadID: ${preuploadId}`);
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    private async getUploadDomain(): Promise<string> {
        const cacheTTL = 5 * 60 * 1000;
        if (this.cachedUploadDomain && Date.now() - this.cachedUploadDomain.fetchedAt < cacheTTL) {
            return this.cachedUploadDomain.domain;
        }
        const response = await fetch(`${API_BASE}/upload/v2/file/domain`, {
            method: "GET",
            headers: this.authHeaders({"Content-Type": "application/json"}),
        });
        await this.ensureOk(response, "获取上传域名失败");
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.message || "获取上传域名失败");
        }
        const domains = payload.data as string[];
        if (!domains?.length) {
            throw new Error("未获取到可用的上传域名");
        }
        const domain = domains[0];
        this.cachedUploadDomain = {domain, fetchedAt: Date.now()};
        return domain;
    }

    private authHeaders(extra?: Record<string, string>): Record<string, string> {
        if (!this.accessToken) {
            throw new Error("尚未设置访问凭证");
        }
        return {
            Authorization: `Bearer ${this.accessToken}`,
            ...PLATFORM_HEADER,
            ...(extra ?? {}),
        };
    }

    private async ensureOk(response: Response, message: string): Promise<void> {
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`${message}: ${response.status} ${text}`);
        }
    }
}
