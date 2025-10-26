[中文](./README_zh_CN.md)

# SiYuan Sync

Automated local snapshots with 123Pan cloud backup and restore for SiYuan Notes. This plugin packages your local data via official kernel APIs and uploads snapshots to [123Pan](https://www.123pan.com/), enabling effortless backup and recovery with both automatic and manual modes.

## ✨ Features

### 🎯 Core Capabilities

- **Flexible Backup Scope**: Choose to backup workspace, data directory, configuration directory, or encrypted `repo` directory
- **Smart Incremental Backup**: Uses MD5 hashing and timestamp checking to backup only changed content
- **123Pan Integration**: Secure file uploads via the official 123Pan Open Platform API
- **Auto-Backup Strategy**: Configurable automatic backups on app close with daily frequency limits
- **Retention Policies**: Automatic cleanup of expired snapshots with both time-based and count-based limits
- **Snapshot Restore**: One-click restore of the latest snapshot or select any historical version

### 🚀 User Experience

- **Real-time Progress Dialog**: Detailed progress tracking for backup and restore operations
  - Backup: Preparing → Creating Snapshot → Uploading → Cleaning
  - Restore: Syncing Index → Downloading → Restoring
  - Shows current file name and progress percentage
- **Friendly UI**: Intuitive settings panel with clear status indicators
- **Bilingual Support**: Full support for Chinese and English interfaces

### 🔒 Security

- **Official APIs**: All file operations use SiYuan kernel APIs to avoid direct filesystem access
- **Data Safety**: Supports backup of encrypted repository (repo) data
- **Version Control**: Maintains multiple historical versions for easy rollback

## 📋 Requirements

- SiYuan Notes version `≥ 3.3.0`
- 123Pan Open Platform application (Client ID and Client Secret required)
  - Apply at [123Pan Open Platform](https://www.123pan.com/openapi)

## 🚀 Quick Start

### 1. Install Plugin

- Download and enable from SiYuan Notes marketplace
- Or manually download `package.zip` to `{workspace}/data/plugins/` directory

### 2. Configure 123Pan

1. Open plugin settings
2. Enter **Client ID** and **Client Secret**
3. Click **Test Connection** to verify credentials
4. Configure **Remote Folder** name (default: SiYuanSync)

### 3. Select Backup Scope

Choose what to backup in "Backup Scope":

- **Workspace**: Backup both data and configuration directories (recommended)
- **Data Directory**: Backup notes data only
- **Configuration Directory**: Backup SiYuan settings only
- **Encrypted Repository**: Backup the repo directory when local encryption is enabled

### 4. Configure Auto-Backup (Optional)

- **Enable Auto Backup**: Turn on automatic backups
- **Backup on Close**: Trigger backup when SiYuan closes
- **Daily Auto Backup Limit**: Maximum automatic backups per day (default: 2)
- **Retention Days**: Delete snapshots older than this (default: 30 days)
- **Maximum Snapshots**: Delete oldest snapshots when exceeding this count (default: 60)

### 5. Backup & Restore

**Manual Backup:**
- Click **Backup Now** button
- View real-time progress dialog
- Automatically closes when complete

**Restore Snapshot:**
- **Restore Latest Snapshot**: One-click restore of most recent backup
- **Choose Snapshot**: Select specific version from history

## 💡 Usage Tips

### Backup Notes

- Plugin creates a snapshot folder in 123Pan root directory
- Snapshot naming format: `{timestamp}--{type}`, e.g., `20250106-123456--manual`
- `repo` directory snapshots are stored as ZIP archives to keep binary data compact
- Large archives automatically switch to 123Pan slice uploads, bypassing the 1 GB single-file cap
- Auto-backup tries to execute on app close; wait for upload completion if data size is large

### Progress Indicators

- **Manual operations** show detailed progress dialogs
- **Auto-backup** runs silently in the background without interruption
- Progress dialog displays:
  - Current operation step
  - Progress percentage
  - Current file being processed

### Best Practices

1. **First Use**: Recommended to do a manual backup first to verify configuration
2. **Regular Checks**: Monitor "Remote Snapshot Count" and "Last Backup Time" in settings
3. **Before Restore**: Restore operations overwrite current data - use with caution
4. **Multi-device Sync**: 123Pan supports multi-device access for cross-device data synchronization

## 🛠️ Technical Architecture

### Core Technologies

- **TypeScript** + **Webpack** + **SCSS**
- SiYuan Notes Official API
- 123Pan Open Platform API

### Main Modules

- **Config Management**: Auto-retrieves workspace paths and system configuration
- **Snapshot Creation**: Exports data and config via SiYuan APIs
- **Cloud Sync**: Uploads/downloads files via 123Pan API
- **Backup Strategy**: Incremental backup, auto-cleanup, retention policies
- **Progress Management**: Real-time progress dialogs for excellent user experience

## 🔄 Changelog

### v1.2.4 (2025-01-10)

- 🔧 Optimized upload implementation, fully aligned with test script's proven approach
  - Added server address validation
  - Unified retry wait time to fixed 1 second
  - Standardized error message format for easier troubleshooting

### v0.1.0 (2025-01-06)

- ✨ Implemented core backup and restore features
- ✨ Support for workspace, data, config, and repo backup scopes
- ✨ Integrated 123Pan cloud storage
- ✨ Auto-backup strategy and retention policies
- ✨ Real-time progress indicator dialogs
- ✨ Bilingual support (Chinese & English)
- 🎨 User-friendly UI design

## 📄 License

MIT License

## 🙏 Acknowledgments

- [SiYuan Notes](https://github.com/siyuan-note/siyuan) - Excellent local knowledge management tool
- [123Pan](https://www.123pan.com/) - Cloud storage service provider

## 📞 Feedback & Support

For issues or suggestions:
- Submit [GitHub Issues](https://github.com/lkb/siyuan-sync/issues)
- Discuss in SiYuan Notes community
