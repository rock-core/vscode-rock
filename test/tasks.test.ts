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
    let subject: tasks.AutoprojProvider;

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
    function assertWatchTask(task: vscode.Task, path: string)
    {
        let process = autoprojExePath(path);
        let args = ['watch', '--show-events'];
        assertTask(task, process, args);
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
    function assertNodepsBuildTask(task: vscode.Task, path: string)
    {
        let process = autoprojExePath(path);
        let args = ['build', '--tool', '--deps=f', path];
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
    function assertAllPackageTasks(path: string)
    {
        let buildTask = subject.buildTask(path);
        assert.notEqual(buildTask, undefined);
        assertBuildTask(buildTask, path);

        let nodepsBuildTask = subject.nodepsBuildTask(path);
        assert.notEqual(nodepsBuildTask, undefined);
        assertNodepsBuildTask(nodepsBuildTask, path);

        let forceBuildTask = subject.forceBuildTask(path);
        assert.notEqual(forceBuildTask, undefined);
        assertForceBuildTask(forceBuildTask, path);

        let updateTask = subject.updateTask(path);
        assert.notEqual(updateTask, undefined);
        assertUpdateTask(updateTask, path);

        let checkoutTask = subject.checkoutTask(path);
        assert.notEqual(checkoutTask, undefined);
        assertCheckoutTask(checkoutTask, path);
    }

    function assertAllWorkspaceTasks(wsRoot: string) {
        let watchTask = subject.watchTask(wsRoot);
        assert.notEqual(watchTask, undefined);
        assertWatchTask(watchTask, wsRoot);

        let buildTask = subject.buildTask(wsRoot);
        assert.notEqual(buildTask, undefined);
        assertBuildTask(buildTask, wsRoot, false);

        let checkoutTask = subject.checkoutTask(wsRoot);
        assert.notEqual(checkoutTask, undefined);
        assertCheckoutTask(checkoutTask, wsRoot, false);

        let osdepsTask = subject.osdepsTask(wsRoot);
        assert.notEqual(osdepsTask, undefined);
        assertOsdepsTask(osdepsTask, wsRoot);

        let updateConfigTask = subject.updateConfigTask(wsRoot);
        assert.notEqual(updateConfigTask, undefined);
        assertUpdateConfigTask(updateConfigTask, wsRoot);

        let updateTask = subject.updateTask(wsRoot);
        assert.notEqual(updateTask, undefined);
        assertUpdateTask(updateTask, wsRoot, false);
    }

    describe("in a non empty workspace", function () {
        let wsOneRoot: string;
        let wsTwoRoot: string;
        let a: string;
        let b: string;
        let c: string;
        let d: string;
        let e: string;
        beforeEach(function () {
            wsOneRoot = helpers.mkdir('one');
            wsTwoRoot = helpers.mkdir('two');
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
            subject = new tasks.AutoprojProvider(workspaces);
        })

        it("is initalized with all tasks", function () {
            let tasks = subject.provideTasks(null);
            assert.equal(tasks.length, 27);
        })
        it("is initalized with all workspace tasks", function () {
            let tasks = subject.provideTasks(null);
            assertAllWorkspaceTasks(wsOneRoot);
            assertAllWorkspaceTasks(wsTwoRoot);
        });
        it("is initalized with all package tasks", function () {
            let tasks = subject.provideTasks(null);
            assertAllPackageTasks(a);
            assertAllPackageTasks(b);
            assertAllPackageTasks(c);
        });
    });

    describe("in an empty workspace", function () {
        beforeEach(function () {
            subject = new tasks.AutoprojProvider(workspaces);
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
            assert.equal(tasks.length, 11);
            assertAllWorkspaceTasks(helpers.fullPath());
            assertAllPackageTasks(a);
        })
    });
});