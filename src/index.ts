import JSZip from "jszip";
import {
    Dialog,
    Plugin,
    Setting,
    fetchPost,
    showMessage,
} from "siyuan";
import "./index.scss";
import {
    AccessTokenInfo,
    BackupComponentType,
    BackupTarget,
    KernelInfo,
    KernelPaths,
    LocalSnapshot,
    PluginSettings,
    SnapshotComponent,
    SnapshotReason,
    SnapshotRemoteComponent,
    SnapshotRemoteMeta,
} from "./types";
import {md5} from "./utils/md5";
import {computeFileMd5Stream} from "./utils/md5-stream";
import {Pan123Client} from "./services/pan123";
import {ProgressDialog} from "./utils/progress";
import {FolderSyncManager, SyncProgress} from "./services/folder-sync";
import {FolderSyncConfig} from "./types";

const SETTINGS_KEY = "siyuan-sync-settings";
const EXPORT_TEMP_RELATIVE = "/temp/siyuan-sync";
const ZIP_MIME = "application/zip";
const JSON_MIME = "application/json";

interface GetConfResponse {
    conf: {
        system: {
            kernelVersion: string;
            os: string;
            container: string;
            workspaceDir: string;
            dataDir: string;
            confDir: string;
        };
    };
}

interface ReadDirResponse {
    isDir: boolean;
    isSymlink: boolean;
    name: string;
    updated: number;
}

interface ExportDataResponse {
    name: string;
}

interface ExportConfResponse {
    name: string;
    zip: string;
}

interface RequestedComponent {
    category: BackupTarget;
    component: BackupComponentType;
}

class KernelApiError extends Error {
    public readonly code: number;
    public readonly endpoint: string;

    constructor(endpoint: string, code: number, message?: string) {
        super(message ? `${message}` : `Kernel API ${endpoint} failed with code ${code}`);
        this.name = "KernelApiError";
        this.code = code;
        this.endpoint = endpoint;
    }
}

export default class SiyuanSyncPlugin extends Plugin {
    private settings: PluginSettings = this.getDefaultSettings();
    private kernelInfo: KernelInfo | null = null;
    private readonly cloudClient = new Pan123Client();
    private readonly folderSyncManager: FolderSyncManager = new FolderSyncManager(this.cloudClient);
    private statusElements: Record<string, HTMLElement> = {};
    private saveSettingsTimer: number | null = null;
    private readonly beforeUnloadHandler = () => {
        if (!this.settings.autoBackupEnabled || !this.settings.autoBackupOnClose) {
            return;
        }
        if (!this.canRunAutoBackup()) {
            return;
        }
        void this.runAutoBackup();
    };

    async onload(): Promise<void> {
        try {
            await this.loadSettings();
            await this.refreshKernelInfo();
            this.initSettingUI();
            window.addEventListener("beforeunload", this.beforeUnloadHandler);
            this.log("initialized");
            showMessage(`[${this.name}] 已加载，当前工作空间：${this.kernelInfo?.paths.workspaceDir ?? "未知"}`);
        } catch (error) {
            console.error(`[${this.name}] 初始化失败`, error);
            showMessage(`[${this.name}] 初始化失败：${(error as Error).message}`, 7000, "error");
        }
    }

    onunload(): void {
        window.removeEventListener("beforeunload", this.beforeUnloadHandler);
        this.log("unloaded");
    }

    public async runManualBackup(): Promise<void> {
        await this.executeBackup("manual");
    }

    public async runAutoBackup(): Promise<void> {
        if (!this.canRunAutoBackup()) {
            this.log("auto backup skipped due to daily limit");
            return;
        }
        await this.executeBackup("auto");
    }

    public async restoreLatestSnapshot(): Promise<void> {
        const progress = new ProgressDialog(this.t("restoreProgress"), [
            {name: this.t("progressSyncing"), weight: 10},
            {name: this.t("progressDownloading"), weight: 40},
            {name: this.t("progressRestoring"), weight: 50},
        ]);

        try {
            progress.startStep(0, this.t("progressSyncing"));
            await this.syncRemoteSnapshotIndex();

            const snapshots = this.settings.snapshots ?? [];
            if (!snapshots.length) {
                progress.destroy();
                showMessage(`[${this.name}] 未找到远程快照`, 5000, "warning");
                return;
            }

            const latest = snapshots[0];
            progress.completeStep(0);

            await this.restoreSnapshot(latest, progress);
            progress.complete(this.t("restoreComplete"));

            setTimeout(() => {
                showMessage(`[${this.name}] 已恢复快照 ${latest.id}`);
            }, 1000);
        } catch (error) {
            progress.error(this.t("restoreFailed") + ": " + (error as Error).message);
            setTimeout(() => {
                showMessage(`[${this.name}] ${this.t("restoreFailed")}: ${(error as Error).message}`, 7000, "error");
            }, 2500);
        }
    }

    public async restoreSnapshotById(snapshotId: string): Promise<void> {
        const progress = new ProgressDialog(this.t("restoreProgress"), [
            {name: this.t("progressSyncing"), weight: 10},
            {name: this.t("progressDownloading"), weight: 40},
            {name: this.t("progressRestoring"), weight: 50},
        ]);

        try {
            progress.startStep(0, this.t("progressSyncing"));
            await this.syncRemoteSnapshotIndex();

            const snapshots = this.settings.snapshots ?? [];
            const target = snapshots.find(item => item.id === snapshotId);
            if (!target) {
                progress.destroy();
                throw new Error(`未找到快照 ${snapshotId}`);
            }

            progress.completeStep(0);
            await this.restoreSnapshot(target, progress);
            progress.complete(this.t("restoreComplete"));
        } catch (error) {
            progress.error(this.t("restoreFailed") + ": " + (error as Error).message);
            throw error;
        }
    }

    private log(message: string, ...args: unknown[]): void {
        console.debug(`[${this.name}] ${message}`, ...args);
    }

    private getDefaultSettings(): PluginSettings {
        return {
            clientId: "",
            clientSecret: "",
            remoteFolderName: "SiYuanSync",
            remoteFolderId: undefined,
            selectedTargets: {
                workspace: false,
                data: true,
                conf: true,
                repo: false,
            },
            autoBackupEnabled: true,
            autoBackupOnClose: true,
            autoBackupDailyLimit: 2,
            retentionDays: 30,
            maxSnapshots: 60,
            backupHistory: [],
            autoBackupTracker: {},
            lastManualBackupAt: undefined,
            lastAutoBackupAt: undefined,
            lastKnownPaths: undefined,
            lastKnownExistence: undefined,
            accessToken: undefined,
            snapshots: [],
            folderSyncConfigs: [],
        };
    }

    private async loadSettings(): Promise<void> {
        const stored = await this.loadData(SETTINGS_KEY);
        const defaults = this.getDefaultSettings();
        if (stored && typeof stored === "object") {
            const selectedTargets = {
                ...defaults.selectedTargets,
                ...(stored.selectedTargets ?? {}),
            } as Record<BackupTarget, boolean>;
            this.settings = {
                ...defaults,
                ...stored,
                selectedTargets,
                backupHistory: stored.backupHistory ?? [],
                autoBackupTracker: stored.autoBackupTracker ?? {},
                snapshots: stored.snapshots ?? [],
                folderSyncConfigs: stored.folderSyncConfigs ?? [],
            };
        } else {
            this.settings = defaults;
        }
    }

