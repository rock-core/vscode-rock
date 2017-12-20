'use strict'
import * as packages from '../packages'
import * as autoproj from '../autoproj'
import * as helpers from './helpers'
import * as vscode from 'vscode'
import * as assert from 'assert'
import * as TypeMoq from 'typemoq'
import * as context from '../context'
import * as tasks from '../tasks'
import * as status from '../status'
import * as wrappers from '../wrappers'
import * as debug from '../debug'
import { dirname, basename } from 'path'

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

describe("PackageFactory", function () {
    let subject: packages.PackageFactory;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockWorkspaces: TypeMoq.IMock<autoproj.Workspaces>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
        subject = new packages.PackageFactory(mockTaskProvider.object);
    })
    it("creates a ConfigPackage", async function () {
        let path = '/path/to/package';
        mockContext.setup(x => x.workspaces).returns(() => mockWorkspaces.object);
        mockWorkspaces.setup(x => x.isConfig(path)).returns(() => true)
        let aPackage = await subject.createPackage(path, mockContext.object);
        await assertThrowsAsync(async () => {
            await aPackage.build();
        }, /configuration package/);
    })
    it("creates an InvalidPackage if package is not in vscode ws", async function () {
        let path = '/path/to/package';
        mockContext.setup(x => x.workspaces).returns(() => mockWorkspaces.object);
        mockWorkspaces.setup(x => x.isConfig(path)).returns(() => false)
        mockWrapper.setup(x => x.getWorkspaceFolder(vscode.Uri.file(path))).
            returns(() => undefined);
        let aPackage = await subject.createPackage(path, mockContext.object);
        assert.equal(aPackage.name, '(Invalid package)');
    })
    it("creates an InvalidPackage if path is null or undefined", async function () {
        let path;
        let aPackage = await subject.createPackage(path, mockContext.object);
        assert.equal(aPackage.name, '(Invalid package)');
    })
    describe("the package is neither invalid nor a configuration", function () {
        let aPackage: packages.Package;
        let path = '/path/to/package';
        let folder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(path),
            name: 'package',
            index: 0
        }
        beforeEach(function () {
            mockContext.setup(x => x.workspaces).returns(() => mockWorkspaces.object);
            mockWorkspaces.setup(x => x.isConfig(path)).returns(() => false);
            mockWrapper.setup(x => x.getWorkspaceFolder(vscode.Uri.file(path))).
                returns(() => folder);
        })
        it("creates a ForeignPackage if the package is not in an autoproj ws", async function () {
            mockWorkspaces.setup(x => x.folderToWorkspace).
                returns(() => new Map<string, autoproj.Workspace>());

            aPackage = await subject.createPackage(path, mockContext.object);
            await assertThrowsAsync(async () => {
                await aPackage.build();
            }, /not part of an autoproj workspace/);
        })
        describe("the package is in an autoproj workspace", function () {
            let folderToWorkspace = new Map<string, autoproj.Workspace>();
            let mockWs: TypeMoq.IMock<autoproj.Workspace>;
            beforeEach(function () {
                mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
                folderToWorkspace.set(path, mockWs.object);
                mockWorkspaces.setup(x => x.folderToWorkspace).
                    returns(() => folderToWorkspace);
            })
            it("returns the type set by the user", async function () {
                mockContext.setup(x => x.getPackageType(path)).
                    returns(() => packages.Type.fromType(packages.TypeList.RUBY));
                aPackage = await subject.createPackage(path, mockContext.object);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.RUBY));
            })
            it("returns an OTHER package if the manifest could not be loaded", async function () {
                mockContext.setup(x => x.getPackageType(path)).
                    returns(() => undefined);
                mockWs.setup(x => x.info()).returns(() => Promise.reject(""));
                aPackage = await subject.createPackage(path, mockContext.object);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.OTHER));
            })
            it("returns the package type defined in the manifest", async function () {
                let thePackages = new Map<string, autoproj.Package>();
                let mockPackage = TypeMoq.Mock.ofType<autoproj.Package>();
                let wsInfo = {
                    path: '/path/to',
                    packages: thePackages,
                    packageSets: new Map<string, autoproj.PackageSet>()
                }
                thePackages.set("package", mockPackage.object);
                mockPackage.setup(x => x.type).returns(() => "Autobuild::CMake");
                mockContext.setup(x => x.getPackageType(path)).
                    returns(() => undefined);
                mockWs.setup(x => x.root).returns(() => '/path/to');
                mockWs.setup(x => x.info()).returns(() => Promise.resolve(wsInfo));
                aPackage = await subject.createPackage(path, mockContext.object);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.CXX));
            })
            it("returns OTHER if the package is not in the manifest", async function () {
                let thePackages = new Map<string, autoproj.Package>();
                let wsInfo = {
                    path: '/path/to',
                    packages: thePackages,
                    packageSets: new Map<string, autoproj.PackageSet>()
                }
                mockContext.setup(x => x.getPackageType(path)).
                    returns(() => undefined);
                mockWs.setup(x => x.root).returns(() => '/path/to');
                mockWs.setup(x => x.info()).returns(() => Promise.resolve(wsInfo));
                aPackage = await subject.createPackage(path, mockContext.object);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.OTHER));
            })
        })
    })
})

