'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../wrappers';
import * as context from '../context';
import * as utils from '../utils';
import * as helpers from './helpers';
import * as autoproj from '../autoproj';
import * as tasks from '../tasks';
import { basename, relative } from 'path';
import * as debug from '../debug';

async function assertThrowsAsync(fn)
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
        assert.throws(f);
    }
}

describe("Utility functions", function () {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let rockContext: context.Context;
    let taskProvider: tasks.Provider;

    beforeEach(function () {
        root = helpers.init();
        workspaces = new autoproj.Workspaces()
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        taskProvider = new tasks.Provider(workspaces);
        rockContext = new context.Context(mockContext.object,
            mockWrapper.object, workspaces);
    })
    afterEach(function () {
        helpers.clear();
    })

    describe("in a non empty workspace", function () {
        let a: string;
        let b: string;
        let c: string;

        beforeEach(function () {
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
            taskProvider.reloadTasks();
        })
        describe("choosePackage", function () {
            it("shows a quick picker with all packages", async function () {
                let expectedChoices = new Array<{
                    label: string,
                    description: string,
                    root: string,
                    name: string
                }>();

                workspaces.forEachFolder((ws, folder) => {
                    expectedChoices.push({
                        label: relative(ws.root, folder),
                        description: ws.name,
                        root: folder,
                        name: basename(folder)
                    });
                });

                await utils.choosePackage(rockContext);
                mockWrapper.verify(x => x.showQuickPick(expectedChoices), TypeMoq.Times.once());
            });
        })
        describe("buildSelectedPackage", function () {
            let mockContext: TypeMoq.IMock<context.Context>;
            let aPackage: { name: string, root: string };
            beforeEach(function () {
                mockContext = TypeMoq.Mock.ofType<context.Context>();
                mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
            });
            it("throws if the selected package is invalid or null", async function () {
                aPackage = null;
                await assertThrowsAsync(async () => {
                    await utils.buildSelectedPackage(mockContext.object, taskProvider);
                });
            });
            it("throws if the selected package does not have a build task", async function () {
                let d = helpers.mkdir('three');
                aPackage = { name: 'three', root: d };

                await assertThrowsAsync(async () => {
                    await utils.buildSelectedPackage(mockContext.object, taskProvider);
                });
            });
            it("runs the build task for the selected package", async function () {
                aPackage = { name: 'iodrivers_base', root: a };
                mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
                mockContext.setup(x => x.workspaces).returns(() => workspaces);

                let task = taskProvider.buildTask(a);
                let taskName = task.source + ": " + task.name;

                await utils.buildSelectedPackage(mockContext.object, taskProvider);
                mockWrapper.verify(x => x.executeCommand("workbench.action.tasks.runTask", taskName), TypeMoq.Times.once());
            });
        })
        describe("choosePackageType", function () {
            let mockContext: TypeMoq.IMock<context.Context>;
            beforeEach(function () {
                mockContext = TypeMoq.Mock.ofType<context.Context>();
                mockContext.setup(x => x.workspaces).returns(() => workspaces);
            });
            it("throws if selected package is invalid", async function () {
                mockContext.setup(x => x.selectedPackage).returns(() => null);
                await assertThrowsAsync(async () => {
                    await utils.choosePackageType(mockContext.object);
                });
                mockWrapper.verify(x => x.showQuickPick(TypeMoq.It.isAny()), TypeMoq.Times.never());
            });
            it("shows a quick picker with all packages", async function () {
                let aPackage = { name: 'iodrivers_base', root: '/path/to/iodrivers_base' };
                mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
                mockContext.setup(x => x.selectedPackage).returns(() => aPackage);

                let expectedChoices = new Array<{ label: string,
                    description: string, type: context.PackageType }>();

                context.PackageTypeList.allTypes.forEach((type) => {
                    expectedChoices.push({
                        label: type.label,
                        description: '',
                        type: type
                    });
                });

                await utils.choosePackageType(mockContext.object);
                mockWrapper.verify(x => x.showQuickPick(expectedChoices), TypeMoq.Times.once());
            });
        })
        describe("selectDebuggingTarget", function () {
            let mockContext: TypeMoq.IMock<context.Context>;
            let mockFactory: TypeMoq.IMock<debug.TargetPickerFactory>;
            beforeEach(function () {
                mockContext = TypeMoq.Mock.ofType<context.Context>();
                mockContext.setup(x => x.workspaces).returns(() => workspaces);
                mockFactory = TypeMoq.Mock.ofType<debug.TargetPickerFactory>();
            });
            it("throws an exception if no package is selected", async function () {
                mockContext.setup(x => x.selectedPackage).returns(() => null);
                await assertThrowsAsync(async () => {
                    await utils.selectDebuggingTarget(mockContext.object, mockFactory.object);
                });
            })
            it("throws an exception if there is no picker for the package type", async function () {
                let aPackage = { name: 'iodrivers_base', root: '/path/to/iodrivers_base' };
                let packageType = context.PackageTypeList.CXX;
                mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
                mockContext.setup(x => x.selectedPackageType).returns(() => packageType);
                mockFactory.setup(x => x.createPicker(packageType, '/path/to/iodrivers_base')).
                    returns(() => undefined);
                await assertThrowsAsync(async () => {
                    await utils.selectDebuggingTarget(mockContext.object, mockFactory.object);
                });
            })
            it("shows the target picker and sets the debugging target", async function () {
                let aPackage = { name: 'iodrivers_base', root: '/path/to/iodrivers_base' };
                let packageType = context.PackageTypeList.CXX;
                let mockPicker = TypeMoq.Mock.ofType<debug.CXXTargetPicker>();
                let target = new debug.Target('iodrivers_base', '/path/to/iodrivers_base');
                let targetPromise = new Promise<debug.Target>((resolve) => {
                    resolve(target);
                });
                mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
                mockContext.setup(x => x.selectedPackageType).returns(() => packageType);
                mockFactory.setup(x => x.createPicker(packageType, '/path/to/iodrivers_base')).
                    returns(() => mockPicker.object);

                mockPicker.setup(x => x.show()).returns(() => targetPromise);
                await utils.selectDebuggingTarget(mockContext.object, mockFactory.object);
                mockPicker.verify(x => x.show(), TypeMoq.Times.once());
                mockContext.verify(x => x.debuggingTarget = target, TypeMoq.Times.once());
            })
        })
        describe("debugSelectedPackage", function () {
            let mockContext: TypeMoq.IMock<context.Context>;
            let mockProvider: TypeMoq.IMock<debug.ConfigurationProvider>;
            beforeEach(function () {
                mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
                mockContext = TypeMoq.Mock.ofType<context.Context>();
                mockContext.setup(x => x.workspaces).returns(() => workspaces);
                mockProvider = TypeMoq.Mock.ofType<debug.ConfigurationProvider>();
            });
            it("throws an exception if no package is selected", async function () {
                mockContext.setup(x => x.selectedPackage).returns(() => null);
                await assertThrowsAsync(async () => {
                    await utils.debugSelectedPackage(mockContext.object, mockProvider.object);
                });
            })
            it("throws an exception if debugging target is unset", async function () {
                let aPackage = { name: 'iodrivers_base', root: '/path/to/iodrivers_base' };
                let packageType = context.PackageTypeList.CXX;
                mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
                mockContext.setup(x => x.selectedPackageType).returns(() => packageType);
                mockContext.setup(x => x.debuggingTarget).returns(() => undefined);
                await assertThrowsAsync(async () => {
                    await utils.debugSelectedPackage(mockContext.object, mockProvider.object);
                });
            })
            it("throws an exception if there's no debugging conf for the package", async function () {
                let aPackage = { name: 'iodrivers_base', root: '/path/to/iodrivers_base' };
                let packageType = context.PackageTypeList.OTHER;
                let target = new debug.Target('test', '/path/to/iodrivers_base/build/src/test');
                mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
                mockContext.setup(x => x.selectedPackageType).returns(() => packageType);
                mockContext.setup(x => x.debuggingTarget).returns(() => target);
                mockProvider.setup(x => x.configuration(TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => undefined);
                await assertThrowsAsync(async () => {
                    await utils.debugSelectedPackage(mockContext.object, mockProvider.object);
                });
            })
            it("starts a debugging session", async function () {
                let aPackage = { name: 'iodrivers_base', root: '/path/to/iodrivers_base' };
                let packageType = context.PackageTypeList.CXX;
                let mockPicker = TypeMoq.Mock.ofType<debug.CXXTargetPicker>();
                let target = new debug.Target('iodrivers_base', '/path/to/iodrivers_base');
                let targetPromise = Promise.resolve(target);
                let uri = vscode.Uri.file(aPackage.root);
                const options = {
                    type: "cppdbg",
                    name: "rock debug",
                    request: "launch",
                    program: target.path,
                };
                let folder = {
                    uri: vscode.Uri.file('/path/to/iodrivers_base'),
                    name: 'iodrivers_base',
                    index: 0
                }
                mockContext.setup(x => x.selectedPackage).returns(() => aPackage);
                mockContext.setup(x => x.selectedPackageType).returns(() => packageType);
                mockContext.setup(x => x.debuggingTarget).returns(() => target);
                mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
                mockWrapper.setup(x => x.getWorkspaceFolder(uri)).returns(() => folder);
                mockProvider.setup(x => x.configuration(target, packageType, aPackage.root)).
                    returns(async () => await options);
                await utils.debugSelectedPackage(mockContext.object, mockProvider.object);
                mockWrapper.verify(x => x.startDebugging(folder, options), TypeMoq.Times.once());
            })
        })
    });
    describe("in an empty workspace", function () {
        describe("choosePackage", function () {
            it("throws an exception", async function () {
                await assertThrowsAsync(async () => {
                    await utils.choosePackage(rockContext)
                });
            })
        })
        describe("buildSelectedPackage", function () {
            it("throws an exception", async function () {
                await assertThrowsAsync(async () => {
                    await utils.buildSelectedPackage(rockContext, taskProvider);
                });
            })
        })
        describe("choosePackageType", function () {
            it("throws an exception", async function () {
                await assertThrowsAsync(async () => {
                    await utils.choosePackageType(rockContext);
                });
            })
        })
        describe("selectDebuggingTarget", function () {
            it("throws an exception", async function () {
                await assertThrowsAsync(async () => {
                    const mockFactory = TypeMoq.Mock.ofType<debug.TargetPickerFactory>();
                    await utils.selectDebuggingTarget(rockContext, mockFactory.object);
                });
            })
        })
        describe("debugSelectedPackage", function () {
            it("throws an exception", async function () {
                await assertThrowsAsync(async () => {
                    const mockProvider = TypeMoq.Mock.ofType<debug.ConfigurationProvider>();
                    await utils.debugSelectedPackage(rockContext, mockProvider.object);
                });
            })
        })
    });
});