    private initSettingUI(): void {
        this.setting = new Setting({
            confirmCallback: async () => {
                await this.saveSettings();
                showMessage(`[${this.name}] ${this.t("settingsSaved")}`);
            }
        });

        const clientIdInput = document.createElement("input");
        clientIdInput.className = "b3-text-field fn__block";
        clientIdInput.placeholder = this.t("clientIdPlaceholder");
        clientIdInput.value = this.settings.clientId;
        clientIdInput.addEventListener("input", () => {
            this.settings.clientId = clientIdInput.value.trim();
            this.scheduleSaveSettings();
        });
        this.setting.addItem({
            title: this.t("clientIdTitle"),
            description: this.t("clientIdDesc"),
            createActionElement: () => clientIdInput,
        });

        const clientSecretInput = document.createElement("input");
        clientSecretInput.className = "b3-text-field fn__block";
        clientSecretInput.type = "password";
        clientSecretInput.placeholder = this.t("clientSecretPlaceholder");
        clientSecretInput.value = this.settings.clientSecret;
        clientSecretInput.addEventListener("input", () => {
            this.settings.clientSecret = clientSecretInput.value.trim();
            this.scheduleSaveSettings();
        });
        this.setting.addItem({
            title: this.t("clientSecretTitle"),
            description: this.t("clientSecretDesc"),
            createActionElement: () => clientSecretInput,
        });

        const remoteFolderInput = document.createElement("input");
        remoteFolderInput.className = "b3-text-field fn__block";
        remoteFolderInput.value = this.settings.remoteFolderName;
        remoteFolderInput.addEventListener("input", () => {
            this.settings.remoteFolderName = remoteFolderInput.value.trim() || "SiYuanSync";
            this.settings.remoteFolderId = undefined;
            this.scheduleSaveSettings();
        });
        this.setting.addItem({
            title: this.t("remoteFolderTitle"),
            description: this.t("remoteFolderDesc"),
            createActionElement: () => remoteFolderInput,
        });

        const authButtonsWrapper = document.createElement("div");
        authButtonsWrapper.style.display = "flex";
        authButtonsWrapper.style.gap = "8px";

        const authButton = document.createElement("button");
        authButton.className = "b3-button b3-button--primary";
        authButton.textContent = this.t("btnTestAuth");
        authButton.addEventListener("click", async () => {
            authButton.disabled = true;
            try {
                await this.ensureAccessToken();
                showMessage(`[${this.name}] ${this.t("authSuccess")}`);
            } catch (error) {
                showMessage(`[${this.name}] ${this.t("authFailed")}: ${(error as Error).message}`, 7000, "error");
            } finally {
                authButton.disabled = false;
                this.refreshSettingStatus();
            }
        });
        authButtonsWrapper.append(authButton);

        const syncButton = document.createElement("button");
        syncButton.className = "b3-button";
        syncButton.textContent = this.t("btnSyncRemote");
        syncButton.addEventListener("click", async () => {
            syncButton.disabled = true;
            try {
                await this.syncRemoteSnapshotIndex();
                showMessage(`[${this.name}] ${this.t("syncRemoteDone")}`);
            } catch (error) {
                showMessage(`[${this.name}] ${this.t("syncRemoteFail")}: ${(error as Error).message}`, 7000, "error");
            } finally {
                syncButton.disabled = false;
                this.refreshSettingStatus();
            }
        });
        authButtonsWrapper.append(syncButton);

        this.setting.addItem({
            title: this.t("authActions"),
            createActionElement: () => authButtonsWrapper,
        });

        const targetsContainer = document.createElement("div");
        targetsContainer.style.display = "flex";
        targetsContainer.style.flexWrap = "wrap";
        targetsContainer.style.gap = "12px";

        const workspaceToggle = this.createTargetToggle("workspace");
        const dataToggle = this.createTargetToggle("data");
        const confToggle = this.createTargetToggle("conf");
        const repoToggle = this.createTargetToggle("repo");

        targetsContainer.append(workspaceToggle.wrapper, dataToggle.wrapper, confToggle.wrapper, repoToggle.wrapper);

        const updateTargetStates = () => {
            const workspaceSelected = this.settings.selectedTargets.workspace;
            dataToggle.input.disabled = workspaceSelected;
            confToggle.input.disabled = workspaceSelected;
            if (workspaceSelected) {
                dataToggle.input.checked = false;
                confToggle.input.checked = false;
                this.settings.selectedTargets.data = false;
                this.settings.selectedTargets.conf = false;
            }
            repoToggle.input.disabled = false;
        };
        updateTargetStates();

        workspaceToggle.input.addEventListener("change", () => {
            this.settings.selectedTargets.workspace = workspaceToggle.input.checked;
            this.scheduleSaveSettings();
            updateTargetStates();
        });
        dataToggle.input.addEventListener("change", () => {
            this.settings.selectedTargets.data = dataToggle.input.checked;
            this.scheduleSaveSettings();
        });
        confToggle.input.addEventListener("change", () => {
            this.settings.selectedTargets.conf = confToggle.input.checked;
            this.scheduleSaveSettings();
        });
        repoToggle.input.addEventListener("change", () => {
            this.settings.selectedTargets.repo = repoToggle.input.checked;
            this.scheduleSaveSettings();
        });

        this.setting.addItem({
            title: this.t("backupTargetsTitle"),
            description: this.t("backupTargetsDesc"),
            createActionElement: () => targetsContainer,
        });

        const autoContainer = document.createElement("div");
        autoContainer.style.display = "flex";
        autoContainer.style.flexDirection = "column";
        autoContainer.style.gap = "6px";

        const autoEnabledToggle = this.createCheckboxRow(this.t("autoEnabled"), this.settings.autoBackupEnabled, (checked) => {
            this.settings.autoBackupEnabled = checked;
            this.scheduleSaveSettings();
        });
        autoContainer.append(autoEnabledToggle.wrapper);

        const autoCloseToggle = this.createCheckboxRow(this.t("autoOnClose"), this.settings.autoBackupOnClose, (checked) => {
            this.settings.autoBackupOnClose = checked;
            this.scheduleSaveSettings();
        });
        autoContainer.append(autoCloseToggle.wrapper);

        const limitInput = this.createNumberInput(this.settings.autoBackupDailyLimit, 1, 10, (value) => {
            this.settings.autoBackupDailyLimit = value;
            this.scheduleSaveSettings();
        });
        const retentionInput = this.createNumberInput(this.settings.retentionDays, 1, 90, (value) => {
            this.settings.retentionDays = value;
            this.scheduleSaveSettings();
        });
        const maxSnapshotInput = this.createNumberInput(this.settings.maxSnapshots, 1, 120, (value) => {
            this.settings.maxSnapshots = value;
            this.scheduleSaveSettings();
        });

        const numericWrapper = document.createElement("div");
        numericWrapper.style.display = "grid";
        numericWrapper.style.gridTemplateColumns = "repeat(auto-fit, minmax(180px, 1fr))";
        numericWrapper.style.gap = "12px";

        numericWrapper.append(
            this.wrapLabeledInput(this.t("autoDailyLimit"), limitInput),
            this.wrapLabeledInput(this.t("retentionDays"), retentionInput),
            this.wrapLabeledInput(this.t("maxSnapshots"), maxSnapshotInput),
        );

        autoContainer.append(numericWrapper);

        this.setting.addItem({
            title: this.t("autoSectionTitle"),
            description: this.t("autoSectionDesc"),
            createActionElement: () => autoContainer,
        });

        const actionContainer = document.createElement("div");
        actionContainer.style.display = "flex";
        actionContainer.style.flexWrap = "wrap";
        actionContainer.style.gap = "8px";

        const manualBackupBtn = document.createElement("button");
        manualBackupBtn.className = "b3-button b3-button--primary";
        manualBackupBtn.textContent = this.t("btnManualBackup");
        manualBackupBtn.addEventListener("click", async () => {
            manualBackupBtn.disabled = true;
            await this.runManualBackup();
            manualBackupBtn.disabled = false;
            this.refreshSettingStatus();
        });
        actionContainer.append(manualBackupBtn);

        const restoreLatestBtn = document.createElement("button");
        restoreLatestBtn.className = "b3-button";
        restoreLatestBtn.textContent = this.t("btnRestoreLatest");
        restoreLatestBtn.addEventListener("click", async () => {
            restoreLatestBtn.disabled = true;
            try {
                await this.restoreLatestSnapshot();
            } catch (error) {
                showMessage(`[${this.name}] ${this.t("restoreFailed")}: ${(error as Error).message}`, 7000, "error");
            } finally {
                restoreLatestBtn.disabled = false;
                this.refreshSettingStatus();
            }
        });
        actionContainer.append(restoreLatestBtn);

        const chooseSnapshotBtn = document.createElement("button");
        chooseSnapshotBtn.className = "b3-button";
        chooseSnapshotBtn.textContent = this.t("btnChooseSnapshot");
        chooseSnapshotBtn.addEventListener("click", async () => {
            await this.showSnapshotPicker();
            this.refreshSettingStatus();
        });
        actionContainer.append(chooseSnapshotBtn);

        this.setting.addItem({
            title: this.t("maintenanceTitle"),
            createActionElement: () => actionContainer,
        });

        // 文件夹同步UI
        const folderSyncContainer = document.createElement("div");
        folderSyncContainer.style.display = "flex";
        folderSyncContainer.style.flexDirection = "column";
        folderSyncContainer.style.gap = "12px";

        const folderListContainer = document.createElement("div");
        folderListContainer.style.display = "flex";
        folderListContainer.style.flexDirection = "column";
        folderListContainer.style.gap = "8px";

        const refreshFolderList = () => {
            folderListContainer.innerHTML = "";
            const configs = this.settings.folderSyncConfigs || [];
            
            if (configs.length === 0) {
                const emptyHint = document.createElement("div");
                emptyHint.style.color = "var(--b3-theme-on-surface)";
                emptyHint.style.opacity = "0.6";
                emptyHint.textContent = this.t("folderSyncNoConfigs");
                folderListContainer.append(emptyHint);
                return;
            }

            configs.forEach((config, index) => {
                const configCard = this.createFolderConfigCard(config, index, refreshFolderList);
                folderListContainer.append(configCard);
            });
        };

        refreshFolderList();
        folderSyncContainer.append(folderListContainer);

        const addFolderBtn = document.createElement("button");
        addFolderBtn.className = "b3-button b3-button--outline";
        addFolderBtn.textContent = this.t("folderSyncAdd");
        addFolderBtn.style.marginTop = "8px";
        addFolderBtn.addEventListener("click", () => {
            this.showFolderConfigDialog(null, refreshFolderList);
        });
        folderSyncContainer.append(addFolderBtn);

        this.setting.addItem({
            title: this.t("folderSyncTitle"),
            description: this.t("folderSyncDesc"),
            createActionElement: () => folderSyncContainer,
        });

        const statusContainer = document.createElement("div");
        statusContainer.className = "fn__flex-column";
        statusContainer.style.gap = "4px";

        const statusKeys: Array<[keyof typeof this.statusElements, string]> = [
            ["workspacePath", this.t("statusWorkspace")],
            ["dataPath", this.t("statusData")],
            ["confPath", this.t("statusConf")],
            ["repoPath", this.t("statusRepo")],
            ["remoteFolder", this.t("statusRemote")],
            ["snapshotCount", this.t("statusSnapshotCount")],
            ["lastManual", this.t("statusLastManual")],
            ["lastAuto", this.t("statusLastAuto")],
            ["tokenStatus", this.t("statusToken")],
        ];

        statusKeys.forEach(([key, label]) => {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.justifyContent = "space-between";
            row.style.gap = "12px";
            const labelEl = document.createElement("span");
            labelEl.textContent = label;
            const valueEl = document.createElement("span");
            valueEl.className = "ft__on-surface";
            valueEl.style.textAlign = "right";
            row.append(labelEl, valueEl);
            statusContainer.append(row);
            this.statusElements[key] = valueEl;
        });

        this.setting.addItem({
            title: this.t("statusTitle"),
            createActionElement: () => statusContainer,
        });

        this.refreshSettingStatus();
    }

