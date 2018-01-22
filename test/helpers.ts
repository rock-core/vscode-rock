'use strict';

import * as vscode from 'vscode'
import * as Autoproj from '../src/autoproj'
import * as FS from 'fs';
import * as Temp from 'fs-temp';
import * as Path from 'path';
import * as YAML from 'js-yaml';
import * as assert from 'assert'
import * as TypeMoq from 'typemoq'
import * as Wrappers from '../src/wrappers'
import * as Context from '../src/context'
import * as Packages from '../src/packages'
import * as Tasks from '../src/tasks'
import * as Async from '../src/async'
import { writeFileSync } from 'fs';

export async function assertThrowsAsync(fn, msg: RegExp)
{
    let f = () => {};
    try {
        await fn();
    }
    catch (e)
    {
        f = () => {throw e};
    }
    finally
    {
        assert.throws(f, msg);
    }
}

let root;
let createdFS : Array<Array<string>> = []

export function init(): string {
    root = Temp.mkdirSync();
    return root;
}

export function fullPath(...path : string[]): string {
    return Path.join(root, ...path);
}
export function mkdir(...path): string {
    let joinedPath = root;
    path.forEach((element) => {
        joinedPath = Path.join(joinedPath, element);
        if (!FS.existsSync(joinedPath))
        {
            FS.mkdirSync(joinedPath);
            createdFS.push([joinedPath, 'dir']);
        }
    })
    return joinedPath;
}
export function mkfile(data: string, ...path): string {
    let joinedPath = fullPath(...path);
    FS.writeFileSync(joinedPath, data)
    createdFS.push([joinedPath, 'file']);
    return joinedPath;
}
export function registerDir(...path) {
    let joinedPath = fullPath(...path);
    createdFS.push([joinedPath, 'dir']);
}
export function registerFile(...path) {
    let joinedPath = fullPath(...path);
    createdFS.push([joinedPath, 'file']);
}
export function createInstallationManifest(data: any, ...workspacePath): string {
    let joinedPath = fullPath(...workspacePath);
    joinedPath = Autoproj.installationManifestPath(joinedPath);
    mkdir(...workspacePath, '.autoproj')
    FS.writeFileSync(joinedPath, YAML.safeDump(data));
    createdFS.push([joinedPath, 'file']);
    return joinedPath;
}
export function clear() {
    createdFS.reverse().forEach((entry) => {
        try {
            if (entry[1] === "file") {
                FS.unlinkSync(entry[0]);
            }
            else if (entry[1] === "dir") {
                FS.rmdirSync(entry[0]);
            }
        }
        catch(error) {
            if (!(error.message =~ /ENOENT/)) {
                throw error;
            }
        }
    })
    createdFS = []
    FS.rmdirSync(root)
    root = null
}

export class TestSetup
{
    mockWrapper : TypeMoq.IMock<Wrappers.VSCode>;
    mockBridge : TypeMoq.IMock<Async.EnvironmentBridge>;
    mockOutputChannel : TypeMoq.IMock<vscode.OutputChannel>;

    mockWorkspaces: TypeMoq.IMock<Autoproj.Workspaces>;
    get workspaces()
    {
        return this.mockWorkspaces.target;
    }

    mockTaskProvider : TypeMoq.IMock<Tasks.Provider>;
    get taskProvider()
    {
        return this.mockTaskProvider.target;
    }

    mockPackageFactory : TypeMoq.IMock<Packages.PackageFactory>;
    get packageFactory() : Packages.PackageFactory
    {
        return this.mockPackageFactory.target;
    }

    mockContext : TypeMoq.IMock<Context.Context>;
    get context() : Context.Context
    {
        return this.mockContext.target;
    }

    get outputChannel() : vscode.OutputChannel
    {
        return this.mockOutputChannel.object;
    }
    constructor()
    {
        this.mockWrapper = TypeMoq.Mock.ofType<Wrappers.VSCode>();
        this.mockBridge = TypeMoq.Mock.ofType<Async.EnvironmentBridge>();
        this.mockOutputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        this.mockWrapper.setup(x => x.createOutputChannel("Rock")).returns(() => this.mockOutputChannel.object);

        this.mockWorkspaces = TypeMoq.Mock.ofType2(Autoproj.Workspaces, []);
        this.mockTaskProvider = TypeMoq.Mock.ofType2(Tasks.Provider, [this.workspaces]);
        this.mockPackageFactory = TypeMoq.Mock.ofType2(Packages.PackageFactory, [this.mockWrapper.target, this.taskProvider, this.mockBridge.target]);
        this.mockContext = TypeMoq.Mock.ofType2(Context.Context, [this.mockWrapper.target, this.workspaces, this.packageFactory]);
    }

    setupWrapper(fn) {
        return this.mockWrapper.setup(fn);
    }

    createWorkspace(...path : string[]) : string {
        let wsPath = fullPath(...path);
        createInstallationManifest([], ...path);
        return wsPath;
    }

    createAndRegisterWorkspace(...path: string[]) {
        let wsPath = this.createWorkspace(...path);
        let mock = TypeMoq.Mock.ofType2(Autoproj.Workspace, [wsPath, false]);
        this.workspaces.add(mock.target);
        return { mock: mock, ws: mock.target };
    }

    addPackageToManifest(ws, path : string[], partialInfo: { [key: string]: any } = {}) : Autoproj.Package {
        let partialVCS: { [key: string]: any } = partialInfo.vcs || {};
        let result: Autoproj.Package = {
            name: partialInfo.name || 'Unknown',
            srcdir: fullPath(...path),
            builddir: partialInfo.builddir || "Unknown",
            prefix: partialInfo.prefix || "Unknown",
            vcs: {
                url: partialVCS.url || "Unknown",
                type: partialVCS.type || "Unknown",
                repository_id: partialVCS.repository_id || "Unknown"
            },
            type: partialInfo.type || "Unknown",
            logdir: partialInfo.logdir || "Unknown",
            dependencies: partialInfo.dependencies || "Unknown"
        };

        let manifestPath = Autoproj.installationManifestPath(ws.root)
        let manifest = YAML.safeLoad(FS.readFileSync(manifestPath).toString());
        manifest.push(result);
        FS.writeFileSync(manifestPath, YAML.safeDump(manifest));
        ws.reload();
        return result;
    }

    async registerPackage(ws, path : string[], partialInfo: { [key: string]: any } = {}) : Promise<Packages.Package>
    {
        let full = fullPath(...path);
        this.addPackageToManifest(ws, path, partialInfo)
        this.workspaces.associateFolderToWorkspace(full, ws);
        let folder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(full),
            name: Path.basename(full),
            index: 0
        }
        this.mockWrapper.setup(x => x.getWorkspaceFolder(full)).
            returns(() => folder);
        let pkg = await this.context.getPackageByPath(full);
        if (pkg) {
            return pkg;
        }
        else {
            throw Error("failed to resolve package after registration");
        }
    }
};
