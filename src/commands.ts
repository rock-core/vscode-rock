import { basename, relative } from 'path';
import * as context from './context';
import * as packages from './packages';
import * as wrappers from './wrappers';

function assert_workspace_not_empty(context: context.Context)
{
    if (!context.vscode.workspaceFolders || context.vscode.workspaceFolders.length == 0)
        throw new Error("Current workspace is empty");
}

export class Commands
{
    private readonly _context: context.Context;
    private _vscode : wrappers.VSCode;

    constructor(context: context.Context, vscode : wrappers.VSCode)
    {
        this._context = context;
        this._vscode  = vscode;
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

        let options = { placeHolder: 'Select the package to work on' }

        const chosen = await this._vscode.showQuickPick(choices, options);
        if (chosen) {
            this._context.setSelectedPackage(chosen.path);
        }
    }

    private handlePromise<T>(promise: Promise<T>)
    {
        promise.catch(err => {
            this._vscode.showErrorMessage(err.message);
        })
    }

    async updatePackageInfo()
    {
        this.handlePromise(this._context.updateWorkspaceInfo());
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
        this._vscode.registerAndSubscribeCommand('rock.selectPackage', (...args) => { this.selectPackage(...args) });
        this._vscode.registerAndSubscribeCommand('rock.buildPackage', (...args) => { this.buildPackage(...args) });
        this._vscode.registerAndSubscribeCommand('rock.selectPackageType', (...args) => { this.selectPackageType(...args) });
        this._vscode.registerAndSubscribeCommand('rock.setDebuggingTarget', (...args) => { this.setDebuggingTarget(...args) });
        this._vscode.registerAndSubscribeCommand('rock.debugPackage', (...args) => { this.debugPackage(...args) });
        this._vscode.registerAndSubscribeCommand('rock.updatePackageInfo', (...args) => { this.updatePackageInfo(...args) });
    }
}