    private createTargetToggle(target: BackupTarget): {wrapper: HTMLLabelElement; input: HTMLInputElement} {
        const wrapper = document.createElement("label");
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.gap = "6px";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!this.settings.selectedTargets[target];
        const span = document.createElement("span");
        span.textContent = this.t(`target_${target}`);
        wrapper.append(input, span);
        return {wrapper, input};
    }

    private createCheckboxRow(label: string, initial: boolean, onChange: (checked: boolean) => void): {wrapper: HTMLLabelElement; input: HTMLInputElement} {
        const wrapper = document.createElement("label");
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.justifyContent = "space-between";
        wrapper.style.gap = "12px";
        const span = document.createElement("span");
        span.textContent = label;
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = initial;
        input.addEventListener("change", () => onChange(input.checked));
        wrapper.append(span, input);
        return {wrapper, input};
    }

    private createNumberInput(initial: number, min: number, max: number, onChange: (value: number) => void): HTMLInputElement {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "b3-text-field";
        input.min = `${min}`;
        input.max = `${max}`;
        input.value = `${initial}`;
        input.addEventListener("change", () => {
            let value = Number(input.value);
            if (Number.isNaN(value)) {
                value = initial;
            }
            value = Math.max(min, Math.min(max, value));
            input.value = `${value}`;
            onChange(value);
        });
        return input;
    }

    private wrapLabeledInput(label: string, input: HTMLElement): HTMLElement {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "4px";
        const span = document.createElement("span");
        span.textContent = label;
        wrapper.append(span, input);
        return wrapper;
    }

    private scheduleSaveSettings(): void {
        if (this.saveSettingsTimer !== null) {
            window.clearTimeout(this.saveSettingsTimer);
        }
        this.saveSettingsTimer = window.setTimeout(() => {
            this.saveSettingsTimer = null;
            this.saveSettings().catch((error) => {
                console.error(`[${this.name}] 保存设置失败`, error);
            });
        }, 500);
    }

    private t(key: string): string {
        const table = this.i18n as Record<string, string>;
        return table?.[key] ?? key;
    }

    private refreshSettingStatus(): void {
        if (!this.statusElements.workspacePath) {
            return;
        }
        const paths = this.kernelInfo?.paths ?? this.settings.lastKnownPaths;
        this.statusElements.workspacePath.textContent = paths?.workspaceDir ?? this.t("unknown");
        this.statusElements.dataPath.textContent = paths?.dataDir ?? this.t("unknown");
        this.statusElements.confPath.textContent = paths?.confDir ?? this.t("unknown");
        this.statusElements.repoPath.textContent = paths?.repoDir ?? this.t("unknown");
        if (this.settings.remoteFolderId) {
            this.statusElements.remoteFolder.textContent = `${this.settings.remoteFolderName} (#${this.settings.remoteFolderId})`;
        } else {
            this.statusElements.remoteFolder.textContent = this.settings.remoteFolderName;
        }
        const snapshots = this.settings.snapshots ?? [];
        this.statusElements.snapshotCount.textContent = `${snapshots.length}`;
        this.statusElements.lastManual.textContent = this.formatDateTime(this.settings.lastManualBackupAt);
        this.statusElements.lastAuto.textContent = this.formatDateTime(this.settings.lastAutoBackupAt);
        const tokenInfo = this.settings.accessToken;
        if (tokenInfo?.token && tokenInfo.expiredAt) {
            this.statusElements.tokenStatus.textContent = this.t("tokenValidUntil") + " " + this.formatDateTime(tokenInfo.expiredAt);
        } else {
            this.statusElements.tokenStatus.textContent = this.t("tokenMissing");
        }
    }

