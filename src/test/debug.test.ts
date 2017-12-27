import * as assert from 'assert'
import * as TypeMoq from 'typemoq'
import * as debug from '../debug'
import * as wrappers from '../wrappers'
import * as context from '../context'
import * as vscode from 'vscode'
import * as autoproj from '../autoproj'
import * as helpers from './helpers'
import * as path from 'path'
import * as packages from '../packages'
import { basename } from 'path'
import { EnvironmentBridge } from '../async';

describe("Target", function () {
    let subject: debug.Target;
    beforeEach(function () {
        subject = new debug.Target('test', '/path/to/some/test');
    })
    it("returns the target name", function () {
        assert.equal(subject.name, 'test');
    })
    it("returns the target path", function () {
        assert.equal(subject.path, '/path/to/some/test');
    })
})

class TestContext
{
    workspaces: autoproj.Workspaces;
    mockContext: TypeMoq.IMock<context.Context>;
    mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    subject: debug.PreLaunchTaskProvider;
    constructor(workspaces: autoproj.Workspaces)
    {
        this.workspaces = workspaces;
        this.mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        let mockFactory = TypeMoq.Mock.ofType<packages.PackageFactory>();
        let mockBridge  = TypeMoq.Mock.ofType<EnvironmentBridge>();

        let ctxt = new context.Context(this.mockWrapper.object,
            workspaces,
            mockFactory.object,
            new vscode.EventEmitter(),
            mockBridge.object);
        this.mockContext = TypeMoq.Mock.ofInstance(ctxt);
        this.mockContext.callBase = true;
        this.subject = new debug.PreLaunchTaskProvider(
            this.mockContext.object);
    }

    setDebuggingTargetForPackage(path: string): debug.Target
    {
        let target = new debug.Target(basename(path), path);
        this.mockContext.setup(x => x.getDebuggingTarget(path)).returns(() => target);
        return target;
    }
    setSelectedPackage(path: string, type: packages.Type): TypeMoq.IMock<packages.Package>
    {
        let mockPkg = TypeMoq.Mock.ofType<packages.Package>();
        mockPkg.setup((x: any) => x.then).returns(() => undefined);
        this.mockContext.setup(x => x.getSelectedPackage()).
            returns(() => Promise.resolve(mockPkg.object));
        mockPkg.setup(x => x.path).returns(() => path);
        mockPkg.setup(x => x.type).returns(() => type);
        return mockPkg;
    }
    associateResourceWithFolder(resource: vscode.Uri,
        folder: vscode.WorkspaceFolder): void
    {
        this.mockWrapper.setup(x => x.getWorkspaceFolder(resource)).
            returns(() => folder);
    }
    setDebuggingConfigurationForPkg(path: string, config: context.RockDebugConfig)
    {
        this.mockContext.setup(x => x.debugConfig(path)).returns(() => config);
    }
}

describe("Pre Launch Task Provider", function () {
    let root: string;
    let workspaces: autoproj.Workspaces;
    beforeEach(function () {
        root = helpers.init();
        workspaces = new autoproj.Workspaces()
    })
    afterEach(function () {
        helpers.clear();
    })

    function assertTask(task: vscode.Task, process: string, args: string[])
    {
        let actual_process = (<vscode.ProcessExecution>task.execution).process;
        let actual_args = (<vscode.ProcessExecution>task.execution).args;
        assert.equal(actual_process, process);
        assert.deepEqual(actual_args, args);
    }

    describe("in a non empty workspace", function () {
        let a: string;
        let test: TestContext;
        beforeEach(function () {
            helpers.mkdir('one');
            helpers.mkdir('one', '.autoproj');
            helpers.createInstallationManifest([], 'one');
            helpers.mkdir('one', 'drivers');
            a = helpers.mkdir('one', 'drivers', 'iodrivers_base');
            workspaces.addFolder(a);
            test = new TestContext(workspaces);
        })
        it("creates the tasks to launch orogen components", async function () {
            let userConf: context.RockDebugConfig = {
                cwd: a,
                args: ['--test'],
                orogen: {
                    start: true,
                    gui: true,
                    confDir: a
                }
            }
            let folder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(a),
                name: basename(a),
                index: 0
            };

            let resource = vscode.Uri.file(a);
            test.setSelectedPackage(a, packages.Type.fromType(packages.TypeList.OROGEN));
            test.associateResourceWithFolder(resource, folder);
            test.setDebuggingConfigurationForPkg(a, userConf);
            let target = test.setDebuggingTargetForPackage(a);
            let tasks = await test.subject.provideTasks();
            assert.equal(tasks.length, 1);

            let process = autoproj.autoprojExePath(autoproj.findWorkspaceRoot(a));
            let args = ['exec', 'rock-run', '--start', '--gui', '--gdbserver',
                '--conf-dir', a, target.name]

            let actual_process = (<vscode.ProcessExecution>tasks[0].execution).process;
            let actual_args = (<vscode.ProcessExecution>tasks[0].execution).args;
            assert.equal(actual_process, process);
            assert.deepEqual(actual_args, args);
            assert.equal(tasks[0].scope, folder);
        });
    });
    describe("in an empty workspace", function () {
        let test: TestContext;
        beforeEach(function () {
            test = new TestContext(workspaces);
        });
        it("provides an empty array of tasks", async function () {
            let tasks = await test.subject.provideTasks();
            assert.equal(tasks.length, 0);
        })
    });
});
