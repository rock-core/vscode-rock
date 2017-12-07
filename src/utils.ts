import * as vscode from 'vscode';
import { basename, relative } from 'path';
import * as autoproj from './autoproj';
import * as context from './context';

export async function choosePackage(context: context.Context) {
    if (context.workspaces.folderToWorkspace.size == 0)
        throw new Error("Current workspace is empty");

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