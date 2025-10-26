#!/usr/bin/env node
// Quick script to test uploading a file to 123Pan via slice API

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

try {
    const {ProxyAgent, setGlobalDispatcher} = require("undici");
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
    if (proxyUrl) {
        setGlobalDispatcher(new ProxyAgent(proxyUrl));
    }
} catch (error) {
    // undici not available, continue without proxy support
}

const CLIENT_ID = "03fe66797ad64d1ea5b65909d36b5a4c";
const CLIENT_SECRET = "b18b5b89c4c5426c96c6bd611adff0fa";
const API_BASE = "https://open-api.123pan.com";
const DEFAULT_SLICE_SIZE = 16 * 1024 * 1024;

const [, , filePathArg] = process.argv;
if (!filePathArg) {
    console.error("Usage: node scripts/test-upload.js <file>");
    process.exit(1);
}
const filePath = path.resolve(filePathArg);
if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
}

async function requestAccessToken() {
    const response = await fetch(`${API_BASE}/api/v1/access_token`, {
        method: "POST",
        headers: {"Content-Type": "application/json", Platform: "open_platform"},
        body: JSON.stringify({clientID: CLIENT_ID, clientSecret: CLIENT_SECRET}),
    });
    const payload = await response.json();
    if (payload.code !== 0) {
        throw new Error(`access_token failed: ${payload.message}`);
    }
    return payload.data.accessToken;
}

async function createUpload(token, filename, size, md5) {
    const response = await fetch(`${API_BASE}/upload/v2/file/create`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Platform: "open_platform",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            parentFileID: 0,
            filename,
            etag: md5,
            size,
            duplicate: 2,
        }),
    });
    const payload = await response.json();
    if (payload.code !== 0) {
        throw new Error(`create upload failed: ${payload.message}`);
    }
    return payload.data;
}

function computeFileMd5(targetPath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("md5");
        const stream = fs.createReadStream(targetPath);
        stream.on("data", chunk => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

async function uploadSlices(token, server, preuploadId, filename, sliceSize, size) {
    const normalizedServer = server && server.startsWith("http")
        ? server.replace(/\/+$/, "")
        : `https://${(server || "").replace(/^\/+/, "")}`.replace(/\/+$/, "");
    if (!normalizedServer || normalizedServer === "https:" || normalizedServer === "https://") {
        throw new Error("invalid upload server address");
    }
    const fd = await fs.promises.open(filePath, "r");
    let offset = 0;
    let sliceNo = 1;
    try {
        while (offset < size) {
            const end = Math.min(offset + sliceSize, size);
            const length = end - offset;
            const buffer = Buffer.alloc(length);
            await fd.read(buffer, 0, length, offset);
            const sliceMd5 = crypto.createHash("md5").update(buffer).digest("hex");
            const form = new FormData();
            form.append("preuploadID", preuploadId);
            form.append("sliceNo", String(sliceNo));
            form.append("sliceMD5", sliceMd5);
            form.append("slice", new Blob([buffer], {type: "application/octet-stream"}), `${filename}.part${sliceNo}`);
            const response = await fetch(`${normalizedServer}/upload/v2/file/slice`, {
                method: "POST",
                headers: {
                    Platform: "open_platform",
                    Authorization: `Bearer ${token}`,
                },
                body: form,
            });
            const payload = await response.json();
            if (payload.code !== 0) {
                throw new Error(`slice ${sliceNo} failed: ${payload.message}`);
            }
            const serverMd5 = payload?.data?.md5 ?? payload?.data?.sliceMD5;
            if (serverMd5 && serverMd5.toLowerCase() !== sliceMd5) {
                throw new Error(`slice ${sliceNo} md5 mismatch (${sliceMd5} != ${serverMd5})`);
            }
            console.log(`Uploaded slice ${sliceNo}, ${((end / size) * 100).toFixed(2)}%`);
            offset = end;
            sliceNo += 1;
        }
    } finally {
        await fd.close();
    }
}

async function completeUpload(token, preuploadId) {
    for (let attempt = 1; attempt <= 30; attempt++) {
        const response = await fetch(`${API_BASE}/upload/v2/file/upload_complete`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Platform: "open_platform",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({preuploadID: preuploadId}),
        });
        const payload = await response.json();
        if (payload.code !== 0) {
            const message = payload.message || "";
            if (/校验中/.test(message) || payload.code === 20005 || payload.code === 40005) {
                console.log(`Server still verifying slices (attempt ${attempt}), retrying in 1s...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            throw new Error(`upload_complete failed: ${message}`);
        }
        if (payload.data?.completed && payload.data?.fileID) {
            return payload.data.fileID;
        }
        console.log(`Waiting for completion... attempt ${attempt}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error("upload_complete timeout");
}

(async () => {
    const stats = await fs.promises.stat(filePath);
    const filename = path.basename(filePath);
    const fileMd5 = await computeFileMd5(filePath);
    console.log(`File: ${filePath}`);
    console.log(`Size: ${stats.size} bytes`);
    console.log(`MD5 : ${fileMd5}`);

    const token = await requestAccessToken();
    console.log("Obtained access token");

    const session = await createUpload(token, filename, stats.size, fileMd5);
    if (session.reuse && session.fileID) {
        console.log("秒传成功, fileID:", session.fileID);
        return;
    }
    const preuploadId = session.preuploadID;
    const sliceSize = session.sliceSize || DEFAULT_SLICE_SIZE;
    const servers = session.servers || [];
    console.log("Servers from create:", servers);
    if (!preuploadId) {
        throw new Error("create upload did not return preuploadID");
    }
    console.log(`Start uploading ${filename} in slices of ${sliceSize} bytes`);

    await uploadSlices(token, servers[0] || "", preuploadId, filename, sliceSize, stats.size);
    const fileId = await completeUpload(token, preuploadId);
    console.log("Upload completed. fileID:", fileId);
})().catch(err => {
    console.error("Upload failed:", err.message || err);
    process.exit(1);
});
