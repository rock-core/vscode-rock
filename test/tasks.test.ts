'use strict';
import * as assert from 'assert';
import * as helpers from './helpers';
import * as autoproj from '../src/autoproj';
import * as tasks from '../src/tasks';
import { basename, relative } from 'path';
import * as vscode from 'vscode';


describe("Task provider", function () {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let subject: tasks.Provider;

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
    function autoprojExePath(basePath)
    {
        let wsRoot = autoproj.findWorkspaceRoot(basePath) as string;
        return autoproj.autoprojExePath(wsRoot);
    }
    function assertBuildTask(task: vscode.Task, path: string, isPackage = true)
    {
        let process = autoprojExePath(path);
        let args = ['build', '--tool']; if (isPackage) args.push(path);
        assertTask(task, process, args);
    }
    function assertForceBuildTask(task: vscode.Task, path: string)
    {
        let process = autoprojExePath(path);
        let args = ['build', '--tool', '--force', '--deps=f', '--no-confirm', path];
        assertTask(task, process, args);
    }
    function assertUpdateTask(task: vscode.Task, path: string, isPackage = true)
    {
        let process = autoprojExePath(path);
        let args = ['update', '--progress=f', '-k', '--color'];
        if (isPackage) args.push(path);
        assertTask(task, process, args);
    }
    function assertCheckoutTask(task: vscode.Task, path: string, isPackage = true)
    {
        let process = autoprojExePath(path);
        let args = ['update', '--progress=f', '-k', '--color', '--checkout-only'];
        if (isPackage) args.push(path);
        assertTask(task, process, args);
    }
    function assertOsdepsTask(task: vscode.Task, path: string)
    {
        let process = autoprojExePath(path);
        let args = ['osdeps', '--color'];
        assertTask(task, process, args);
    }
    function assertUpdateConfigTask(task: vscode.Task, path: string)
    {
        let process = autoprojExePath(path);
        let args = ['update', '--progress=f', '-k', '--color', '--config'];
        assertTask(task, process, args);
    }
    function assertAllTasks(path: string)
    {
        let buildTask = subject.buildTask(path);
        assert.notEqual(buildTask, undefined);
        assertBuildTask(buildTask, path);

        let forceBuildTask = subject.forceBuildTask(path);
        assert.notEqual(forceBuildTask, undefined);
        assertForceBuildTask(forceBuildTask, path);

        let updateTask = subject.updateTask(path);
        assert.notEqual(updateTask, undefined);
        assertUpdateTask(updateTask, path);

        let checkoutTask = subject.checkoutTask(path);
        assert.notEqual(checkoutTask, undefined);
        assertCheckoutTask(checkoutTask, path);

        let ws = workspaces.folderToWorkspace.get(path) as autoproj.Workspace;
        let wsRoot = ws.root;
        buildTask = subject.buildTask(wsRoot);
        assert.notEqual(buildTask, undefined);
        assertBuildTask(buildTask, wsRoot, false);

        checkoutTask = subject.checkoutTask(wsRoot);
        assert.notEqual(checkoutTask, undefined);
        assertCheckoutTask(checkoutTask, wsRoot, false);

        let osdepsTask = subject.osdepsTask(wsRoot);
        assert.notEqual(osdepsTask, undefined);
        assertOsdepsTask(osdepsTask, wsRoot);

        let updateConfigTask = subject.updateConfigTask(wsRoot);
        assert.notEqual(updateConfigTask, undefined);
        assertUpdateConfigTask(updateConfigTask, wsRoot);

        updateTask = subject.updateTask(wsRoot);
        assert.notEqual(updateTask, undefined);
        assertUpdateTask(updateTask, wsRoot, false);
    }

    describe("in a non empty workspace", function () {
        let a: string;
        let b: string;
        let c: string;
        let d: string;
        let e: string;
        beforeEach(function () {
            helpers.mkdir('one');
            helpers.mkdir('two');
            helpers.mkdir('one', '.autoproj');
            helpers.mkdir('two', '.autoproj');
            d = helpers.mkdir('one', 'autoproj');
            e = helpers.mkdir('two', 'autoproj');

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
            workspaces.addFolder(d);
            workspaces.addFolder(e);
            subject = new tasks.Provider(workspaces);
        })
        it("is initalized with all tasks", function () {
            let tasks = subject.provideTasks(null);
            assert.equal(tasks.length, 22);

            assertAllTasks(a);
            assertAllTasks(b);
            assertAllTasks(c);
        });
    });

    describe("in an empty workspace", function () {
        beforeEach(function () {
            subject = new tasks.Provider(workspaces);
        });
        it("provides an empty array of tasks", function () {
            let tasks = subject.provideTasks(null);
            assert.equal(tasks.length, 0);
        })
        it("creates tasks when folders/workspaces are added", function () {
            helpers.mkdir('.autoproj');
            helpers.createInstallationManifest([]);
            helpers.mkdir('drivers');

            let a = helpers.mkdir('drivers', 'iodrivers_base');
            workspaces.addFolder(a);
            subject.reloadTasks();

            let tasks = subject.provideTasks(null);
            assert.equal(tasks.length, 9);
            assertAllTasks(a);
        })
    });
});