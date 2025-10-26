#!/usr/bin/env node

/**
 * 测试spark-md5的准确性
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const SparkMD5 = require('spark-md5');

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
 * 使用spark-md5计算文件MD5（流式）
 */
function computeSparkMD5(filePath, chunkSize = 2 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const spark = new SparkMD5.ArrayBuffer();
        const fd = fs.openSync(filePath, 'r');
        const fileSize = fs.statSync(filePath).size;
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

async function testMD5() {
    console.log('=== Spark-MD5 准确性测试 ===\n');
    
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
        console.log(`   大小: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
        
        try {
            // 标准MD5
            const start1 = Date.now();
            const standardMD5 = await computeStandardMD5(filePath);
            const time1 = Date.now() - start1;
            console.log(`   标准MD5: ${standardMD5} (${time1}ms)`);
            
            // Spark MD5
            const start2 = Date.now();
            const sparkMD5 = await computeSparkMD5(filePath);
            const time2 = Date.now() - start2;
            console.log(`   Spark MD5: ${sparkMD5} (${time2}ms)`);
            
            // 比较结果
            if (standardMD5 === sparkMD5) {
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
    
    // 使用spark-md5
    const spark = new SparkMD5.ArrayBuffer();
    spark.append(testBuffer);
    const sparkHash = spark.end().toLowerCase();
    console.log(`spark  MD5: ${sparkHash}`);
    
    if (cryptoHash === sparkHash) {
        console.log('✅ 小数据MD5匹配');
    } else {
        console.log('❌ 小数据MD5不匹配');
    }
    
    console.log('\n\n=== 测试已知MD5 ===');
    // 测试已知的MD5值
    const knownTests = [
        { data: '', expected: 'd41d8cd98f00b204e9800998ecf8427e' },
        { data: 'The quick brown fox jumps over the lazy dog', expected: '9e107d9d372bb6826bd81d3542a419d6' },
    ];
    
    for (const test of knownTests) {
        const spark = new SparkMD5.ArrayBuffer();
        spark.append(Buffer.from(test.data));
        const result = spark.end().toLowerCase();
        const match = result === test.expected;
        console.log(`数据: "${test.data || '(空字符串)'}"`);
        console.log(`预期: ${test.expected}`);
        console.log(`实际: ${result}`);
        console.log(`结果: ${match ? '✅ 匹配' : '❌ 不匹配'}\n`);
    }
}

testMD5().catch(console.error);


