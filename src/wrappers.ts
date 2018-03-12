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

    public get activeTextEditor() : vscode.TextEditor | undefined
    {
        return vscode.window.activeTextEditor;
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

    public showOpenDialog(options: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined>
    {
        return vscode.window.showOpenDialog(options);
    }

    public showErrorMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>
    {
        return vscode.window.showErrorMessage(message, ...items);
    }

    public showWarningMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>
    {
        return vscode.window.showWarningMessage(message, ...items);
    }

    public getWorkspaceState(key : string) : string | undefined
    {
        return this._extensionContext.workspaceState.get(key);
    }

    public updateWorkspaceState(key : string, value : string | undefined)
    {
        this._extensionContext.workspaceState.update(key, value);
    }

    public createOutputChannel(name: string) {
        return vscode.window.createOutputChannel(name);
    }

    public updateWorkspaceFolders(start: number, deleteCount: number | undefined | null,
        ...workspaceFoldersToAdd: { name?: string, uri: vscode.Uri }[]): boolean
    {
        return vscode.workspace.updateWorkspaceFolders(start, deleteCount, ...workspaceFoldersToAdd);
    }
}