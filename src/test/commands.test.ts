'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as status from '../status';
import * as wrappers from '../wrappers';
import * as context from '../context';
import * as helpers from './helpers';
import * as autoproj from '../autoproj';
import * as tasks from '../tasks';
import { basename, relative } from 'path';
import * as debug from '../debug';
import * as commands from '../commands';

async function assertThrowsAsync(fn, msg?: RegExp)
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

describe("Commands", function () {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockDebugProvider: TypeMoq.IMock<debug.ConfigurationProvider>;
    let mockFactory: TypeMoq.IMock<debug.TargetPickerFactory>;
    let mockStatusBar: TypeMoq.IMock<status.StatusBar>;
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
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockDebugProvider = TypeMoq.Mock.ofType<debug.ConfigurationProvider>();
        mockFactory = TypeMoq.Mock.ofType<debug.TargetPickerFactory>();
        mockStatusBar = TypeMoq.Mock.ofType<status.StatusBar>();
        subject = new commands.Commands(mockContext.object, mockTaskProvider.object,
            mockFactory.object, mockDebugProvider.object, mockStatusBar.object);
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
        mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);

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
                root: string,
                name: string
            }>();

            let chosen = {
                label: "drivers/iodrivers_base",
                description: "one",
                root: a,
                name: "iodrivers_base"
            };
            workspaces.forEachFolder((ws, folder) => {
                expectedChoices.push({
                    label: relative(ws.root, folder),
                    description: ws.name,
                    root: folder,
                    name: basename(folder)
                });
            });

            mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny())).
                returns(() => Promise.resolve(chosen));

            await subject.selectPackage();
            mockWrapper.verify(x => x.showQuickPick(expectedChoices), TypeMoq.Times.once());
            mockStatusBar.verify(x => x.update(), TypeMoq.Times.once());
        });
    })
    describe("buildPackage", function () {
        let aPackage: { name: string, root: string };
        beforeEach(function () {
            mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
        });
        it("throws if the selected package is invalid or null", async function () {
            aPackage = null;
            await assertThrowsAsync(async () => {
                await subject.buildPackage();
            }, /package is invalid/);
        });
        it("throws if the selected package does not have a build task", async function () {
            aPackage = { name: 'iodrivers_base', root: a };
            mockTaskProvider.setup(x => x.buildTask(TypeMoq.It.isAny())).
                returns(() => undefined);
            await assertThrowsAsync(async () => {
                await subject.buildPackage();
            }, /does not have a build task/);
        });
        it("runs the build task for the selected package", async function () {
            aPackage = { name: 'iodrivers_base', root: a };
            let defs: vscode.TaskDefinition = { type: "test" };
            let task = new vscode.Task(defs, "test", "test");
            mockTaskProvider.setup(x => x.buildTask(aPackage.root)).
                returns(() => task);

            let taskName = task.source + ": " + task.name;

            await subject.buildPackage();
            mockWrapper.verify(x => x.executeCommand("workbench.action.tasks.runTask", taskName), TypeMoq.Times.once());
        });
    })
    describe("selectPackageType", function () {
        it("throws if selected package is invalid", async function () {
            mockContext.setup(x => x.selectedPackage).returns(() => null);
            await assertThrowsAsync(async () => {
                await subject.selectPackageType();
            }, /package is invalid/);
            mockWrapper.verify(x => x.showQuickPick(TypeMoq.It.isAny()), TypeMoq.Times.never());
        });
        it("shows a quick picker with all types", async function () {
            let aPackage = { name: 'iodrivers_base', root: '/path/to/iodrivers_base' };
            mockContext.setup(x => x.selectedPackage).returns(() => aPackage);

            let expectedChoices = new Array<{
                label: string,
                description: string, type: context.PackageType
            }>();

            context.PackageTypeList.allTypes.forEach((type) => {
                expectedChoices.push({
                    label: type.label,
                    description: '',
                    type: type
                });
            });
            let packageType = {
                label: 'Ruby',
                description: '',
                type: context.PackageTypeList.RUBY
            }
            mockWrapper.setup(x => x.showQuickPick(expectedChoices)).
                returns(() => Promise.resolve(packageType));

            await subject.selectPackageType();
            mockWrapper.verify(x => x.showQuickPick(expectedChoices), TypeMoq.Times.once());
            mockContext.verify(x => x.setSelectedPackageType(context.PackageTypeList.RUBY),
                TypeMoq.Times.once());
        });
    })
    describe("setDebuggingTarget", function () {
        it("throws an exception if no package is selected", async function () {
            mockContext.setup(x => x.selectedPackage).returns(() => null);
            await assertThrowsAsync(async () => {
                await subject.setDebuggingTarget();
            }, /package is invalid/);
        })
        it("throws an exception if there is no picker for the package type", async function () {
            let aPackage = { name: 'iodrivers_base', root: a };
            let packageType = context.PackageTypeList.CXX;
            mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
            mockContext.setup(x => x.getSelectedPackageType()).
                returns(() => Promise.resolve(packageType));
            mockFactory.setup(x => x.createPicker(packageType, a)).
                returns(() => undefined);
            await assertThrowsAsync(async () => {
                await subject.setDebuggingTarget();
            }, /not available for this package/);
        })
        it("throws an exception if package is not in an workspace", async function () {
            let aPackage = { name: 'iodrivers_base', root: '/not/in/workspace/iodrivers_base' };
            let packageType = context.PackageTypeList.CXX;
            mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
            await assertThrowsAsync(async () => {
                await subject.debugPackage();
            }, /not part of an autoproj workspace/);
        })
        it("shows the target picker and sets the debugging target", async function () {
            let aPackage = { name: 'iodrivers_base', root: a };
            let packageType = context.PackageTypeList.CXX;
            let mockPicker = TypeMoq.Mock.ofType<debug.CXXTargetPicker>();
            let target = new debug.Target('iodrivers_base', a);
            let targetPromise = Promise.resolve(target);
            mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
            mockContext.setup(x => x.getSelectedPackageType()).
                returns(() => Promise.resolve(packageType));
            mockFactory.setup(x => x.createPicker(packageType, a)).
                returns(() => mockPicker.object);

            mockPicker.setup(x => x.show()).returns(() => targetPromise);
            await subject.setDebuggingTarget();
            mockPicker.verify(x => x.show(), TypeMoq.Times.once());
            mockContext.verify(x => x.debuggingTarget = target, TypeMoq.Times.once());
        })
    })
    describe("debugPackage", function () {
        it("throws an exception if no package is selected", async function () {
            mockContext.setup(x => x.selectedPackage).returns(() => null);
            await assertThrowsAsync(async () => {
                await subject.debugPackage();
            }, /package is invalid/);
        })
        it("throws an exception if debugging target is unset", async function () {
            let aPackage = { name: 'iodrivers_base', root: a };
            let packageType = context.PackageTypeList.CXX;
            mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
            mockContext.setup(x => x.getSelectedPackageType()).
                returns(() => Promise.resolve(packageType));
            mockContext.setup(x => x.debuggingTarget).returns(() => undefined);
            await assertThrowsAsync(async () => {
                await subject.debugPackage();
            }, /target is unset/);
        })
        it("throws an exception if package is not in an workspace", async function () {
            let aPackage = { name: 'iodrivers_base', root: '/not/in/workspace/iodrivers_base' };
            let packageType = context.PackageTypeList.CXX;
            mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
            await assertThrowsAsync(async () => {
                await subject.debugPackage();
            }, /not part of an autoproj workspace/);
        })
        it("throws an exception if there's no debugging conf for the package", async function () {
            let aPackage = { name: 'iodrivers_base', root: a };
            let packageType = context.PackageTypeList.OTHER;
            let target = new debug.Target('test', '/path/to/iodrivers_base/build/src/test');
            mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
            mockContext.setup(x => x.getSelectedPackageType()).
                returns(() => Promise.resolve(packageType));
            mockContext.setup(x => x.debuggingTarget).returns(() => target);
            mockDebugProvider.setup(x => x.configuration(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => undefined);
            await assertThrowsAsync(async () => {
                await subject.debugPackage();
            }, /not available for this package/);
        })
        it("starts a debugging session", async function () {
            let aPackage = { name: 'iodrivers_base', root: a };
            let packageType = context.PackageTypeList.CXX;
            let mockPicker = TypeMoq.Mock.ofType<debug.CXXTargetPicker>();
            let target = new debug.Target('iodrivers_base', a);
            let targetPromise = Promise.resolve(target);
            let uri = vscode.Uri.file(aPackage.root);
            const options = {
                type: "cppdbg",
                name: "rock debug",
                request: "launch",
                program: target.path,
            };
            let folder = {
                uri: vscode.Uri.file(a),
                name: 'iodrivers_base',
                index: 0
            }
            mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
            mockContext.setup(x => x.getSelectedPackageType()).
                returns(() => Promise.resolve(packageType));
            mockContext.setup(x => x.debuggingTarget).returns(() => target);
            mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
            mockWrapper.setup(x => x.getWorkspaceFolder(uri)).returns(() => folder);
            mockDebugProvider.setup(x => x.configuration(target, packageType, aPackage.root)).
                returns(async () => await options);
            await subject.debugPackage();
            mockWrapper.verify(x => x.startDebugging(folder, options), TypeMoq.Times.once());
        })
    })
});
