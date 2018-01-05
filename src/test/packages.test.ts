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
import * as async from '../async'
import { dirname, basename } from 'path'

async function assertThrowsAsync(fn, msg: RegExp)
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

describe("Type", function() {
    describe("typePickerChoices", function() {
        it("does not contain any internal type", function() {
            packages.Type.typePickerChoices().forEach((choice) => {
                assert(!choice.type.isInternal());
            })
        })
    })
})

describe("PackageFactory", function () {
    let subject: packages.PackageFactory;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockWorkspaces: TypeMoq.IMock<autoproj.Workspaces>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
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
        mockContext.setup(x => x.getWorkspaceFolder(path)).
            returns(() => undefined);
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
            mockContext.setup(x => x.getWorkspaceFolder(path)).
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
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
    })
})

describe("RockRubyPackage", function () {
    let subject: packages.RockRubyPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;
    beforeEach(function () {
        mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
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
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        await subject.build();
        mockContext.verify(x => x.runTask(task), TypeMoq.Times.once());
    })
    it("shows the target picking ui and sets the debugging target", async function () {
        subject.pickTarget();
        mockContext.verify(x => x.pickDebuggingFile(subject.path), TypeMoq.Times.once());
    })

    describe("debug()", function () {
        it("throws if the debugging target is unset", async function () {
            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /Select a debugging target/);
        })
        it("throws if environment cannot be loaded", async function () {
            let error = new Error("test");
            const target = new debug.Target('package', '/path/to/package/build/test');            
            mockBridge.setup(x => x.env(subject.path)).returns(() => Promise.reject(error));
            mockContext.setup(x => x.bridge).returns(() => mockBridge.object);
            mockContext.setup(x => x.getDebuggingTarget(subject.path)).
                returns(() => target);

            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /test/);
        })
        it("starts a ruby debugging session", async function () {
            const target = new debug.Target('package', '/path/to/package/build/test');
            let userConf: context.RockDebugConfig = {
                cwd: subject.path,
                args: ['--test'],
                orogen: {
                    start: true,
                    gui: true,
                    confDir: subject.path
                }
            }
            const type = packages.TypeList.RUBY;
            let env = {
                key: 'KEY',
                value: 'VALUE'
            }
            const options = {
                type: "Ruby",
                name: "rock debug",
                request: "launch",
                program: target.path,
                cwd: userConf.cwd,
                args: userConf.args,
                env: env
            };

            mockBridge.setup(x => x.env(subject.path)).returns(() => Promise.resolve(env));
            mockContext.setup(x => x.debugConfig(subject.path)).returns(() => userConf);
            mockContext.setup(x => x.bridge).returns(() => mockBridge.object);
            mockContext.setup(x => x.getDebuggingTarget(subject.path)).
                returns(() => target);

            await subject.debug();
            mockContext.verify(x => x.startDebugging(subject.path, options), TypeMoq.Times.once());
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
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
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        await subject.build();
        mockContext.verify(x => x.runTask(task),
            TypeMoq.Times.once());
    })
    it("shows the target picking ui and sets the debugging target", async function () {
        subject.pickTarget();
        mockContext.verify(x => x.pickDebuggingFile(subject.path), TypeMoq.Times.once());
    })
    describe("debug()", function () {
        it("throws if the debugging target is unset", async function () {
            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /Select a debugging target/);
        })
        it("starts a cxx debugging session", async function () {
            const target = new debug.Target('package', '/path/to/package/build/test');
            const type = packages.TypeList.CXX;
            let userConf: context.RockDebugConfig = {
                cwd: subject.path,
                args: ['--test'],
                orogen: {
                    start: true,
                    gui: true,
                    confDir: subject.path
                }
            }
            const options = {
                type: "cppdbg",
                name: "rock debug",
                request: "launch",
                program: target.path,
                externalConsole: false,
                MIMode: "gdb",
                cwd: userConf.cwd,
                args: userConf.args,
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
            mockContext.setup(x => x.debugConfig(subject.path)).returns(() => userConf);
            mockContext.setup(x => x.getDebuggingTarget(subject.path)).
                returns(() => target);

            await subject.debug();
            mockContext.verify(x => x.startDebugging(subject.path, options), TypeMoq.Times.once());
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
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

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        await subject.build();
        mockContext.verify(x => x.runTask(task),
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
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
    })
    it("returns the OTHER package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.OTHER));
    })
})

describe("RockOrogenPackage", function () {
    let subject: packages.RockRubyPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;    
    beforeEach(function () {
        mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();        
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        subject = new packages.RockOrogenPackage("/path/to/package",
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
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        await subject.build();
        mockContext.verify(x => x.runTask(task),
            TypeMoq.Times.once());
    })
    describe("pickTarget()", function () {
        it("throws if orogen project loading fails", async function () {
            let error = new Error("test");
            mockBridge.setup(x => x.describeOrogenProject(subject.path,
                subject.name)).returns(() => Promise.reject(error));
            mockContext.setup(x => x.bridge).returns(() => mockBridge.object);
            await assertThrowsAsync(async () => {
                await subject.pickTarget();
            }, /test/);
        })
        it("shows the target picking ui and sets the debugging target", async function () {
            let expectedChoices = new Array<context.DebuggingTargetChoice>();
            let task: async.IOrogenTask = {
                model_name: 'task1',
                deployment_name: "orogen_task1",
                file: '/some/bin/deployment/binfile'
            }

            expectedChoices.push({
                label: 'task1',
                description: '',
                targetName: task.model_name,
                targetFile: task.file
            });

            mockBridge.setup(x => x.describeOrogenProject(subject.path, subject.name))
                .returns(() => Promise.resolve([ task ]));
            mockContext.setup(x => x.bridge).returns(() => mockBridge.object);
        
            let choices;
            mockContext.setup(x => x.pickDebuggingTarget(subject.path, TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                callback((path, choicesArg, ...ignored) => { choices = choicesArg });

            await subject.pickTarget();
            let givenChoices = await choices;
            assert.deepEqual(givenChoices, expectedChoices);
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
    })
    it("returns the OROGEN package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.OROGEN));
    })
})