describe("InvalidPackage", function () {
    let subject;
    beforeEach(function () {
        subject = new packages.InvalidPackage();
    })
    it("returns a valid string as its name", function () {
        assert.equal(subject.name, "(Invalid package)");
    })
    it("does not allow to debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /Select a valid package/);
    })
    it("does not allow building", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /Select a valid package/);
    })
    it("does not allow to pick a debugging target", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /Select a valid package/);
    })
    it("does not allow to pick the package type", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickType();
        }, /Select a valid package/);
    })
    it("returns an invalid package type", function () {
        assert.deepEqual(subject.type,
            packages.Type.invalid());
    })
})

describe("ConfigPackage", function () {
    let subject;
    beforeEach(function () {
        subject = new packages.ConfigPackage("/path/to/package");
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("does not allow debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /configuration package/);
    })
    it("does not allow building", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /configuration package/);
    })
    it("does not allow to pick a debugging target", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /configuration package/);
    })
    it("does not allow to pick the package type", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickType();
        }, /configuration package/);
    })
    it("returns the CONFIG package type", function () {
        assert.deepEqual(subject.type,
            packages.Type.config());
    })
})

async function testTargetPicker(subject: packages.Package,
    mockContext: TypeMoq.IMock<context.Context>)
{
    let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
    let target = new debug.Target('file', '/a/picked/file');
    const options: vscode.OpenDialogOptions = {
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        defaultUri: vscode.Uri.file(subject.path)
    };

    const uri = Promise.resolve([ vscode.Uri.file('/a/picked/file') ]);

    mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
    mockWrapper.setup(x => x.showOpenDialog(options)).returns(() => uri);
    mockContext.setup(x => x.getDebuggingTarget(subject.path)).
        returns(() => target)
    await subject.pickTarget();
    mockContext.verify(x => x.setDebuggingTarget(subject.path, target),
        TypeMoq.Times.once());
    assert.equal(subject.target.name, 'file');
    assert.equal(subject.target.path, '/a/picked/file');
}

async function testTypePicker(subject: packages.Package,
    mockContext: TypeMoq.IMock<context.Context>)
{
    let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();

    let expectedChoices = new Array<{
        label: string,
        description: string,
        type: packages.Type
    }>();

    packages.TypeList.allTypes.forEach((type) => {
        expectedChoices.push({
            label: type.label,
            description: '',
            type: type
        });
    });
    let packageType = {
        label: 'Ruby',
        description: '',
        type: packages.TypeList.RUBY
    }
    mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
    mockWrapper.setup(x => x.showQuickPick(expectedChoices)).
        returns(() => Promise.resolve(packageType));

    await subject.pickType();
    mockWrapper.verify(x => x.showQuickPick(expectedChoices), TypeMoq.Times.once());
    mockContext.verify(x => x.setPackageType(subject.path, packages.TypeList.RUBY),
        TypeMoq.Times.once());
}

describe("ForeignPackage", function () {
    let subject;
    let mockContext: TypeMoq.IMock<context.Context>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        subject = new packages.ForeignPackage("/path/to/package",
            mockContext.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("does not allow debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /not part of an autoproj workspace/);
    })
    it("does not allow debugging target picking", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /not part of an autoproj workspace/);
    })
    it("does not allow building", async function () {
        await assertThrowsAsync(async () => {
            await subject.build();
        }, /not part of an autoproj workspace/);
    })
    it("shows the type picking ui and sets the package type", async function () {
        await testTypePicker(subject, mockContext);
    })
})

