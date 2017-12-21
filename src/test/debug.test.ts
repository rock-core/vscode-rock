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

describe("Pre Launch Task Provider", function () {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let mockContext: TypeMoq.IMock<context.Context>;
    let subject: debug.PreLaunchTaskProvider;

    beforeEach(function () {
        root = helpers.init();
        workspaces = new autoproj.Workspaces()
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockContext.setup(x => x.workspaces).returns(() => workspaces);
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
        let target: debug.Target;
        let mockPkg: TypeMoq.IMock<packages.RockOrogenPackage>;
        beforeEach(function () {
            helpers.mkdir('one');
            helpers.mkdir('one', '.autoproj');
            helpers.createInstallationManifest([], 'one');
            helpers.mkdir('one', 'drivers');
            a = helpers.mkdir('one', 'drivers', 'iodrivers_base');

            workspaces.addFolder(a);
            subject = new debug.PreLaunchTaskProvider(mockContext.object);

            target = new debug.Target('iodrivers_base', a);
            mockContext.setup(x => x.getDebuggingTarget(a)).returns(() => target);
            mockPkg = TypeMoq.Mock.ofType<packages.RockOrogenPackage>();
            mockPkg.setup((x: any) => x.then).returns(() => undefined);
            mockContext.setup(x => x.getSelectedPackage()).
                returns(() => Promise.resolve(mockPkg.object));
            mockPkg.setup(x => x.path).returns(() => a);
            mockPkg.setup(x => x.type).
                returns(() => packages.Type.fromType(packages.TypeList.OROGEN));
        })
        it("creates the tasks to launch orogen components", async function () {
            let tasks = await subject.provideTasks();
            assert.equal(tasks.length, 1);

            let process = autoproj.autoprojExePath(autoproj.findWorkspaceRoot(a));
            let args = ['exec', 'rock-run', '--gui', '--gdbserver', '--conf-dir',
                path.join(a, 'scripts'), target.name]
            assertTask(tasks[0], process, args);
        });
    });
    describe("in an empty workspace", function () {
        beforeEach(function () {
            subject = new debug.PreLaunchTaskProvider(mockContext.object);
        });
        it("provides an empty array of tasks", async function () {
            mockContext.setup(x => x.getSelectedPackage()).
                returns(() => Promise.resolve(new packages.InvalidPackage));

            let tasks = await subject.provideTasks();
            assert.equal(tasks.length, 0);
        })
    });
});
