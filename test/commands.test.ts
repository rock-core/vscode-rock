'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../src/wrappers';
import * as context from '../src/context';
import * as helpers from './helpers';
import * as autoproj from '../src/autoproj';
import * as tasks from '../src/tasks';
import { basename, relative, dirname } from 'path';
import * as debug from '../src/debug';
import * as commands from '../src/commands';
import * as packages from '../src/packages'
import { assertThrowsAsync } from './helpers';
import * as config from '../src/config';
import { workspace } from 'vscode';

describe("Commands", function () {
    let mockWorkspaces: TypeMoq.IMock<autoproj.Workspaces>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockPackage: TypeMoq.IMock<packages.Package>;
    let mockConfigManager: TypeMoq.IMock<config.ConfigManager>;
    let subject: commands.Commands;

    beforeEach(function () {
        mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockPackage = TypeMoq.Mock.ofType<packages.Package>();
        mockConfigManager = TypeMoq.Mock.ofType<config.ConfigManager>();
        subject = new commands.Commands(mockContext.object,
            mockWrapper.object, mockConfigManager.object);
        mockContext.setup(x => x.workspaces).returns(() => mockWorkspaces.object);
    })
    describe("addLaunchConfig()", function () {
        let mockSubject: TypeMoq.IMock<commands.Commands>;
        beforeEach(function () {
            mockPackage.setup((x: any) => x.then).returns(() => undefined);
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("does nothing if canceled", async function () {
            mockSubject.setup(x => x.showPackagePicker()).
                returns(() => Promise.resolve(undefined));
            await subject.addLaunchConfig();
            mockConfigManager.verify(x => x.addLaunchConfig(TypeMoq.It.isAny(),
                TypeMoq.It.isAny()), TypeMoq.Times.never());
        })
        it("handles an exception in the debug configuration method", async function () {
            mockSubject.setup(x => x.showPackagePicker()).
                returns(() => Promise.resolve(mockPackage.object));
            mockPackage.setup(x => x.debugConfiguration()).
                returns(() => Promise.reject(new Error("test")));
            await subject.addLaunchConfig();
            mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            mockConfigManager.verify(x => x.addLaunchConfig(TypeMoq.It.isAny(),
                TypeMoq.It.isAny()), TypeMoq.Times.never());
        })
        it("handles an exception if workspace is empty", async function () {
            mockSubject.setup(x => x.showPackagePicker()).
                returns(() => Promise.reject(new Error("test")));
            await subject.addLaunchConfig();
            mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            mockConfigManager.verify(x => x.addLaunchConfig(TypeMoq.It.isAny(),
                TypeMoq.It.isAny()), TypeMoq.Times.never());
        })
        it("adds a launch config to the package", async function () {
            let debugConfig: vscode.DebugConfiguration = {
                name: "test",
                type: "cppdbg",
                request: "launch"
            }
            mockSubject.setup(x => x.showPackagePicker()).
                returns(() => Promise.resolve(mockPackage.object));
            mockPackage.setup(x => x.path).returns(() => '/path/to/package');
            mockPackage.setup(x => x.debugConfiguration()).
                returns(() => Promise.resolve(debugConfig));
            await subject.addLaunchConfig();
            mockConfigManager.verify(x => x.addLaunchConfig('/path/to/package',
                debugConfig), TypeMoq.Times.once());
        })
    })
    describe("updatePackageInfo()", function () {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockSubject: TypeMoq.IMock<commands.Commands>;
        beforeEach(function () {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup((x: any) => x.then).returns(() => undefined);
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("does nothing if canceled", async function () {
            mockSubject.setup(x => x.showWorkspacePicker()).
                returns(() => Promise.resolve(undefined));
            await subject.updatePackageInfo();
            mockContext.verify(x => x.updateWorkspaceInfo(TypeMoq.It.isAny()),
                TypeMoq.Times.never());
        })
        it("handles an exception while updating workspace info", async function () {
            mockSubject.setup(x => x.showWorkspacePicker()).
                returns(() => Promise.resolve(mockWorkspace.object));
            mockContext.setup(x => x.updateWorkspaceInfo(mockWorkspace.object)).
                returns(() => Promise.reject(new Error("test")));
            await subject.updatePackageInfo();
            mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            mockContext.verify(x => x.updateWorkspaceInfo(mockWorkspace.object),
                TypeMoq.Times.once());
        })
        it("handles an exception if workspace is empty", async function () {
            mockSubject.setup(x => x.showWorkspacePicker()).
                returns(() => Promise.reject(new Error("test")));
            await subject.updatePackageInfo();
            mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            mockContext.verify(x => x.updateWorkspaceInfo(TypeMoq.It.isAny()),
                TypeMoq.Times.never());
        })
        it("updates workspace info", async function () {
            mockSubject.setup(x => x.showWorkspacePicker()).
                returns(() => Promise.resolve(mockWorkspace.object));
            mockContext.setup(x => x.updateWorkspaceInfo(mockWorkspace.object)).
                returns(() => Promise.resolve());
            await subject.updatePackageInfo();
            mockContext.verify(x => x.updateWorkspaceInfo(mockWorkspace.object),
                TypeMoq.Times.once());
        })
    })
    describe("updateCodeConfig()", function () {
        let choices: { label, description, configTarget }[];
        function makeChoice(label: string, scope: vscode.ConfigurationTarget) {
            return {
                label: label,
                description: '',
                configTarget: scope
            }
        }
        beforeEach(function () {
            choices = [];
            choices.push(makeChoice('Global', vscode.ConfigurationTarget.Global));
            choices.push(makeChoice('Workspace', vscode.ConfigurationTarget.Workspace))
        })
        it("applies configuration globally", async function () {
            const choice = makeChoice('Global', vscode.ConfigurationTarget.Global);
            mockWrapper.setup(x => x.showQuickPick(choices, TypeMoq.It.isAny())).
                returns(() => Promise.resolve(choice));
            await subject.updateCodeConfig();
            mockConfigManager.verify(x => x.updateCodeConfig(choice.configTarget),
                TypeMoq.Times.once());
        })
        it("applies configuration to the workspace", async function () {
            const choice = makeChoice('Workspace', vscode.ConfigurationTarget.Workspace);
            mockWrapper.setup(x => x.showQuickPick(choices, TypeMoq.It.isAny())).
                returns(() => Promise.resolve(choice));
            await subject.updateCodeConfig();
            mockConfigManager.verify(x => x.updateCodeConfig(choice.configTarget),
                TypeMoq.Times.once());
        })
        it("handles an exception if configuration fails", async function () {
            const choice = makeChoice('Workspace', vscode.ConfigurationTarget.Workspace);
            mockWrapper.setup(x => x.showQuickPick(choices, TypeMoq.It.isAny())).
                returns(() => Promise.resolve(choice));
            mockConfigManager.setup(x => x.updateCodeConfig(choice.configTarget)).
                throws(new Error("test"));
            await subject.updateCodeConfig();
            mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
        });
        it("does nothing when canceled", async function () {
            mockWrapper.setup(x => x.showQuickPick(choices, TypeMoq.It.isAny())).
                returns(() => Promise.resolve(undefined));
            await subject.updateCodeConfig();
            mockConfigManager.verify(x => x.updateCodeConfig(TypeMoq.It.isAny()),
                TypeMoq.Times.never());
        });
    })
    describe("showPackagePicker()", function () {
        let choices: { label, description, pkg }[];
        let workspaceFolders: vscode.WorkspaceFolder[];
        let mockOne: TypeMoq.IMock<packages.Package>;
        let mockTwo: TypeMoq.IMock<packages.Package>;

        function makeChoice(pkg: packages.Package) {
            return {
                label: pkg.name,
                description: pkg.workspace ? basename(pkg.workspace.root) : '',
                pkg: pkg
            }
        }
        beforeEach(function () {
            mockOne = TypeMoq.Mock.ofType<packages.Package>();
            mockTwo = TypeMoq.Mock.ofType<packages.Package>();
            const mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();

            mockWs.setup((x: any) => x.then).returns(() => undefined);
            mockWs.setup(x => x.root).returns(() => "/ws/root");
            mockOne.setup(x => x.workspace).returns(() => mockWs.object);
            mockTwo.setup(x => x.workspace).returns(() => mockWs.object);
            mockOne.setup(x => x.name).returns(() => "one");
            mockTwo.setup(x => x.name).returns(() => "two");
            mockOne.setup((x: any) => x.then).returns(() => undefined);
            mockTwo.setup((x: any) => x.then).returns(() => undefined);

            mockContext.setup(x => x.getPackageByPath("/ws/root/one")).
                returns(() => Promise.resolve(mockOne.object));

            mockContext.setup(x => x.getPackageByPath("/ws/root/two")).
                returns(() => Promise.resolve(mockTwo.object));

            choices = [];
            choices.push(makeChoice(mockOne.object));
            choices.push(makeChoice(mockTwo.object));
            workspaceFolders = [];
        })
        it("throws if workspace is empty", async function () {
            mockWrapper.setup(x => x.workspaceFolders).returns(() => undefined);
            helpers.assertThrowsAsync(async () => {
                await subject.showPackagePicker();
            }, /workspace is empty/)
        })
        function addFolderToWorkspace(path: string)
        {
            const folder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(path),
                name: basename(path),
                index: workspaceFolders.length
            }
            workspaceFolders.push(folder);
        }
        it("skip picker if there is only one package in the workspace", async function () {
            mockWrapper.setup(x => x.workspaceFolders).returns(() => workspaceFolders);
            addFolderToWorkspace("/ws/root/one");
            let pkg = await subject.showPackagePicker();
            mockWrapper.verify(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny()), TypeMoq.Times.never());
            assert.strictEqual(pkg, mockOne.object);
        })
        it("returns undefined if canceled", async function () {
            addFolderToWorkspace("/ws/root/one");
            addFolderToWorkspace("/ws/root/two");
            mockWrapper.setup(x => x.workspaceFolders).returns(() => workspaceFolders);
            mockWrapper.setup(x => x.showQuickPick(choices,
                TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

            let pkg = await subject.showPackagePicker();
            assert(!pkg);
        });
        it("returns the picked package", async function () {
            addFolderToWorkspace("/ws/root/one");
            addFolderToWorkspace("/ws/root/two");
            mockWrapper.setup(x => x.workspaceFolders).returns(() => workspaceFolders);
            mockWrapper.setup(x => x.showQuickPick(choices,
                TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[0]))

            let pkg = await subject.showPackagePicker();
            mockWrapper.verify(x => x.showQuickPick(choices, TypeMoq.It.isAny()),
                TypeMoq.Times.once());
            assert.strictEqual(pkg, choices[0].pkg);
        });
    })
    describe("showWorkspacePicker()", function () {
        let choices: { label, description, ws }[];
        let mockOne: TypeMoq.IMock<autoproj.Workspace>;
        let mockTwo: TypeMoq.IMock<autoproj.Workspace>;
        let workspaces: Map<string, autoproj.Workspace>;

        function makeChoice(ws: autoproj.Workspace) {
            return {
                label: basename(ws.root),
                description: basename(dirname(ws.root)),
                ws: ws
            }
        }
        beforeEach(function () {
            workspaces = new Map();
            mockOne = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockTwo = TypeMoq.Mock.ofType<autoproj.Workspace>();

            mockOne.setup(x => x.root).returns(() => "/ws/one");
            mockTwo.setup(x => x.root).returns(() => "/ws/two");
            mockOne.setup((x: any) => x.then).returns(() => undefined);
            mockTwo.setup((x: any) => x.then).returns(() => undefined);

            choices = [];
            choices.push(makeChoice(mockOne.object));
            choices.push(makeChoice(mockTwo.object));
            workspaces.set("/ws/one", mockOne.object);
            workspaces.set("/ws/two", mockTwo.object);
        })
        it("throws if there are no autoproj workspaces", async function () {
            mockWorkspaces.setup(x => x.workspaces).returns(() => new Map());
            helpers.assertThrowsAsync(async () => {
                await subject.showWorkspacePicker();
            }, /No Autoproj workspace/)
        })
        it("skip picker if there is only one workspace", async function () {
            let tempWs: Map<string, autoproj.Workspace> = new Map();
            tempWs.set("/ws/one", mockOne.object);
            mockWorkspaces.setup(x => x.workspaces).returns(() => tempWs);
            let ws = await subject.showWorkspacePicker();
            mockWrapper.verify(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny()), TypeMoq.Times.never());
            assert.strictEqual(ws, mockOne.object);
        })
        it("returns undefined if canceled", async function () {
            mockWorkspaces.setup(x => x.workspaces).returns(() => workspaces);
            mockWorkspaces.setup(x => x.forEachWorkspace(TypeMoq.It.isAny())).
                returns((callback) => workspaces.forEach(callback));
            mockWrapper.setup(x => x.showQuickPick(choices,
                TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

            let ws = await subject.showWorkspacePicker();
            assert(!ws);
        });
        it("returns the picked workspace", async function () {
            mockWorkspaces.setup(x => x.workspaces).returns(() => workspaces);
            mockWorkspaces.setup(x => x.forEachWorkspace(TypeMoq.It.isAny())).
                returns((callback) => workspaces.forEach(callback));
            mockWrapper.setup(x => x.showQuickPick(choices,
                TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[0]))

            let ws = await subject.showWorkspacePicker();
            mockWrapper.verify(x => x.showQuickPick(choices, TypeMoq.It.isAny()),
                TypeMoq.Times.once());
            assert.strictEqual(ws, choices[0].ws);
        });
    })
});
