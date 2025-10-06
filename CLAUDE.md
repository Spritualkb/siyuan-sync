# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个思源笔记(SiYuan)插件项目,使用 TypeScript + Webpack + SCSS 技术栈开发。插件需要在思源笔记应用中加载运行,支持桌面端、移动端和浏览器环境。

## 开发命令

### 安装依赖
```bash
pnpm i
```

### 开发模式(实时编译)
```bash
pnpm run dev
```
- 启用 watch 模式,自动编译到项目根目录
- 输出文件: `index.js`, `index.css`, `i18n/*`
- 开发目录可直接放在 `{工作空间}/data/plugins/` 下进行热重载测试

### 代码检查
```bash
pnpm run lint
```
- 自动修复 ESLint 问题并缓存结果

### 生产构建
```bash
pnpm run build
```
- 编译输出到 `dist/` 目录
- 自动生成 `package.zip` 用于发布到集市
- 包含: `index.js`, `index.css`, `plugin.json`, `icon.png`, `preview.png`, `README*.md`, `i18n/*`

## 核心架构

### 插件入口
- **主文件**: `src/index.ts` - 继承 `Plugin` 基类,实现插件生命周期
- **样式**: `src/index.scss` - 插件自定义样式
- **国际化**: `src/i18n/zh_CN.json`, `src/i18n/en_US.json` - 通过 `this.i18n.key` 访问

### 关键生命周期方法
- `onload()` - 插件加载时调用,注册命令、菜单、事件总线
- `onLayoutReady()` - 布局就绪后调用,添加顶栏图标、状态栏
- `onunload()` - 插件卸载时清理资源
- `uninstall()` - 插件被删除时调用

### 主要扩展点
- **自定义 Tab**: `this.addTab()` - 创建自定义页签
- **Dock 面板**: `this.addDock()` - 添加侧边栏面板
- **命令**: `this.addCommand()` - 注册快捷键命令
- **顶栏图标**: `this.addTopBar()` - 添加顶栏按钮
- **状态栏**: `this.addStatusBar()` - 添加状态栏元素
- **Protyle 工具栏**: `updateProtyleToolbar()` - 扩展编辑器工具栏
- **斜杆命令**: `this.protyleSlash` - 自定义 `/` 命令
- **事件总线**: `this.eventBus.on/off()` - 监听系统事件

## 关键开发规范

### 1. 文件读写限制
**禁止直接使用 fs/electron/nodejs API 操作 data 目录**
必须通过思源内核 API (如 `/api/file/getFile`) 进行文件操作,否则会导致同步数据丢失。

### 2. 日记文档属性
手动创建日记时:
- 使用 `/api/filetree/createDailyNote` 会自动添加属性
- 手动创建文档需添加 `custom-dailynote-yyyymmdd` 属性

### 3. 移动端适配
检测前端环境:
```typescript
const frontEnd = getFrontend();
this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
```

### 4. 数据持久化
```typescript
// 加载
await this.loadData(STORAGE_NAME);
// 保存
await this.saveData(STORAGE_NAME, data);
// 删除
await this.removeData(STORAGE_NAME);
```

## 插件元数据 (plugin.json)

- **name**: 必须与仓库名一致,全局唯一
- **version**: 遵循 semver 规范
- **minAppVersion**: 最低兼容的思源版本 (当前: 3.3.0)
- **backends**: 后端环境支持列表 (windows/linux/darwin/docker/android/ios/harmony/all)
- **frontends**: 前端环境支持列表 (desktop/mobile/browser-desktop/browser-mobile/desktop-window/all)
- **displayName/description/readme**: 支持多语言,必须包含 `default` 和 `zh_CN`

## API 资源

- **前端 API**: https://github.com/siyuan-note/petal
- **后端 API**: https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md
- **事件总线**: 支持 50+ 系统事件 (ws-main, click-blockicon, paste 等)

## 发布流程

1. 执行 `pnpm run build` 生成 `package.zip`
2. 创建 GitHub Release,Tag 使用版本号
3. 上传 `package.zip` 作为附件
4. 首次发布需 PR [Community Bazaar](https://github.com/siyuan-note/bazaar) 的 `plugins.json`

## 注意事项

- 插件运行在思源笔记的沙箱环境中,依赖 `siyuan` 包作为外部模块
- Webpack 配置已优化开发/生产模式,无需手动修改
- 图标需符合尺寸要求: `icon.png` (160x160), `preview.png` (1024x768)
- 所有用户交互文案需支持国际化
