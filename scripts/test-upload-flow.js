#!/usr/bin/env node

/**
 * 完整测试123Pan上传流程，包括文件MD5和分片MD5的计算
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SparkMD5 = require('spark-md5');
require('dotenv').config();

const API_BASE = "https://open-api.123pan.com";
const SLICE_SIZE = 16 * 1024 * 1024; // 16MB

// 获取访问令牌
async function getAccessToken() {
    const clientId = process.env.PAN123_CLIENT_ID;
    const clientSecret = process.env.PAN123_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
        throw new Error('请在 .env 文件中设置 PAN123_CLIENT_ID 和 PAN123_CLIENT_SECRET');
    }

    const response = await fetch(`${API_BASE}/api/v1/access_token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Platform': 'open_platform'
        },
        body: JSON.stringify({
            clientID: clientId,
            clientSecret: clientSecret
        })
    });

    const result = await response.json();
    if (result.code !== 0) {
        throw new Error(`获取访问令牌失败: ${result.message}`);
    }

    return result.data.accessToken;
}

// 计算文件的完整MD5（使用spark-md5）
function computeFileSparkMD5(filePath) {
    return new Promise((resolve, reject) => {
        const spark = new SparkMD5.ArrayBuffer();
        const fd = fs.openSync(filePath, 'r');
        const fileSize = fs.statSync(filePath).size;
        const chunkSize = 2 * 1024 * 1024; // 2MB chunks
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
            resolve(spark.end().toLowerCase());
        } catch (error) {
            fs.closeSync(fd);
            reject(error);
        }
    });
}

// 计算文件的完整MD5（使用crypto）
function computeFileCryptoMD5(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
        stream.on('error', reject);
    });
}

// 计算分片MD5（使用spark-md5）
function computeSliceSparkMD5(filePath, offset, size) {
    return new Promise((resolve, reject) => {
        const fd = fs.openSync(filePath, 'r');
        try {
            const buffer = Buffer.allocUnsafe(size);
            fs.readSync(fd, buffer, 0, size, offset);
            
            const spark = new SparkMD5.ArrayBuffer();
            spark.append(buffer);
            const md5 = spark.end().toLowerCase();
            
            fs.closeSync(fd);
            resolve(md5);
        } catch (error) {
            fs.closeSync(fd);
            reject(error);
        }
    });
}

// 计算分片MD5（使用crypto）
function computeSliceCryptoMD5(filePath, offset, size) {
    return new Promise((resolve, reject) => {
        const fd = fs.openSync(filePath, 'r');
        try {
            const buffer = Buffer.allocUnsafe(size);
            fs.readSync(fd, buffer, 0, size, offset);
            
            const hash = crypto.createHash('md5');
            hash.update(buffer);
            const md5 = hash.digest('hex').toLowerCase();
            
            fs.closeSync(fd);
            resolve(md5);
        } catch (error) {
            fs.closeSync(fd);
            reject(error);
        }
    });
}

async function testUploadFlow() {
    console.log('=== 123Pan 上传流程测试 ===\n');

    // 1. 选择测试文件
    const testFile = process.argv[2] || './dist/index.js';
    const filePath = path.resolve(__dirname, '..', testFile);
    
    if (!fs.existsSync(filePath)) {
        console.error(`❌ 文件不存在: ${testFile}`);
        process.exit(1);
    }

    const fileSize = fs.statSync(filePath).size;
    const fileName = path.basename(filePath);
    
    console.log(`📄 测试文件: ${testFile}`);
    console.log(`   大小: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)\n`);

    // 2. 测试完整文件MD5
    console.log('=== 步骤1: 测试完整文件MD5 ===');
    const start1 = Date.now();
    const cryptoMD5 = await computeFileCryptoMD5(filePath);
    const time1 = Date.now() - start1;
    console.log(`Crypto MD5:  ${cryptoMD5} (${time1}ms)`);
    
    const start2 = Date.now();
    const sparkMD5 = await computeFileSparkMD5(filePath);
    const time2 = Date.now() - start2;
    console.log(`Spark MD5:   ${sparkMD5} (${time2}ms)`);
    
    if (cryptoMD5 === sparkMD5) {
        console.log('✅ 完整文件MD5匹配\n');
    } else {
        console.log('❌ 完整文件MD5不匹配！\n');
        return;
    }

    // 3. 测试分片MD5
    console.log('=== 步骤2: 测试分片MD5 ===');
    const numSlices = Math.ceil(fileSize / SLICE_SIZE);
    console.log(`分片数量: ${numSlices}\n`);
    
    let allSlicesMatch = true;
    for (let i = 0; i < numSlices; i++) {
        const offset = i * SLICE_SIZE;
        const sliceSize = Math.min(SLICE_SIZE, fileSize - offset);
        
        console.log(`分片 ${i + 1}/${numSlices}:`);
        console.log(`  offset: ${offset}, size: ${sliceSize}`);
        
        const cryptoSliceMD5 = await computeSliceCryptoMD5(filePath, offset, sliceSize);
        const sparkSliceMD5 = await computeSliceSparkMD5(filePath, offset, sliceSize);
        
        console.log(`  Crypto MD5: ${cryptoSliceMD5}`);
        console.log(`  Spark MD5:  ${sparkSliceMD5}`);
        
        if (cryptoSliceMD5 === sparkSliceMD5) {
            console.log(`  ✅ 匹配\n`);
        } else {
            console.log(`  ❌ 不匹配！\n`);
            allSlicesMatch = false;
        }
    }
    
    if (allSlicesMatch) {
        console.log('✅ 所有分片MD5匹配\n');
    } else {
        console.log('❌ 有分片MD5不匹配！\n');
        return;
    }

    // 4. 如果提供了API凭证，测试实际上传
    if (process.env.PAN123_CLIENT_ID && process.env.PAN123_CLIENT_SECRET) {
        console.log('=== 步骤3: 测试实际上传 ===');
        
        try {
            const accessToken = await getAccessToken();
            console.log('✅ 获取访问令牌成功\n');
            
            // 创建上传任务
            const createResponse = await fetch(`${API_BASE}/upload/v2/file/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Platform': 'open_platform',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    parentFileID: 0,
                    filename: `test_${Date.now()}_${fileName}`,
                    etag: sparkMD5,
                    size: fileSize,
                    duplicate: 2 // 覆盖
                })
            });
            
            const createResult = await createResponse.json();
            console.log('创建上传任务响应:', JSON.stringify(createResult, null, 2));
            
            if (createResult.code !== 0) {
                throw new Error(`创建上传任务失败: ${createResult.message}`);
            }
            
            if (createResult.data.reuse) {
                console.log('✅ 文件已存在，秒传成功！');
                return;
            }
            
            const preuploadID = createResult.data.preuploadID;
            const uploadServer = createResult.data.server || createResult.data.servers?.[0];
            
            if (!uploadServer) {
                throw new Error('未获取到上传服务器');
            }
            
            console.log(`\n上传服务器: ${uploadServer}`);
            console.log(`PreuploadID: ${preuploadID}\n`);
            
            // 上传分片
            for (let i = 0; i < numSlices; i++) {
                const sliceNo = i + 1;
                const offset = i * SLICE_SIZE;
                const sliceSize = Math.min(SLICE_SIZE, fileSize - offset);
                
                console.log(`上传分片 ${sliceNo}/${numSlices}...`);
                
                const sliceMD5 = await computeSliceSparkMD5(filePath, offset, sliceSize);
                console.log(`  MD5: ${sliceMD5}`);
                
                const fd = fs.openSync(filePath, 'r');
                const buffer = Buffer.allocUnsafe(sliceSize);
                fs.readSync(fd, buffer, 0, sliceSize, offset);
                fs.closeSync(fd);
                
                const FormData = require('form-data');
                const form = new FormData();
                form.append('preuploadID', preuploadID);
                form.append('sliceNo', sliceNo.toString());
                form.append('sliceMD5', sliceMD5);
                form.append('slice', buffer, {
                    filename: `${fileName}.part${sliceNo}`,
                    contentType: 'application/octet-stream'
                });
                
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
                console.log(`  响应:`, JSON.stringify(uploadResult));
                
                if (uploadResult.code !== 0) {
                    throw new Error(`分片 ${sliceNo} 上传失败: ${uploadResult.message}`);
                }
                
                const serverMD5 = uploadResult.data?.md5 || uploadResult.data?.sliceMD5;
                if (serverMD5 && serverMD5.toLowerCase() !== sliceMD5) {
                    console.log(`  ❌ MD5不匹配: 本地=${sliceMD5}, 服务器=${serverMD5}`);
                    throw new Error(`分片 ${sliceNo} MD5校验失败`);
                }
                
                console.log(`  ✅ 上传成功\n`);
            }
            
            // 完成上传
            console.log('合并分片...');
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
            console.log('合并分片响应:', JSON.stringify(completeResult, null, 2));
            
            if (completeResult.code === 0) {
                console.log('\n✅ 上传完成！');
            } else {
                console.log(`\n⚠️  合并分片返回: ${completeResult.message}`);
            }
            
        } catch (error) {
            console.error('\n❌ 上传测试失败:', error.message);
        }
    } else {
        console.log('=== 跳过实际上传测试 ===');
        console.log('提示: 在 .env 文件中设置 PAN123_CLIENT_ID 和 PAN123_CLIENT_SECRET 以进行完整测试\n');
    }
}

testUploadFlow().catch(console.error);

