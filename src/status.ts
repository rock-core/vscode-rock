import * as vscode from 'vscode';
import * as context from './context';
import * as tasks from './tasks';
import { basename } from 'path';
import * as debug from './debug';
import * as autoproj from './autoproj';

interface Hideable {
    show(): void;
    hide(): void;
}

function setVisible<T extends Hideable>(i: T, v: boolean) {
    if (v) {
        i.show();
    } else {
        i.hide();
    }
}

export class StatusBar implements vscode.Disposable {
    private readonly _context: context.Context;
    private readonly _taskProvider: tasks.Provider;
    private readonly _selectPackageButton =
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 4.5);

    private readonly _buildPackageButton =
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.5);

    private readonly _debugButton =
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2.5);

    private readonly _debuggingTargetButton =
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1.5);

    private readonly _packageTypeButton =
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0.5);

    private readonly _buttons = { selectPackage:   this._selectPackageButton,
                                  buildPackage:    this._buildPackageButton,
                                  packageType:     this._packageTypeButton,
                                  debuggingTarget: this._debuggingTargetButton,
                                  debug:           this._debugButton };
     
    public dispose() {
        Object.keys(this._buttons).forEach(key => {
            this._buttons[key].dispose();
        });
    }

    constructor(context: context.Context, taskProvider: tasks.Provider) {
        this._selectPackageButton.text = null;
        this._buildPackageButton.text = null;
        this._context = context;
        this._taskProvider = taskProvider;
        this.reloadVisibility();

        let events: { (listener: (e: any) => any): vscode.Disposable; } [] = [
            vscode.workspace.onDidChangeWorkspaceFolders,
            vscode.workspace.onDidChangeConfiguration,
            vscode.window.onDidChangeActiveTextEditor,
            vscode.window.onDidChangeTextEditorViewColumn,
            vscode.workspace.onDidOpenTextDocument,
            vscode.workspace.onDidCloseTextDocument
        ]

        for (const event of events) {
            context.extensionContext.subscriptions.push(event(e => this.update()));
        }
    }

    public reloadVisibility() {
        const hide = (i: vscode.StatusBarItem) => i.hide();
        const show = (i: vscode.StatusBarItem) => i.show();

        let folders = this._context.vscode.workspaceFolders;
        if (!folders || folders.length == 0)
            this._visible = false;

        Object.keys(this._buttons).forEach(key => {
            let item = this._buttons[key];
            setVisible(item, this.visible && !!item.text);
        });
    }

    public update() {
        this.updateSelectedPackage();
        this.updateBuildButton();
        this.updateDebugButton();
        this.updateDebuggingTarget();
        this.updatePackageType();
        this.reloadVisibility();
    }

    public updateSelectedPackage() {
        const selectedPackage = this._context.selectedPackage;
        let text: string = "$(file-submodule)  ";
        let tooltip: string;
        let command: string;

        if (!selectedPackage) {
            text += '(invalid package)';
            tooltip = 'Invalid package';
        } else {
            text += selectedPackage.name;
            tooltip = selectedPackage.root;
        }
        command = this._context.packageSelectionMode == "auto" ? null : 'rock.selectPackage';
        this.updateButton(this._selectPackageButton, text, tooltip, command);
    }

    public updateBuildButton()
    {
        const selectedPackage = this._context.selectedPackage;
        let text: string = "$(gear)  ";
        let tooltip: string;
        let command: string;

        if (!selectedPackage || !this._taskProvider.buildTask(selectedPackage.root)) {
            text = null;
        } else {
            text += 'Build';
            tooltip = 'Build selected package'
        }
        command = 'rock.buildPackage';
        this.updateButton(this._buildPackageButton, text, tooltip, command);
    }

    public updateDebugButton() {
        let text: string = "$(bug) ";
        let tooltip: string;
        let command: string;

        let target: debug.Target;
        let options: boolean;
        let selectedPackage = this._context.selectedPackage;
        if (selectedPackage && this._context.workspaces.folderToWorkspace.has(selectedPackage.root))
            target = this._context.debuggingTarget;

        if (target)
            options = new debug.ConfigurationProvider().
                hasConfiguration(this._context.selectedPackageType);

        if (!selectedPackage || !target || !options) {
            text = null;
        } else {
            text += "Debug";
        }

        tooltip = "Debug package";
        command = 'rock.debugPackage';
        this.updateButton(this._debugButton, text, tooltip, command);
    }

    public updatePackageType() {
        const selectedPackageType = this._context.selectedPackageType;
        let text: string = "$(file-code)  ";
        let tooltip: string;
        let command: string;

        if (!this._context.selectedPackage)
            text = null;
        else
            text += selectedPackageType.label;

        tooltip = "Change package type";
        command = 'rock.selectPackageType';
        this.updateButton(this._packageTypeButton, text, tooltip, command);
    }

    public updateDebuggingTarget() {
        let text: string;
        let tooltip: string;
        let command: string;

        let ws: autoproj.Workspace;
        let selectedPackageType = this._context.selectedPackageType;
        let selectedPackage = this._context.selectedPackage;

        const picker = new debug.TargetPickerFactory(this._context.vscode).
            createPicker(this._context.selectedPackageType);
        if (selectedPackage && this._context.workspaces.folderToWorkspace.has(selectedPackage.root))
            ws = this._context.workspaces.folderToWorkspace.
                get(this._context.selectedPackage.root);
        if (!this._context.selectedPackage || !picker || !ws)
            text = null;
        else if (!this._context.debuggingTarget) {
            text = '(No debugging target)'
        } else {
            text = this._context.debuggingTarget.name;
        }

        tooltip = "Change debugging target";
        command = 'rock.setDebuggingTarget';
        this.updateButton(this._debuggingTargetButton, text, tooltip, command);
    }

    public updateButton(item: vscode.StatusBarItem, text: string,
                        tooltip: string, command: string)
    {
        item.text = text;
        item.tooltip = tooltip;
        item.command = command;
    }

    private _visible: boolean = true;
    public get visible(): boolean {
        return this._visible;
    }

    public set visible(v: boolean) {
        this._visible = v;
        this.reloadVisibility();
    }
}