describe("RockRubyPackage", function () {
    let subject: packages.RockRubyPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        subject = new packages.RockRubyPackage("/path/to/package",
            mockContext.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();

        mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let taskName = task.source + ": " + task.name;

        await subject.build();
        mockWrapper.verify(x => x.executeCommand("workbench.action.tasks.runTask", taskName),
            TypeMoq.Times.once());
    })
    it("shows the target picking ui and sets the debugging target", async function () {
        await testTargetPicker(subject, mockContext);
    })
    describe("debug()", function () {
        it("throws if the debugging target is unset", async function () {
            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /Select a debugging target/);
        })
        it("starts a ruby debugging session", async function () {
            let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();

            const target = new debug.Target('package', '/path/to/package/build/test');
            const type = packages.TypeList.RUBY;
            const options = {
                type: "Ruby",
                name: "rock debug",
                request: "launch",
                program: target.path,
                cwd: dirname(target.path),
                env: undefined
            };
            const uri = vscode.Uri.file(subject.path);
            let folder = {
                uri: vscode.Uri.file(subject.path),
                name: basename(subject.path),
                index: 0
            }

            mockContext.setup(x => x.getDebuggingTarget(subject.path)).
                returns(() => target);

            let env = (await subject.debugConfiguration()).env;
            options.env = env;

            mockWrapper.setup(x => x.getWorkspaceFolder(uri)).returns(() => folder);
            mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
            await subject.debug();
            mockWrapper.verify(x => x.startDebugging(folder, options), TypeMoq.Times.once());
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        await testTypePicker(subject, mockContext);
    })
    it("returns the RUBY package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.RUBY));
    })
})

describe("RockCXXPackage", function () {
    let subject: packages.RockRubyPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        subject = new packages.RockCXXPackage("/path/to/package",
            mockContext.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();

        mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let taskName = task.source + ": " + task.name;

        await subject.build();
        mockWrapper.verify(x => x.executeCommand("workbench.action.tasks.runTask", taskName),
            TypeMoq.Times.once());
    })
    it("shows the target picking ui and sets the debugging target", async function () {
        await testTargetPicker(subject, mockContext);
    })
    describe("debug()", function () {
        it("throws if the debugging target is unset", async function () {
            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /Select a debugging target/);
        })
        it("starts a cxx debugging session", async function () {
            let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
            const target = new debug.Target('package', '/path/to/package/build/test');
            const type = packages.TypeList.CXX;
            const options = {
                type: "cppdbg",
                name: "rock debug",
                request: "launch",
                program: target.path,
                externalConsole: false,
                MIMode: "gdb",
                cwd: dirname(target.path),
                setupCommands: [
                    {
                        description: "Enable pretty-printing for gdb",
                        text: "-enable-pretty-printing",
                        ignoreFailures: false
                    }
                ]
            };
            const uri = vscode.Uri.file(subject.path);
            let folder = {
                uri: vscode.Uri.file(subject.path),
                name: basename(subject.path),
                index: 0
            }

            mockContext.setup(x => x.getDebuggingTarget(subject.path)).
                returns(() => target);

            mockWrapper.setup(x => x.getWorkspaceFolder(uri)).returns(() => folder);
            mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
            await subject.debug();
            mockWrapper.verify(x => x.startDebugging(folder, options), TypeMoq.Times.once());
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        await testTypePicker(subject, mockContext);
    })
    it("returns the CXX package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.CXX));
    })
})

describe("RockOtherPackage", function () {
    let subject: packages.RockOtherPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        subject = new packages.RockOtherPackage("/path/to/package",
            mockContext.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();

        mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let taskName = task.source + ": " + task.name;

        await subject.build();
        mockWrapper.verify(x => x.executeCommand("workbench.action.tasks.runTask", taskName),
            TypeMoq.Times.once());
    })
    it("does not allow debugging target picking", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /Set the package type/);
    })
    it("does not allow debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /Set the package type/);
    })
    it("shows the type picking ui and sets the package type", async function () {
        await testTypePicker(subject, mockContext);
    })
    it("returns the OTHER package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.OTHER));
    })
})