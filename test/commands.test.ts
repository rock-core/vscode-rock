'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as status from '../src/status';
import * as wrappers from '../src/wrappers';
import * as context from '../src/context';
import * as helpers from './helpers';
import * as autoproj from '../src/autoproj';
import * as tasks from '../src/tasks';
import { basename, relative } from 'path';
import * as debug from '../src/debug';
import * as commands from '../src/commands';
import * as packages from '../src/packages'
import { assertThrowsAsync } from './helpers';
import * as config from '../src/config';

describe("Commands", function () {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockPackage: TypeMoq.IMock<packages.Package>;
    let mockConfigManager: TypeMoq.IMock<config.ConfigManager>;
    let mockExtensionContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let subject: commands.Commands;

    let a: string;
    let b: string;
    let c: string;
    let folders: vscode.WorkspaceFolder[];
    beforeEach(function () {
        root = helpers.init();

        workspaces = new autoproj.Workspaces()
        folders = new Array<vscode.WorkspaceFolder>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockPackage = TypeMoq.Mock.ofType<packages.Package>();
        mockConfigManager = TypeMoq.Mock.ofType<config.ConfigManager>();
        subject = new commands.Commands(mockContext.object,
            mockWrapper.object, mockConfigManager.object);
        mockContext.setup(x => x.workspaces).returns(() => workspaces);

        helpers.mkdir('one');
        helpers.mkdir('two');
        helpers.mkdir('one', '.autoproj');
        helpers.mkdir('two', '.autoproj');

        helpers.createInstallationManifest([], 'one');
        helpers.createInstallationManifest([], 'two');
        helpers.mkdir('one', 'drivers');
        helpers.mkdir('two', 'firmware');
        a = helpers.mkdir('one', 'drivers', 'iodrivers_base');
        b = helpers.mkdir('one', 'drivers', 'auv_messaging');
        c = helpers.mkdir('two', 'firmware', 'chibios');

        workspaces.addFolder(a);
        workspaces.addFolder(b);
        workspaces.addFolder(c);

        let index = 0;
        workspaces.forEachFolder((ws, folder) => {
            let candidate: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(folder),
                name: basename(folder),
                index: index
            }
            folders.push(candidate);
            index++;
        });
        mockWrapper.setup(x => x.workspaceFolders).returns(() => folders);
    })
    afterEach(function () {
        helpers.clear();
    })
    describe("selectPackage", function () {
        it("shows a quick picker with all packages", async function () {
            let expectedChoices = new Array<{
                label: string,
                description: string,
                path: string
            }>();

            let chosen = {
                label: "drivers/iodrivers_base",
                description: "one",
                path: a
            };
            workspaces.forEachFolder((ws, folder) => {
                expectedChoices.push({
                    label: relative(ws.root, folder),
                    description: ws.name,
                    path: folder
                });
            });

            mockWrapper.setup(x => x.showQuickPick(expectedChoices, TypeMoq.It.isAny())).
                returns(() => Promise.resolve(chosen));

            await subject.selectPackage();
            mockWrapper.verify(x => x.showQuickPick(expectedChoices,
                TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockContext.verify(x => x.setSelectedPackage(chosen.path), TypeMoq.Times.once());
        });
    })
    describe("actions on the package", function () {
        beforeEach(function () {
            mockPackage.setup((x: any) => x.then).returns(() => undefined);
            mockContext.setup(x => x.getSelectedPackage()).
                returns(() => Promise.resolve(mockPackage.object));
        });
        describe("buildPackage", function () {
            it("handles exceptions thrown in the promise", async function () {
                mockPackage.setup(x => x.build()).returns(() => Promise.reject(new Error("test")));
                await subject.buildPackage();
                mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            });
        })
        describe("addLaunchConfig()", function () {
            it("does nothing if canceled", async function () {
                mockPackage.setup(x => x.debugConfiguration()).
                    returns(() => Promise.resolve(undefined));
                await subject.addLaunchConfig();
                mockConfigManager.verify(x => x.addLaunchConfig(TypeMoq.It.isAny(),
                    TypeMoq.It.isAny()), TypeMoq.Times.never());
            })
            it("handles an exception in the custom configuration method", async function () {
                mockPackage.setup(x => x.debugConfiguration()).
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
                mockPackage.setup(x => x.path).returns(() => '/path/to/package');
                mockPackage.setup(x => x.debugConfiguration()).
                    returns(() => Promise.resolve(debugConfig));
                await subject.addLaunchConfig();
                mockConfigManager.verify(x => x.addLaunchConfig('/path/to/package',
                    debugConfig), TypeMoq.Times.once());
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
    })
});
