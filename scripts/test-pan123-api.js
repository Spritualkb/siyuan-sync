/**
 * 123网盘API测试脚本
 * 测试所有增删改查等操作
 */

const API_BASE = "https://open-api.123pan.com";

// 从环境变量或这里设置你的凭证
const CLIENT_ID = process.env.PAN123_CLIENT_ID || "YOUR_CLIENT_ID";
const CLIENT_SECRET = process.env.PAN123_CLIENT_SECRET || "YOUR_CLIENT_SECRET";

let accessToken = null;

// 工具函数：休眠
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 1. 获取访问令牌
async function testGetAccessToken() {
    console.log("\n=== 测试：获取访问令牌 ===");
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/access_token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
            },
            body: JSON.stringify({
                clientID: CLIENT_ID,
                clientSecret: CLIENT_SECRET,
            }),
        });

        const data = await response.json();
        if (data.code === 0) {
            accessToken = data.data.accessToken;
            console.log("✅ 获取访问令牌成功");
            console.log("   Token:", accessToken.substring(0, 20) + "...");
            console.log("   过期时间:", data.data.expiredAt);
            return true;
        } else {
            console.error("❌ 获取访问令牌失败:", data.message);
            return false;
        }
    } catch (error) {
        console.error("❌ 获取访问令牌异常:", error.message);
        return false;
    }
}

// 2. 测试列出根目录文件
async function testListRootFiles() {
    console.log("\n=== 测试：列出根目录文件 ===");
    
    try {
        const url = new URL(`${API_BASE}/api/v2/file/list`);
        url.searchParams.set("parentFileId", "0");
        url.searchParams.set("limit", "10");

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
            },
        });

        const data = await response.json();
        if (data.code === 0) {
            console.log("✅ 列出根目录成功");
            console.log("   文件数量:", data.data.fileList.length);
            data.data.fileList.forEach(file => {
                const type = file.type === 0 ? "文件" : "文件夹";
                console.log(`   - [${type}] ${file.filename} (ID: ${file.fileId})`);
            });
            return data.data.fileList;
        } else {
            console.error("❌ 列出根目录失败:", data.message);
            return [];
        }
    } catch (error) {
        console.error("❌ 列出根目录异常:", error.message);
        return [];
    }
}

// 3. 测试创建文件夹
async function testCreateFolder(parentId, folderName) {
    console.log(`\n=== 测试：创建文件夹 "${folderName}" (parentId: ${parentId}) ===`);
    
    try {
        const response = await fetch(`${API_BASE}/upload/v1/file/mkdir`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                name: folderName,
                parentID: parentId,
            }),
        });

        const data = await response.json();
        if (data.code === 0) {
            const folderId = data.data.dirID;
            console.log("✅ 创建文件夹成功");
            console.log("   文件夹ID:", folderId);
            return folderId;
        } else {
            console.error("❌ 创建文件夹失败:", data.message);
            return null;
        }
    } catch (error) {
        console.error("❌ 创建文件夹异常:", error.message);
        return null;
    }
}

// 4. 测试获取文件详情
async function testGetFileDetail(fileId) {
    console.log(`\n=== 测试：获取文件详情 (fileId: ${fileId}) ===`);
    
    try {
        const url = new URL(`${API_BASE}/api/v1/file/detail`);
        url.searchParams.set("fileID", String(fileId));

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
            },
        });

        const data = await response.json();
        if (data.code === 0) {
            console.log("✅ 获取文件详情成功");
            console.log("   文件名:", data.data.filename);
            console.log("   类型:", data.data.type === 0 ? "文件" : "文件夹");
            console.log("   大小:", data.data.size);
            console.log("   父级ID:", data.data.parentFileID);
            return data.data;
        } else {
            console.error("❌ 获取文件详情失败:", data.message);
            return null;
        }
    } catch (error) {
        console.error("❌ 获取文件详情异常:", error.message);
        return null;
    }
}

// 5. 测试重命名
async function testRenameFile(fileId, newName) {
    console.log(`\n=== 测试：重命名文件 (fileId: ${fileId}, newName: ${newName}) ===`);
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/file/name`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                fileId: fileId,
                fileName: newName,
            }),
        });

        const data = await response.json();
        if (data.code === 0) {
            console.log("✅ 重命名成功");
            return true;
        } else {
            console.error("❌ 重命名失败:", data.message);
            return false;
        }
    } catch (error) {
        console.error("❌ 重命名异常:", error.message);
        return false;
    }
}

// 6. 测试搜索文件
async function testSearchFiles(keyword) {
    console.log(`\n=== 测试：搜索文件 "${keyword}" ===`);
    
    try {
        const url = new URL(`${API_BASE}/api/v2/file/list`);
        url.searchParams.set("parentFileId", "0");
        url.searchParams.set("limit", "10");
        url.searchParams.set("searchData", keyword);
        url.searchParams.set("searchMode", "0");

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
            },
        });

        const data = await response.json();
        if (data.code === 0) {
            console.log("✅ 搜索成功");
            console.log("   找到文件数量:", data.data.fileList.length);
            data.data.fileList.forEach(file => {
                const type = file.type === 0 ? "文件" : "文件夹";
                console.log(`   - [${type}] ${file.filename}`);
            });
            return data.data.fileList;
        } else {
            console.error("❌ 搜索失败:", data.message);
            return [];
        }
    } catch (error) {
        console.error("❌ 搜索异常:", error.message);
        return [];
    }
}

// 7. 测试移动文件
async function testMoveFile(fileIds, toParentFileId) {
    console.log(`\n=== 测试：移动文件 (fileIds: ${fileIds}, toParentFileId: ${toParentFileId}) ===`);
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/file/move`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                fileIDs: fileIds,
                toParentFileID: toParentFileId,
            }),
        });

        const data = await response.json();
        if (data.code === 0) {
            console.log("✅ 移动文件成功");
            return true;
        } else {
            console.error("❌ 移动文件失败:", data.message);
            return false;
        }
    } catch (error) {
        console.error("❌ 移动文件异常:", error.message);
        return false;
    }
}

