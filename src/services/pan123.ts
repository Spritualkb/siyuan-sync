import {AccessTokenInfo} from "../types";
import {md5} from "../utils/md5";

const API_BASE = "https://open-api.123pan.com";
const PLATFORM_HEADER = {Platform: "open_platform"};
const DEFAULT_SLICE_SIZE = 16 * 1024 * 1024; // 16MB fallback

export interface CloudFile {
    fileId: number;
    filename: string;
    parentFileId: number;
    type: number;
    etag: string;
    size: number;
    createAt: string;
    updateAt: string;
    trashed?: number;
}

export interface UploadSingleOptions {
    parentId: number;
    file: File;
    md5: string;
    size: number;
    filename: string;
    duplicateStrategy?: number; // 1 keep both, 2 override
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
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

    public async listFiles(parentFileId: number, limit = 100): Promise<CloudFile[]> {
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
            results.push(...fileList);
            lastFileId = data.lastFileId ?? -1;
        } while (lastFileId && lastFileId > 0);
        return results;
    }

    public async createFolder(name: string, parentId: number): Promise<number> {
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
        return dirId;
    }

    public async deleteFiles(fileIds: number[]): Promise<void> {
        if (!fileIds.length) {
            return;
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

    public async getDownloadUrl(fileId: number): Promise<string> {
        const url = new URL(`${API_BASE}/api/v1/file/download_info`);
        url.searchParams.set("fileId", `${fileId}`);
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: this.authHeaders({"Content-Type": "application/json"}),
        });
        await this.ensureOk(response, "获取下载链接失败");
        const payload = await response.json();
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
        const session = await this.createUploadSession(options);
        if (session.reuse && session.fileId) {
            options.onProgress?.(options.size, options.size);
            return {fileId: session.fileId, completed: true};
        }

        if (!session.preuploadId) {
            throw new Error("创建上传任务失败：缺少 preuploadID");
        }

        const server = await this.resolveUploadServer(session.servers);
        await this.uploadSlices(server, session, options);
        const result = await this.completeUpload(session.preuploadId);
        if (!result.fileId && session.fileId) {
            // fallback when complete doesn't echo fileId but create did
            result.fileId = session.fileId;
        }
        return result;
    }

    private async createUploadSession(options: UploadSingleOptions): Promise<UploadSession> {
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
        const chunkSize = session.sliceSize && session.sliceSize > 0 ? session.sliceSize : DEFAULT_SLICE_SIZE;
        const totalSize = options.size;
        let offset = 0;
        let sliceNo = 1;
        let uploadedBytes = 0;
        const preuploadId = session.preuploadId as string;

        while (offset < totalSize) {
            const end = Math.min(offset + chunkSize, totalSize);
            const buffer = await options.file.slice(offset, end).arrayBuffer();
            const chunkMd5 = md5(buffer).toLowerCase();
            const chunkBlob = new Blob([buffer], {type: "application/octet-stream"});
            const partName = `${options.filename}.part${sliceNo}`;

            const form = new FormData();
            form.append("preuploadID", preuploadId);
            form.append("sliceNo", `${sliceNo}`);
            form.append("sliceMD5", chunkMd5);
            form.append("slice", chunkBlob, partName);

            const response = await fetch(`${normalizedServer}/upload/v2/file/slice`, {
                method: "POST",
                headers: this.authHeaders(),
                body: form,
            });
            await this.ensureOk(response, "分片上传失败");
            const reply = await response.json();
            if (reply.code !== 0) {
                throw new Error(reply.message || `分片上传失败（第${sliceNo}片）`);
            }

            const serverMd5 = reply?.data?.md5 ?? reply?.data?.sliceMD5;
            if (typeof serverMd5 === "string" && serverMd5.toLowerCase() !== chunkMd5) {
                throw new Error(`分片校验失败（第${sliceNo}片）`);
            }

            uploadedBytes += chunkBlob.size;
            options.onProgress?.(uploadedBytes, totalSize);
            offset = end;
            sliceNo += 1;
        }

        if (totalSize === 0) {
            options.onProgress?.(0, 0);
        }
    }

    private async completeUpload(preuploadId: string): Promise<UploadResult> {
        const maxAttempts = 30;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const response = await fetch(`${API_BASE}/upload/v2/file/upload_complete`, {
                method: "POST",
                headers: this.authHeaders({"Content-Type": "application/json"}),
                body: JSON.stringify({preuploadID: preuploadId}),
            });
            await this.ensureOk(response, "合并分片失败");
            const payload = await response.json();
            if (payload.code !== 0) {
                throw new Error(payload.message || "合并分片失败");
            }
            const data = payload.data ?? {};
            if (data.completed || data.fileID) {
                const fileId = data.fileID ?? data.fileId ?? 0;
                const completed = data.completed ?? (fileId ? true : false);
                return {
                    fileId,
                    completed: Boolean(completed),
                };
            }
            await this.sleep(1000);
        }
        throw new Error("等待云端合并分片超时");
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
