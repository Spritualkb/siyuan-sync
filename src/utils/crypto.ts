/**
 * 加密工具模块
 * 使用 Web Crypto API 提供 AES-256-GCM 加密/解密功能
 */

// 加密算法配置
const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // GCM模式推荐12字节IV
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

/**
 * 加密结果
 */
export interface EncryptedData {
    data: ArrayBuffer; // 加密后的数据
    iv: Uint8Array; // 初始化向量
    salt: Uint8Array; // 盐值
}

/**
 * 从密码派生密钥
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    // 导入密码作为原始密钥材料
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        passwordBuffer,
        "PBKDF2",
        false,
        ["deriveBits", "deriveKey"]
    );
    
    // 使用PBKDF2派生密钥
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        {
            name: ALGORITHM,
            length: KEY_LENGTH,
        },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * 加密数据
 * @param data 要加密的数据
 * @param password 加密密码
 * @returns 加密结果
 */
export async function encryptData(data: ArrayBuffer, password: string): Promise<EncryptedData> {
    // 生成随机盐值和IV
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    
    // 派生密钥
    const key = await deriveKey(password, salt);
    
    // 加密数据
    const encryptedData = await crypto.subtle.encrypt(
        {
            name: ALGORITHM,
            iv: iv,
        },
        key,
        data
    );
    
    return {
        data: encryptedData,
        iv: iv,
        salt: salt,
    };
}

/**
 * 解密数据
 * @param encryptedData 加密的数据
 * @param iv 初始化向量
 * @param salt 盐值
 * @param password 解密密码
 * @returns 解密后的数据
 */
export async function decryptData(
    encryptedData: ArrayBuffer,
    iv: Uint8Array,
    salt: Uint8Array,
    password: string
): Promise<ArrayBuffer> {
    // 派生密钥
    const key = await deriveKey(password, salt);
    
    // 解密数据
    return crypto.subtle.decrypt(
        {
            name: ALGORITHM,
            iv: iv,
        },
        key,
        encryptedData
    );
}

/**
 * 加密文件
 * @param file 要加密的文件
 * @param password 加密密码
 * @returns 包含加密数据的Blob和元数据
 */
export async function encryptFile(file: File, password: string): Promise<{blob: Blob; iv: Uint8Array; salt: Uint8Array}> {
    const buffer = await file.arrayBuffer();
    const encrypted = await encryptData(buffer, password);
    
    // 创建包含加密数据的Blob
    const blob = new Blob([encrypted.data], {type: "application/octet-stream"});
    
    return {
        blob: blob,
        iv: encrypted.iv,
        salt: encrypted.salt,
    };
}

/**
 * 解密文件
 * @param encryptedBlob 加密的Blob
 * @param iv 初始化向量
 * @param salt 盐值
 * @param password 解密密码
 * @param originalName 原始文件名
 * @returns 解密后的文件
 */
export async function decryptFile(
    encryptedBlob: Blob,
    iv: Uint8Array,
    salt: Uint8Array,
    password: string,
    originalName: string
): Promise<File> {
    const encryptedBuffer = await encryptedBlob.arrayBuffer();
    const decryptedBuffer = await decryptData(encryptedBuffer, iv, salt, password);
    
    return new File([decryptedBuffer], originalName);
}

/**
 * 将加密元数据序列化为JSON字符串
 */
export function serializeEncryptionMetadata(iv: Uint8Array, salt: Uint8Array): string {
    return JSON.stringify({
        iv: Array.from(iv),
        salt: Array.from(salt),
    });
}

/**
 * 从JSON字符串反序列化加密元数据
 */
export function deserializeEncryptionMetadata(json: string): {iv: Uint8Array; salt: Uint8Array} {
    const obj = JSON.parse(json);
    return {
        iv: new Uint8Array(obj.iv),
        salt: new Uint8Array(obj.salt),
    };
}