// 8. 测试删除文件
async function testDeleteFile(fileIds) {
    console.log(`\n=== 测试：删除文件到回收站 (fileIds: ${fileIds}) ===`);
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/file/trash`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                fileIDs: fileIds,
            }),
        });

        const data = await response.json();
        if (data.code === 0) {
            console.log("✅ 删除文件成功");
            return true;
        } else {
            console.error("❌ 删除文件失败:", data.message);
            return false;
        }
    } catch (error) {
        console.error("❌ 删除文件异常:", error.message);
        return false;
    }
}

// 9. 测试上传小文件
async function testUploadSmallFile(parentId, fileName, content) {
    console.log(`\n=== 测试：上传小文件 "${fileName}" ===`);
    
    try {
        // 计算MD5
        const crypto = require('crypto');
        const md5Hash = crypto.createHash('md5').update(content).digest('hex');
        
        // 1. 创建上传任务
        const createResponse = await fetch(`${API_BASE}/upload/v2/file/create`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                parentFileID: parentId,
                filename: fileName,
                etag: md5Hash,
                size: content.length,
            }),
        });

        const createData = await createResponse.json();
        if (createData.code !== 0) {
            console.error("❌ 创建上传任务失败:", createData.message);
            return null;
        }

        if (createData.data.reuse) {
            console.log("✅ 文件已存在，秒传成功");
            return createData.data.fileID;
        }

        console.log("   preuploadID:", createData.data.preuploadID);

        // 2. 上传分片
        const server = createData.data.servers?.[0] || createData.data.server;
        const preuploadID = createData.data.preuploadID;

        const sliceMD5 = crypto.createHash('md5').update(content).digest('hex');
        const form = new (require('form-data'))();
        form.append('preuploadID', preuploadID);
        form.append('sliceNo', '1');
        form.append('sliceMD5', sliceMD5);
        form.append('slice', Buffer.from(content), fileName);

        const uploadResponse = await fetch(`${server}/upload/v2/file/slice`, {
            method: "POST",
            headers: {
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
                ...form.getHeaders(),
            },
            body: form,
        });

        const uploadData = await uploadResponse.json();
        if (uploadData.code !== 0) {
            console.error("❌ 上传分片失败:", uploadData.message);
            return null;
        }

        console.log("   上传分片成功");

        // 3. 完成上传
        await sleep(1000);

        const completeResponse = await fetch(`${API_BASE}/upload/v2/file/upload_complete`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Platform": "open_platform",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                preuploadID: preuploadID,
            }),
        });

        const completeData = await completeResponse.json();
        if (completeData.code !== 0) {
            console.error("❌ 完成上传失败:", completeData.message);
            return null;
        }

        console.log("✅ 上传文件成功");
        console.log("   文件ID:", completeData.data.fileID);
        return completeData.data.fileID;
    } catch (error) {
        console.error("❌ 上传文件异常:", error.message);
        return null;
    }
}

// 主测试流程
async function runAllTests() {
    console.log("==========================================");
    console.log("     123网盘API功能测试");
    console.log("==========================================");

    // 1. 获取访问令牌
    const tokenSuccess = await testGetAccessToken();
    if (!tokenSuccess) {
        console.error("\n❌ 无法获取访问令牌，测试终止");
        return;
    }

    await sleep(500);

    // 2. 列出根目录文件
    const rootFiles = await testListRootFiles();
    await sleep(500);

    // 3. 创建测试文件夹
    const testFolderName = `test_api_${Date.now()}`;
    const testFolderId = await testCreateFolder(0, testFolderName);
    if (!testFolderId) {
        console.error("\n❌ 无法创建测试文件夹，部分测试将跳过");
    } else {
        await sleep(500);

        // 4. 获取文件夹详情
        await testGetFileDetail(testFolderId);
        await sleep(500);

        // 5. 重命名文件夹
        const newName = `${testFolderName}_renamed`;
        await testRenameFile(testFolderId, newName);
        await sleep(500);

        // 6. 在测试文件夹中创建子文件夹
        const subFolderName = "sub_folder";
        const subFolderId = await testCreateFolder(testFolderId, subFolderName);
        await sleep(500);

        // 7. 上传测试文件
        const testContent = "这是一个测试文件的内容\nTest file content";
        const testFileName = "test_file.txt";
        const uploadedFileId = await testUploadSmallFile(testFolderId, testFileName, testContent);
        await sleep(500);

        // 8. 搜索文件
        if (uploadedFileId) {
            await testSearchFiles("test_file");
            await sleep(500);
        }

        // 9. 移动文件
        if (uploadedFileId && subFolderId) {
            await testMoveFile([uploadedFileId], subFolderId);
            await sleep(500);

            // 移回来
            await testMoveFile([uploadedFileId], testFolderId);
            await sleep(500);
        }

        // 10. 清理：删除测试文件和文件夹
        console.log("\n=== 清理测试数据 ===");
        if (uploadedFileId) {
            await testDeleteFile([uploadedFileId]);
            await sleep(500);
        }
        if (subFolderId) {
            await testDeleteFile([subFolderId]);
            await sleep(500);
        }
        await testDeleteFile([testFolderId]);
    }

    console.log("\n==========================================");
    console.log("     测试完成！");
    console.log("==========================================");
}

// 运行测试
runAllTests().catch(error => {
    console.error("测试过程出现错误:", error);
    process.exit(1);
});


