#!/usr/bin/env node

/**
 * 测试MD5计算的正确性
 * 对比流式MD5和标准MD5的结果
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

/**
 * 使用Node.js crypto模块计算文件MD5（标准方法）
 */
function computeStandardMD5(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
        stream.on('error', reject);
    });
}

/**
 * 模拟浏览器中的流式MD5计算
 */
async function computeStreamMD5(filePath) {
    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
    const fileSize = fs.statSync(filePath).size;
    const fd = fs.openSync(filePath, 'r');
    
    // MD5状态
    let a = 0x67452301;
    let b = 0xefcdab89;
    let c = 0x98badcfe;
    let d = 0x10325476;
    
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
        K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }
    
    const SHIFT_AMOUNTS = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    
    let processedBytes = 0;
    const M = new Uint32Array(16);
    
    // 处理所有完整的64字节块
    while (processedBytes < fileSize) {
        const chunkSize = Math.min(CHUNK_SIZE, fileSize - processedBytes);
        const buffer = Buffer.allocUnsafe(chunkSize);
        fs.readSync(fd, buffer, 0, chunkSize, processedBytes);
        
        // 处理这个chunk中的64字节块
        const data = new Uint8Array(buffer);
        const completeBlocks = Math.floor(data.length / 64);
        const view = new DataView(data.buffer, data.byteOffset);
        
        for (let blockIdx = 0; blockIdx < completeBlocks; blockIdx++) {
            const offset = blockIdx * 64;
            for (let j = 0; j < 16; j++) {
                M[j] = view.getUint32(offset + j * 4, true);
            }
            
            let A = a, B = b, C = c, D = d;
            
            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16) {
                    F = (B & C) | (~B & D);
                    g = i;
                } else if (i < 32) {
                    F = (D & B) | (~D & C);
                    g = (5 * i + 1) % 16;
                } else if (i < 48) {
                    F = B ^ C ^ D;
                    g = (3 * i + 5) % 16;
                } else {
                    F = C ^ (B | ~D);
                    g = (7 * i) % 16;
                }
                
                const temp = D;
                D = C;
                C = B;
                const sum = (A + F + K[i] + M[g]) | 0;
                const rotated = ((sum << SHIFT_AMOUNTS[i]) | (sum >>> (32 - SHIFT_AMOUNTS[i]))) | 0;
                B = (B + rotated) | 0;
                A = temp;
            }
            
            a = (a + A) | 0;
            b = (b + B) | 0;
            c = (c + C) | 0;
            d = (d + D) | 0;
        }
        
        processedBytes += chunkSize;
    }
    
    fs.closeSync(fd);
    
    // 现在处理padding和最后的块
    const bitLength = fileSize * 8;
    const paddingNeeded = ((fileSize + 8) >> 6 << 6) + 64 - fileSize;
    const paddedData = new Uint8Array(paddingNeeded);
    
    // 读取剩余的数据（不足64字节的部分）
    const remainderSize = fileSize % 64;
    if (remainderSize > 0) {
        const remainder = Buffer.allocUnsafe(remainderSize);
        const fdRemain = fs.openSync(filePath, 'r');
        fs.readSync(fdRemain, remainder, 0, remainderSize, fileSize - remainderSize);
        fs.closeSync(fdRemain);
        paddedData.set(new Uint8Array(remainder));
    }
    
    // 添加padding
    paddedData[remainderSize] = 0x80;
    const view = new DataView(paddedData.buffer);
    view.setUint32(paddedData.length - 8, bitLength & 0xffffffff, true);
    view.setUint32(paddedData.length - 4, Math.floor(bitLength / 0x100000000), true);
    
    // 处理padding后的块
    for (let offset = 0; offset < paddedData.length; offset += 64) {
        for (let j = 0; j < 16; j++) {
            M[j] = view.getUint32(offset + j * 4, true);
        }
        
        let A = a, B = b, C = c, D = d;
        
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) {
                F = (B & C) | (~B & D);
                g = i;
            } else if (i < 32) {
                F = (D & B) | (~D & C);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D;
                g = (3 * i + 5) % 16;
            } else {
                F = C ^ (B | ~D);
                g = (7 * i) % 16;
            }
            
            const temp = D;
            D = C;
            C = B;
            const sum = (A + F + K[i] + M[g]) | 0;
            const rotated = ((sum << SHIFT_AMOUNTS[i]) | (sum >>> (32 - SHIFT_AMOUNTS[i]))) | 0;
            B = (B + rotated) | 0;
            A = temp;
        }
        
        a = (a + A) | 0;
        b = (b + B) | 0;
        c = (c + C) | 0;
        d = (d + D) | 0;
    }
    
    function toHex(value) {
        return (value >>> 0).toString(16).padStart(8, '0');
    }
    
    return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

async function testMD5() {
    console.log('=== MD5计算测试 ===\n');
    
    // 测试文件列表
    const testFiles = [
        './package.json',
        './dist/index.js',
    ];
    
    for (const file of testFiles) {
        const filePath = path.resolve(__dirname, '..', file);
        if (!fs.existsSync(filePath)) {
            console.log(`⚠️  文件不存在: ${file}`);
            continue;
        }
        
        const fileSize = fs.statSync(filePath).size;
        console.log(`\n📄 测试文件: ${file}`);
        console.log(`   大小: ${fileSize} bytes`);
        
        try {
            // 标准MD5
            const standardMD5 = await computeStandardMD5(filePath);
            console.log(`   标准MD5: ${standardMD5}`);
            
            // 流式MD5
            const streamMD5 = await computeStreamMD5(filePath);
            console.log(`   流式MD5: ${streamMD5}`);
            
            // 比较结果
            if (standardMD5 === streamMD5) {
                console.log(`   ✅ MD5匹配`);
            } else {
                console.log(`   ❌ MD5不匹配！`);
            }
        } catch (error) {
            console.error(`   ❌ 错误: ${error.message}`);
        }
    }
    
    // 测试小文件
    console.log('\n\n=== 测试小数据 ===');
    const testData = 'Hello, World!';
    const testBuffer = Buffer.from(testData);
    
    // 使用crypto
    const cryptoHash = crypto.createHash('md5').update(testBuffer).digest('hex').toLowerCase();
    console.log(`测试数据: "${testData}"`);
    console.log(`crypto MD5: ${cryptoHash}`);
    
    // 使用我们的实现（通过临时文件）
    const tempFile = path.join(__dirname, 'temp-test.txt');
    fs.writeFileSync(tempFile, testData);
    const ourHash = await computeStreamMD5(tempFile);
    fs.unlinkSync(tempFile);
    console.log(`流式 MD5:   ${ourHash}`);
    
    if (cryptoHash === ourHash) {
        console.log('✅ 小数据MD5匹配');
    } else {
        console.log('❌ 小数据MD5不匹配');
    }
}

testMD5().catch(console.error);

