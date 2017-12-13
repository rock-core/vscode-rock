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

            it("throws if the selected package does not belong to an autoproj workspace", async function () {
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
    });
});