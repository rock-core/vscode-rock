import * as vscode from 'vscode';
import * as context from './context';
import * as tasks from './tasks';
import { basename } from 'path';
import * as debug from './debug';
import * as autoproj from './autoproj';
import * as packages from './packages';

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

    constructor(extensionContext : vscode.ExtensionContext, context: context.Context) {
        this._selectPackageButton.text = null;
        this._buildPackageButton.text = null;
        this._context = context;
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
            extensionContext.subscriptions.push(event(e => this.update()));
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

    public async update() {
        const selectedPackage = await this._context.getSelectedPackage();
        this.updateSelectedPackage(selectedPackage);
        this.updateBuildButton(selectedPackage);
        this.updateDebugButton(selectedPackage);
        this.updateDebuggingTarget(selectedPackage);
        this.updatePackageType(selectedPackage);
        this.reloadVisibility();
    }

    private updateSelectedPackage(selectedPackage: packages.Package) {
        let text: string = "$(file-submodule)  ";
        let tooltip: string;
        let command: string;

        text += selectedPackage.name;
        tooltip = selectedPackage.path;
        command = this._context.packageSelectionMode == "auto" ? null : 'rock.selectPackage';
        this.updateButton(this._selectPackageButton, text, tooltip, command);
    }

    private updateBuildButton(selectedPackage: packages.Package)
    {
        let text: string = "$(gear)  ";
        let tooltip: string;
        let command: string;

        if (!selectedPackage.buildTask) {
            text = null;
        } else {
            text += 'Build';
            tooltip = 'Build package'
        }
        command = 'rock.buildPackage';
        this.updateButton(this._buildPackageButton, text, tooltip, command);
    }

    private updateDebugButton(selectedPackage: packages.Package) {
        let text: string = "$(bug) ";
        let tooltip: string;
        let command: string;

        if (!selectedPackage.debugable || !selectedPackage.target) {
            text = null;
        } else {
            text += "Debug";
        }

        tooltip = "Debug package";
        command = 'rock.debugPackage';
        this.updateButton(this._debugButton, text, tooltip, command);
    }

    private updatePackageType(selectedPackage: packages.Package) {
        let text: string = "$(file-code)  ";
        let tooltip: string;
        let command: string;

        if (!selectedPackage.type.label)
            text = null;
        else
            text += selectedPackage.type.label;

        tooltip = "Change package type";
        command = 'rock.selectPackageType';
        this.updateButton(this._packageTypeButton, text, tooltip, command);
    }

    private updateDebuggingTarget(selectedPackage: packages.Package) {
        let text: string;
        let tooltip: string;
        let command: string;

        if (!selectedPackage.debugable)
            text = null;
        else if (!selectedPackage.target) {
            text = '(No debugging target)'
        } else {
            text = selectedPackage.target.name;
        }

        tooltip = "Change debugging target";
        command = 'rock.setDebuggingTarget';
        this.updateButton(this._debuggingTargetButton, text, tooltip, command);
    }

    private updateButton(item: vscode.StatusBarItem, text: string,
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
