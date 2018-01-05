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
        this._selectPackageButton.text = '';
        this._buildPackageButton.text = '';
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

        if (this._context.isWorkspaceEmpty()) {
            this._visible = false;
        }

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
        let text = "$(file-submodule)  " + selectedPackage.name;
        let tooltip = selectedPackage.path;
        let command = this._context.packageSelectionMode == "auto" ? undefined : 'rock.selectPackage';
        this.updateButton(this._selectPackageButton, text, tooltip, command);
    }

    private updateBuildButton(selectedPackage: packages.Package)
    {
        let text: string = "$(gear)  ";
        let tooltip: string | undefined;

        if (!selectedPackage.buildTask) {
            text = '';
        } else {
            text += 'Build';
            tooltip = 'Build package'
        }
        this.updateButton(this._buildPackageButton, text, tooltip, 'rock.buildPackage');
    }

    private updateDebugButton(selectedPackage: packages.Package) {
        let text: string = '';
        let tooltip = "Debug package";
        let command : string | undefined;
        if (selectedPackage.debugable && selectedPackage.debugTarget) {
            text = "$(bug) Debug";
            command = 'rock.debugPackage';
        }

        this.updateButton(this._debugButton, text, tooltip, command);
    }

    private updatePackageType(selectedPackage: packages.Package) {
        let text: string = '';
        let tooltip: string | undefined;
        let command: string | undefined;

        if (!selectedPackage.type.isInternal())
        {
            text = "$(file-code)  " + selectedPackage.type.label;
            tooltip = "Change package type";
            command = 'rock.selectPackageType';
        }
        this.updateButton(this._packageTypeButton, text, tooltip, command);
    }

    private updateDebuggingTarget(selectedPackage: packages.Package) {
        let text: string;
        if (!selectedPackage.debugable)
            text = '';
        else if (!selectedPackage.debugTarget) {
            text = '(No debugging target)'
        } else {
            text = selectedPackage.debugTarget.name;
        }

        let tooltip = "Change debugging target";
        let command = 'rock.setDebuggingTarget';
        this.updateButton(this._debuggingTargetButton, text, tooltip, command);
    }

    private updateButton(item: vscode.StatusBarItem, text: string,
                        tooltip: string | undefined, command: string | undefined)
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
