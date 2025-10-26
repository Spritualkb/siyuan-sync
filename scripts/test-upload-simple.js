#!/usr/bin/env node

/**
 * 简化的123Pan上传测试脚本
 * 用法: node scripts/test-upload-simple.js <文件路径>
 */

const fs = require('fs');
const path = require('path');
const SparkMD5 = require('spark-md5');

const API_BASE = "https://open-api.123pan.com";

// 从环境变量或命令行参数获取凭证
const CLIENT_ID = process.env.PAN123_CLIENT_ID;
const CLIENT_SECRET = process.env.PAN123_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('请设置环境变量:');
    console.error('  export PAN123_CLIENT_ID="your_client_id"');
    console.error('  export PAN123_CLIENT_SECRET="your_client_secret"');
    process.exit(1);
}

// 获取访问令牌
async function getAccessToken() {
    console.log('获取访问令牌...');
    const response = await fetch(`${API_BASE}/api/v1/access_token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Platform': 'open_platform'
        },
        body: JSON.stringify({
            clientID: CLIENT_ID,
            clientSecret: CLIENT_SECRET
        })
    });

    const result = await response.json();
    if (result.code !== 0) {
        throw new Error(`获取访问令牌失败: ${result.message}`);
    }

    console.log('✅ 访问令牌获取成功\n');
    return result.data.accessToken;
}

// 使用spark-md5计算文件MD5
function computeFileMD5(filePath) {
    console.log('计算文件MD5...');
    return new Promise((resolve, reject) => {
        const spark = new SparkMD5.ArrayBuffer();
        const fd = fs.openSync(filePath, 'r');
        const fileSize = fs.statSync(filePath).size;
        const chunkSize = 2 * 1024 * 1024; // 2MB
        let offset = 0;

        try {
            while (offset < fileSize) {
                const readSize = Math.min(chunkSize, fileSize - offset);
                const buffer = Buffer.allocUnsafe(readSize);
                fs.readSync(fd, buffer, 0, readSize, offset);
                
                spark.append(buffer);
                offset += readSize;
            }
            
            fs.closeSync(fd);
            const md5 = spark.end().toLowerCase();
            console.log(`MD5: ${md5}\n`);
            resolve(md5);
        } catch (error) {
            fs.closeSync(fd);
            reject(error);
        }
    });
}

// 计算分片MD5
function computeSliceMD5(filePath, offset, size) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.allocUnsafe(size);
        fs.readSync(fd, buffer, 0, size, offset);
        
        const spark = new SparkMD5.ArrayBuffer();
        spark.append(buffer);
        const md5 = spark.end().toLowerCase();
        
        fs.closeSync(fd);
        return md5;
    } catch (error) {
        fs.closeSync(fd);
        throw error;
    }
}

async function testUpload(filePath) {
    console.log('=== 123Pan 上传测试 ===\n');

    if (!fs.existsSync(filePath)) {
        console.error(`❌ 文件不存在: ${filePath}`);
        process.exit(1);
    }

    const fileSize = fs.statSync(filePath).size;
    const fileName = path.basename(filePath);
    
    console.log(`📄 文件: ${filePath}`);
    console.log(`   大小: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)\n`);

    try {
        // 1. 获取访问令牌
        const accessToken = await getAccessToken();

        // 2. 计算文件MD5
        const fileMD5 = await computeFileMD5(filePath);

        // 3. 创建上传任务
        console.log('创建上传任务...');
        const testFileName = `test_${Date.now()}_${fileName}`;
        
        const createPayload = {
            parentFileID: 0,  // 根目录
            filename: testFileName,
            etag: fileMD5,
            size: fileSize,
            duplicate: 2  // 覆盖
        };
        
        console.log('请求参数:', JSON.stringify(createPayload, null, 2));
        
        const createResponse = await fetch(`${API_BASE}/upload/v2/file/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Platform': 'open_platform',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(createPayload)
        });
        
        const createResult = await createResponse.json();
        console.log('响应:', JSON.stringify(createResult, null, 2));
        
        if (createResult.code !== 0) {
            throw new Error(`创建上传任务失败: ${createResult.message}`);
        }
        
        if (createResult.data.reuse) {
            console.log('\n✅ 文件已存在，秒传成功！');
            
            // 测试删除
            if (createResult.data.fileID) {
                console.log('\n清理测试文件...');
                const deleteResponse = await fetch(`${API_BASE}/api/v1/file/trash`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Platform': 'open_platform',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        fileTrashInfos: [{
                            FileID: createResult.data.fileID
                        }]
                    })
                });
                const deleteResult = await deleteResponse.json();
                console.log('删除结果:', deleteResult.message);
            }
            return;
        }
        
        const preuploadID = createResult.data.preuploadID;
        const uploadServer = createResult.data.server || createResult.data.servers?.[0];
        
        if (!uploadServer) {
            throw new Error('未获取到上传服务器');
        }
        
        console.log(`\n上传服务器: ${uploadServer}`);
        console.log(`PreuploadID: ${preuploadID}\n`);
        
        // 4. 上传分片
        const SLICE_SIZE = 16 * 1024 * 1024; // 16MB
        const numSlices = Math.ceil(fileSize / SLICE_SIZE);
        
        console.log(`开始上传 ${numSlices} 个分片...\n`);
        
        for (let i = 0; i < numSlices; i++) {
            const sliceNo = i + 1;
            const offset = i * SLICE_SIZE;
            const sliceSize = Math.min(SLICE_SIZE, fileSize - offset);
            
            console.log(`上传分片 ${sliceNo}/${numSlices}:`);
            console.log(`  offset: ${offset}, size: ${sliceSize}`);
            
            // 计算分片MD5
            const sliceMD5 = computeSliceMD5(filePath, offset, sliceSize);
            console.log(`  MD5: ${sliceMD5}`);
            
            // 读取分片数据
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.allocUnsafe(sliceSize);
            fs.readSync(fd, buffer, 0, sliceSize, offset);
            fs.closeSync(fd);
            
            // 构建表单数据
            const FormData = require('form-data');
            const form = new FormData();
            form.append('preuploadID', preuploadID);
            form.append('sliceNo', sliceNo.toString());
            form.append('sliceMD5', sliceMD5);
            form.append('slice', buffer, {
                filename: `${testFileName}.part${sliceNo}`,
                contentType: 'application/octet-stream'
            });
            
            // 上传分片
            const uploadResponse = await fetch(`${uploadServer}/upload/v2/file/slice`, {
                method: 'POST',
                headers: {
                    'Platform': 'open_platform',
                    'Authorization': `Bearer ${accessToken}`,
                    ...form.getHeaders()
                },
                body: form
            });
            
            const uploadResult = await uploadResponse.json();
            
            if (uploadResult.code !== 0) {
                console.log('  响应:', JSON.stringify(uploadResult, null, 2));
                throw new Error(`分片 ${sliceNo} 上传失败: ${uploadResult.message}`);
            }
            
            // 验证MD5
            const serverMD5 = uploadResult.data?.md5 || uploadResult.data?.sliceMD5;
            if (serverMD5 && serverMD5.toLowerCase() !== sliceMD5) {
                console.log(`  ❌ MD5不匹配: 本地=${sliceMD5}, 服务器=${serverMD5.toLowerCase()}`);
                throw new Error(`分片 ${sliceNo} MD5校验失败`);
            }
            
            console.log(`  ✅ 上传成功\n`);
        }
        
        // 5. 完成上传
        console.log('合并分片...');
        
        let completeAttempts = 0;
        const maxCompleteAttempts = 30;
        let completed = false;
        
        while (completeAttempts < maxCompleteAttempts && !completed) {
            completeAttempts++;
            
            const completeResponse = await fetch(`${API_BASE}/upload/v2/file/upload_complete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Platform': 'open_platform',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    preuploadID: preuploadID
                })
            });
            
            const completeResult = await completeResponse.json();
            
            if (completeResult.code === 0) {
                console.log('\n✅ 上传完成！');
                console.log('FileID:', completeResult.data?.fileID || completeResult.data?.fileId);
                completed = true;
                
                // 清理测试文件
                const fileID = completeResult.data?.fileID || completeResult.data?.fileId;
                if (fileID) {
                    console.log('\n清理测试文件...');
                    const deleteResponse = await fetch(`${API_BASE}/api/v1/file/trash`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Platform': 'open_platform',
                            'Authorization': `Bearer ${accessToken}`
                        },
                        body: JSON.stringify({
                            fileTrashInfos: [{
                                FileID: fileID
                            }]
                        })
                    });
                    const deleteResult = await deleteResponse.json();
                    console.log('删除结果:', deleteResult.message);
                }
            } else {
                const message = completeResult.message || '';
                const isStillVerifying = /校验中/.test(message) || completeResult.code === 20005 || completeResult.code === 40005;
                
                if (isStillVerifying) {
                    console.log(`  等待服务器校验... (${completeAttempts}/${maxCompleteAttempts})`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    console.log('\n响应:', JSON.stringify(completeResult, null, 2));
                    throw new Error(`合并分片失败: ${completeResult.message}`);
                }
            }
        }
        
        if (!completed) {
            throw new Error('等待服务器合并分片超时');
        }
        
    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        if (error.stack) {
            console.error('\n堆栈:', error.stack);
        }
        process.exit(1);
    }
}

// 主函数
const testFile = process.argv[2];
if (!testFile) {
    console.log('用法: node scripts/test-upload-simple.js <文件路径>');
    console.log('示例: node scripts/test-upload-simple.js ./package.json');
    process.exit(1);
}

const filePath = path.resolve(testFile);
testUpload(filePath);


