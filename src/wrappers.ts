import * as vscode from 'vscode'
import * as Path from 'path'

/** Shim that provides us an API to the VSCode state we need within the extension
 * 
 * This helps during testing to mock VSCode itself, something VSCode's test
 * harness is fairly bad at
 */
export class VSCode {
    private _extensionContext : vscode.ExtensionContext;

    public constructor(extensionContext : vscode.ExtensionContext)
    {
        this._extensionContext = extensionContext;
    }

    public get activeDocumentURI() : vscode.Uri | undefined
    {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        return editor.document.uri;
    }

    public get workspaceFolders(): vscode.WorkspaceFolder[] | undefined
    {
        return vscode.workspace.workspaceFolders;
    }

    public getWorkspaceFolder(uri: vscode.Uri | string): vscode.WorkspaceFolder | undefined
    {
        if (typeof uri == 'string') {
            uri = vscode.Uri.file(uri);
        }
        return vscode.workspace.getWorkspaceFolder(uri);
    }

    public getConfiguration(section?: string, resource?: vscode.Uri): 
        vscode.WorkspaceConfiguration
    {
        return vscode.workspace.getConfiguration(section, resource);
    }

    public showQuickPick<T extends vscode.QuickPickItem>(items: T[] | Thenable<T[]>,
        options?: vscode.QuickPickOptions, token?: vscode.CancellationToken): Thenable<T | undefined>
    {
        return vscode.window.showQuickPick<T>(items, options, token);
    }

    public registerAndSubscribeCommand(name : string, fn) : void
    {
        let cmd = vscode.commands.registerCommand(name, fn);
        this._extensionContext.subscriptions.push(cmd);
    }

    public executeCommand<T>(command: string, ...rest: any[]): Thenable<T | undefined>
    {
        return vscode.commands.executeCommand(command, ...rest);
    }

    public showOpenDialog(options: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined>
    {
        return vscode.window.showOpenDialog(options);
    }

    public startDebugging(folder: vscode.WorkspaceFolder | string | undefined, nameOrConfiguration: string | vscode.DebugConfiguration): Thenable<boolean>
    {
        if (typeof folder == 'string') {
            folder = this.getWorkspaceFolder(folder);
        }
        return vscode.debug.startDebugging(folder, nameOrConfiguration);
    }

    public showErrorMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>
    {
        return vscode.window.showErrorMessage(message, ...items);
    }

    public getWorkspaceState(key : string) : string | undefined
    {
        return this._extensionContext.workspaceState.get(key);
    }

    public updateWorkspaceState(key : string, value : string | undefined)
    {
        this._extensionContext.workspaceState.update(key, value);
    }

    public runTask(task : vscode.Task)
    {
        vscode.commands.executeCommand("workbench.action.tasks.runTask",
            task.source + ": " + task.name);
    }
}