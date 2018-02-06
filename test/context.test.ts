'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../src/wrappers';
import * as tasks from '../src/tasks';
import * as context from '../src/context';
import * as autoproj from '../src/autoproj';
import * as helpers from './helpers';
import * as packages from '../src/packages';
import { basename, join, relative, dirname } from 'path';
import * as fs from 'fs';
import * as debug from '../src/debug';
import { assertThrowsAsync } from './helpers';
import * as syskit from '../src/syskit';

class TestContext
{
    root: string;
    mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    mockPackageFactory: TypeMoq.IMock<packages.PackageFactory>;
    workspaces: autoproj.Workspaces;

    workspaceFolders: vscode.WorkspaceFolder[];

    subject: context.Context;
    constructor()
    {
        this.root = helpers.init();
        this.mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        this.mockWrapper.setup(x => x.workspaceFolders)
            .returns(() => this.workspaceFolders);
        let packageFactory = new packages.PackageFactory(this.mockWrapper.object);
        this.mockPackageFactory = TypeMoq.Mock.ofInstance(packageFactory);
        this.mockPackageFactory.callBase = true;
        this.workspaces = new autoproj.Workspaces;
        let mockOutputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        mockOutputChannel.setup(x => x.dispose()).returns(() => undefined)

        this.subject = new context.Context(
            this.mockWrapper.object,
            this.workspaces,
            this.mockPackageFactory.object,
            mockOutputChannel.object);
    }

    clear(): void
    {
        helpers.clear();
    }
}

