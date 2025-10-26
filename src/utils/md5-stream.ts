import * as SparkMD5 from "spark-md5";

/**
 * 流式计算文件MD5，避免大文件一次性加载到内存
 * 使用spark-md5库确保计算准确性
 * 
 * @param file - 要计算MD5的文件
 * @param chunkSize - 分块大小，默认2MB
 * @param onProgress - 进度回调函数
 * @returns Promise<string> - MD5哈希值（小写十六进制）
 */
export async function computeFileMd5Stream(
    file: File,
    chunkSize = 2 * 1024 * 1024,
    onProgress?: (progress: number) => void
): Promise<string> {
    const spark = new SparkMD5.ArrayBuffer();
    const fileSize = file.size;
    let offset = 0;

    // 分块读取文件并计算MD5
    while (offset < fileSize) {
        const end = Math.min(offset + chunkSize, fileSize);
        const chunk = file.slice(offset, end);
        const buffer = await chunk.arrayBuffer();
        
        // 添加到MD5计算器
        spark.append(buffer);
        
        offset = end;
        
        // 报告进度
        if (onProgress) {
            const progress = (offset / fileSize) * 100;
            onProgress(progress);
        }
    }

    // 返回最终的MD5哈希值（小写）
    return spark.end().toLowerCase();
}

