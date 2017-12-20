import * as vscode from 'vscode'

export class VSCode {
    public constructor()
    {
    }

    public get activeTextEditor(): vscode.TextEditor
    {
        return vscode.window.activeTextEditor;
    }

    public get workspaceFolders(): vscode.WorkspaceFolder[]
    {
        return vscode.workspace.workspaceFolders;
    }

    public getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder
    {
        return vscode.workspace.getWorkspaceFolder(uri);
    }

    public getConfiguration(section?: string, resource?: vscode.Uri): 
        vscode.WorkspaceConfiguration
    {
        return vscode.workspace.getConfiguration(section, resource);
    }

    public showQuickPick<T extends vscode.QuickPickItem>(items: T[] | Thenable<T[]>,
        options?: vscode.QuickPickOptions): Thenable<T>
    {
        return vscode.window.showQuickPick<T>(items, options);
    }

    public executeCommand<T>(command: string, ...rest: any[]): Thenable<T | undefined>
    {
        return vscode.commands.executeCommand(command, ...rest);
    }

    public showOpenDialog(options: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined>
    {
        return vscode.window.showOpenDialog(options);
    }

    public startDebugging(folder: vscode.WorkspaceFolder | undefined, nameOrConfiguration: string | vscode.DebugConfiguration): Thenable<boolean>
    {
        return vscode.debug.startDebugging(folder, nameOrConfiguration);
    }

    public showErrorMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>
    {
        return vscode.window.showErrorMessage(message, ...items);
    }
}