describe("Context tests", function () {
    let testContext: TestContext;
    beforeEach(function () {
        testContext = new TestContext;
    })
    afterEach(function () {
        testContext.clear();
    })

    function verifyContextUpdated(times) {
        const mock = TypeMoq.Mock.ofInstance(() => undefined);
        mock.object();
        testContext.subject.onUpdate(mock);
        mock.verify(x => x(), times);
    }
    it("returns the given workspaces", function () {
        assert.strictEqual(testContext.workspaces, testContext.subject.workspaces);
    });
    it("calls envsh and fires the update event", async function () {
        const mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
        await testContext.subject.updateWorkspaceInfo(mockWs.object);
        mockWs.verify(x => x.envsh(), TypeMoq.Times.once());
        verifyContextUpdated(TypeMoq.Times.once());
    });
    describe("listExecutables()", function () {
        let files: string[];
        function createDummyExecutables() {
            helpers.mkdir('.hidden');
            helpers.mkdir('CMakeFiles');
            helpers.mkdir('subdir');

            files = [];
            files.push(helpers.mkfile('', 'suite'));
            files.push(helpers.mkfile('', '.hidden', 'suite'));
            files.push(helpers.mkfile('', 'CMakeFiles', 'suite'));
            files.push(helpers.mkfile('', 'subdir', 'test'));
            files.push(helpers.mkfile('', 'libtool'));
            files.push(helpers.mkfile('', 'configure'));
            files.push(helpers.mkfile('', 'config.status'));
            files.push(helpers.mkfile('', 'lib.so'));
            files.push(helpers.mkfile('', 'lib.so.1'));
            files.push(helpers.mkfile('', 'lib.so.1.2'));
            files.push(helpers.mkfile('', 'lib.so.1.2.3'));
            files.push(helpers.mkfile('', 'file.rb'));
            files.push(helpers.mkfile('', 'file.py'));
            files.push(helpers.mkfile('', 'file.sh'));
            for (let file of files)
                fs.chmodSync(file, 0o755);
            files.push(helpers.mkfile('', 'test'));
        }
        it("lists executables recursively", async function () {
            createDummyExecutables();
            const execs = await testContext.subject.listExecutables(testContext.root);
            assert.equal(execs.length, 2);
            assert(execs.some(file => file == files[0]));
            assert(execs.some(file => file == files[3]));
        });
        it("throws if path does not exist", async function () {
            assertThrowsAsync(function () {
                testContext.subject.listExecutables('/path/not/found');
            }, /Did you build/);
        })
    });
    describe("pickExecutable()", function () {
        let mockSubject: TypeMoq.IMock<context.Context>;
        let executables: string[];
        let subject: context.Context;
        beforeEach(function () {
            executables = [];
            executables.push('/path/to/package/build/test');
            executables.push('/path/to/package/build/other_test');
            mockSubject = TypeMoq.Mock.ofInstance(testContext.subject);
            mockSubject.setup(x => x.listExecutables(TypeMoq.It.isAny())).
                returns(() => Promise.resolve(executables));
            subject = mockSubject.target;
        })
        it("shows a picker and returns the selected executable", async function () {
            let choices: { label: string, description: string, path: string }[] = [];
            let expectedChoices: { label: string, description: string, path: string }[] = [];
            for (let choice of executables) {
                expectedChoices.push({
                    label: basename(choice),
                    description: relative('/some/dir', dirname(choice)),
                    path: choice
                });
            }
            testContext.mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                callback(async (promisedChoices, ...ignored) => { choices = await promisedChoices }).
                returns(() => Promise.resolve(expectedChoices[0]));

            let chosen = await subject.pickExecutable('/some/dir');
            assert.deepEqual(choices, expectedChoices);
            assert.equal(chosen, executables[0]);
        });
        it("returns undefined if canceled by the user", async function () {
            testContext.mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                returns(() => Promise.resolve(undefined));

            let chosen = await subject.pickExecutable('/some/dir');
            assert(!chosen);
        })
    })
    describe("pickFile()", function () {
        it("returns undefined if canceled", async function () {
            const options: vscode.OpenDialogOptions = {
                canSelectMany: false,
                canSelectFiles: true,
                canSelectFolders: false,
                defaultUri: vscode.Uri.file('/some/path'),
                openLabel: "Debug file"
            };
            testContext.mockWrapper.setup(x => x.showOpenDialog(options)).
                returns(() => Promise.resolve(undefined));
            assert(!await testContext.subject.pickFile('/some/path'));
        })
    })
    describe("pickTask()", function () {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockSyskit: TypeMoq.IMock<syskit.Connection>
        let deployments : syskit.AvailableDeployment[] = [
            {
                name: 'test_deployment',
                project_name: 'test',
                default_deployment_for: 'test::Task',
                default_logger: undefined,
                tasks: []
            }
        ]
        beforeEach(function () {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockSyskit = TypeMoq.Mock.ofType<syskit.Connection>();
            mockSyskit.setup((x: any) => x.then).returns(() => undefined);
            mockWorkspace.setup(x => x.syskitDefaultConnection()).
                returns(() => Promise.resolve(mockSyskit.object));
        })
        it("shows a quick pick ui and returns the selected task", async function () {
            let expectedChoices = new Array<any>();
            expectedChoices.push({
                label: 'test::Task',
                description: '',
                orogen_info: deployments[0]
            });
            mockSyskit.setup(x => x.availableDeployments()).
                returns(() => Promise.resolve(deployments));

            let choicesP;
            testContext.mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                callback((promisedChoices, ...ignored) => { choicesP = promisedChoices }).
                returns(() => Promise.resolve(expectedChoices[0]));

            let selected = await testContext.subject.pickTask(mockWorkspace.object);
            let choices = await choicesP;
            assert.deepStrictEqual(choices, expectedChoices);
            assert.deepStrictEqual(selected, deployments[0]);
        })
        it("shows a quick pick ui and returns undefined if canceled", async function () {
            mockSyskit.setup(x => x.availableDeployments()).
                returns(() => Promise.resolve(deployments));
            testContext.mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                returns(() => Promise.resolve(undefined));
            let selected = await testContext.subject.pickTask(mockWorkspace.object);
            assert.deepEqual(selected, undefined);
        })
    })
});
