# 思源笔记同步插件 v1.3.2 Release Notes

## 🐛 关键修复

### MD5计算错误修复
**问题**: 用户报告在备份时出现 "分片 1 上传失败: 校验文件MD5与期望MD5不一致" 错误

**根本原因**: 
- 自定义的流式MD5计算实现存在算法错误
- 在处理文件padding时计算不准确
- 导致本地计算的MD5与服务器端不一致

**解决方案**:
- ✅ 替换自定义MD5实现为 `spark-md5` 库（经过充分验证的MD5实现）
- ✅ 保持流式处理方式，避免大文件内存问题
- ✅ 添加详细的上传日志用于问题诊断

**验证结果**:
```bash
=== Spark-MD5 准确性测试 ===

📄 测试文件: ./package.json
   大小: 962 bytes (0.00 MB)
   标准MD5: d8bc7c8e28db018bf14213fcec400f4f
   Spark MD5: d8bc7c8e28db018bf14213fcec400f4f
   ✅ MD5匹配

📄 测试文件: ./dist/index.js
   大小: 173184 bytes (0.17 MB)
   标准MD5: 17b41bac79eaf618544e26c9e006536d
   Spark MD5: 17b41bac79eaf618544e26c9e006536d
   ✅ MD5匹配

✅ 所有已知MD5值测试通过
```

## 🔧 技术改进

### 1. 增强的日志系统
添加了详细的上传和校验日志：
```typescript
// 上传会话创建日志
console.log(`[Pan123] 创建上传任务: ${filename}, 大小: ${size}, MD5: ${md5}`);

// 分片上传日志
console.log(`[Pan123] 分片 ${sliceNo}: offset=${offset}, size=${size}, MD5=${md5}`);

// 上传响应日志
console.log(`[Pan123] 分片 ${sliceNo} 上传响应:`, JSON.stringify(reply));

// 合并分片日志
console.log(`[Pan123] 合并分片响应 (尝试 ${attempt}/${maxAttempts}):`, JSON.stringify(payload));
```

### 2. MD5计算优化
```typescript
// 使用spark-md5进行流式计算
export async function computeFileMd5Stream(
    file: File,
    chunkSize = 2 * 1024 * 1024,
    onProgress?: (progress: number) => void
): Promise<string> {
    const spark = new SparkMD5.ArrayBuffer();
    const fileSize = file.size;
    let offset = 0;

    while (offset < fileSize) {
        const end = Math.min(offset + chunkSize, fileSize);
        const chunk = file.slice(offset, end);
        const buffer = await chunk.arrayBuffer();
        
        spark.append(buffer);
        offset = end;
        
        if (onProgress) {
            onProgress((offset / fileSize) * 100);
        }
    }

    return spark.end().toLowerCase();
}
```

## 📦 依赖变更

### 新增依赖
- `spark-md5@3.0.2` - 可靠的MD5计算库
- `@types/spark-md5@3.0.5` (devDependency) - TypeScript类型定义

## 🔍 问题诊断

如果您在使用过程中遇到问题，现在可以通过浏览器控制台查看详细的上传日志：

1. 打开浏览器开发者工具 (F12)
2. 切换到 Console 标签
3. 执行备份操作
4. 查看 `[siyuan-sync]` 和 `[Pan123]` 开头的日志

关键诊断信息包括：
- 文件大小和MD5值
- 每个分片的偏移量、大小和MD5
- 服务器响应的详细内容
- 合并分片的详细状态

## 📝 更新建议

**强烈推荐所有用户更新到此版本**，特别是如果您遇到了以下任何问题：
- ❌ "校验文件MD5与期望MD5不一致"
- ❌ 分片上传失败
- ❌ 备份失败但无明确错误信息

## 🙏 致谢

感谢用户报告此问题并提供详细的错误信息，这对于定位和修复问题至关重要。

---

**完整更新日志**: https://github.com/Spritualkb/siyuan-sync/compare/v1.3.1...v1.3.2