    private formatDateTime(iso?: string): string {
        if (!iso) {
            return this.t("notYet");
        }
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
            return iso;
        }
        const yyyy = date.getFullYear();
        const mm = `${date.getMonth() + 1}`.padStart(2, "0");
        const dd = `${date.getDate()}`.padStart(2, "0");
        const hh = `${date.getHours()}`.padStart(2, "0");
        const mi = `${date.getMinutes()}`.padStart(2, "0");
        const ss = `${date.getSeconds()}`.padStart(2, "0");
        return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    }

    private async showSnapshotPicker(): Promise<void> {
        await this.syncRemoteSnapshotIndex();
        const snapshots = this.settings.snapshots ?? [];
        if (!snapshots.length) {
            showMessage(`[${this.name}] ${this.t("noSnapshots")}`, 5000, "warning");
            return;
        }
        const options = snapshots.map((snapshot) => {
            return `<option value="${snapshot.id}">${snapshot.id} (${this.formatDateTime(snapshot.createdAt)})</option>`;
        }).join("");
        const content = `<div class="b3-dialog__content"><select class="b3-select fn__block" id="siyuan-sync-snapshot-select">${options}</select><div class="fn__flex-column" id="siyuan-sync-snapshot-detail" style="margin-top:8px;gap:4px;"></div></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${this.t("btnCancel")}</button><button class="b3-button b3-button--primary" data-type="restore">${this.t("btnRestore")}</button></div>`;
        const dialog = new Dialog({
            title: this.t("snapshotPickerTitle"),
            content,
            width: "520px",
        });
        const selectEl = dialog.element.querySelector("#siyuan-sync-snapshot-select") as HTMLSelectElement;
        const detailEl = dialog.element.querySelector("#siyuan-sync-snapshot-detail") as HTMLElement;
        const renderDetail = () => {
            const selected = snapshots.find(item => item.id === selectEl.value);
            if (!selected) {
                detailEl.textContent = "";
                return;
            }
            const components = selected.components.map(item => this.t(`target_${item.component === "repo" ? "repo" : item.component}`)).join(", ");
            detailEl.innerHTML = `<div>${this.t("snapshotReason")}: ${this.t(selected.reason === "auto" ? "reasonAuto" : "reasonManual")}</div><div>${this.t("snapshotComponents")}: ${components}</div>`;
        };
        renderDetail();
        selectEl.addEventListener("change", renderDetail);
        dialog.element.querySelector(".b3-button--cancel")?.addEventListener("click", () => {
            dialog.destroy();
        });
        dialog.element.querySelector('[data-type="restore"]')?.addEventListener("click", async () => {
            const snapshotId = selectEl.value;
            try {
                await this.restoreSnapshotById(snapshotId);
                showMessage(`[${this.name}] ${this.t("restoreDone")}: ${snapshotId}`);
                dialog.destroy();
            } catch (error) {
                showMessage(`[${this.name}] ${this.t("restoreFailed")}: ${(error as Error).message}`, 7000, "error");
            }
        });
    }

    private async saveSettings(): Promise<void> {
        await this.saveData(SETTINGS_KEY, this.settings);
    }

    private async ensureKernelInfoLoaded(): Promise<void> {
        if (!this.kernelInfo) {
            await this.refreshKernelInfo();
        }
    }

    private async refreshKernelInfo(): Promise<void> {
        const response = await this.kernelPost<GetConfResponse>("/api/system/getConf", {});
        const systemConf = response?.conf?.system;
        if (!systemConf) {
            throw new Error("未能获取系统配置");
        }
        const paths: KernelPaths = {
            workspaceDir: systemConf.workspaceDir,
            dataDir: systemConf.dataDir,
            confDir: systemConf.confDir,
            repoDir: joinPath(systemConf.workspaceDir, "repo"),
        };

        const existence = await this.detectPaths();

        this.kernelInfo = {
            system: {
                kernelVersion: systemConf.kernelVersion,
                os: systemConf.os,
                container: systemConf.container,
            },
            paths,
            existence,
            fetchedAt: new Date().toISOString(),
        };

        this.settings.lastKnownPaths = paths;
        this.settings.lastKnownExistence = existence;
        await this.saveSettings();
    }

    private async detectPaths(): Promise<Record<BackupTarget, boolean>> {
        const existence: Record<BackupTarget, boolean> = {
            workspace: true,
            data: await this.pathExists("/data"),
            conf: await this.pathExists("/conf"),
            repo: await this.pathExists("/repo"),
        };
        this.log("path existence", existence);
        return existence;
    }

    private async pathExists(relativePath: string): Promise<boolean> {
        try {
            await this.kernelPost<ReadDirResponse[]>("/api/file/readDir", {path: relativePath});
            return true;
        } catch (error) {
            if (error instanceof KernelApiError) {
                if (error.code === 404 || error.code === 405) {
                    return false;
                }
            }
            console.warn(`[${this.name}] 检查路径 ${relativePath} 失败`, error);
            return false;
        }
    }

    private resolveRequestedComponents(): RequestedComponent[] {
        const components: RequestedComponent[] = [];
        const existence = this.kernelInfo?.existence ?? this.settings.lastKnownExistence ?? {
            workspace: true,
            data: true,
            conf: true,
            repo: false,
        };
        const targets = this.settings.selectedTargets;
        if (targets.workspace) {
            components.push({category: "workspace", component: "data"});
            components.push({category: "workspace", component: "conf"});
            if (existence.repo) {
                components.push({category: "workspace", component: "repo"});
            }
            return components;
        }
        if (targets.data) {
            components.push({category: "data", component: "data"});
        }
        if (targets.conf) {
            components.push({category: "conf", component: "conf"});
        }
        if (targets.repo && existence.repo) {
            components.push({category: "repo", component: "repo"});
        }
        return components;
    }

    private generateSnapshotId(date = new Date()): string {
        const yyyy = date.getFullYear();
        const mm = `${date.getMonth() + 1}`.padStart(2, "0");
        const dd = `${date.getDate()}`.padStart(2, "0");
        const hh = `${date.getHours()}`.padStart(2, "0");
        const mi = `${date.getMinutes()}`.padStart(2, "0");
        const ss = `${date.getSeconds()}`.padStart(2, "0");
        return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
    }

    private buildComponentFileName(request: RequestedComponent, originalName: string, snapshotId: string): string {
        const extIndex = originalName.lastIndexOf(".");
        const ext = extIndex > -1 ? originalName.slice(extIndex + 1) : "";
        const sanitizedExt = ext ? `.${ext}` : "";
        return `${request.category}-${request.component}-${snapshotId}${sanitizedExt}`;
    }

    private getLastRecord(category: BackupTarget, component: BackupComponentType) {
        for (let i = this.settings.backupHistory.length - 1; i >= 0; i--) {
            const record = this.settings.backupHistory[i];
            if (record.category === category && record.component === component) {
                return record;
            }
        }
        return undefined;
    }

    private getDateKey(date = new Date()): string {
        const yyyy = date.getFullYear();
        const mm = `${date.getMonth() + 1}`.padStart(2, "0");
        const dd = `${date.getDate()}`.padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    private canRunAutoBackup(): boolean {
        if (!this.settings.autoBackupEnabled) {
            return false;
        }
        const key = this.getDateKey();
        const count = this.settings.autoBackupTracker[key] ?? 0;
        return count < this.settings.autoBackupDailyLimit;
    }

    private markAutoBackupSuccess(dateKey: string): void {
        const current = this.settings.autoBackupTracker[dateKey] ?? 0;
        this.settings.autoBackupTracker[dateKey] = current + 1;
        this.cleanupAutoBackupTracker();
    }

    private cleanupAutoBackupTracker(): void {
        const keys = Object.keys(this.settings.autoBackupTracker);
        if (keys.length <= 16) {
            return;
        }
        keys.sort();
        while (keys.length > 16) {
            const key = keys.shift();
            if (key) {
                delete this.settings.autoBackupTracker[key];
            }
        }
    }

    private async createLocalSnapshot(reason: SnapshotReason, progress?: ProgressDialog | null): Promise<LocalSnapshot | null> {
        await this.ensureKernelInfoLoaded();
        const requests = this.resolveRequestedComponents();
        if (requests.length === 0) {
            this.log("no backup targets selected");
            if (reason === "manual") {
                showMessage(`[${this.name}] 未选择需要备份的目录`, 5000, "warning");
            }
            return null;
        }

        if (progress) {
            progress.startStep(1, this.t("progressCreatingSnapshot"));
        }

        const snapshotId = this.generateSnapshotId();
        const createdAt = new Date().toISOString();
        const components: SnapshotComponent[] = [];

        for (let i = 0; i < requests.length; i++) {
            const request = requests[i];
            if (progress) {
                const componentProgress = (i / requests.length) * 100;
                progress.updateStepProgress(1, componentProgress, `${this.t("progressCreating")} ${this.t(`target_${request.component}`)}`);
            }

            let component: SnapshotComponent | null = null;
            try {
                if (request.component === "data") {
                    component = await this.createDataComponent(request, snapshotId, createdAt);
                } else if (request.component === "conf") {
                    component = await this.createConfComponent(request, snapshotId, createdAt);
                } else if (request.component === "repo") {
                    component = await this.createRepoComponent(request, snapshotId, createdAt);
                }
            } catch (error) {
                console.error(`[${this.name}] 构建备份组件失败`, request, error);
                showMessage(`[${this.name}] 备份 ${request.category}/${request.component} 失败：${(error as Error).message}`, 7000, "error");
                continue;
            }
            if (!component) {
                continue;
            }
            const lastRecord = this.getLastRecord(request.category, request.component);
            if (lastRecord && lastRecord.md5 === component.md5) {
                this.log(`component ${request.category}/${request.component} unchanged, skip`);
                continue;
            }
            components.push(component);
        }

        if (components.length === 0) {
            this.log("no component changed, skip snapshot");
            if (reason === "manual") {
                showMessage(`[${this.name}] 所选目录未发生变化，已跳过备份`, 4000, "info");
            }
            return null;
        }

        return {
            id: snapshotId,
            createdAt,
            reason,
            components,
        };
    }

    private async executeBackup(reason: SnapshotReason): Promise<void> {
        let progress: ProgressDialog | null = null;
        let snapshot: LocalSnapshot | null = null;
        try {
            if (reason === "manual") {
                progress = new ProgressDialog(this.t("backupProgress"), [
                    {name: this.t("progressPreparing"), weight: 5},
                    {name: this.t("progressCreatingSnapshot"), weight: 30},
                    {name: this.t("progressUploading"), weight: 60},
                    {name: this.t("progressCleaning"), weight: 5},
                ]);
                progress.startStep(0, this.t("progressPreparing"));
            }

            snapshot = await this.createLocalSnapshot(reason, progress);
            if (!snapshot) {
                if (progress) {
                    progress.destroy();
                }
                return;
            }

            if (progress) {
                progress.completeStep(1);
            }

            const remoteMeta = await this.uploadSnapshot(snapshot, progress);
            if (!remoteMeta) {
                if (progress) {
                    progress.destroy();
                }
                // 上传失败也要清理临时文件
                await this.cleanupTempFiles(snapshot);
                return;
            }

            if (progress) {
                progress.completeStep(3);
                progress.complete(this.t("backupComplete"));
            }

            if (reason === "manual") {
                setTimeout(() => {
                    showMessage(`[${this.name}] 备份成功：${remoteMeta.id}`);
                }, 1000);
            } else {
                this.log(`auto backup completed: ${remoteMeta.id}`);
            }
        } catch (error) {
            console.error(`[${this.name}] 备份失败`, error);
            const message = (error as Error).message ?? "未知错误";
            if (progress) {
                progress.error(this.t("backupFailed") + ": " + message);
            }
            
            // 备份失败时清理临时文件
            if (snapshot) {
                try {
                    await this.cleanupTempFiles(snapshot);
                } catch (cleanupError) {
                    console.warn(`[${this.name}] 清理临时文件失败`, cleanupError);
                }
            }
            
            if (reason === "manual") {
                setTimeout(() => {
                    showMessage(`[${this.name}] 备份失败：${message}`, 7000, "error");
                }, progress ? 2500 : 0);
            } else {
                this.log(`auto backup failed: ${message}`);
            }
        }
    }

    private async createDataComponent(request: RequestedComponent, snapshotId: string, createdAt: string): Promise<SnapshotComponent | null> {
        const paths = this.kernelInfo?.paths ?? this.settings.lastKnownPaths;
        if (!paths) {
            throw new Error("无法确定工作空间路径");
        }
        await this.ensureDir(EXPORT_TEMP_RELATIVE);
        const exportDirAbs = joinPath(paths.workspaceDir, stripLeadingSlash(EXPORT_TEMP_RELATIVE));
        const exportResponse = await this.kernelPost<ExportDataResponse>("/api/export/exportDataInFolder", {folder: exportDirAbs});
        if (!exportResponse?.name) {
            throw new Error("导出数据返回结果异常");
        }

        const absZipPath = joinPath(exportDirAbs, exportResponse.name);
        const relativeZipPath = this.absoluteToWorkspacePath(absZipPath);
        const fileName = this.buildComponentFileName(request, exportResponse.name, snapshotId);
        
        // 使用优化的方法获取文件，避免大文件内存问题
        const file = await this.fetchFileAsBlob(relativeZipPath, fileName);
        
        // 使用流式MD5计算，避免一次性读取大文件
        console.log(`[${this.name}] 正在计算 ${fileName} 的MD5 (${file.size} bytes)...`);
        const md5Hash = await computeFileMd5Stream(file);
        console.log(`[${this.name}] MD5计算完成: ${md5Hash}`);

        // 不要立即删除,记录临时文件路径,上传完成后再删除
        return {
            category: request.category,
            component: request.component,
            createdAt,
            file,
            md5: md5Hash,
            size: file.size,
            tempFilePath: relativeZipPath, // 记录临时文件路径
        };
    }

    private async createConfComponent(request: RequestedComponent, snapshotId: string, createdAt: string): Promise<SnapshotComponent | null> {
        const response = await this.kernelPost<ExportConfResponse>("/api/system/exportConf", {});
        if (!response?.zip) {
            throw new Error("导出配置失败");
        }
        const buffer = await this.fetchBinaryFromUrl(response.zip);
        const archiveName = response.zip.split("/").pop() ?? `${response.name}.zip`;
        const fileName = this.buildComponentFileName(request, archiveName, snapshotId);
        const file = new File([buffer], fileName, {type: ZIP_MIME});
        const md5Hash = md5(buffer);
        
        // 提取临时文件路径，用于后续清理
        // response.zip 格式类似 "/temp/export/conf-20231115-143022.zip"
        let tempFilePath: string | undefined;
        try {
            // 将URL路径转换为工作空间相对路径
            const urlPath = response.zip.split("?")[0]; // 移除可能的查询参数
            if (urlPath.startsWith("/")) {
                tempFilePath = urlPath;
            }
        } catch (error) {
            console.warn(`[${this.name}] 无法解析配置文件临时路径:`, error);
        }
        
        return {
            category: request.category,
            component: request.component,
            createdAt,
            file,
            md5: md5Hash,
            size: file.size,
            tempFilePath, // 记录临时文件路径，用于上传后清理
        };
    }

    private async createRepoComponent(request: RequestedComponent, snapshotId: string, createdAt: string): Promise<SnapshotComponent | null> {
        const existence = this.kernelInfo?.existence ?? this.settings.lastKnownExistence;
        if (!existence?.repo) {
            this.log("repo directory missing, skip repo backup");
            return null;
        }
        
        console.log(`[${this.name}] 开始构建repo归档...`);
        const archive = await this.buildRepoArchive();
        const fileName = `${request.category}-${request.component}-${snapshotId}.zip`;
        
        // 创建Blob而不是直接使用ArrayBuffer，减少内存占用
        const blob = new Blob([archive], {type: ZIP_MIME});
        const file = new File([blob], fileName, {type: ZIP_MIME});
        
        // 使用流式MD5计算
        console.log(`[${this.name}] 正在计算repo的MD5 (${file.size} bytes)...`);
        const md5Hash = await computeFileMd5Stream(file);
        console.log(`[${this.name}] Repo MD5计算完成: ${md5Hash}`);
        
        return {
            category: request.category,
            component: request.component,
            createdAt,
            file,
            md5: md5Hash,
            size: file.size,
        };
    }

    private async ensureAccessToken(): Promise<string> {
        const {clientId, clientSecret} = this.settings;
        if (!clientId || !clientSecret) {
            throw new Error("请先在设置中配置 123 网盘的 Client ID 和 Client Secret");
        }
        let tokenInfo = this.settings.accessToken;
        if (!tokenInfo || this.isTokenExpired(tokenInfo)) {
            const freshToken = await this.cloudClient.requestAccessToken(clientId, clientSecret);
            tokenInfo = freshToken;
            this.settings.accessToken = freshToken;
            await this.saveSettings();
        }
        this.cloudClient.setAccessToken(tokenInfo.token);
        return tokenInfo.token;
    }

    private isTokenExpired(info?: AccessTokenInfo): boolean {
        if (!info?.token || !info.expiredAt) {
            return true;
        }
        const expireMs = Date.parse(info.expiredAt);
        if (Number.isNaN(expireMs)) {
            return true;
        }
        const bufferMs = 5 * 60 * 1000;
        return expireMs - Date.now() <= bufferMs;
    }

    private async ensureRemoteRootFolder(): Promise<number> {
        await this.ensureAccessToken();
        const name = this.settings.remoteFolderName || "SiYuanSync";
        
        // 如果有缓存的folderId，先验证它是否仍然存在
        if (this.settings.remoteFolderId) {
            try {
                const detail = await this.cloudClient.getFileDetail(this.settings.remoteFolderId);
                // 验证是文件夹且未被删除
                if (detail.type === 1 && detail.trashed === 0 && detail.filename === name) {
                    console.log(`[${this.name}] 使用缓存的远程文件夹ID: ${this.settings.remoteFolderId}`);
                    return this.settings.remoteFolderId;
                } else {
                    console.warn(`[${this.name}] 缓存的文件夹ID ${this.settings.remoteFolderId} 已失效，重新查找`);
                    this.settings.remoteFolderId = undefined;
                }
            } catch (error) {
                console.warn(`[${this.name}] 验证缓存的文件夹ID失败:`, error);
                this.settings.remoteFolderId = undefined;
            }
        }
        
        // 在根目录查找文件夹
        const entries = await this.cloudClient.listFiles(0);
        let folder = entries.find(item => item.type === 1 && item.filename === name && (item.trashed ?? 0) === 0);
        let folderId: number;
        
        if (folder) {
            folderId = folder.fileId;
            console.log(`[${this.name}] 找到已存在的远程文件夹: ${name} (ID: ${folderId})`);
        } else {
            console.log(`[${this.name}] 创建新的远程文件夹: ${name}`);
            const result = await this.cloudClient.createFolder(0, name);
            folderId = result.fileId;
            console.log(`[${this.name}] 远程文件夹创建成功 (ID: ${folderId})`);
        }
        
        this.settings.remoteFolderId = folderId;
        await this.saveSettings();
        return folderId;
    }

    private async uploadSnapshot(snapshot: LocalSnapshot, progress?: ProgressDialog | null): Promise<SnapshotRemoteMeta | null> {
        await this.ensureAccessToken();
        const rootFolderId = await this.ensureRemoteRootFolder();
        await this.syncRemoteSnapshotIndex();

        if (progress) {
            progress.startStep(2, this.t("progressUploading"));
        }

        const folderName = buildSnapshotFolderName(snapshot.id, snapshot.reason);
        const existingMeta = (this.settings.snapshots ?? []).find(item => item.id === snapshot.id);
        if (existingMeta) {
            await this.deleteSnapshotRemote(existingMeta);
        }
        const siblings = await this.cloudClient.listFiles(rootFolderId);
        const duplicate = siblings.find(item => item.type === 1 && item.filename === folderName && (item.trashed ?? 0) === 0);
        if (duplicate) {
            await this.cloudClient.deleteFiles([duplicate.fileId]);
        }
        const folderResult = await this.cloudClient.createFolder(rootFolderId, folderName);
        const folderId = folderResult.fileId;
        const remoteComponents: SnapshotRemoteComponent[] = [];

        const totalComponents = snapshot.components.length;
        for (let i = 0; i < totalComponents; i++) {
            const component = snapshot.components[i];
            const progressLabel = `${this.t("progressUploading")} ${component.file.name} (${i + 1}/${totalComponents})`;
            if (progress) {
                const uploadProgress = (i / totalComponents) * 100;
                progress.updateStepProgress(2, uploadProgress, progressLabel);
            }

            console.log(`[${this.name}] 开始上传: ${component.file.name}, 大小: ${component.size}, MD5: ${component.md5}`);
            
            const result = await this.cloudClient.uploadSingle({
                parentId: folderId,
                file: component.file,
                filename: component.file.name,
                md5: component.md5,
                size: component.size,
                duplicateStrategy: 2,
                onProgress: (uploadedBytes, totalBytes, currentSlice, totalSlices) => {
                    if (!progress) {
                        return;
                    }
                    const ratio = totalBytes > 0 ? uploadedBytes / totalBytes : 1;
                    const overall = ((i + ratio) / totalComponents) * 100;
                    
                    // 更详细的进度信息
                    let detailedLabel = progressLabel;
                    if (currentSlice && totalSlices) {
                        const sliceInfo = `[${currentSlice}/${totalSlices}]`;
                        const sizeInfo = this.formatBytes(uploadedBytes) + "/" + this.formatBytes(totalBytes);
                        detailedLabel = `${progressLabel} ${sliceInfo} ${sizeInfo}`;
                    }
                    
                    progress.updateStepProgress(2, overall, detailedLabel);
                },
            });
            if (progress) {
                const finalPercent = ((i + 1) / totalComponents) * 100;
                progress.updateStepProgress(2, finalPercent, progressLabel);
            }
            remoteComponents.push({
                category: component.category,
                component: component.component,
                fileId: result.fileId,
                fileName: component.file.name,
                md5: component.md5,
                size: component.size,
                uploadedAt: new Date().toISOString(),
            });
        }

        const remoteMeta: SnapshotRemoteMeta = {
            id: snapshot.id,
            createdAt: snapshot.createdAt,
            reason: snapshot.reason,
            folderId,
            components: remoteComponents,
        };

        this.registerSnapshotMeta(remoteMeta, snapshot);
        if (snapshot.reason === "auto") {
            const key = this.getDateKey(new Date(snapshot.createdAt));
            this.markAutoBackupSuccess(key);
            this.settings.lastAutoBackupAt = snapshot.createdAt;
        } else {
            this.settings.lastManualBackupAt = snapshot.createdAt;
        }
        await this.saveSettings();

        if (progress) {
            progress.startStep(3, this.t("progressCleaning"));
        }

        // 上传成功后,清理所有临时文件
        await this.cleanupTempFiles(snapshot);


        await this.enforceDailyLimit(remoteMeta);
        await this.applyRetention(rootFolderId);
        await this.saveSettings();
        this.refreshSettingStatus();
        return remoteMeta;
    }

    private registerSnapshotMeta(remoteMeta: SnapshotRemoteMeta, localSnapshot: LocalSnapshot): void {
        const snapshots = this.settings.snapshots ?? [];
        const filtered = snapshots.filter(item => item.id !== remoteMeta.id);
        filtered.push(remoteMeta);
        filtered.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        this.settings.snapshots = filtered;
        this.updateHistoryWithSnapshot(remoteMeta, localSnapshot);
    }

    private updateHistoryWithSnapshot(remoteMeta: SnapshotRemoteMeta, localSnapshot: LocalSnapshot): void {
        const updatedHistory = this.settings.backupHistory.filter(record => record.timestamp !== remoteMeta.createdAt);
        for (const component of remoteMeta.components) {
            const source = localSnapshot.components.find(item => item.category === component.category && item.component === component.component);
            if (!source) {
                continue;
            }
            updatedHistory.push({
                category: component.category,
                component: component.component,
                md5: component.md5,
                size: component.size,
                timestamp: remoteMeta.createdAt,
                remoteFileId: component.fileId,
                remoteFileName: component.fileName,
                remoteEtag: component.md5,
            });
        }
        updatedHistory.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
        const maxRecords = 256;
        if (updatedHistory.length > maxRecords) {
            this.settings.backupHistory = updatedHistory.slice(0, maxRecords);
        } else {
            this.settings.backupHistory = updatedHistory;
        }
    }

    private async deleteSnapshotRemote(snapshot: SnapshotRemoteMeta): Promise<void> {
        try {
            await this.ensureAccessToken();
            await this.cloudClient.deleteFiles([snapshot.folderId]);
            this.settings.snapshots = (this.settings.snapshots ?? []).filter(item => item.id !== snapshot.id);
            this.settings.backupHistory = this.settings.backupHistory.filter(record => record.timestamp !== snapshot.createdAt);
            await this.saveSettings();
            this.refreshSettingStatus();
        } catch (error) {
            console.warn(`[${this.name}] 删除远程快照失败`, snapshot, error);
        }
    }

    private async applyRetention(rootFolderId: number): Promise<void> {
        const retentionDays = Math.max(1, this.settings.retentionDays);
        const maxSnapshots = Math.max(1, this.settings.maxSnapshots);
        const now = Date.now();
        const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
        const snapshots = (this.settings.snapshots ?? []).slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        const toDelete: SnapshotRemoteMeta[] = [];
        for (const snapshot of snapshots) {
            const created = Date.parse(snapshot.createdAt);
            if (!Number.isNaN(created) && now - created > retentionMs) {
                toDelete.push(snapshot);
            }
        }
        const retained = snapshots.filter(item => !toDelete.includes(item));
        while (retained.length > maxSnapshots) {
            const candidate = retained.shift();
            if (candidate) {
                toDelete.push(candidate);
            }
        }
        for (const snapshot of toDelete) {
            await this.deleteSnapshotRemote(snapshot);
        }
    }

    private async cleanupTempFiles(snapshot: LocalSnapshot): Promise<void> {
        const tempFilesToClean: string[] = [];
        
        // 收集所有需要清理的临时文件路径
        for (const component of snapshot.components) {
            if (component.tempFilePath) {
                tempFilesToClean.push(component.tempFilePath);
            }
        }

        // 删除所有临时文件
        for (const filePath of tempFilesToClean) {
            try {
                await this.removeFile(filePath);
                this.log(`已清理临时文件: ${filePath}`);
            } catch (error) {
                console.warn(`[${this.name}] 清理临时文件失败`, filePath, error);
            }
        }

        if (tempFilesToClean.length > 0) {
            this.log(`已清理 ${tempFilesToClean.length} 个临时文件`);
        }
    }

    private async enforceDailyLimit(newSnapshot: SnapshotRemoteMeta): Promise<void> {
        if (newSnapshot.reason !== "auto") {
            return;
        }
        const dateKey = newSnapshot.createdAt.slice(0, 10);
        const limit = Math.max(1, this.settings.autoBackupDailyLimit);
        const snapshots = (this.settings.snapshots ?? []).slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        const sameDayAuto = snapshots.filter(item => item.reason === "auto" && item.createdAt.startsWith(dateKey));
        while (sameDayAuto.length > limit) {
            const target = sameDayAuto.shift();
            if (target) {
                await this.deleteSnapshotRemote(target);
            }
        }
    }

    private async syncRemoteSnapshotIndex(): Promise<void> {
        try {
            await this.ensureAccessToken();
        } catch (error) {
            this.log(`skip syncing remote snapshots: ${(error as Error).message}`);
            return;
        }
        let rootFolderId: number;
        try {
            rootFolderId = await this.ensureRemoteRootFolder();
        } catch (error) {
            console.warn(`[${this.name}] 同步远程索引失败`, error);
            return;
        }
        const folders = await this.cloudClient.listFiles(rootFolderId);
        const metas: SnapshotRemoteMeta[] = [];
        for (const folder of folders) {
            if (folder.type !== 1 || (folder.trashed ?? 0) === 1) {
                continue;
            }
            const parsed = parseSnapshotFolderName(folder.filename);
            if (!parsed) {
                continue;
            }
            const files = await this.cloudClient.listFiles(folder.fileId);
            const components: SnapshotRemoteComponent[] = [];
            for (const file of files) {
                if (file.type !== 0 || (file.trashed ?? 0) === 1) {
                    continue;
                }
                const parsedComponent = parseComponentFileName(file.filename, parsed.id);
                if (!parsedComponent) {
                    continue;
                }
                components.push({
                    category: parsedComponent.category,
                    component: parsedComponent.component,
                    fileId: file.fileId,
                    fileName: file.filename,
                    md5: file.etag,
                    size: file.size,
                    uploadedAt: file.updateAt ?? file.createAt,
                });
            }
            if (!components.length) {
                continue;
            }
            const createdDate = snapshotIdToDate(parsed.id) ?? new Date(folder.createAt ?? Date.now());
            metas.push({
                id: parsed.id,
                createdAt: createdDate.toISOString(),
                reason: parsed.reason,
                folderId: folder.fileId,
                components,
            });
        }
        metas.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        this.settings.snapshots = metas;
        await this.saveSettings();
        this.refreshSettingStatus();
    }

    private async fetchRemoteComponentData(component: SnapshotRemoteComponent): Promise<ArrayBuffer> {
        await this.ensureAccessToken();
        const downloadUrl = await this.cloudClient.getDownloadUrl(component.fileId);
        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`下载 ${component.fileName} 失败`);
        }
        return await response.arrayBuffer();
    }

    private async restoreSnapshot(snapshot: SnapshotRemoteMeta, progress?: ProgressDialog | null): Promise<void> {
        await this.ensureKernelInfoLoaded();

        if (progress) {
            progress.startStep(1, this.t("progressDownloading"));
        }

        for (let i = 0; i < snapshot.components.length; i++) {
            const component = snapshot.components[i];
            if (progress) {
                const downloadProgress = (i / snapshot.components.length) * 100;
                progress.updateStepProgress(1, downloadProgress, `${this.t("progressDownloading")} ${component.fileName} (${i + 1}/${snapshot.components.length})`);
            }

            const buffer = await this.fetchRemoteComponentData(component);

            if (progress) {
                const restoreProgress = (i / snapshot.components.length) * 100;
                progress.startStep(2, this.t("progressRestoring"));
                progress.updateStepProgress(2, restoreProgress, `${this.t("progressRestoring")} ${this.t(`target_${component.component}`)}`);
            }

            if (component.component === "data") {
                await this.importDataArchive(buffer, component.fileName);
            } else if (component.component === "conf") {
                await this.importConfArchive(buffer, component.fileName);
            } else if (component.component === "repo") {
                await this.restoreRepoFromArchive(buffer);
            }
        }

        this.refreshSettingStatus();
    }

    private async importDataArchive(buffer: ArrayBuffer, fileName: string): Promise<void> {
        const blob = new Blob([buffer], {type: ZIP_MIME});
        const file = new File([blob], fileName, {type: ZIP_MIME});
        const form = new FormData();
        form.append("file", file);
        await this.kernelForm("/api/import/importData", form);
    }

    private async importConfArchive(buffer: ArrayBuffer, fileName: string): Promise<void> {
        const blob = new Blob([buffer], {type: ZIP_MIME});
        const file = new File([blob], fileName, {type: ZIP_MIME});
        const form = new FormData();
        form.append("file", file);
        await this.kernelForm("/api/system/importConf", form);
    }

    private async restoreRepoFromArchive(buffer: ArrayBuffer): Promise<void> {
        await this.clearRepoDirectory();
        await this.ensureDir("/repo");
        const zip = await JSZip.loadAsync(buffer);
        const files = Object.values(zip.files);
        for (const entry of files) {
            const normalized = entry.name.replace(/^\/+/, "");
            if (!normalized) {
                continue;
            }
            const targetPath = `/repo/${normalized}`;
            if (entry.dir) {
                await this.ensureDir(targetPath);
                continue;
            }
            const content = await entry.async("uint8array");
            await this.putFile(targetPath, content);
        }
    }

    private async clearRepoDirectory(): Promise<void> {
        try {
            await this.kernelPost("/api/file/removeFile", {path: "/repo"});
        } catch (error) {
            if (!(error instanceof KernelApiError) || error.code !== 404) {
                throw error;
            }
        }
    }

    private async putFile(relativePath: string, data: Uint8Array): Promise<void> {
        const segments = relativePath.split("/");
        const fileName = segments.pop();
        if (!fileName) {
            throw new Error(`无效路径 ${relativePath}`);
        }
        const parentSegments = segments.filter(Boolean);
        if (parentSegments.length) {
            await this.ensureDir(`/${parentSegments.join("/")}`);
        }
        const form = new FormData();
        form.append("path", relativePath);
        form.append("isDir", "false");
        form.append("modTime", `${Math.floor(Date.now() / 1000)}`);
        const file = new File([data], fileName);
        form.append("file", file);
        await this.kernelForm("/api/file/putFile", form);
    }

    private async buildRepoArchive(): Promise<Uint8Array> {
        const zip = new JSZip();
        await this.archiveRepoDirectory(zip, "/repo", "");
        return await zip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
            compressionOptions: {level: 6},
        });
    }

    private async archiveRepoDirectory(zip: JSZip, relativePath: string, basePath: string): Promise<void> {
        let list: ReadDirResponse[] = [];
        try {
            list = await this.kernelPost<ReadDirResponse[]>("/api/file/readDir", {path: relativePath});
        } catch (error) {
            if (error instanceof KernelApiError && error.code === 404) {
                return;
            }
            throw error;
        }
        for (const item of list) {
            const childRelative = joinWorkspaceRelative(relativePath, item.name);
            const childPath = basePath ? `${basePath}/${item.name}` : item.name;
            if (item.isDir) {
                zip.folder(childPath);
                await this.archiveRepoDirectory(zip, childRelative, childPath);
            } else {
                const buffer = await this.fetchBinaryFile(childRelative);
                zip.file(childPath, buffer, {binary: true});
            }
        }
    }

    private async ensureDir(relativePath: string): Promise<void> {
        const segments = relativePath.split("/").filter(Boolean);
        let current = "";
        for (const segment of segments) {
            current += `/${segment}`;
            try {
                await this.kernelPost<ReadDirResponse[]>("/api/file/readDir", {path: current});
            } catch (error) {
                if (error instanceof KernelApiError && error.code === 404) {
                    await this.createDir(current);
                } else if (error instanceof KernelApiError && error.code === 405) {
                    throw new Error(`${current} 已存在且不是目录`);
                } else {
                    throw error;
                }
            }
        }
    }

    private async createDir(relativePath: string): Promise<void> {
        const formData = new FormData();
        formData.append("path", relativePath);
        formData.append("isDir", "true");
        formData.append("modTime", `${Math.floor(Date.now() / 1000)}`);
        await this.kernelForm("/api/file/putFile", formData);
    }

    private async removeFile(relativePath: string): Promise<void> {
        await this.kernelPost("/api/file/removeFile", {path: relativePath});
    }

    /**
     * 获取文件作为File对象（优化的大文件处理）
     * 使用Blob避免一次性将文件加载到内存
     */
    private async fetchFileAsBlob(relativePath: string, fileName: string): Promise<File> {
        try {
            const response = await fetch("/api/file/getFile", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: relativePath}),
            });
            
            if (response.status === 200) {
                // 直接从响应创建Blob，避免一次性读取到内存
                const blob = await response.blob();
                return new File([blob], fileName);
            }
            
            if (response.headers.get("content-type")?.includes(JSON_MIME)) {
                const data = await response.json();
                throw new KernelApiError("/api/file/getFile", data.code ?? response.status, data.msg ?? "读取文件失败");
            }
            throw new KernelApiError("/api/file/getFile", response.status, response.statusText);
        } catch (error) {
            if (error instanceof KernelApiError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.log(`fetchFileAsBlob 失败，路径: ${relativePath}，错误:`, message);
            throw new Error(`读取文件 ${relativePath} 失败: ${message}`);
        }
    }

    private async fetchBinaryFile(relativePath: string): Promise<ArrayBuffer> {
        try {
            const response = await fetch("/api/file/getFile", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: relativePath}),
            });
            if (response.status === 200) {
                return await response.arrayBuffer();
            }
            if (response.headers.get("content-type")?.includes(JSON_MIME)) {
                const data = await response.json();
                throw new KernelApiError("/api/file/getFile", data.code ?? response.status, data.msg ?? "读取文件失败");
            }
            throw new KernelApiError("/api/file/getFile", response.status, response.statusText);
        } catch (error) {
            // 捕获网络错误并添加上下文
            if (error instanceof KernelApiError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.log(`fetchBinaryFile 失败，路径: ${relativePath}，错误:`, message);
            throw new Error(`读取文件 ${relativePath} 失败: ${message}`);
        }
    }

    private async fetchBinaryFromUrl(url: string): Promise<ArrayBuffer> {
        const response = await fetch(url, {method: "GET"});
        if (!response.ok) {
            throw new Error(`下载 ${url} 失败: ${response.status}`);
        }
        return await response.arrayBuffer();
    }

    private async kernelPost<T>(endpoint: string, payload: Record<string, unknown>): Promise<T> {
        return await new Promise((resolve, reject) => {
            try {
                fetchPost(endpoint, payload, (response: {code: number; msg: string; data: T}) => {
                    if (!response) {
                        reject(new KernelApiError(endpoint, -1, "空响应"));
                        return;
                    }
                    if (typeof response === "string") {
                        reject(new KernelApiError(endpoint, -1, "意外的字符串响应"));
                        return;
                    }
                    if (response.code !== 0) {
                        reject(new KernelApiError(endpoint, response.code, response.msg));
                        return;
                    }
                    resolve(response.data);
                });
            } catch (error) {
                // 捕获 fetchPost 内部可能抛出的网络错误
                const message = error instanceof Error ? error.message : String(error);
                this.log(`kernelPost 请求失败 ${endpoint}:`, message);
                reject(new KernelApiError(endpoint, -1, `网络请求失败: ${message}`));
            }
        });
    }

    private async kernelForm(endpoint: string, form: FormData): Promise<void> {
        const response = await fetch(endpoint, {
            method: "POST",
            body: form,
        });
        if (!response.ok) {
            throw new KernelApiError(endpoint, response.status, response.statusText);
        }
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
            const result = await response.json();
            if (result.code !== 0) {
                throw new KernelApiError(endpoint, result.code, result.msg);
            }
        }
    }

    private absoluteToWorkspacePath(absolutePath: string): string {
        const paths = this.kernelInfo?.paths ?? this.settings.lastKnownPaths;
        if (!paths?.workspaceDir) {
            throw new Error("工作空间路径未知");
        }
        const normalizedWorkspace = normalizePath(paths.workspaceDir);
        const normalizedAbsolute = normalizePath(absolutePath);
        if (!normalizedAbsolute.startsWith(normalizedWorkspace)) {
            throw new Error(`路径 ${absolutePath} 不在工作空间内`);
        }
        let relative = normalizedAbsolute.slice(normalizedWorkspace.length);
        if (!relative.startsWith("/")) {
            relative = `/${relative}`;
        }
        return relative;
    }

    /**
     * 创建文件夹配置卡片
     */
    private createFolderConfigCard(config: FolderSyncConfig, index: number, refreshList: () => void): HTMLElement {
        const card = document.createElement("div");
        card.style.border = "1px solid var(--b3-theme-surface-lighter)";
        card.style.borderRadius = "4px";
        card.style.padding = "12px";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.gap = "8px";

        // 标题行
        const headerRow = document.createElement("div");
        headerRow.style.display = "flex";
        headerRow.style.justifyContent = "space-between";
        headerRow.style.alignItems = "center";

        const titleEl = document.createElement("span");
        titleEl.style.fontWeight = "bold";
        titleEl.textContent = config.name;
        headerRow.append(titleEl);

        const statusBadge = document.createElement("span");
        statusBadge.style.padding = "2px 8px";
        statusBadge.style.borderRadius = "12px";
        statusBadge.style.fontSize = "12px";
        statusBadge.style.backgroundColor = config.enabled ? "var(--b3-theme-primary)" : "var(--b3-theme-surface-lighter)";
        statusBadge.style.color = config.enabled ? "white" : "var(--b3-theme-on-surface)";
        statusBadge.textContent = config.enabled ? this.t("folderSyncEnabled") : this.t("folderSyncDisabled");
        headerRow.append(statusBadge);
        card.append(headerRow);

        // 信息行
        const infoRow = document.createElement("div");
        infoRow.style.display = "flex";
        infoRow.style.flexDirection = "column";
        infoRow.style.gap = "4px";
        infoRow.style.fontSize = "13px";
        infoRow.style.color = "var(--b3-theme-on-surface)";
        infoRow.style.opacity = "0.8";

        infoRow.innerHTML = `
            <div>📁 ${config.localPath}</div>
            <div>☁️ ${config.remotePath || "/"}</div>
            <div>🔄 ${config.syncMode === "full" ? this.t("folderSyncModeFull") : this.t("folderSyncModeIncremental")}</div>
            <div>🕐 ${config.lastSyncAt ? new Date(config.lastSyncAt).toLocaleString() : this.t("folderSyncNever")}</div>
        `;
        card.append(infoRow);

        // 按钮行
        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.gap = "8px";
        btnRow.style.marginTop = "4px";

        const syncBtn = document.createElement("button");
        syncBtn.className = "b3-button b3-button--primary";
        syncBtn.style.fontSize = "12px";
        syncBtn.textContent = this.t("folderSyncNow");
        syncBtn.disabled = !config.enabled;
        syncBtn.addEventListener("click", async () => {
            syncBtn.disabled = true;
            try {
                await this.syncSingleFolder(config, index, refreshList);
            } catch (error) {
                showMessage(`[${this.name}] ${this.t("folderSyncFailed")}: ${(error as Error).message}`, 7000, "error");
            } finally {
                syncBtn.disabled = !config.enabled;
            }
        });
        btnRow.append(syncBtn);

        const editBtn = document.createElement("button");
        editBtn.className = "b3-button";
        editBtn.style.fontSize = "12px";
        editBtn.textContent = this.t("folderSyncEdit");
        editBtn.addEventListener("click", () => {
            this.showFolderConfigDialog(index, refreshList);
        });
        btnRow.append(editBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "b3-button b3-button--cancel";
        deleteBtn.style.fontSize = "12px";
        deleteBtn.textContent = this.t("folderSyncDelete");
        deleteBtn.addEventListener("click", () => {
            if (confirm(this.t("folderSyncConfirmDelete"))) {
                this.settings.folderSyncConfigs = this.settings.folderSyncConfigs?.filter((_, i) => i !== index) || [];
                void this.saveSettings();
                refreshList();
            }
        });
        btnRow.append(deleteBtn);

        card.append(btnRow);
        return card;
    }

    /**
     * 显示文件夹配置对话框
     */
    private showFolderConfigDialog(configIndex: number | null, refreshList: () => void): void {
        const isEdit = configIndex !== null;
        const existingConfig = isEdit ? this.settings.folderSyncConfigs?.[configIndex] : null;

        const dialog = new Dialog({
            title: isEdit ? this.t("folderSyncEdit") : this.t("folderSyncAdd"),
            content: `
                <div class="b3-dialog__content" style="display: flex; flex-direction: column; gap: 12px; padding: 16px;">
                    <div>
                        <label>${this.t("folderSyncName")}</label>
                        <input id="folder-config-name" class="b3-text-field fn__block" placeholder="${this.t("folderSyncNamePlaceholder")}" value="${existingConfig?.name || ""}" />
                    </div>
                    <div>
                        <label>${this.t("folderSyncLocalPath")}</label>
                        <input id="folder-config-local" class="b3-text-field fn__block" placeholder="${this.t("folderSyncLocalPathPlaceholder")}" value="${existingConfig?.localPath || ""}" />
                    </div>
                    <div>
                        <label>${this.t("folderSyncRemotePath")}</label>
                        <input id="folder-config-remote" class="b3-text-field fn__block" placeholder="${this.t("folderSyncRemotePathPlaceholder")}" value="${existingConfig?.remotePath || ""}" />
                    </div>
                    <div>
                        <label>${this.t("folderSyncPassword")}</label>
                        <input id="folder-config-password" type="password" class="b3-text-field fn__block" placeholder="${this.t("folderSyncPasswordPlaceholder")}" value="${existingConfig?.password || ""}" />
                    </div>
                    <div>
                        <label>${this.t("folderSyncMode")}</label>
                        <select id="folder-config-mode" class="b3-select fn__block">
                            <option value="full" ${existingConfig?.syncMode === "full" ? "selected" : ""}>${this.t("folderSyncModeFull")}</option>
                            <option value="incremental" ${existingConfig?.syncMode === "incremental" || !existingConfig ? "selected" : ""}>${this.t("folderSyncModeIncremental")}</option>
                        </select>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input id="folder-config-enabled" type="checkbox" ${existingConfig?.enabled !== false ? "checked" : ""} />
                        <label for="folder-config-enabled">${this.t("folderSyncEnabled")}</label>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel">${this.t("folderSyncCancel")}</button>
                    <button class="b3-button b3-button--primary">${this.t("folderSyncSave")}</button>
                </div>
            `,
            width: "500px",
        });

        const saveBtn = dialog.element.querySelector(".b3-button--primary") as HTMLButtonElement;
        const cancelBtn = dialog.element.querySelector(".b3-button--cancel") as HTMLButtonElement;

        const saveConfig = () => {
            const nameInput = dialog.element.querySelector("#folder-config-name") as HTMLInputElement;
            const localInput = dialog.element.querySelector("#folder-config-local") as HTMLInputElement;
            const remoteInput = dialog.element.querySelector("#folder-config-remote") as HTMLInputElement;
            const passwordInput = dialog.element.querySelector("#folder-config-password") as HTMLInputElement;
            const modeSelect = dialog.element.querySelector("#folder-config-mode") as HTMLSelectElement;
            const enabledCheckbox = dialog.element.querySelector("#folder-config-enabled") as HTMLInputElement;

            const name = nameInput.value.trim();
            const localPath = localInput.value.trim();
            const remotePath = remoteInput.value.trim();
            const password = passwordInput.value;
            const syncMode = modeSelect.value as "full" | "incremental";
            const enabled = enabledCheckbox.checked;

            if (!name || !localPath || !password) {
                showMessage(`[${this.name}] ${this.t("folderSyncValidationError")}`, 3000, "error");
                return;
            }

            const newConfig: FolderSyncConfig = {
                id: existingConfig?.id || `folder-${Date.now()}`,
                name,
                localPath,
                remotePath,
                password,
                syncMode,
                enabled,
                lastSyncAt: existingConfig?.lastSyncAt,
                fileMetadata: existingConfig?.fileMetadata,
            };

            if (!this.settings.folderSyncConfigs) {
                this.settings.folderSyncConfigs = [];
            }

            if (isEdit) {
                this.settings.folderSyncConfigs[configIndex] = newConfig;
            } else {
                this.settings.folderSyncConfigs.push(newConfig);
            }

            void this.saveSettings();
            refreshList();
            dialog.destroy();
        };

        saveBtn.addEventListener("click", saveConfig);
        cancelBtn.addEventListener("click", () => dialog.destroy());
    }

    /**
     * 同步单个文件夹
     */
    private async syncSingleFolder(config: FolderSyncConfig, configIndex: number, refreshList: () => void): Promise<void> {
        const progress = new ProgressDialog(
            this.t("folderSyncInProgress"),
            [
                {name: this.t("folderSyncScanning"), weight: 20},
                {name: this.t("folderSyncEncrypting"), weight: 30},
                {name: this.t("folderSyncUploading"), weight: 50},
            ]
        );

        try {
            // 确保有访问令牌和远程文件夹
            await this.ensureAccessToken();
            const remoteFolderId = await this.ensureRemoteRootFolder();

            // 执行同步
            const updatedConfig = await this.folderSyncManager.syncFolder(
                config,
                remoteFolderId,
                (syncProgress: SyncProgress) => {
                    switch (syncProgress.phase) {
                        case "scan":
                            progress.updateStepProgress(0, 100, syncProgress.message);
                            break;
                        case "encrypt":
                            progress.updateStepProgress(1, syncProgress.percentage || 0, syncProgress.message);
                            break;
                        case "upload":
                            progress.updateStepProgress(2, syncProgress.percentage || 0, syncProgress.message);
                            break;
                        case "complete":
                            progress.complete(syncProgress.message);
                            break;
                        case "error":
                            progress.error(syncProgress.message);
                            break;
                    }
                }
            );

            // 更新配置
            if (!this.settings.folderSyncConfigs) {
                this.settings.folderSyncConfigs = [];
            }
            this.settings.folderSyncConfigs[configIndex] = updatedConfig;
            await this.saveSettings();
            refreshList();

            showMessage(`[${this.name}] ${this.t("folderSyncSuccess")}`);
        } catch (error) {
            console.error("[FolderSync] 同步失败", error);
            progress.error(this.t("folderSyncFailed") + ": " + (error as Error).message);
            throw error;
        }
    }
}

