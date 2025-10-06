import {AccessTokenInfo} from "../types";

const API_BASE = "https://open-api.123pan.com";
const PLATFORM_HEADER = {Platform: "open_platform"};

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
}

export interface UploadResult {
    fileId: number;
    completed: boolean;
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
        const domain = await this.getUploadDomain();
        const form = new FormData();
        form.append("file", options.file);
        form.append("parentFileID", `${options.parentId}`);
        form.append("filename", options.filename);
        form.append("etag", options.md5);
        form.append("size", `${options.size}`);
        if (options.duplicateStrategy) {
            form.append("duplicate", `${options.duplicateStrategy}`);
        }
        const response = await fetch(`${domain}/upload/v2/file/single/create`, {
            method: "POST",
            headers: this.authHeaders(),
            body: form,
        });
        await this.ensureOk(response, "上传文件失败");
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.message || "上传文件失败");
        }
        const data = payload.data ?? payload;
        return {
            fileId: data.fileID ?? data.fileId ?? 0,
            completed: data.completed ?? false,
        };
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
