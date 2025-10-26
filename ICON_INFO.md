# 📱 SiYuan Sync 插件图标

## ✨ 图标设计

这个图标专为 SiYuan Sync 插件设计，包含以下元素：

### 视觉元素
- **kb 字样**：醒目的白色粗体字母，代表品牌标识
- **☁️ 云朵**：象征云端存储和 123 网盘备份功能
- **🔄 同步箭头**：双向箭头表示上传和下载同步
- **💙 蓝色渐变背景**：从 `#4A90E2` 到 `#357ABD` 的渐变，传达科技感与可靠性
- **✨ 装饰光点**：增加视觉趣味性和现代感

### 设计规格
- **尺寸**: 160×160 像素
- **格式**: PNG（源文件为 SVG）
- **圆角**: 32px，符合现代UI设计规范
- **颜色空间**: sRGB

## 📂 文件位置

图标已更新到以下位置：
- `/icon.png` - 项目根目录
- `/dist/icon.png` - 构建输出目录
- `/package/icon.png` - 打包目录

## 🔄 如何重新生成

如果需要修改图标，编辑 `icon.svg` 文件后运行：

```bash
# 使用 rsvg-convert（推荐）
rsvg-convert -w 160 -h 160 icon.svg -o icon.png
cp icon.png dist/icon.png
cp icon.png package/icon.png

# 或使用 ImageMagick
magick icon.svg -density 300 -background none -resize 160x160 icon.png
cp icon.png dist/icon.png
cp icon.png package/icon.png
```

## 🎨 设计哲学

1. **简洁明了**：图标元素清晰，一眼就能识别插件功能
2. **品牌识别**：kb 字样突出显示，建立独特的品牌形象
3. **功能表达**：云朵和同步箭头直观地传达了插件的核心功能
4. **现代美观**：渐变色和圆角设计符合现代审美

---

*设计制作于 2025-10-27*