function joinPath(base: string, segment: string): string {
    if (!base) {
        return segment;
    }
    const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
    return base.endsWith(separator) ? `${base}${segment}` : `${base}${separator}${segment}`;
}

function stripLeadingSlash(path: string): string {
    return path.startsWith("/") ? path.slice(1) : path;
}

function joinWorkspaceRelative(parent: string, name: string): string {
    if (!parent.endsWith("/")) {
        return `${parent}/${name}`;
    }
    return `${parent}${name}`;
}

function normalizePath(path: string): string {
    if (!path) {
        return "";
    }
    const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
    if (normalized === "/") {
        return normalized;
    }
    return normalized.replace(/\/$/, "");
}

const SNAPSHOT_FOLDER_SEPARATOR = "--";

function buildSnapshotFolderName(id: string, reason: SnapshotReason): string {
    return `${id}${SNAPSHOT_FOLDER_SEPARATOR}${reason}`;
}

function parseSnapshotFolderName(name: string): {id: string; reason: SnapshotReason} | null {
    if (!name) {
        return null;
    }
    const parts = name.split(SNAPSHOT_FOLDER_SEPARATOR);
    if (parts.length === 2) {
        return {
            id: parts[0],
            reason: parts[1] === "auto" ? "auto" : "manual",
        };
    }
    if (parts.length === 1) {
        return {id: parts[0], reason: "manual"};
    }
    return null;
}

function parseComponentFileName(fileName: string, snapshotId: string): {category: BackupTarget; component: BackupComponentType} | null {
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
    const segments = nameWithoutExt.split("-");
    if (segments.length < 3) {
        return null;
    }
    const categoryRaw = segments[0];
    const componentRaw = segments[1];
    const idCandidate = segments.slice(2).join("-");
    if (!isBackupTarget(categoryRaw) || !isBackupComponent(componentRaw)) {
        return null;
    }
    if (idCandidate !== snapshotId) {
        // 允许 idCandidate 包含扩展信息
        if (!idCandidate.startsWith(snapshotId)) {
            return null;
        }
    }
    return {
        category: categoryRaw as BackupTarget,
        component: componentRaw as BackupComponentType,
    };
}

function snapshotIdToDate(id: string): Date | null {
    const match = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    if (!match) {
        return null;
    }
    const [, year, month, day, hour, minute, second] = match;
    return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
    );
}

function isBackupTarget(value: string): value is BackupTarget {
    return value === "workspace" || value === "data" || value === "conf" || value === "repo";
}

function isBackupComponent(value: string): value is BackupComponentType {
    return value === "data" || value === "conf" || value === "repo";
}
