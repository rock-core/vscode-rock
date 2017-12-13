import * as vscode from 'vscode';
import { basename, relative } from 'path';
import * as autoproj from './autoproj';
import * as context from './context';
import * as tasks from './tasks';

function assert_workspace_not_empty(workspaces: autoproj.Workspaces)
{
    if (workspaces.folderToWorkspace.size == 0)
        throw new Error("Current workspace is empty");
}

export async function choosePackage(context: context.Context) {
    assert_workspace_not_empty(context.workspaces);
    let choices = new Array<{ label: string,
                              description: string,
                              root: string,
                              name: string }>();

    context.workspaces.forEachFolder((ws, folder) => {
        choices.push({ label: relative(ws.root, folder),
                       description: ws.name,
                       root: folder,
                       name: basename(folder) });
    });

    const chosen = await context.vscode.showQuickPick(choices);
    if (chosen) {
        context.selectedPackage = { name: chosen.name, root: chosen.root };
    }
    return chosen;
}

export function buildSelectedPackage(context: context.Context,
    taskProvider: tasks.Provider)
{
    assert_workspace_not_empty(context.workspaces);

    let task = taskProvider.buildTask(context.selectedPackage.root);
    if (!task) throw new Error("Selected package does not belong to an autproj workspace");

    context.vscode.executeCommand("workbench.action.tasks.runTask",
        task.source + ": " + task.name);
}