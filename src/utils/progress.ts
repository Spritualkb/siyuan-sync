import {Dialog} from "siyuan";

export interface ProgressStep {
    name: string;
    weight: number;
}

export class ProgressDialog {
    private dialog: Dialog | null = null;
    private titleEl: HTMLElement | null = null;
    private messageEl: HTMLElement | null = null;
    private progressBarEl: HTMLElement | null = null;
    private progressFillEl: HTMLElement | null = null;
    private percentEl: HTMLElement | null = null;
    private currentPercent = 0;
    private steps: ProgressStep[] = [];
    private completedSteps = 0;

    constructor(title: string, steps: ProgressStep[]) {
        this.steps = steps;
        this.createDialog(title);
    }

    private createDialog(title: string): void {
        const content = `
            <div class="b3-dialog__content" style="padding: 16px;">
                <div id="siyuan-sync-progress-title" style="font-size: 14px; font-weight: 500; margin-bottom: 12px;">
                    ${title}
                </div>
                <div id="siyuan-sync-progress-message" style="font-size: 13px; color: var(--b3-theme-on-surface); margin-bottom: 12px;">
                    准备中...
                </div>
                <div id="siyuan-sync-progress-bar" style="width: 100%; height: 8px; background-color: var(--b3-theme-surface-lighter); border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
                    <div id="siyuan-sync-progress-fill" style="width: 0%; height: 100%; background-color: var(--b3-theme-primary); transition: width 0.3s ease;"></div>
                </div>
                <div id="siyuan-sync-progress-percent" style="font-size: 12px; color: var(--b3-theme-on-surface); text-align: right;">
                    0%
                </div>
            </div>
        `;

        this.dialog = new Dialog({
            title: "备份/恢复进度",
            content,
            width: "480px",
            disableClose: true,
            disableAnimation: false,
        });

        this.titleEl = this.dialog.element.querySelector("#siyuan-sync-progress-title");
        this.messageEl = this.dialog.element.querySelector("#siyuan-sync-progress-message");
        this.progressBarEl = this.dialog.element.querySelector("#siyuan-sync-progress-bar");
        this.progressFillEl = this.dialog.element.querySelector("#siyuan-sync-progress-fill");
        this.percentEl = this.dialog.element.querySelector("#siyuan-sync-progress-percent");
    }

    public updateMessage(message: string): void {
        if (this.messageEl) {
            this.messageEl.textContent = message;
        }
    }

    public updateProgress(percent: number): void {
        this.currentPercent = Math.max(0, Math.min(100, percent));
        if (this.progressFillEl) {
            this.progressFillEl.style.width = `${this.currentPercent}%`;
        }
        if (this.percentEl) {
            this.percentEl.textContent = `${Math.floor(this.currentPercent)}%`;
        }
    }

    public startStep(stepIndex: number, message?: string): void {
        if (stepIndex < 0 || stepIndex >= this.steps.length) {
            return;
        }
        const step = this.steps[stepIndex];
        const totalWeight = this.steps.reduce((sum, s) => sum + s.weight, 0);
        const completedWeight = this.steps.slice(0, stepIndex).reduce((sum, s) => sum + s.weight, 0);
        const basePercent = (completedWeight / totalWeight) * 100;

        this.updateProgress(basePercent);
        this.updateMessage(message || step.name);
    }

    public completeStep(stepIndex: number): void {
        if (stepIndex < 0 || stepIndex >= this.steps.length) {
            return;
        }
        const totalWeight = this.steps.reduce((sum, s) => sum + s.weight, 0);
        const completedWeight = this.steps.slice(0, stepIndex + 1).reduce((sum, s) => sum + s.weight, 0);
        const percent = (completedWeight / totalWeight) * 100;

        this.updateProgress(percent);
        this.completedSteps = stepIndex + 1;
    }

    public updateStepProgress(stepIndex: number, stepPercent: number, message?: string): void {
        if (stepIndex < 0 || stepIndex >= this.steps.length) {
            return;
        }
        const totalWeight = this.steps.reduce((sum, s) => sum + s.weight, 0);
        const completedWeight = this.steps.slice(0, stepIndex).reduce((sum, s) => sum + s.weight, 0);
        const currentStepWeight = this.steps[stepIndex].weight;
        const percent = ((completedWeight + currentStepWeight * (stepPercent / 100)) / totalWeight) * 100;

        this.updateProgress(percent);
        if (message) {
            this.updateMessage(message);
        }
    }

    public complete(message = "完成！"): void {
        this.updateProgress(100);
        this.updateMessage(message);
        setTimeout(() => {
            this.destroy();
        }, 800);
    }

    public error(message: string): void {
        if (this.messageEl) {
            this.messageEl.textContent = `❌ ${message}`;
            this.messageEl.style.color = "var(--b3-card-error-color)";
        }
        setTimeout(() => {
            this.destroy();
        }, 2000);
    }

    public destroy(): void {
        if (this.dialog) {
            this.dialog.destroy();
            this.dialog = null;
        }
    }
}
