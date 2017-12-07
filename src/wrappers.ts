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
}