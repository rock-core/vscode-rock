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
import { assertThrowsAsync } from './helpers';

function autoprojMakePackage(name, type, path) {
    return {
        name: name,
        type: type,
        srcdir: path,
        builddir: '',
        prefix: '',
        vcs: { type: 'git', url: '', repository_id: '' },
        logdir: '',
        dependencies: []
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
    let root: string;
    let s: helpers.TestSetup;
    let subject: packages.PackageFactory;
    beforeEach(function () {
        root = helpers.init();
        s = new helpers.TestSetup();
        subject = s.packageFactory;
    })
    it("creates a ConfigPackage for a package set", async function () {
        let path = '/path/to/package';
        s.mockWorkspaces.setup(x => x.isConfig(path)).returns(() => true)
        let aPackage = await subject.createPackage(path, s.context);
        assert(aPackage instanceof packages.ConfigPackage);
    })
    it("creates an InvalidPackage if package is not in vscode ws", async function () {
        let path = '/path/to/package';
        s.mockWrapper.setup(x => x.getWorkspaceFolder(path)).
            returns(() => undefined);
        let aPackage = await subject.createPackage(path, s.context);
        assert.equal(aPackage.name, '(Invalid package)');
    })
    describe("the package is neither invalid nor a configuration", function () {
        let path;
        let folder: vscode.WorkspaceFolder;
        beforeEach(function() {
            path = helpers.mkdir('package');
            helpers.registerDir('.vscode');
            folder = {
                uri: vscode.Uri.file(path),
                name: 'package',
                index: 0
            }
            s.mockWrapper.setup(x => x.getWorkspaceFolder(path)).
                returns(() => folder)
        })
        it("creates a ForeignPackage if the package is not in an autoproj ws", async function () {
            s.mockContext.
                setup(x => x.getWorkspaceByPath(path)).returns(() => undefined)

            let aPackage = await subject.createPackage(path, s.context);
            assert(aPackage instanceof packages.ForeignPackage);
        })
        describe("the package is in an autoproj workspace", function () {
            let mockWS: TypeMoq.IMock<autoproj.Workspace>;
            let ws: autoproj.Workspace;
            let emptyInfo: autoproj.WorkspaceInfo;
            const rubyType = packages.Type.fromType(packages.TypeList.RUBY)
            const otherType = packages.Type.fromType(packages.TypeList.OTHER)
            beforeEach(async function () {
                let created = s.createAndRegisterWorkspace('test');
                mockWS = created.mock;
                ws = created.ws;
                s.mockContext.setup(x => x.getWorkspaceByPath(path)).
                    returns((path) => ws);
                emptyInfo = new autoproj.WorkspaceInfo(ws.root);
                mockWS.setup(x => x.envsh()).returns(() => Promise.resolve(emptyInfo));
            })
            it("returns the type set by the user even if there is no data in the workspace", async function () {
                s.mockContext.setup(x => x.getPackageType(path)).
                    returns(() => packages.Type.fromType(packages.TypeList.RUBY));
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.RUBY));
            })
            it("returns the type set by the user, overriding what is in the workspace", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::CMake' });
                s.context.setPackageType(path, rubyType);
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, rubyType);
            })
            it("sets a null package info if the workspace doesn't have one", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::CMake' });
                mockWS.setup(x => x.info()).returns(() => Promise.resolve(emptyInfo));
                s.context.setPackageType(path, rubyType);
                let aPackage = await subject.createPackage(path, s.context);
                assert.equal("Unknown", (aPackage as packages.RockPackage).info.type);
            })
            it("returns an OTHER package if the manifest has no type info and the user has not set a type", async function () {
                mockWS.setup(x => x.info()).returns(() => Promise.resolve(emptyInfo));
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, otherType);
            })
            it("returns the package type defined in the manifest", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::Ruby' });
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, rubyType);
            })
            it("embeds the containing workspace in the package objects", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::Ruby' });
                let aPackage = await subject.createPackage(path, s.context);
                assert.equal((aPackage as packages.RockPackage).ws, ws);
            })
            it("attempts to regenerate the manifest if the package is not present in it", async function() {
                mockWS.setup(x => x.envsh()).
                    returns(() => {
                        s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::Ruby' })
                        return ws.reload();
                    });
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, rubyType);
            })
            it("returns OTHER if the package is not in the manifest even after reloading", async function () {
                mockWS.setup(x => x.envsh()).returns(() => Promise.resolve(emptyInfo));
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, otherType);
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
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;

    beforeEach(function () {
        mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new packages.RockRubyPackage(
            mockBridge.object,
            autoprojMakePackage('package', 'Autobuild::Ruby', "/path/to/package"),
            mockContext.object, mockWrapper.object, mockTaskProvider.object);
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
        mockWrapper.verify(x => x.runTask(task), TypeMoq.Times.once());
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
            mockContext.setup(x => x.getDebuggingTarget(subject.path)).
                returns(() => target);

            await subject.debug();
            mockWrapper.verify(x => x.startDebugging(subject.path, options), TypeMoq.Times.once());
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
    let subject: packages.RockCXXPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new packages.RockCXXPackage(
            autoprojMakePackage('package', 'Autobuild::CMake', "/path/to/package"),
            mockContext.object, mockWrapper.object, mockTaskProvider.object);
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
        mockWrapper.verify(x => x.runTask(task),
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
            mockWrapper.verify(x => x.startDebugging(subject.path, options), TypeMoq.Times.once());
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
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new packages.RockOtherPackage("/path/to/package",
            mockContext.object, mockWrapper.object, mockTaskProvider.object);
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
        mockWrapper.verify(x => x.runTask(task),
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
    let subject: packages.RockOrogenPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;    
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    beforeEach(function () {
        mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();        
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new packages.RockOrogenPackage(
            mockBridge.object,
            autoprojMakePackage('package', 'Autobuild::Orogen', "/path/to/package"),
            mockContext.object, mockWrapper.object, mockTaskProvider.object);
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
        mockWrapper.verify(x => x.runTask(task),
            TypeMoq.Times.once());
    })
    describe("pickTarget()", function () {
        it("throws if orogen project loading fails", async function () {
            let error = new Error("test");
            mockBridge.setup(x => x.describeOrogenProject(subject.path,
                subject.name)).returns(() => Promise.reject(error));
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
