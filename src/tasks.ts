'use strict';
import * as vscode from 'vscode';
import * as autoproj from './autoproj';
import * as path from 'path';

export class Provider implements vscode.TaskProvider
{
    workspaces : autoproj.Workspaces;
    folderToWorkspace : Map<string, autoproj.Workspace>;

    private runAutoproj(ws, ...args) {
        return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: ws.root })
    }

    constructor()
    {
        this.workspaces = new autoproj.Workspaces();
        this.folderToWorkspace = new Map();
        vscode.workspace.workspaceFolders.forEach((folder) => {
            this.workspaces.addFolder(folder.uri.fsPath);
        })
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            event.added.forEach((folder) => {
                this.workspaces.addFolder(folder.uri.fsPath);
            })
            event.removed.forEach((folder) => {
                this.workspaces.deleteFolder(folder.uri.fsPath);
            })
        })
    }

    private createBuildTask(name, ws, folder = null) {
        let definition = { type: 'autoproj', kind: 'build', workspace: ws.root, folder: folder }
        let extra_args = []
        if (folder) {
            extra_args.push(folder);
        }
        let exec = this.runAutoproj(ws, 'build', '--tool', ...extra_args);
        let task = new vscode.Task(definition, name, 'autoproj', exec, []);
        task.group = vscode.TaskGroup.Build;
        return task;
    }

    provideTasks(token)
    {
        let result = [];
        this.workspaces.forEachWorkspace((ws) => {
            result.push(this.createBuildTask(`${ws.name}: Build`, ws));
        })
        this.workspaces.forEachFolder((ws, folder) => {
            let relative = path.relative(ws.root, folder);
            result.push(this.createBuildTask(`${ws.name}: Build ${relative}`, ws, folder));
        })
        return result;
    }

    resolveTask(task, token)
    {
        return null;
    }
}