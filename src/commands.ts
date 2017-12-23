import * as vscode from 'vscode';
import { basename, relative } from 'path';
import * as context from './context';
import * as status from './status';
import * as packages from './packages';

function assert_workspace_not_empty(context: context.Context)
{
    if (!context.vscode.workspaceFolders || context.vscode.workspaceFolders.length == 0)
        throw new Error("Current workspace is empty");
}

export class Commands
{
    private readonly _context: context.Context;
    constructor(context: context.Context)
    {
        this._context = context;
    }

    async selectPackage()
    {
        assert_workspace_not_empty(this._context);
        let choices = new Array<{ label: string,
                                  description: string,
                                  path: string }>();

        this._context.workspaces.forEachFolder((ws, folder) => {
            choices.push({ label: relative(ws.root, folder),
                           description: ws.name,
                           path: folder });
        });

        let options: vscode.QuickPickOptions = {
            placeHolder: 'Select the package to work on' }

        const chosen = await this._context.vscode.showQuickPick(choices, options);
        if (chosen) {
            this._context.setSelectedPackage(chosen.path);
        }
    }

    private handlePromise<T>(promise: Promise<T>)
    {
        promise.catch(err => {
            this._context.vscode.showErrorMessage(err.message);
        })
    }
    async buildPackage()
    {
        let pkg = await this._context.getSelectedPackage();
        this.handlePromise(pkg.build());
    }

    async selectPackageType()
    {
        let pkg = await this._context.getSelectedPackage();
        this.handlePromise(pkg.pickType());
    }

    async setDebuggingTarget()
    {
        let pkg = await this._context.getSelectedPackage();
        this.handlePromise(pkg.pickTarget());
    }

    async debugPackage()
    {
        let pkg = await this._context.getSelectedPackage();
        this.handlePromise(pkg.debug());
    }

    register()
    {
        function register(receiver, name) {
            let fn = receiver[name].bind(receiver);
            return vscode.commands.registerCommand('rock.' + name, _ => fn());
        }

        for (const key of ['selectPackage',
                           'buildPackage',
                           'selectPackageType',
                           'setDebuggingTarget',
                           'debugPackage'])
        {
            this._context.extensionContext.subscriptions.
                push(register(this, key));
        }
    }
}